/**
 * ToolCube - Background Service Worker
 * 后台服务工作者，处理插件核心逻辑
 * @version 1.3.0
 */

import { TOOLS_CONFIG } from './common/tool-registry.js';
import { analyzeFile } from './common/pe-analyzer.js';
import {
  SERVICE_KINDS,
  PROVIDERS,
  SERVICE_CONFIG_KEY,
  defaultServiceConfig,
  normalizeServiceConfig,
  resolveEndpoint,
  validateParams,
  getServiceKind,
  isClientTransport,
  buildClientRequestUrl
} from './common/service-providers.js';

// ==================== 全局配置 ====================
// 在 Service Worker 模式下 globalThis === self，在 Firefox background.scripts 模式下 globalThis === window
const self_ref = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);

// 全局错误捕获 — 帮助诊断后台脚本问题
self_ref.addEventListener('error', (event) => {
  console.error('[ToolCube] Background Error:', event.error?.message || event.message);
});
self_ref.addEventListener('unhandledrejection', (event) => {
  console.error('[ToolCube] Background Unhandled Rejection:', event.reason?.message || event.reason);
});

/**
 * 记录被忽略的错误。
 *
 * 后台有若干「尽力而为」的降级路径（标签页已关闭、存储写入失败、消息无人接收等），
 * 这些失败不应打断主流程，因此捕获后不再抛出。但完全静默会让真实故障无从排查，
 * 故保留一条 console.debug —— 它属于 verbose 级别，默认不在 DevTools 中显示；
 * 需要排查时打开 Verbose 即可看到，正常使用不会刷屏。
 */
function logIgnored(err) {
  console.debug('[ToolCube] 已忽略的错误:', err);
}

// ==================== 全局配置 ====================
// DNR 规则 ID 分配表：
// 9000          - ua-switcher
// 9100-9199     - video-unlocker 上报拦截
// 10000-10999   - tracker-blocker
// 11000-11999   - https-enforcer
// 12000-12999   - 预留
// 13000-13999   - custom-headers
const CONFIG = {
  VERSION: '1.2.6',
  STORAGE_KEYS: {
    SETTINGS: 'toolbox_settings',
    FAVORITES: 'toolbox_favorites',
    HISTORY: 'toolbox_history',
    TOOLS_STATUS: 'tools_status',
    USER_PREFS: 'user_preferences',
    CACHE: 'toolbox_cache',
    RECENT: 'toolbox_recent',
    DB_NAME: 'ToolboxDB'
  },
  DEFAULT_SETTINGS: {
    theme: 'auto',
    language: 'zh-CN',
    sidebarPosition: 'right',
    sidebarWidth: 400,
    autoSave: true,
    showNotifications: true,
    enableAnalytics: false,
    showFloatingBtn: true,
    toolsOrder: [],
    disabledTools: [],
    shortcuts: {
      toggleSidebar: 'Ctrl+Shift+B',
      quickSearch: 'Ctrl+Shift+K'
    }
  },
  // 工具列表统一从 common/tool-registry.js 获取，避免多处维护导致不一致
  get ALL_TOOLS() { return TOOLS_CONFIG; }
};

// ==================== 初始化 ====================

/**
 * 插件安装/更新时的初始化
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[ToolCube] Extension installed/updated:', details.reason);
  
  try {
    // 首次安装初始化
    if (details.reason === 'install') {
      await initializeExtension();
    }
    
    // 更新时迁移数据
    if (details.reason === 'update') {
      await migrateData(details.previousVersion);
    }
    
    // 创建右键菜单
    createContextMenus();
    
    // 设置默认快捷键
    await setupDefaultShortcuts();
    
    // 恢复持久化安全功能的规则
    await restorePersistentFeatures();
    
    console.log('[ToolCube] Initialization completed');
  } catch (error) {
    console.error('[ToolCube] Initialization failed:', error);
  }
});

/**
 * Service Worker 启动时恢复持久化安全功能
 */
chrome.runtime.onStartup.addListener(async () => {
  try {
    await restorePersistentFeatures();
    console.log('[ToolCube] Persistent features restored on startup');
  } catch (error) {
    console.error('[ToolCube] Failed to restore persistent features on startup:', error);
  }
});

/**
 * 初始化插件默认设置
 */
async function initializeExtension() {
  console.log('[ToolCube] Initializing default settings...');

  // 自动检测浏览器语言（zh-CN / zh-TW / en）
  const detectedLang = detectBrowserLocale();

  // 设置默认配置（包含自动检测的语言）
  // 注意：所有数据统一使用 chrome.storage.local，避免 sync 的 8KB 单条限制
  const defaultSettings = { ...CONFIG.DEFAULT_SETTINGS, language: detectedLang };
  await chrome.storage.local.set({
    [CONFIG.STORAGE_KEYS.SETTINGS]: defaultSettings,
    [CONFIG.STORAGE_KEYS.FAVORITES]: [],
    [CONFIG.STORAGE_KEYS.TOOLS_STATUS]: generateDefaultToolsStatus(),
    [CONFIG.STORAGE_KEYS.HISTORY]: [],
    [CONFIG.STORAGE_KEYS.USER_PREFS]: {}
  });
  // 用 remove 而非 set null：确保 hasAccepted() 严格判定为未同意
  await chrome.storage.local.remove(['toolbox_terms_v1', 'toolbox_first_run_done_v1']);

  // 创建IndexedDB数据库
  await createIndexedDB();

  // 显示欢迎通知
  // 快捷键文案必须与 manifest.json 的 commands 保持一致（toggle-sidebar = Ctrl+Shift+B），
  // 否则用户按提示操作不会有任何反应。
  showNotification(
    'ToolCube 安装成功',
    '按 Ctrl+Shift+B 打开ToolCube侧边栏',
    'icons/icon128.png'
  );
}

/**
 * 自动检测浏览器语言
 * @returns {'zh-CN' | 'zh-TW' | 'en'}
 */
function detectBrowserLocale() {
  try {
    const lang = chrome.i18n?.getUILanguage?.() || (typeof navigator !== 'undefined' ? (navigator.language || '') : '');
    if (lang.startsWith('zh')) {
      if (lang === 'zh-TW' || lang === 'zh-HK' || lang === 'zh-MO') return 'zh-TW';
      if (lang === 'zh-CN' || lang === 'zh-SG') return 'zh-CN';
      return 'zh-CN';
    }
    return 'en';
  } catch (e) {
    return 'zh-CN';
  }
}

/**
 * 生成默认工具状态
 */
function generateDefaultToolsStatus() {
  const status = {};
  CONFIG.ALL_TOOLS.forEach(tool => {
    status[tool.id] = {
      enabled: true,
      order: 0,
      useCount: 0,
      lastUsed: null
    };
  });
  return status;
}

/**
 * 数据迁移（版本更新时）
 */
async function migrateData(previousVersion) {
  console.log('[ToolCube] Migrating data from version:', previousVersion);

  // 迁移旧版 chrome.storage.sync 数据到 chrome.storage.local
  // 旧版使用 sync 存储，但 sync 单条限制 8KB，80+ 工具状态会超限
  try {
    const syncData = await chrome.storage.sync.get(null);
    if (syncData && Object.keys(syncData).length > 0) {
      // 将 sync 数据合并到 local（不覆盖已有的 local 数据）
      const localData = await chrome.storage.local.get(null);
      const merged = { ...syncData, ...localData }; // local 优先
      await chrome.storage.local.set(merged);
      // 迁移完成后清空 sync，避免重复迁移
      await chrome.storage.sync.clear();
      console.log('[ToolCube] Migrated sync data to local');
    }
  } catch (e) {
    // sync 可能不可用或为空，忽略
    console.log('[ToolCube] Sync migration skipped:', e.message);
  }

  // 合并新配置项
  const result = await chrome.storage.local.get(CONFIG.STORAGE_KEYS.SETTINGS);
  const currentSettings = result[CONFIG.STORAGE_KEYS.SETTINGS];
  if (currentSettings) {
    const mergedSettings = { ...CONFIG.DEFAULT_SETTINGS, ...currentSettings };
    await chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.SETTINGS]: mergedSettings });
  }
}

/**
 * 创建IndexedDB数据库
 */
async function createIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ToolboxDB', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // 历史记录存储
      if (!db.objectStoreNames.contains('history')) {
        const historyStore = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
        historyStore.createIndex('toolId', 'toolId', { unique: false });
        historyStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
      
      // 文件缓存存储
      if (!db.objectStoreNames.contains('fileCache')) {
        const fileStore = db.createObjectStore('fileCache', { keyPath: 'id' });
        fileStore.createIndex('expireAt', 'expireAt', { unique: false });
      }
      
      // 工具数据存储
      if (!db.objectStoreNames.contains('toolData')) {
        db.createObjectStore('toolData', { keyPath: 'toolId' });
      }
    };
  });
}

// 缓存的 IndexedDB 连接（复用连接，避免每次操作都重新 open）
let _dbPromise = null;

/**
 * 获取（或创建并缓存）IndexedDB 连接
 * @returns {Promise<IDBDatabase>}
 */
function getDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = createIndexedDB().catch((e) => {
    _dbPromise = null; // 失败后允许下次重试
    throw e;
  });
  return _dbPromise;
}

// ==================== 右键菜单 ====================

/**
 * 创建右键菜单
 */
async function createContextMenus() {
  // 清除现有菜单
  await chrome.contextMenus.removeAll();

  // 主菜单
  chrome.contextMenus.create({
    id: 'toolbox-root',
    title: '用 ToolCube 处理选中内容',
    contexts: ['selection', 'page']
  });

  // 子菜单项
  const menuItems = [
    { id: 'json-format', title: 'JSON格式化', parentId: 'toolbox-root' },
    { id: 'base64-encode', title: 'Base64编码', parentId: 'toolbox-root' },
    { id: 'base64-decode', title: 'Base64解码', parentId: 'toolbox-root' },
    { id: 'url-encode', title: 'URL编码', parentId: 'toolbox-root' },
    { id: 'url-decode', title: 'URL解码', parentId: 'toolbox-root' },
    { id: 'timestamp-convert', title: '时间戳转换', parentId: 'toolbox-root' },
    { id: 'hash-md5', title: '生成MD5哈希', parentId: 'toolbox-root' },
    { id: 'open-sidebar', title: '打开ToolCube侧边栏', parentId: 'toolbox-root' }
  ];

  menuItems.forEach(item => {
    chrome.contextMenus.create({
      id: item.id,
      title: item.title,
      parentId: item.parentId,
      contexts: ['selection', 'page']
    });
  });
}

/**
 * 右键菜单点击处理
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const selectedText = info.selectionText || '';
  
  switch (info.menuItemId) {
    case 'json-format':
      await openToolWithData('json-formatter', selectedText, tab.id);
      break;
    case 'base64-encode':
      await openToolWithData('base64-converter', { action: 'encode', text: selectedText }, tab.id);
      break;
    case 'base64-decode':
      await openToolWithData('base64-converter', { action: 'decode', text: selectedText }, tab.id);
      break;
    case 'url-encode':
      await openToolWithData('url-encoder', { action: 'encode', text: selectedText }, tab.id);
      break;
    case 'url-decode':
      await openToolWithData('url-encoder', { action: 'decode', text: selectedText }, tab.id);
      break;
    case 'timestamp-convert':
      await openToolWithData('timestamp-converter', selectedText, tab.id);
      break;
    case 'hash-md5':
      await openToolWithData('hash-generator', { algorithm: 'md5', text: selectedText }, tab.id);
      break;
    case 'open-sidebar':
      await toggleSidebar(tab.id);
      break;
  }
});

// ==================== 消息处理 ====================

/**
 * 处理来自content script和popup的消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, data } = message;

  // 防御性来源校验：只接受本扩展自身发出的消息。
  // 当前未声明 externally_connectable，外部扩展与网页本就无法直接发消息到这里；
  // 但显式校验可以避免将来误加 externally_connectable 后，悄悄打开一个无鉴权的入口。
  if (sender && sender.id && sender.id !== chrome.runtime.id) {
    console.warn('[ToolCube] 已拒绝非本扩展来源的消息:', action);
    sendResponse({ success: false, error: 'Unauthorized sender' });
    return true;
  }

  // 异步处理消息
  handleMessage(action, data, sender).then(result => {
    // 各 handler 自行返回含 success 字段的结果对象，直接透传
    sendResponse(result);
  }).catch(error => {
    console.error('[ToolCube] Message handling error:', error);
    sendResponse({ success: false, error: error.message });
  });
  
  // 返回true表示异步响应
  return true;
});

/**
 * 全局开关白名单：以下动作在全局开关关闭时仍允许执行
 * 提升为模块级常量，避免每次消息处理都重建 Set
 */
const MASTER_WHITELIST = new Set([
  'masterSwitchOn', 'masterSwitchOff',
  'getSettings', 'saveSettings',
  'getToolsList', 'getToolConfig',
  'getToolData', 'saveToolData',
  'getHistory', 'saveToHistory',
  'getFavorites', 'addFavorite', 'removeFavorite',
  'openOptionsPage',
  'exportData', 'importData', 'clearData', 'getAllData',
  'toggleSidebar',
  // 工具所需的查询/分析类 action（只读操作，不修改状态）
  'getTabInfo', 'getNetworkAnalysis',
  'fetchHeaders', 'fetchSecurityHeaders',
  'extractPageJsonData', 'sendTabMessage',
  'downloadResource', 'fetchResourceMeta'
]);

/**
 * 将消息转发到当前活动标签页的 content script（带注入兜底）
 * 用于自动连播等工具页需要与页面 content script 交互的场景
 */
async function forwardToActiveTab(action, data, sender) {
  let tabId = sender.tab?.id;
  if (!tabId) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id;
    } catch (e) { logIgnored(e); }
  }
  if (!tabId) return { success: false, error: 'No active tab' };
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { action, data });
    return { success: true, data: resp };
  } catch (e) {
    // content script 未注入时尝试注入后重试
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/injector.js', 'content/auto-play-next.js']
      });
      await new Promise(r => setTimeout(r, 150));
      const resp = await chrome.tabs.sendMessage(tabId, { action, data });
      return { success: true, data: resp };
    } catch (e2) {
      return { success: false, error: e2.message };
    }
  }
}

/**
 * 消息处理分发器
 */
async function handleMessage(action, data, sender) {
  if (!MASTER_WHITELIST.has(action)) {
    try {
      const master = await chrome.storage.local.get('toolbox_master_enabled');
      if (master.toolbox_master_enabled === false) {
        return { success: false, error: '全局开关已关闭', masterOff: true };
      }
    } catch (e) { logIgnored(e); }
  }
  switch (action) {
    case 'getToolsList':
      return getToolsList();
    case 'getToolConfig':
      return getToolConfig(data.toolId);
    case 'toggleSidebar':
      // popup 发来时 sender.tab 为 undefined，用 data.tabId；content script 发来时用 sender.tab.id
      return toggleSidebar(data?.tabId || sender.tab?.id, data?.forceOpen || false);
    case 'openTool':
      // popup 等非 tab 上下文发送时显式携带 tabId，content script 发送时用 sender.tab
      return openTool(data.toolId, data.params, data.tabId || sender.tab?.id);
    case 'openToolWithData':
      return openToolWithData(data.toolId, data.input, data.tabId || sender.tab?.id);
    case 'saveToHistory':
      return saveToHistory(data);
    case 'getHistory':
      return getHistory(data.toolId, data.limit);
    case 'addFavorite':
      return addFavorite(data.toolId);
    case 'removeFavorite':
      return removeFavorite(data.toolId);
    case 'getFavorites':
      return getFavorites();
    case 'saveToolData':
      return saveToolData(data.toolId, data.data);
    case 'getToolData':
      return getToolData(data.toolId);
    case 'getSettings':
      return getSettings();
    case 'saveSettings':
      return saveSettings(data);
    case 'exportData':
      return exportData();
    case 'importData':
      return importData(data);
    case 'clearData':
      return clearData(data.type);
    case 'deleteHistory':
      return deleteHistoryItem(data.id);
    case 'clearToolHistory':
      return clearToolHistory(data.toolId);
    case 'getAllData':
      return exportData();
    case 'getTabInfo':
      return getTabInfo(sender.tab?.id);
    // ===== 新增消息处理 =====
    case 'downloadResource':
      return downloadResource(data);
    case 'batchDownload':
      return batchDownload(data);
    case 'fetchResourceMeta':
      return fetchResourceMeta(data.url);
    case 'parseM3U8':
      return parseM3U8(data.url, data.maxSegments);
    case 'listTabs':
      return listTabs(data?.query || {});
    case 'closeTabs':
      return closeTabs(data.tabIds);
    case 'switchTab':
      return switchTab(data.tabId);
    case 'groupTabs':
      return groupTabs(data.tabIds, data.title, data.color);
    case 'getAllCookies':
      return getAllCookies(data?.domain);
    case 'getCookie':
      return getCookie(data);
    case 'setCookie':
      return setCookie(data);
    case 'deleteCookie':
      return deleteCookie(data);
    case 'deleteAllCookies':
      return deleteAllCookies(data?.domain);
    case 'expandShortUrl':
      return expandShortUrl(data.url, data.maxHops);
    case 'getCurrentUA':
      return getCurrentUA(sender.tab?.id);
    case 'setDeclarativeRule':
      return setDeclarativeRule(data, sender.tab?.id);
    case 'clearDeclarativeRules':
      return clearDeclarativeRules();
    case 'listDeclarativeRules':
      return listDeclarativeRules();
    case 'requestOptionalPermissions':
      return requestOptionalPermissions(data?.permissions || []);
    case 'checkPermissions':
      return checkPermissions(data?.permissions || []);
    case 'getBrowserInfo':
      return getBrowserInfo();
    case 'fetchHeaders':
      return fetchHeaders(data.url);
    case 'fetchSecurityHeaders':
      return fetchSecurityHeaders(data.url);
    case 'extractPageJsonData':
      return extractPageJsonData();
    case 'sendTabMessage':
      return sendTabMessage(data);
    // ===== 持久化安全功能 =====
    case 'trackerBlocker_enable':
      return trackerBlockerEnable(data);
    case 'trackerBlocker_disable':
      return trackerBlockerDisable();
    case 'trackerBlocker_getCatalog':
      return trackerBlockerCatalog();
    case 'httpsEnforcer_enable':
      return httpsEnforcerEnable(data);
    case 'httpsEnforcer_disable':
      return httpsEnforcerDisable();
    case 'antiFingerprint_enable':
      return antiFingerprintEnable(data);
    case 'antiFingerprint_disable':
      return antiFingerprintDisable();
    case 'antiFingerprint_reportHits':
      return antiFingerprintReportHits(data);
    case 'customHeaders_enable':
      return customHeadersEnable(data);
    case 'customHeaders_disable':
      return customHeadersDisable();
    case 'scriptInjector_enable':
      return scriptInjectorEnable(data);
    case 'scriptInjector_disable':
      return scriptInjectorDisable();
    case 'autoPlayNext_enable':
      return autoPlayNextEnable(data);
    case 'autoPlayNext_disable':
      return autoPlayNextDisable();
    case 'videoUnlocker_enable':
      return videoUnlockerEnable(data);
    case 'videoUnlocker_disable':
      return videoUnlockerDisable();
    case 'videoUnlocker_setReportBlocking':
      return videoUnlockerSetReportBlocking(data);
    case 'autoPlayNext_addHistory':
      return autoPlayNextAddHistory(data);
    case 'autoPlayNext_getHistory':
      return autoPlayNextGetHistory();
    case 'autoPlayNext_clearHistory':
      return autoPlayNextClearHistory();
    // 自动连播工具页发起的"元素拾取/测试连播"：转发到当前活动标签页的 content script
    case 'autoPlayNext_startPick':
    case 'autoPlayNext_test':
      return forwardToActiveTab(action, data, sender);
    case 'masterSwitchOff':
      return handleMasterSwitchOff();
    case 'masterSwitchOn':
      return handleMasterSwitchOn();
    case 'getNetworkAnalysis':
      return getNetworkAnalysis();
    case 'downloadAndMergeM3U8':
      return downloadAndMergeM3U8(data);
    case 'silverFoxGuard_enable':
      return silverFoxGuardEnable(data);
    case 'silverFoxGuard_disable':
      return silverFoxGuardDisable();
    case 'silverFoxGuard_getStats':
      return silverFoxGuardGetStats();
    case 'portScan':
      return portScan(data.host, data.ports, data.timeout);
    // ===== 外部服务端点（可插拔：支持接入自建服务器）=====
    case 'serviceRequest':
      return serviceRequest(data);
    case 'serviceProviders':
      return serviceProviders();
    case 'serviceConfigGet':
      return serviceConfigGet();
    case 'serviceConfigSet':
      return serviceConfigSet(data && data.config);
    case 'serviceConfigReset':
      return serviceConfigReset();
    case 'serviceTest':
      return serviceRequest({
        kind: data && data.kind,
        params: serviceProbeParams(data && data.kind),
        providerId: data && data.providerId
      });
    case 'clientRequestUrl':
      return clientRequestUrl(data);
    // ===== 以下为兼容旧调用方的薄适配层，内部统一走 serviceRequest =====
    case 'dnsLookup':
      return dnsLookup(data.domain, data.type, data.provider);
    case 'sslCheck':
      return sslCheck(data.domain);
    case 'findSubdomains':
      return findSubdomains(data.domain, data.source);
    case 'whoisLookup':
      return whoisLookup(data.domain);
    case 'openOptionsPage':
      return openOptionsPageHandler();
    case 'fetchUrl':
      return fetchUrl(data);
    case 'ipLookup':
      return ipLookup(data && data.ip);
    case 'getMyIp':
      return getMyIp();
    // ===== 截图增强：通过 tabs.captureVisibleTab 实现真实截图 =====
    case 'captureVisibleTab':
      return captureVisibleTab(data);
    case 'captureTabRegion':
      return captureTabRegion(data);
    case 'captureFullPage':
      return captureFullPage(data);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/**
 * 截取当前活动标签页的可见区域
 * 使用 tabs.captureVisibleTab API 获取真实像素截图（远比 canvas 绘制 DOM 准确）
 */
async function captureVisibleTab(data) {
  try {
    const format = (data && data.format) || 'png';
    const quality = (data && data.quality) || 92;
    // 获取当前窗口的活动标签页
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs.length) {
      return { success: false, error: '没有找到活动标签页' };
    }
    const tabId = tabs[0].id;
    const windowId = tabs[0].windowId;
    // chrome.tabs.captureVisibleTab 接受 windowId
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: format === 'jpeg' ? 'jpeg' : 'png',
      quality: quality
    });
    return { success: true, dataUrl, tabId, width: tabs[0].width, height: tabs[0].height };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 截取当前活动标签页的指定矩形区域
 */
async function captureTabRegion(data) {
  try {
    if (!data || !data.rect) return { success: false, error: '缺少 rect 参数' };
    const { x, y, width, height } = data.rect;
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs.length) return { success: false, error: '没有找到活动标签页' };
    const windowId = tabs[0].windowId;
    const fullDataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: data.format === 'jpeg' ? 'jpeg' : 'png',
      quality: data.quality || 92
    });
    // 通过 OffscreenCanvas 裁剪（service worker 不能用 Image，但可用 OffscreenCanvas）
    if (typeof OffscreenCanvas === 'undefined') {
      // 降级：返回完整图，由 content script 裁剪
      return { success: true, dataUrl: fullDataUrl, needCrop: true, rect: data.rect };
    }
    const blob = await (await fetch(fullDataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
    const outBlob = await canvas.convertToBlob({
      type: data.format === 'jpeg' ? 'image/jpeg' : 'image/png',
      quality: (data.quality || 92) / 100
    });
    return { success: true, dataUrl: await blobToDataURL(outBlob) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 将 Blob 转换为 data URL
 *
 * 不使用 FileReader：Chrome MV3 的后台是 Service Worker，而 Service Worker 环境
 * 不提供 FileReader，调用会直接抛错。改用 arrayBuffer + 分块 base64 编码，
 * 在 Chrome Service Worker 与 Firefox 事件页两种后台环境下均可用。
 *
 * @param {Blob} blob
 * @returns {Promise<string>} data URL
 */
async function blobToDataURL(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 8192; // 分块避免 String.fromCharCode 参数过多导致栈溢出
  const chunks = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length))));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(chunks.join(''))}`;
}

/**
 * 全页面截图：通过滚动页面分段截取并拼接
 * 注意：实际拼接由 content script 完成（需要 canvas），这里仅返回分段截图数据
 */
async function captureFullPage(data) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs.length) return { success: false, error: '没有找到活动标签页' };
    const tabId = tabs[0].id;
    const windowId = tabs[0].windowId;
    // 通过 content script 获取页面尺寸
    const pageInfo = await chrome.tabs.sendMessage(tabId, { action: '__getFullPageDimensions' }).catch(() => null);
    if (!pageInfo) {
      // 降级：仅截取可见区域
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
        format: (data && data.format) === 'jpeg' ? 'jpeg' : 'png',
        quality: (data && data.quality) || 92
      });
      return { success: true, dataUrl, fullPage: false };
    }
    const { scrollWidth, scrollHeight, viewportWidth, viewportHeight, devicePixelRatio } = pageInfo;
    // 计算需要截取的次数
    const captures = [];
    const cols = Math.ceil(scrollWidth / viewportWidth);
    const rows = Math.ceil(scrollHeight / viewportHeight);
    // 通知 content script 滚动到指定位置后等待
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * viewportWidth;
        const y = r * viewportHeight;
        // 通知滚动
        await chrome.tabs.sendMessage(tabId, { action: '__scrollTo', data: { x, y } });
        // 等待渲染稳定
        await new Promise(resolve => setTimeout(resolve, 250));
        // 截图
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
          format: (data && data.format) === 'jpeg' ? 'jpeg' : 'png',
          quality: (data && data.quality) || 92
        });
        captures.push({ x, y, dataUrl });
      }
    }
    // 恢复滚动位置
    await chrome.tabs.sendMessage(tabId, { action: '__scrollTo', data: { x: 0, y: 0 } });
    // 返回分段数据，由 content script 拼接
    return {
      success: true,
      needStitch: true,
      captures,
      totalWidth: scrollWidth,
      totalHeight: scrollHeight,
      viewportWidth,
      viewportHeight,
      devicePixelRatio,
      format: (data && data.format) || 'png',
      quality: (data && data.quality) || 92
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ==================== 工具管理 ====================

/**
 * 获取工具列表
 */
async function getToolsList() {
  const [toolsStatus, favorites] = await Promise.all([
    chrome.storage.local.get(CONFIG.STORAGE_KEYS.TOOLS_STATUS),
    chrome.storage.local.get(CONFIG.STORAGE_KEYS.FAVORITES)
  ]);
  
  const status = toolsStatus[CONFIG.STORAGE_KEYS.TOOLS_STATUS] || {};
  const favs = favorites[CONFIG.STORAGE_KEYS.FAVORITES] || [];
  
  return CONFIG.ALL_TOOLS.map(tool => ({
    ...tool,
    enabled: status[tool.id]?.enabled !== false,
    useCount: status[tool.id]?.useCount || 0,
    lastUsed: status[tool.id]?.lastUsed,
    isFavorite: favs.includes(tool.id)
  }));
}

/**
 * 获取单个工具配置
 */
async function getToolConfig(toolId) {
  const tool = CONFIG.ALL_TOOLS.find(t => t.id === toolId);
  if (!tool) throw new Error(`Tool not found: ${toolId}`);
  
  const settings = await getSettings();
  const toolData = await getToolData(toolId);
  
  return {
    ...tool,
    settings: settings.toolSettings?.[toolId] || {},
    data: toolData
  };
}

/**
 * 打开指定工具
 */
async function openTool(toolId, params, tabId) {
  // xss-tester 等工具通过 __openUrl 伪工具 ID 请求在新标签页打开外部网址
  if (toolId === '__openUrl') {
    const url = (params && params.url) || null;
    if (!url) return { success: false, error: 'Missing url' };
    try {
      await chrome.tabs.create({ url });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  // 更新工具使用统计（排除内部伪工具 ID）
  if (toolId && !toolId.startsWith('__')) {
    await updateToolStats(toolId);
  }

  // 向content script发送消息打开工具
  if (!tabId) return { success: false, error: 'No tabId' };
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'openTool',
      data: { toolId, params }
    });
    return { success: true };
  } catch (e) {
    console.log('[ToolCube] Cannot send to tab, may need injection:', e.message);
    // 尝试注入并重新打开侧边栏
    return toggleSidebar(tabId, true);
  }
}

/**
 * 打开工具并传入数据
 */
async function openToolWithData(toolId, data, tabId) {
  // 确保侧边栏打开
  const result = await toggleSidebar(tabId, true);
  if (!result?.success) return { success: false, error: result?.error || 'Cannot open sidebar' };

  // 向 content script 发送带数据打开工具的消息
  if (!tabId) return { success: false, error: 'No tabId' };
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'openToolWithData',
      data: { toolId, input: data }
    });
    return { success: true };
  } catch (e) {
    // 如果 content script 未加载，尝试注入后重试
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/injector.js']
      });
      await new Promise(r => setTimeout(r, 100));
      await chrome.tabs.sendMessage(tabId, {
        action: 'openToolWithData',
        data: { toolId, input: data }
      });
      return { success: true };
    } catch (e2) {
      return { success: false, error: e2.message };
    }
  }
}

/**
 * 更新工具使用统计
 */
async function updateToolStats(toolId) {
  const key = CONFIG.STORAGE_KEYS.TOOLS_STATUS;
  const result = await chrome.storage.local.get(key);
  const status = result[key] || {};
  
  if (!status[toolId]) {
    status[toolId] = { enabled: true, useCount: 0 };
  }
  
  status[toolId].useCount++;
  status[toolId].lastUsed = Date.now();
  
  await chrome.storage.local.set({ [key]: status });
}

// ==================== 侧边栏控制 ====================

/**
 * 切换侧边栏显示状态
 */
async function toggleSidebar(tabId, forceOpen = false) {
  if (!tabId) {
    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  }
  
  if (!tabId) return { success: false, error: 'No active tab' };
  
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: forceOpen ? 'openSidebar' : 'toggleSidebar'
    });
    return { success: true };
  } catch (error) {
    // 如果content script未加载，尝试注入
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/injector.js']
      });
    } catch (injectError) {
      console.error('[ToolCube] Failed to inject content script:', injectError);
      return { success: false, error: injectError.message };
    }
    
    // 重新尝试发送消息
    return new Promise((resolve) => {
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tabId, {
            action: forceOpen ? 'openSidebar' : 'toggleSidebar'
          });
          resolve({ success: true });
        } catch (e) {
          console.error('[ToolCube] Failed to send message after injection:', e);
          resolve({ success: false, error: e.message });
        }
      }, 100);
    });
  }
}

// ==================== 收藏管理 ====================

/**
 * 添加收藏
 */
async function addFavorite(toolId) {
  const key = CONFIG.STORAGE_KEYS.FAVORITES;
  const result = await chrome.storage.local.get(key);
  const favorites = result[key] || [];
  
  if (!favorites.includes(toolId)) {
    favorites.push(toolId);
    await chrome.storage.local.set({ [key]: favorites });
  }
  
  return { success: true, favorites };
}

/**
 * 移除收藏
 */
async function removeFavorite(toolId) {
  const key = CONFIG.STORAGE_KEYS.FAVORITES;
  const result = await chrome.storage.local.get(key);
  const favorites = result[key] || [];
  
  const index = favorites.indexOf(toolId);
  if (index > -1) {
    favorites.splice(index, 1);
    await chrome.storage.local.set({ [key]: favorites });
  }
  
  return { success: true, favorites };
}

/**
 * 获取收藏列表
 */
async function getFavorites() {
  const key = CONFIG.STORAGE_KEYS.FAVORITES;
  const result = await chrome.storage.local.get(key);
  return result[key] || [];
}

// ==================== 历史记录 ====================

/**
 * 保存到历史记录
 */
async function saveToHistory(data) {
  return new Promise((resolve, reject) => {
    getDB().then((db) => {
      const transaction = db.transaction(['history'], 'readwrite');
      const store = transaction.objectStore('history');
      
      const record = {
        ...data,
        timestamp: Date.now()
      };
      
      const addRequest = store.add(record);
      addRequest.onsuccess = () => resolve({ success: true });
      addRequest.onerror = () => reject(addRequest.error);
    }).catch(reject);
  });
}

/**
 * 获取历史记录
 */
async function getHistory(toolId, limit = 50) {
  return new Promise((resolve, reject) => {
    getDB().then((db) => {
      const transaction = db.transaction(['history'], 'readonly');
      const store = transaction.objectStore('history');
      
      let getRequest;
      if (toolId) {
        const index = store.index('toolId');
        getRequest = index.getAll(toolId, limit);
      } else {
        getRequest = store.getAll();
      }
      
      getRequest.onsuccess = () => {
        const records = getRequest.result || [];
        records.sort((a, b) => b.timestamp - a.timestamp);
        resolve(records.slice(0, limit));
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    }).catch(reject);
  });
}

// ==================== 工具数据存储 ====================

/**
 * 保存工具数据
 */
async function saveToolData(toolId, data) {
  return new Promise((resolve, reject) => {
    getDB().then((db) => {
      const transaction = db.transaction(['toolData'], 'readwrite');
      const store = transaction.objectStore('toolData');
      
      const putRequest = store.put({
        toolId,
        data,
        updatedAt: Date.now()
      });
      
      putRequest.onsuccess = () => resolve({ success: true });
      putRequest.onerror = () => reject(putRequest.error);
    }).catch(reject);
  });
}

/**
 * 获取工具数据
 */
async function getToolData(toolId) {
  return new Promise((resolve, reject) => {
    getDB().then((db) => {
      const transaction = db.transaction(['toolData'], 'readonly');
      const store = transaction.objectStore('toolData');
      
      const getRequest = store.get(toolId);
      
      getRequest.onsuccess = () => {
        const result = getRequest.result;
        resolve(result ? result.data : null);
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    }).catch(reject);
  });
}

// ==================== 设置管理 ====================

/**
 * 获取设置
 */
async function getSettings() {
  const key = CONFIG.STORAGE_KEYS.SETTINGS;
  const result = await chrome.storage.local.get(key);
  return { ...CONFIG.DEFAULT_SETTINGS, ...result[key] };
}

/**
 * 保存设置
 */
async function saveSettings(settings) {
  const key = CONFIG.STORAGE_KEYS.SETTINGS;
  const current = await getSettings();
  const merged = { ...current, ...settings };
  await chrome.storage.local.set({ [key]: merged });
  return { success: true, settings: merged };
}

// ==================== 历史记录删除 ====================

/**
 * 删除单条历史记录
 */
async function deleteHistoryItem(id) {
  return new Promise((resolve, reject) => {
    getDB().then((db) => {
      const transaction = db.transaction(['history'], 'readwrite');
      const store = transaction.objectStore('history');
      const deleteRequest = store.delete(id);
      
      deleteRequest.onsuccess = () => resolve({ success: true });
      deleteRequest.onerror = () => reject(deleteRequest.error);
    }).catch(reject);
  });
}

/**
 * 清空指定工具的历史记录
 */
async function clearToolHistory(toolId) {
  return new Promise((resolve, reject) => {
    getDB().then((db) => {
      const transaction = db.transaction(['history'], 'readwrite');
      const store = transaction.objectStore('history');
      const index = store.index('toolId');
      const getAllRequest = index.getAllKeys(toolId);
      
      getAllRequest.onsuccess = () => {
        const keys = getAllRequest.result;
        keys.forEach(key => store.delete(key));
        transaction.oncomplete = () => resolve({ success: true, count: keys.length });
        transaction.onerror = () => reject(transaction.error);
      };
      
      getAllRequest.onerror = () => reject(getAllRequest.error);
    }).catch(reject);
  });
}

/**
 * 获取标签页信息
 */
async function getTabInfo(tabId) {
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  }
  
  if (!tabId) return { success: false, error: 'No active tab' };
  
  try {
    const tab = await chrome.tabs.get(tabId);
    return {
      success: true,
      data: {
        title: tab.title,
        url: tab.url,
        favIconUrl: tab.favIconUrl
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ==================== 数据导入导出 ====================

/**
 * 导出所有数据
 */
async function exportData() {
  const localData = await chrome.storage.local.get(null);
  return {
    version: CONFIG.VERSION,
    exportDate: new Date().toISOString(),
    data: localData
  };
}

/**
 * 导入数据
 */
async function importData(data) {
  if (!data.data) {
    // 兼容旧格式（有 sync + local）
    const importObj = data.sync || data.local || data;
    await chrome.storage.local.set(importObj);
  } else {
    await chrome.storage.local.set(data.data);
  }
  return { success: true };
}

/**
 * 清除数据
 */
async function clearData(type) {
  switch (type) {
    case 'history':
      await clearIndexedDBStore('history');
      break;
    case 'toolData':
      await clearIndexedDBStore('toolData');
      break;
    case 'fileCache':
      await clearIndexedDBStore('fileCache');
      break;
    case 'all':
      await Promise.all([
        chrome.storage.local.clear(),
        clearAllIndexedDB()
      ]);
      break;
    default:
      throw new Error(`Unknown clear type: ${type}`);
  }
  
  return { success: true };
}

/**
 * 清除IndexedDB存储
 */
async function clearIndexedDBStore(storeName) {
  return new Promise((resolve, reject) => {
    getDB().then((db) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const clearRequest = store.clear();
      
      clearRequest.onsuccess = () => resolve();
      clearRequest.onerror = () => reject(clearRequest.error);
    }).catch(reject);
  });
}

/**
 * 清除所有IndexedDB
 */
async function clearAllIndexedDB() {
  const stores = ['history', 'toolData', 'fileCache'];
  for (const store of stores) {
    await clearIndexedDBStore(store);
  }
}

// ==================== 快捷键处理 ====================

/**
 * 快捷键命令处理
 */
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab?.id) return;
  
  try {
    switch (command) {
      case 'toggle-sidebar':
        await toggleSidebar(tab.id);
        break;
      case 'quick-search':
        await toggleSidebar(tab.id, true);
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'focusSearch' });
        } catch (e) {
          console.log('[ToolCube] focusSearch failed:', e.message);
        }
        break;
    }
  } catch (e) {
    console.error('[ToolCube] Command error:', e);
  }
});

// ==================== 通知 ====================

/**
 * 显示通知（尊重用户 showNotifications 设置）
 */
async function showNotification(title, message, iconUrl) {
  // 检查用户是否关闭了通知
  try {
    const s = await chrome.storage.local.get('toolbox_settings');
    if (s.toolbox_settings && s.toolbox_settings.showNotifications === false) return;
  } catch (e) { logIgnored(e); }
  if (chrome.notifications) {
    try {
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: iconUrl || 'icons/icon128.png',
        title,
        message
      });
    } catch (e) { /* 通知失败不影响主流程 */ }
  }
}

// ==================== 资源嗅探 / 下载服务 ====================

/**
 * 通过 chrome.downloads 下载单个资源
 * @param {{url:string,filename?:string,conflictAction?:string,saveAs?:boolean}} data
 */
async function downloadResource(data) {
  if (!data || !data.url) throw new Error('Missing url');
  const opts = {
    url: data.url,
    filename: sanitizeFilename(data.filename || guessFilename(data.url)),
    conflictAction: data.conflictAction || 'uniquify',
    saveAs: !!data.saveAs
  };
  try {
    const id = await chrome.downloads.download(opts);
    return { success: true, id, url: data.url };
  } catch (e) {
    return { success: false, error: e.message, url: data.url };
  }
}

/**
 * 批量下载（带并发控制与限速）
 * @param {{items:Array<{url:string,filename?:string}>, concurrency?:number}} data
 */
async function batchDownload(data) {
  const items = (data && data.items) || [];
  const concurrency = Math.max(1, Math.min(8, data?.concurrency || 3));
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      const it = items[idx];
      const r = await downloadResource(it);
      results[idx] = r;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { success: true, total: items.length, results };
}

/**
 * 探测资源元数据（HEAD 优先，失败则 GET 读取 Content-Length / Content-Type）
 */
async function fetchResourceMeta(url) {
  if (!url) throw new Error('Missing url');
  try {
    const head = await fetch(url, { method: 'HEAD', redirect: 'follow', credentials: 'omit' });
    const size = parseInt(head.headers.get('content-length') || '0', 10);
    const type = head.headers.get('content-type') || '';
    const acceptRanges = !!head.headers.get('accept-ranges');
    return {
      success: true,
      url,
      size,
      type,
      acceptRanges,
      status: head.status,
      filename: guessFilename(url, head.headers.get('content-disposition') || '')
    };
  } catch (e) {
    try {
      const get = await fetch(url, { method: 'GET', redirect: 'follow', credentials: 'omit' });
      const buf = await get.arrayBuffer();
      return {
        success: true,
        url,
        size: buf.byteLength,
        type: get.headers.get('content-type') || '',
        acceptRanges: !!get.headers.get('accept-ranges'),
        status: get.status,
        filename: guessFilename(url, get.headers.get('content-disposition') || '')
      };
    } catch (e2) {
      return { success: false, url, error: e2.message };
    }
  }
}

/**
 * 解析 M3U8 主播放列表与媒体片段清单
 * 返回 ts 片段 URL 列表与时长
 */
async function parseM3U8(url, maxSegments = 500) {
  if (!url) throw new Error('Missing url');
  try {
    const r = await fetch(url, { credentials: 'omit' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const text = await r.text();
    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
    const lines = text.split(/\r?\n/);
    let isMaster = false;
    let bandwidth = 0, resolution = '';
    const variants = [];
    const segments = [];
    let currentVariant = null;
    let currentEncryption = null;
    let seq = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      // 检测加密信息
      if (line.startsWith('#EXT-X-KEY')) {
        const method = line.match(/METHOD=([^,\s]+)/);
        const uri = line.match(/URI="([^"]+)"/);
        const iv = line.match(/IV=0x([0-9a-fA-F]+)/);
        currentEncryption = {
          method: method ? method[1] : 'NONE',
          uri: uri ? absolutize(uri[1], baseUrl) : null,
          iv: iv ? iv[1] : null
        };
        continue;
      }
      if (line.startsWith('#EXT-X-SESSION-KEY')) {
        // 会话级密钥，暂不处理
        continue;
      }
      if (line.startsWith('#EXT-X-STREAM-INF')) {
        isMaster = true;
        currentVariant = { bandwidth: 0, resolution: '', url: '' };
        const bw = line.match(/BANDWIDTH=(\d+)/);
        const res = line.match(/RESOLUTION=(\d+x\d+)/);
        if (bw) currentVariant.bandwidth = parseInt(bw[1], 10);
        if (res) currentVariant.resolution = res[1];
        continue;
      }
      if (line.startsWith('#EXTINF')) {
        const m = line.match(/#EXTINF:([\d.]+)/);
        const dur = m ? parseFloat(m[1]) : 0;
        // 下一行是片段
        if (lines[i + 1] && !lines[i + 1].startsWith('#')) {
          segments.push({
            index: seq++,
            duration: dur,
            url: absolutize(lines[++i], baseUrl),
            encryption: currentEncryption ? { ...currentEncryption } : null
          });
        }
        continue;
      }
      if (line.startsWith('#')) continue;
      // 普通 URL 行
      if (isMaster && currentVariant) {
        currentVariant.url = absolutize(line, baseUrl);
        variants.push(currentVariant);
        currentVariant = null;
      } else {
        segments.push({ index: seq++, duration: 0, url: absolutize(line, baseUrl), encryption: currentEncryption ? { ...currentEncryption } : null });
      }
    }
    // 检测 DRM 加密（SAMPLE-AES 等无法在扩展中解密）
    const hasDRM = segments.some(s => s.encryption && s.encryption.method !== 'NONE' && s.encryption.method !== 'AES-128');
    const hasAES128 = segments.some(s => s.encryption && s.encryption.method === 'AES-128');
    return {
      success: true,
      url,
      isMaster,
      variants: variants.slice(0, 8),
      totalSegments: segments.length,
      segments: segments.slice(0, maxSegments),
      totalDuration: segments.reduce((a, s) => a + (s.duration || 0), 0),
      encryption: {
        hasEncryption: segments.some(s => s.encryption && s.encryption.method !== 'NONE'),
        hasAES128,
        hasDRM,
        methods: [...new Set(segments.filter(s => s.encryption).map(s => s.encryption.method))].filter(m => m !== 'NONE')
      }
    };
  } catch (e) {
    return { success: false, url, error: e.message };
  }
}

/**
 * 下载 M3U8 的 TS 片段并合并为完整视频
 * 支持无加密和 AES-128 加密的片段
 * @param {{url: string, segments: Array, filename: string}} data
 */
async function downloadAndMergeM3U8(data) {
  const { url, segments: inputSegments, filename } = data || {};
  if (!url) return { success: false, error: 'Missing M3U8 URL' };

  try {
    // 1. 解析 M3U8（如果没传 segments）
    let segments = inputSegments;
    let encryptionInfo = null;
    if (!segments || !segments.length) {
      const parsed = await parseM3U8(url, 2000);
      if (!parsed.success) return { success: false, error: parsed.error };
      segments = parsed.segments;
      encryptionInfo = parsed.encryption;
      // 如果是主播放列表，选择最高码率
      if (parsed.isMaster && parsed.variants.length) {
        const best = parsed.variants.sort((a, b) => b.bandwidth - a.bandwidth)[0];
        const subParsed = await parseM3U8(best.url, 2000);
        if (!subParsed.success) return { success: false, error: subParsed.error };
        segments = subParsed.segments;
        encryptionInfo = subParsed.encryption;
      }
    }

    if (!segments || !segments.length) {
      return { success: false, error: 'No segments found' };
    }

    // 检测 DRM — 无法处理
    const hasDRM = segments.some(s => s.encryption && s.encryption.method !== 'NONE' && s.encryption.method !== 'AES-128');
    if (hasDRM) {
      return { success: false, error: 'DRM加密（SAMPLE-AES-CENC等），无法在扩展中解密。请使用专业录屏工具。', isDRM: true };
    }

    // 2. 预取 AES-128 密钥（如果需要）
    const keyCache = new Map();
    const aesSegments = segments.filter(s => s.encryption && s.encryption.method === 'AES-128');
    for (const seg of aesSegments) {
      if (seg.encryption.uri && !keyCache.has(seg.encryption.uri)) {
        try {
          const keyResp = await fetch(seg.encryption.uri, { credentials: 'omit' });
          if (!keyResp.ok) return { success: false, error: `密钥获取失败: HTTP ${keyResp.status} (${seg.encryption.uri})` };
          const keyBuf = await keyResp.arrayBuffer();
          keyCache.set(seg.encryption.uri, new Uint8Array(keyBuf));
        } catch (e) {
          return { success: false, error: `密钥获取失败: ${e.message}` };
        }
      }
    }

    // 3. 下载所有片段（带并发控制）
    const CONCURRENCY = 6;
    const chunkBuffers = new Array(segments.length);
    const errors = [];
    let completed = 0;

    async function downloadSegment(seg, idx) {
      try {
        const resp = await fetch(seg.url, { credentials: 'omit' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        let buf = await resp.arrayBuffer();

        // AES-128 解密
        if (seg.encryption && seg.encryption.method === 'AES-128') {
          const key = keyCache.get(seg.encryption.uri);
          if (!key) throw new Error('密钥未找到');
          buf = await aes128Decrypt(buf, key, seg.encryption.iv, idx);
        }

        chunkBuffers[idx] = buf;
      } catch (e) {
        errors.push({ index: idx, error: e.message });
        chunkBuffers[idx] = null;
      }
      completed++;
    }

    // 使用批次处理控制并发
    for (let i = 0; i < segments.length; i += CONCURRENCY) {
      const batch = [];
      for (let j = i; j < Math.min(i + CONCURRENCY, segments.length); j++) {
        batch.push(downloadSegment(segments[j], j));
      }
      await Promise.all(batch);
    }

    // 4. 检查下载结果
    const successCount = chunkBuffers.filter(Boolean).length;
    if (successCount === 0) {
      return { success: false, error: '所有片段下载失败', errors: errors.slice(0, 10) };
    }

    // 5. 合并为单个文件
    const validBuffers = chunkBuffers.filter(Boolean);
    const totalSize = validBuffers.reduce((s, b) => s + b.byteLength, 0);
    const merged = new Uint8Array(totalSize);
    let offset = 0;
    for (const buf of validBuffers) {
      merged.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }

    // 6. 通过 chrome.downloads 保存
    // 使用 data URL 方式（兼容 Chrome 和 Firefox Service Worker，两者都不支持 URL.createObjectURL）
    const finalName = sanitizeFilename(filename || `video_${Date.now()}.ts`);

    try {
      // 将合并后的数据转为 base64 data URL（兼容 Chrome 和 Firefox Service Worker）
      let dataUrl;
      const maxDataUrlSize = 100 * 1024 * 1024; // 100MB 限制（data URL 不宜过大）
      if (totalSize > maxDataUrlSize) {
        // 大文件：尝试使用 Blob URL（Chrome 支持），Firefox 不支持则报错
        var blobUrl = null;
        try {
          const blob = new Blob([merged], { type: 'video/mp2t' });
          blobUrl = URL.createObjectURL(blob);
        } catch (e) {
          // Firefox Service Worker 不支持 URL.createObjectURL
        }
        if (blobUrl) {
          dataUrl = blobUrl;
        } else {
          return { success: false, error: '文件过大(' + (totalSize/1024/1024).toFixed(1) + 'MB)，当前环境不支持大文件下载。建议使用专业下载工具。' };
        }
      } else {
        // 小文件：使用 data URL（跨浏览器兼容，分块编码避免栈溢出）
        const CHUNK = 8192;
        const chunks = [];
        for (let i = 0; i < merged.length; i += CHUNK) {
          const slice = merged.subarray(i, Math.min(i + CHUNK, merged.length));
          chunks.push(String.fromCharCode.apply(null, slice));
        }
        dataUrl = 'data:video/mp2t;base64,' + btoa(chunks.join(''));
      }

      const id = await chrome.downloads.download({
        url: dataUrl,
        filename: finalName,
        conflictAction: 'uniquify',
        saveAs: true
      });
      // 延迟释放 Blob URL（如果是 data URL 则不需要释放）
      if (dataUrl.startsWith('blob:')) {
        setTimeout(() => URL.revokeObjectURL(dataUrl), 60000);
      }
      return {
        success: true,
        totalSegments: segments.length,
        successSegments: successCount,
        failedSegments: errors.length,
        totalSize,
        downloadId: id,
        filename: finalName,
        errors: errors.slice(0, 5)
      };
    } catch (e) {
      return { success: false, error: `下载保存失败: ${e.message}` };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * AES-128-CBC 解密（HLS 标准）
 * 使用 Web Crypto API
 */
async function aes128Decrypt(encryptedBuffer, keyBytes, ivHex, seqNum) {
  // 导入密钥
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']
  );

  // 构造 IV：如果 M3U8 指定了 IV 则使用，否则使用片段序列号
  let iv;
  if (ivHex) {
    // IV 是 32 字符的十六进制字符串
    const ivStr = ivHex.padStart(32, '0');
    iv = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      iv[i] = parseInt(ivStr.substr(i * 2, 2), 16);
    }
  } else {
    // 默认 IV = 序列号（HLS 规范：当未指定 IV 时，使用 segment sequence number）
    iv = new Uint8Array(16);
    const seq = seqNum || 0;
    // 序列号作为 16 字节大端整数
    const buf = new ArrayBuffer(8);
    new DataView(buf).setBigUint64(0, BigInt(seq));
    const seqBytes = new Uint8Array(buf);
    iv.set(seqBytes, 8);
  }

  // 解密
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv },
    cryptoKey,
    encryptedBuffer
  );

  return decrypted;
}

function absolutize(u, base) {
  try { return new URL(u, base).href; } catch (e) { return u; }
}

function guessFilename(url, contentDisposition) {
  if (contentDisposition) {
    const m = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i) ||
              contentDisposition.match(/filename="?([^";]+)"?/i);
    if (m) try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').pop();
    if (last && last.length < 200) return decodeURIComponent(last);
  } catch (e) { logIgnored(e); }
  return 'download_' + Date.now();
}

function sanitizeFilename(name) {
  return String(name).replace(/[\\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200);
}

// ==================== 标签页管理 ====================

async function listTabs(query) {
  const all = await chrome.tabs.query({});
  let list = all.map(t => ({
    id: t.id, windowId: t.windowId, index: t.index,
    title: t.title || '', url: t.url || '',
    favIconUrl: t.favIconUrl || '',
    active: !!t.active, pinned: !!t.pinned,
    audible: !!t.audible, mutedInfo: t.mutedInfo,
    lastAccessed: t.lastAccessed, status: t.status,
    groupId: t.groupId
  }));
  if (query.q) {
    const q = String(query.q).toLowerCase();
    list = list.filter(t => (t.title || '').toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q));
  }
  if (query.currentWindowOnly) {
    const cw = await chrome.windows.getCurrent();
    list = list.filter(t => t.windowId === cw.id);
  }
  if (query.active) list = list.filter(t => t.active);
  return { success: true, tabs: list };
}

async function closeTabs(tabIds) {
  if (!Array.isArray(tabIds) || !tabIds.length) return { success: false, error: 'No tabIds' };
  await chrome.tabs.remove(tabIds);
  return { success: true, removed: tabIds.length };
}

async function switchTab(tabId) {
  await chrome.tabs.update(tabId, { active: true });
  if (chrome.windows && tabId) {
    const t = await chrome.tabs.get(tabId);
    if (t && t.windowId) await chrome.windows.update(t.windowId, { focused: true });
  }
  return { success: true };
}

async function groupTabs(tabIds, title, color) {
  // Firefox 不支持 chrome.tabGroups API；做安全降级
  if (!chrome.tabGroups || !chrome.tabGroups.group) {
    return { success: false, error: 'tabGroups not supported in this browser', supported: false };
  }
  try {
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, { title: title || 'ToolCube 分组', color: color || 'blue' });
    return { success: true, groupId };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ==================== Cookie 管理 ====================

async function getAllCookies(domain) {
  // Firefox 不接受空的 getAll({})，需要传 null 或具体 URL
  let cookies;
  try {
    cookies = await chrome.cookies.getAll(domain ? { domain } : null);
  } catch (e) {
    // Firefox 兜底：使用 getAllCookieStores
    const stores = await chrome.cookies.getAllCookieStores();
    const all = [];
    for (const s of stores) {
      const list = await chrome.cookies.getAll({ storeId: s.storeId });
      all.push(...list);
    }
    cookies = domain ? all.filter(c => (c.domain || '').includes(domain)) : all;
  }
  return { success: true, cookies: cookies.map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path,
    secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
    expirationDate: c.expirationDate, storeId: c.storeId, session: c.session
  })) };
}

async function getCookie(detail) {
  const c = await chrome.cookies.get(detail);
  return { success: true, cookie: c };
}

async function setCookie(detail) {
  // 兼容最小字段，缺省值填充
  const scheme = detail.secure ? 'https' : 'http';
  const url = detail.url || (detail.domain && detail.path ? `${scheme}://${detail.domain.startsWith('.') ? detail.domain.slice(1) : detail.domain}${detail.path}` : null);
  if (!url) return { success: false, error: 'Missing url or domain+path' };
  const payload = { url, name: detail.name, value: detail.value };
  if (detail.domain) payload.domain = detail.domain;
  if (detail.path) payload.path = detail.path;
  if (detail.secure != null) payload.secure = !!detail.secure;
  if (detail.httpOnly != null) payload.httpOnly = !!detail.httpOnly;
  if (detail.sameSite) payload.sameSite = detail.sameSite;
  if (detail.expirationDate) payload.expirationDate = detail.expirationDate;
  const c = await chrome.cookies.set(payload);
  return { success: true, cookie: c };
}

async function deleteCookie(detail) {
  await chrome.cookies.remove({ url: detail.url, name: detail.name, storeId: detail.storeId });
  return { success: true };
}

async function deleteAllCookies(domain) {
  if (!domain) return { success: false, error: 'domain required' };
  const list = await chrome.cookies.getAll({ domain });
  let n = 0;
  for (const c of list) {
    const scheme = c.secure ? 'https' : 'http';
    await chrome.cookies.remove({ url: `${scheme}://${c.domain.startsWith('.') ? c.domain.slice(1) : c.domain}${c.path}`, name: c.name, storeId: c.storeId });
    n++;
  }
  return { success: true, removed: n };
}

// ==================== 短链还原 ====================

/**
 * 还原短链，最多跟随 N 次 3xx 跳转
 */
async function expandShortUrl(url, maxHops = 8) {
  if (!url) throw new Error('Missing url');
  const chain = [{ url, status: 0 }];
  let current = url;
  for (let i = 0; i < maxHops; i++) {
    try {
      const r = await fetch(current, { method: 'HEAD', redirect: 'manual', credentials: 'omit' });
      const status = r.status;
      if (status >= 300 && status < 400) {
        const loc = r.headers.get('location');
        if (!loc) break;
        const next = absolutize(loc, current);
        chain.push({ url: next, status });
        // 同链检测
        if (chain.length > 1 && chain.some((c, idx) => idx < chain.length - 1 && c.url === next)) break;
        current = next;
        continue;
      }
      chain.push({ url: current, status });
      break;
    } catch (e) {
      // HEAD 不被支持时降级为 GET Range
      try {
        const r2 = await fetch(current, { method: 'GET', redirect: 'manual', credentials: 'omit', headers: { Range: 'bytes=0-0' } });
        const status = r2.status;
        if (status >= 300 && status < 400) {
          const loc = r2.headers.get('location');
          if (!loc) break;
          const next = absolutize(loc, current);
          chain.push({ url: next, status });
          current = next;
          continue;
        }
        chain.push({ url: current, status });
        break;
      } catch (e2) {
        chain.push({ url: current, status: 0, error: e2.message });
        break;
      }
    }
  }
  return { success: true, original: url, final: current, hops: chain.length - 1, chain };
}

// ==================== UA 切换 (declarativeNetRequest) ====================

/**
 * 获取当前 tab 的 User-Agent
 */
async function getCurrentUA(tabId) {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.getDynamicRules) {
    return { success: false, supported: false, error: 'declarativeNetRequest not available' };
  }
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const active = rules.find(r => r.id === 9000);
    const ua = active?.action?.requestHeaders?.find(h => h.header.toLowerCase() === 'user-agent')?.value || null;
    return { success: true, ua, activeRules: rules.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 通过 declarativeNetRequest 设置动态规则，修改请求头
 * 规则：将所有主框架/子框架请求的 User-Agent 头重写为指定 UA
 * 支持 tabOnly 模式：仅对指定标签页生效（通过 tabIds 条件限定）
 */
async function setDeclarativeRule(data, tabId) {
  const ua = data?.userAgent;
  if (!ua) return { success: false, error: 'Missing userAgent' };
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) {
    return { success: false, supported: false, error: 'declarativeNetRequest not available' };
  }
  const id = 9000;
  // 构建 condition，tabOnly 模式下通过 tabIds 限定仅对当前标签页生效
  const condition = {
    urlFilter: '*',
    resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'image', 'font', 'script', 'stylesheet', 'other']
  };
  if (data?.tabOnly && tabId) {
    condition.tabIds = [tabId];
  }
  const rule = {
    id,
    priority: 9000,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'User-Agent', operation: 'set', value: ua }]
    },
    condition
  };
  try {
    // 先移除同 id
    const existing = (await chrome.declarativeNetRequest.getDynamicRules()).find(r => r.id === id);
    if (existing) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [id] });
    }
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [rule] });
    // 持久化保存，以便扩展重启后恢复（tabOnly 模式不持久化，因 tabId 会变化）
    if (!data?.tabOnly) {
      try {
        await chrome.storage.local.set({ toolbox_ua_switcher: { enabled: true, userAgent: ua } });
      } catch (e) { logIgnored(e); }
    }
    return { success: true, ua, ruleId: id, tabOnly: !!(data?.tabOnly && tabId) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function clearDeclarativeRules() {
  // 仅清除 UA 切换器规则（ID 9000），不清除其他功能的 DNR 规则
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.getDynamicRules) {
    return { success: false, supported: false, error: 'declarativeNetRequest not available' };
  }
  try {
    const existing = (await chrome.declarativeNetRequest.getDynamicRules()).find(r => r.id === 9000);
    if (existing) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [9000] });
      // 清除持久化状态
      try {
        await chrome.storage.local.set({ toolbox_ua_switcher: { enabled: false } });
      } catch (e) { logIgnored(e); }
      return { success: true, removed: 1 };
    }
    return { success: true, removed: 0 };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function listDeclarativeRules() {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.getDynamicRules) {
    return { success: false, supported: false, error: 'declarativeNetRequest not available' };
  }
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    return { success: true, rules };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ==================== 跨浏览器兼容：可选权限申请 ====================

/**
 * 申请可选权限（Firefox 上 clipboardWrite/clipboardRead/tabGroups 均为可选）
 * @param {string[]} permissions 需要申请的权限列表
 * @returns {Promise<{granted:boolean, permissions:string[]}>}
 */
async function requestOptionalPermissions(permissions) {
  if (!chrome.permissions || !chrome.permissions.request) {
    return { granted: false, error: 'permissions API not available' };
  }
  try {
    const granted = await chrome.permissions.request({ permissions });
    return { granted, permissions };
  } catch (e) {
    return { granted: false, error: e.message };
  }
}

/**
 * 检查权限是否已授权
 */
async function checkPermissions(permissions) {
  if (!chrome.permissions || !chrome.permissions.contains) {
    return { has: false, error: 'permissions API not available' };
  }
  try {
    const has = await chrome.permissions.contains({ permissions });
    return { has, permissions };
  } catch (e) {
    return { has: false, error: e.message };
  }
}

/**
 * 浏览器能力检测（用于前端做能力降级）
 */
function getBrowserInfo() {
  const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
  let browser = 'unknown';
  if (/\bEdg\//.test(ua)) browser = 'edge';
  else if (/\bFirefox\//.test(ua)) browser = 'firefox';
  else if (/\bChrome\//.test(ua)) browser = 'chrome';
  return {
    browser,
    supportsTabGroups: !!(typeof chrome !== 'undefined' && chrome.tabGroups && chrome.tabGroups.group),
    supportsClipboardPermissions: !!(typeof chrome !== 'undefined' && chrome.permissions && chrome.permissions.contains),
    supportsDeclarativeNetRequest: !!(typeof chrome !== 'undefined' && chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateDynamicRules),
    supportsServiceWorker: !!(typeof self !== 'undefined' && self.ServiceWorkerGlobalScope && self instanceof ServiceWorkerGlobalScope),
    userAgent: ua
  };
}

/**
 * 获取指定 URL 的响应头（绕过 CORS 限制，在后台 fetch）
 */
async function fetchHeaders(url) {
  if (!url) throw new Error('Missing url');
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    const headers = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    const rawHeaders = Array.from(response.headers.entries()).map(([k, v]) => `${k}: ${v}`).join('\n');
    return { headers, rawHeaders, status: response.status };
  } catch (e) {
    try {
      const response = await fetch(url, { method: 'GET', redirect: 'follow' });
      const headers = {};
      response.headers.forEach((value, key) => { headers[key] = value; });
      const rawHeaders = Array.from(response.headers.entries()).map(([k, v]) => `${k}: ${v}`).join('\n');
      return { headers, rawHeaders, status: response.status };
    } catch (e2) {
      throw new Error(e2.message || 'Failed to fetch headers');
    }
  }
}

async function fetchSecurityHeaders(url) {
  if (!url) throw new Error('Missing url');
  const securityHeaders = [
    'strict-transport-security', 'content-security-policy', 'x-frame-options',
    'x-content-type-options', 'x-xss-protection', 'referrer-policy',
    'permissions-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy',
    'cross-origin-embedder-policy', 'feature-policy'
  ];
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    const result = {};
    securityHeaders.forEach(h => { result[h] = null; });
    response.headers.forEach((value, key) => {
      const lk = key.toLowerCase();
      if (securityHeaders.includes(lk)) result[lk] = value;
    });
    return { headers: result, status: response.status };
  } catch (e) {
    try {
      const response = await fetch(url, { method: 'GET', redirect: 'follow' });
      const result = {};
      securityHeaders.forEach(h => { result[h] = null; });
      response.headers.forEach((value, key) => {
        const lk = key.toLowerCase();
        if (securityHeaders.includes(lk)) result[lk] = value;
      });
      return { headers: result, status: response.status };
    } catch (e2) {
      throw new Error(e2.message || 'Failed to fetch security headers');
    }
  }
}

/**
 * 从当前活动标签页提取页面中的JSON数据（供jsonpath-query工具使用）
 */
async function extractPageJsonData() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return { success: false, error: 'No active tab' };
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const sources = [];
        for (const key in window) {
          if (key.startsWith('__') && window[key] && typeof window[key] === 'object') {
            try {
              const s = JSON.stringify(window[key]);
              if (s && s.length > 10 && s.length < 500000) sources.push({ key, value: window[key] });
            } catch (e) { logIgnored(e); }
          }
        }
        return sources;
      }
    });
    return { success: true, sources: results?.[0]?.result || [] };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 向当前活动标签页发送消息（供工具iframe代理调用chrome.tabs.sendMessage）
 */
async function sendTabMessage(data) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return { success: false, error: 'No active tab' };
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { action: data?.action, data: data?.data }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve({ success: true, data: response });
        }
      });
    });
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ==================== 持久化安全功能 ====================

/**
 * 追踪器域名分类表
 *
 * 每一类都必须对应「真实会被拦截的域名」，因为界面上的分类与数量直接由本表派生
 * （见 trackerBlockerCatalog），前端不再另存一份副本 —— 旧实现里前端有一份
 * BLOCKLIST、后台有一份 TRACKER_DOMAINS，两者内容与数量都不一致，于是界面显示
 * "该分类有 N 条规则"，实际生效的却是另一批域名；"恶意软件"分类更是只填了
 * `malware-site.example.com` 这类示例占位域名，永远不可能命中任何真实请求。
 *
 * 因此这里只收录**纯域名**（不含路径、不含通配符），并按真实用途分类；
 * 自定义域名与白名单在启用时统一做格式校验后再并入。
 */
const TRACKER_DOMAINS = {
  // 广告与广告交易平台
  ad: [
    '2mdn.net', '33across.com', 'adcolony.com', 'adform.net', 'admeld.com',
    'adnxs.com', 'adsrvr.org', 'adsymptotic.com', 'adsterra.com', 'adtech.com',
    'adtech.de', 'amazon-adsystem.com', 'appnexus.com', 'bidswitch.net',
    'bluedolfintech.com', 'casalemedia.com', 'contextweb.com', 'criteo.com',
    'criteo.net', 'demdex.net', 'doubleclick.net', 'googleadservices.com',
    'googlesyndication.com', 'indexexchange.com', 'liadm.com', 'lijit.com',
    'mgid.com', 'moatads.com', 'openx.net', 'outbrain.com', 'popads.net',
    'popcash.net', 'propellerads.com', 'pubmatic.com', 'quantcount.com',
    'quantserve.com', 'revcontent.com', 'rubiconproject.com', 'scorecardresearch.com',
    'serving-sys.com', 'sharethis.com', 'sharethrough.com', 'smartadserver.com',
    'soma-assets.com', 'sonobi.com', 'spotxchange.com', 'springserve.com',
    'taboola.com', 'tapad.com', 'undertone.com', 'yieldlab.net', 'zedo.com'
  ],
  // 分析与行为统计
  analytics: [
    'amplitude.com', 'chartbeat.com', 'chartbeat.net', 'clarity.ms', 'clicktale.net',
    'cnzz.com', 'crazyegg.com', 'fullstory.com', 'google-analytics.com',
    'googletagmanager.com', 'growingio.com', 'heap.io', 'hotjar.com',
    'inspectlet.com', 'kissmetrics.com', 'luckyorange.com', 'mixpanel.com',
    'mmstat.com', 'mouseflow.com', 'newrelic.com', 'optimizely.com',
    'pingdom.net', 'plausible.io', 'rumcdn.com', 'segment.com', 'segment.io',
    'sensorsdata.cn', 'speedcurve.com', 'statcounter.com', 'talkingdata.com',
    'umeng.co', 'umeng.com'
  ],
  // 社交平台内嵌追踪（仅收录纯追踪域，不误伤其主站与开放 API）
  social: [
    'addthis.com', 'ads-twitter.com', 'analytics.twitter.com', 'connect.facebook.net',
    'disqus.com', 'fbcdn.net', 'platform.instagram.com', 'platform.linkedin.com',
    'platform.reddit.com', 'platform.tumblr.com', 'platform.twitter.com',
    'sdk.snapkit.com', 'snap.licdn.com', 'static.addtoany.com', 'widgets.pinterest.com'
  ],
  // 浏览器指纹识别服务
  fingerprint: [
    'browserleaks.com', 'bluecava.com', 'deviceatlas.com', 'fingerprintjs.com',
    'fpjs.io', 'idcookie.media.net', 'iovation.com', 'threatmetrix.com'
  ],
  // 网页挖矿脚本
  crypto: [
    'authedmine.com', 'coinhive.com', 'coin-hive.com', 'coinerra.com',
    'crypto-loot.com', 'cryptoloot.pro', 'deepminer.com', 'hashflare.io',
    'jsecoin.com', 'minergate.com', 'minero.cc', 'webminepool.com'
  ],
  // 数据交易、用户画像与内容推荐
  other: [
    'addthis.com', 'adform.net', 'agkn.com', 'bidswitch.net', 'bluekai.com',
    'cookielaw.org', 'crwdcntrl.net', 'demdex.net', 'disqus.com', 'evidon.com',
    'exelator.com', 'gravatar.com', 'krxd.net', 'krux.com', 'onetrust.com',
    'pippio.com', 'quantcount.com', 'quantserve.com', 'rlcdn.com',
    'scorecardresearch.com', 'sharethis.com', 'tapad.com', 'trustarc.com',
    'truste.com'
  ]
};

/** 允许被拦截的分类（前端传入的任意字符串不得直接当作分类名使用） */
const TRACKER_CATEGORY_IDS = Object.keys(TRACKER_DOMAINS);

/** 动态规则 ID 区间：10000–10999，与其它持久化功能的区间互不重叠 */
const TRACKER_RULE_ID_BASE = 10000;
const TRACKER_MAX_RULES = 1000;
/** 白名单条目上限：避免单条规则的条件过大导致规则注册失败 */
const TRACKER_MAX_WHITELIST = 200;

/** 域名合法性校验：只接受常规域名，拒绝任何可能破坏规则结构的输入 */
const TRACKER_DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * 归一化域名列表：小写化、去掉前导点、去重、剔除非法项
 * @param {unknown} list
 * @param {number} [limit]
 * @returns {string[]}
 */
function normalizeDomainList(list, limit) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const domain = String(raw || '').trim().toLowerCase().replace(/^\./, '');
    if (!domain || seen.has(domain) || !TRACKER_DOMAIN_RE.test(domain)) continue;
    seen.add(domain);
    out.push(domain);
    if (limit && out.length >= limit) break;
  }
  return out;
}

/**
 * 返回各分类的实际域名数量，供界面渲染
 * 单一数据源：界面不再自行维护一份会与后台漂移的域名表。
 */
function trackerBlockerCatalog() {
  return {
    success: true,
    categories: TRACKER_CATEGORY_IDS.map(id => ({ id, count: TRACKER_DOMAINS[id].length }))
  };
}

/**
 * 追踪器屏蔽 - 启用
 *
 * @param {{categories?: string[], customDomains?: string[], whitelist?: string[]}} data
 *   - categories: 选中的分类 id；包含 'other' 时视为全部分类
 *   - customDomains: 用户自定义要拦截的域名
 *   - whitelist: 例外站点；来自这些站点的请求**不**被拦截
 * @returns {Promise<{success:boolean, rulesCount?:number, whitelistCount?:number, categoryCounts?:object, error?:string}>}
 */
async function trackerBlockerEnable(data) {
  const categories = Array.isArray(data && data.categories) ? data.categories : [];
  const customDomains = normalizeDomainList(data && data.customDomains);
  // 白名单曾经被后台完全忽略（前端收集了却没人用），导致"加入白名单"是个假功能。
  const whitelist = normalizeDomainList(data && data.whitelist, TRACKER_MAX_WHITELIST);

  // 'other' 语义为"全部分类"，与界面上的"全量拦截"预设一致
  const selected = categories.includes('other') ? TRACKER_CATEGORY_IDS.slice() : categories;

  const domains = [];
  const seen = new Set();
  const categoryCounts = {};
  for (const cat of selected) {
    if (!TRACKER_DOMAINS[cat]) continue;
    categoryCounts[cat] = TRACKER_DOMAINS[cat].length;
    for (const domain of TRACKER_DOMAINS[cat]) {
      if (seen.has(domain)) continue;
      seen.add(domain);
      domains.push(domain);
    }
  }
  for (const domain of customDomains) {
    if (seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
  }

  if (!domains.length) {
    return { success: false, error: '没有可拦截的域名：请至少选择一个分类，或填写自定义域名' };
  }

  const limited = domains.slice(0, TRACKER_MAX_RULES);
  const rules = limited.map((domain, index) => {
    const condition = {
      urlFilter: '||' + domain + '^',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'image', 'media', 'font', 'other']
    };
    // 例外站点：请求发起方（页面）命中白名单时不拦截
    if (whitelist.length) condition.excludedInitiatorDomains = whitelist;
    return { id: TRACKER_RULE_ID_BASE + index, priority: 1, action: { type: 'block' }, condition };
  });

  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const oldIds = existingRules
      .filter(r => r.id >= TRACKER_RULE_ID_BASE && r.id < TRACKER_RULE_ID_BASE + TRACKER_MAX_RULES)
      .map(r => r.id);
    if (oldIds.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds });
    }
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: rules });

    // 保存配置到本地存储（含白名单，便于重启后完整还原）
    const config = { categories, customDomains, whitelist, enabled: true, updatedAt: Date.now() };
    await chrome.storage.local.set({ toolbox_tracker_blocker: config });

    return {
      success: true,
      rulesCount: rules.length,
      whitelistCount: whitelist.length,
      categoryCounts
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 追踪器屏蔽 - 禁用
 */
async function trackerBlockerDisable() {
  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const oldIds = existingRules.filter(r => r.id >= 10000 && r.id < 11000).map(r => r.id);
    if (oldIds.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds });
    }
    // 保留配置，仅将 enabled 置为 false，避免重新启用时丢失用户配置
    const data = await chrome.storage.local.get('toolbox_tracker_blocker');
    const cfg = data.toolbox_tracker_blocker || {};
    cfg.enabled = false;
    await chrome.storage.local.set({ toolbox_tracker_blocker: cfg });
    return { success: true, removed: oldIds.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * HTTPS 强制 - 启用
 * @param {{mode: 'strict'|'lenient', whitelist: string[]}} data
 */
/**
 * HTTPS 强制 - 启用
 *
 * 两种模式的真实差异（此前 `mode` 被解构后从未使用，选宽松与严格行为完全一样）：
 *   - `strict`（严格）：所有资源类型（页面、脚本、图片、XHR 等）的 HTTP 请求都升级到 HTTPS；
 *   - `lenient`（宽松）：只升级**页面级导航**（main_frame），子资源保持原样。
 *     宽松模式的意义：某些站点的第三方 CDN / 统计脚本只提供 HTTP，
 *     强制升级这些子资源会导致页面功能损坏；此时只保证主页面走 HTTPS 更实用。
 *
 * @param {{mode: 'strict'|'lenient', whitelist: string[]}} data
 */
async function httpsEnforcerEnable(data) {
  const { mode = 'strict', whitelist = [] } = data || {};
  const isStrict = mode === 'strict';
  // 宽松模式只作用于页面级导航，避免误伤仅提供 HTTP 的第三方子资源
  const resourceTypes = isStrict
    ? ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'image', 'font', 'script', 'stylesheet', 'other']
    : ['main_frame'];

  const rules = [{
    id: 11000,
    priority: 2,
    action: {
      type: 'redirect',
      redirect: { transform: { scheme: 'https' } }
    },
    condition: {
      urlFilter: 'http://*',
      resourceTypes
    }
  }];

  // 白名单规则：对白名单域名跳过重定向（优先级更高）
  whitelist.forEach((domain, i) => {
    rules.push({
      id: 11001 + i,
      priority: 100,
      action: { type: 'allow' },
      condition: {
        urlFilter: `||${domain}^`,
        resourceTypes
      }
    });
  });

  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const oldIds = existingRules.filter(r => r.id >= 11000 && r.id < 12000).map(r => r.id);
    if (oldIds.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds });
    }
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: rules });

    const config = { mode, whitelist, enabled: true, updatedAt: Date.now() };
    await chrome.storage.local.set({ toolbox_https_enforcer: config });

    return { success: true, rulesCount: rules.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * HTTPS 强制 - 禁用
 */
async function httpsEnforcerDisable() {
  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const oldIds = existingRules.filter(r => r.id >= 11000 && r.id < 12000).map(r => r.id);
    if (oldIds.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds });
    }
    // 保留配置，仅将 enabled 置为 false，避免重新启用时丢失用户配置
    const data = await chrome.storage.local.get('toolbox_https_enforcer');
    const cfg = data.toolbox_https_enforcer || {};
    cfg.enabled = false;
    await chrome.storage.local.set({ toolbox_https_enforcer: cfg });
    return { success: true, removed: oldIds.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 反指纹 - 启用
 * 使用 registerContentScripts 注册静态文件，Chrome 自动在每次导航时注入
 * @param {{protections: object, level: string}} data
 */
async function antiFingerprintEnable(data) {
  const {
    protections = {},
    level = 'stealth',
    noiseLevel = 'medium',
    screenPreset = 'default',
    fontPreset = 'default'
  } = data || {};

  try {
    // 先尝试注销旧注册
    try {
      await chrome.scripting.unregisterContentScripts({ ids: ['anti-fingerprint'] });
    } catch (e) { /* 忽略不存在的注册 */ }

    // Firefox 不支持 world: 'MAIN'，使用不带 world 参数的注册
    // anti-fingerprint.js 内部有自注入逻辑，会自动注入到 MAIN world
    await chrome.scripting.registerContentScripts([{
      id: 'anti-fingerprint',
      matches: ['<all_urls>'],
      js: ['content/anti-fingerprint.js'],
      runAt: 'document_start'
    }]);

    // 这里必须写入**完整**配置：内容脚本按 noiseLevel / screenPreset / fontPreset /
    // level 决定实际行为。旧实现只写 { protections, level }，把噪声强度与屏幕/字体
    // 预设一并丢弃，导致界面上"噪声强度""分辨率伪装""字体伪装"三项配置全部无效。
    const config = {
      protections,
      level,
      noiseLevel,
      screenPreset,
      fontPreset,
      enabled: true,
      updatedAt: Date.now()
    };
    await chrome.storage.local.set({ toolbox_anti_fingerprint: config });

    // 立即对已有标签页注入
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/anti-fingerprint.js'],
            injectImmediately: true
          });
        } catch (e) { /* 忽略无法注入的标签页 */ }
      }
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 反指纹 - 累加拦截计数
 *
 * 内容脚本按周期把 MAIN world 中实际发生的指纹读取拦截次数上报到这里累计，
 * 供工具页展示真实数据（旧实现里工具页在等一条**从未有人发送**的消息，
 * 计数因此永远停留在 0，是个纯粹摆设的指标）。
 *
 * @param {{hits?: number}} data 本次增量
 */
async function antiFingerprintReportHits(data) {
  const delta = Math.max(0, Math.min(100000, Number(data && data.hits) || 0));
  if (!delta) return { success: true, total: null };
  try {
    const stored = await chrome.storage.local.get('toolbox_af_blocked');
    const total = (Number(stored.toolbox_af_blocked) || 0) + delta;
    await chrome.storage.local.set({ toolbox_af_blocked: total });
    return { success: true, total };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 反指纹 - 禁用
 */
async function antiFingerprintDisable() {
  try {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: ['anti-fingerprint'] });
    } catch (e) { /* 忽略不存在的注册 */ }
    // 保留配置，仅将 enabled 置为 false，避免重新启用时丢失用户配置
    const data = await chrome.storage.local.get('toolbox_anti_fingerprint');
    const cfg = data.toolbox_anti_fingerprint || {};
    cfg.enabled = false;
    await chrome.storage.local.set({ toolbox_anti_fingerprint: cfg });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 自定义请求头 - 启用
 * @param {{rules: Array<{urlFilter: string, headers: Array<{header: string, operation: string, value: string}>, resourceTypes?: string[]}>}} data
 */
async function customHeadersEnable(data) {
  const { rules: customRules = [] } = data || {};

  if (!customRules.length) return { success: false, error: 'No rules provided' };

  const rules = customRules.map((rule, i) => {
    const requestHeaders = (rule.headers || []).map(h => ({
      header: h.header,
      operation: h.operation || 'set',
      value: h.value || ''
    }));

    const responseHeaders = (rule.responseHeaders || []).map(h => ({
      header: h.header,
      operation: h.operation || 'set',
      value: h.value || ''
    }));

    const action = { type: 'modifyHeaders' };
    if (requestHeaders.length) action.requestHeaders = requestHeaders;
    if (responseHeaders.length) action.responseHeaders = responseHeaders;

    return {
      id: 13000 + i,
      priority: 3,
      action,
      condition: {
        urlFilter: rule.urlFilter || '*',
        resourceTypes: rule.resourceTypes || ['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'image', 'media', 'font', 'stylesheet', 'other']
      }
    };
  });

  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const oldIds = existingRules.filter(r => r.id >= 13000 && r.id < 14000).map(r => r.id);
    if (oldIds.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds });
    }
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: rules });

    const config = { rules: customRules, enabled: true, updatedAt: Date.now() };
    await chrome.storage.local.set({ toolbox_custom_headers: config });

    return { success: true, rulesCount: rules.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 自定义请求头 - 禁用
 */
async function customHeadersDisable() {
  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const oldIds = existingRules.filter(r => r.id >= 13000 && r.id < 14000).map(r => r.id);
    if (oldIds.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds });
    }
    // 保留配置，仅将 enabled 置为 false，避免重新启用时丢失用户配置
    const data = await chrome.storage.local.get('toolbox_custom_headers');
    const cfg = data.toolbox_custom_headers || {};
    cfg.enabled = false;
    await chrome.storage.local.set({ toolbox_custom_headers: cfg });
    return { success: true, removed: oldIds.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 脚本注入 - 启用
 * 使用 registerContentScripts 注册 user-scripts-runner.js，Chrome 自动注入
 * @param {{rules: Array}} data
 */
async function scriptInjectorEnable(data) {
  const { rules: injectRules = [] } = data || {};

  if (!injectRules.length) return { success: false, error: 'No rules provided' };

  try {
    // 先注销旧的注册
    try {
      await chrome.scripting.unregisterContentScripts({ ids: ['user-scripts-runner'] });
    } catch (e) { /* 忽略不存在的注册 */ }

    // 收集所有规则的 URL 匹配模式
    const allMatches = new Set();
    injectRules.forEach(rule => {
      if (rule.disabled) return;
      const patterns = rule.matches || rule.urlPatterns || [];
      if (patterns.length > 0) {
        patterns.forEach(p => allMatches.add(p));
      } else {
        allMatches.add('<all_urls>');
      }
    });

    // 如果有启用的规则，注册内容脚本
    if (allMatches.size > 0) {
      const matches = allMatches.has('<all_urls>') ? ['<all_urls>'] : Array.from(allMatches);
      await chrome.scripting.registerContentScripts([{
        id: 'user-scripts-runner',
        matches: matches,
        js: ['content/user-scripts-runner.js'],
        runAt: 'document_start',
        world: 'ISOLATED'
      }]);
    }

    const config = { rules: injectRules, enabled: true, updatedAt: Date.now() };
    await chrome.storage.local.set({ toolbox_script_injector: config });

    // 立即对已有标签页注入
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/user-scripts-runner.js'],
            injectImmediately: true
          });
        } catch (e) { /* 忽略无法注入的标签页 */ }
      }
    }

    return { success: true, rulesCount: injectRules.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 脚本注入 - 禁用
 */
async function scriptInjectorDisable() {
  try {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: ['user-scripts-runner'] });
    } catch (e) { /* 忽略不存在的注册 */ }
    // 保留配置，仅将 enabled 置为 false，避免重新启用时丢失用户配置
    const data = await chrome.storage.local.get('toolbox_script_injector');
    const cfg = data.toolbox_script_injector || {};
    cfg.enabled = false;
    await chrome.storage.local.set({ toolbox_script_injector: cfg });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 自动连播 - 启用
 * 使用 registerContentScripts 注册 auto-play-next.js，Chrome 自动注入
 * @param {{delay: number, autoReplay: boolean, clickNextButton: boolean}} data
 */
async function autoPlayNextEnable(data) {
  const { delay = 3, autoReplay = false, clickNextButton = true, skipIntro = false, nearEndThreshold = 3, customSelector = '', excludeDomains = '' } = data || {};

  try {
    // 先注销旧注册
    try {
      await chrome.scripting.unregisterContentScripts({ ids: ['auto-play-next'] });
    } catch (e) { /* 忽略不存在的注册 */ }

    await chrome.scripting.registerContentScripts([{
      id: 'auto-play-next',
      matches: ['<all_urls>'],
      js: ['content/auto-play-next.js'],
      runAt: 'document_start',
      world: 'ISOLATED',
      allFrames: true
    }]);

    const config = { enabled: true, delay, autoReplay, clickNextButton, skipIntro, nearEndThreshold, customSelector, excludeDomains, count: 0, updatedAt: Date.now() };
    // 保留已有计数
    const existing = await chrome.storage.local.get('toolbox_auto_play_next');
    if (existing.toolbox_auto_play_next && existing.toolbox_auto_play_next.count) {
      config.count = existing.toolbox_auto_play_next.count;
    }
    await chrome.storage.local.set({ toolbox_auto_play_next: config });

    // 立即对已有标签页注入
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/auto-play-next.js'],
            injectImmediately: true
          });
        } catch (e) { /* 忽略无法注入的标签页 */ }
      }
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 自动连播 - 禁用
 */
async function autoPlayNextDisable() {
  try {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: ['auto-play-next'] });
    } catch (e) { /* 忽略不存在的注册 */ }
    const existing = await chrome.storage.local.get('toolbox_auto_play_next');
    const config = existing.toolbox_auto_play_next || {};
    config.enabled = false;
    await chrome.storage.local.set({ toolbox_auto_play_next: config });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ==================== 视频解锁持久化 ====================

async function videoUnlockerEnable(data) {
  try {
    // Firefox: video-unlocker-injector.js 已在 manifest.json 中静态注册
    // 它内部有自注入逻辑，会自动注入到 MAIN world
    // 这里只需要保存配置，不需要再动态注册
    // 保存配置
    const config = data || {};
    config.enabled = true;
    await chrome.storage.local.set({ toolbox_video_unlocker: config });

    // 通知所有已加载的标签页重新加载配置
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'videoUnlocker:setConfig',
            data: config
          });
        } catch (e) { /* 忽略无法通信的标签页 */ }
      }
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function videoUnlockerDisable() {
  try {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: ['video-unlocker'] });
    } catch (e) { /* 忽略不存在的注册 */ }
    const existing = await chrome.storage.local.get('toolbox_video_unlocker');
    const config = existing.toolbox_video_unlocker || {};
    config.enabled = false;
    await chrome.storage.local.set({ toolbox_video_unlocker: config });

    // 通知所有已加载的标签页禁用视频解锁
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'videoUnlocker:setConfig',
            data: config
          });
        } catch (e) { /* 忽略无法通信的标签页 */ }
      }
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 视频解锁 - 上报拦截
 * 通过 declarativeNetRequest 拦截学习平台的进度上报请求
 * 规则 ID 范围: 9100-9199（UA 切换器使用 9000）
 * @param {{enabled: boolean, patterns: string}} data
 */
async function videoUnlockerSetReportBlocking(data) {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateDynamicRules) {
    return { success: false, error: 'declarativeNetRequest 不可用' };
  }
  try {
    const { enabled, patterns } = data || {};

    // 先移除所有现有的上报拦截规则（ID 9100-9199）
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const reportRuleIds = existingRules
      .filter(r => r.id >= 9100 && r.id <= 9199)
      .map(r => r.id);
    if (reportRuleIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: reportRuleIds });
    }

    if (!enabled) {
      // 持久化关闭状态，避免 restorePersistentFeatures 误恢复
      try {
        const existing = await chrome.storage.local.get('toolbox_video_unlocker');
        const cfg = existing.toolbox_video_unlocker || {};
        cfg.blockReports = false;
        cfg.reportPatterns = patterns || '';
        await chrome.storage.local.set({ toolbox_video_unlocker: cfg });
      } catch (e) { logIgnored(e); }
      return { success: true, enabled: false, removed: reportRuleIds.length };
    }

    // 内置学习平台上报 URL 关键词
    const BUILTIN_PATTERNS = [
      // 超星/学习通
      'chaoxing.com/multimedia/progress',
      'chaoxing.com/ananas/status',
      'chaoxing.com/knowledge/progress',
      'chaoxing.com/api/progress',
      // 智慧树
      'zhihuishu.com/api/v3/study',
      'zhihuishu.com/heart',
      // 中国大学MOOC
      'icourse163.org/web/j/learnBean',
      'icourse163.org/learnBean',
      // 学堂在线
      'xuetangx.com/api/v1/progress',
      'xuetangx.com/heartbeat',
      // 雨课堂
      'yuketang.cn/api/v1/report',
      'yuketang.cn/heartbeat',
      // 通用关键词
      '/api/heartbeat',
      '/api/progress',
      '/multimedia/report',
      '/learn/progress',
      '/study/progress',
      '/video/report',
      '/course/progress'
    ];

    // 合并内置和用户自定义关键词
    const allPatterns = [...BUILTIN_PATTERNS];
    if (patterns && typeof patterns === 'string') {
      const userPatterns = patterns.split(/[\n,]+/)
        .map(p => p.trim())
        .filter(p => p.length > 0);
      userPatterns.forEach(p => {
        if (allPatterns.indexOf(p) === -1) allPatterns.push(p);
      });
    }

    // 构建 declarativeNetRequest 规则（每个关键词一条规则）
    const rules = [];
    for (let i = 0; i < allPatterns.length && i < 100; i++) {
      const pattern = allPatterns[i];
      // 使用 urlFilter 匹配 URL 中包含关键词的请求
      rules.push({
        id: 9100 + i,
        priority: 1,
        action: { type: 'block' },
        condition: {
          urlFilter: pattern,
          resourceTypes: ['xmlhttprequest', 'script', 'image', 'media', 'other']
        }
      });
    }

    if (rules.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ addRules: rules });
    }

    // 持久化启用状态，使 master 开关重开 / SW 重启后可恢复
    try {
      const existing = await chrome.storage.local.get('toolbox_video_unlocker');
      const cfg = existing.toolbox_video_unlocker || {};
      cfg.blockReports = true;
      cfg.reportPatterns = allPatterns.join('\n');
      await chrome.storage.local.set({ toolbox_video_unlocker: cfg });
    } catch (e) { logIgnored(e); }

    return {
      success: true,
      enabled: true,
      ruleCount: rules.length,
      patterns: allPatterns.length
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 自动连播 - 添加历史记录
 * 将连播事件记录到 storage（最多保留 50 条）
 * @param {{url: string, title: string, method: string, timestamp: number}} data
 */
async function autoPlayNextAddHistory(data) {
  try {
    if (!data || !data.url) return { success: false, error: '缺少URL' };
    const result = await chrome.storage.local.get('toolbox_apn_history');
    const history = result.toolbox_apn_history || [];
    // 添加到开头
    history.unshift({
      url: data.url,
      title: data.title || '',
      method: data.method || '',
      timestamp: data.timestamp || Date.now()
    });
    // 限制最多 50 条
    if (history.length > 50) history.length = 50;
    await chrome.storage.local.set({ toolbox_apn_history: history });
    return { success: true, count: history.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 自动连播 - 获取历史记录
 */
async function autoPlayNextGetHistory() {
  try {
    const result = await chrome.storage.local.get('toolbox_apn_history');
    return { success: true, history: result.toolbox_apn_history || [] };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 自动连播 - 清空历史记录
 */
async function autoPlayNextClearHistory() {
  try {
    await chrome.storage.local.set({ toolbox_apn_history: [] });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ==================== 全局开关 ====================

async function handleMasterSwitchOff() {
  try {
    // 1. 持久化全局开关状态到 storage
    await chrome.storage.local.set({ toolbox_master_enabled: false });

    // 2. 通知所有已注入的内容脚本停止功能运行
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) continue;
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'masterSwitchOff' });
        } catch (e) {
          // content script 未加载，尝试动态注入后重试
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content/injector.js']
            });
            await new Promise(r => setTimeout(r, 100));
            await chrome.tabs.sendMessage(tab.id, { action: 'masterSwitchOff' });
          } catch (e2) { logIgnored(e2); }
        }
      }
    } catch (e) { logIgnored(e); }

    // 全局开关关闭时，注销所有动态注册的内容脚本
    const scriptIds = ['anti-fingerprint', 'user-scripts-runner', 'auto-play-next', 'video-unlocker'];
    for (const id of scriptIds) {
      try {
        await chrome.scripting.unregisterContentScripts({ ids: [id] });
      } catch (e) { logIgnored(e); }
    }
    // 移除安全功能相关的动态 declarativeNetRequest 规则（含UA切换器规则 9000）
    // 先保存UA切换器状态以便恢复
    try {
      const dynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
      const uaRule = dynamicRules.find(r => r.id === 9000);
      if (uaRule && uaRule.action && uaRule.action.requestHeaders) {
        const uaHeader = uaRule.action.requestHeaders.find(h => h.header === 'User-Agent');
        if (uaHeader) {
          await chrome.storage.local.set({ toolbox_ua_switcher: { enabled: true, userAgent: uaHeader.value } });
        }
      }
      // 为彻底关闭，移除所有动态 DNR 规则（不限于安全类）
      const allRuleIds = dynamicRules.map(r => r.id);
      if (allRuleIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: allRuleIds
        });
      }
    } catch (e) { logIgnored(e); }
    // 重要：这里**不能**把各功能的 storage 配置改写成 enabled:false。
    //
    // restorePersistentFeatures() 以 `config.enabled === true` 作为「是否需要恢复」的判据；
    // 若在关闭时把它写成 false，主开关重新打开时就再也不会恢复任何持久化功能，
    // 用户此前开启的追踪拦截 / HTTPS 强制 / 反指纹 / 自定义请求头 / 脚本注入 / 自动连播 /
    // 视频解锁 / 视频倍速等设置会被**静默清除**（与"一键让扩展不存在"的临时语义相反）。
    // 上面 UA 切换器单独保留了 enabled:true 才能被恢复，这正说明此处不该改动配置。
    //
    // 关闭期间的功能停用由三处共同保证，且都可在重开时完整还原：
    //   1) toolbox_master_enabled = false —— 后台与内容脚本据此拒绝执行；
    //   2) 向所有标签页广播 masterSwitchOff —— 页面内实例自行停用；
    //   3) 上面移除的动态 DNR 规则与已注销的动态内容脚本 —— 由 restorePersistentFeatures 重建。
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleMasterSwitchOn() {
  try {
    // 1. 持久化全局开关状态到 storage
    await chrome.storage.local.set({ toolbox_master_enabled: true });

    // 2. 恢复所有之前开启的功能
    await restorePersistentFeatures();
    // 3. 通知所有已注入的内容脚本恢复功能运行
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) continue;
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'masterSwitchOn' });
        } catch (e) {
          // content script 未加载，尝试动态注入后重试
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content/injector.js']
            });
            // 注入后稍等，让 init() 完成
            await new Promise(r => setTimeout(r, 100));
            await chrome.tabs.sendMessage(tab.id, { action: 'masterSwitchOn' });
          } catch (e2) { logIgnored(e2); }
        }
      }
    } catch (e) { logIgnored(e); }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 获取网络分析数据（从活动标签页的内容脚本收集性能条目）
 * 收集 navigation（主文档）+ resource（子资源）两类 PerformanceEntry
 * 包含 DNS / TCP / TLS / TTFB / 内容下载 等计时分解字段
 */
async function getNetworkAnalysis() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return { success: false, error: 'No active tab' };

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const r = n => (n == null || n < 0) ? 0 : Math.round(n * 100) / 100;
        // 计时分解：将各阶段耗时汇总为可读结构
        const breakdown = e => ({
          redirect: r((e.redirectEnd || 0) - (e.redirectStart || 0)),
          dns: r((e.domainLookupEnd || 0) - (e.domainLookupStart || 0)),
          tcp: r((e.connectEnd || 0) - (e.connectStart || 0)),
          tls: r((e.connectEnd || 0) - (e.secureConnectionStart || 0)),
          ttfb: r((e.responseStart || 0) - (e.requestStart || 0)),
          download: r((e.responseEnd || 0) - (e.responseStart || 0)),
          worker: r((e.fetchStart || 0) - (e.workerStart || 0))
        });
        const out = [];
        // 1. 导航条目（主文档，含 responseStatus / 请求方法）
        try {
          const navs = performance.getEntriesByType('navigation');
          for (const n of navs) {
            out.push({
              name: n.name,
              initiatorType: 'navigation',
              method: 'GET',
              status: n.responseStatus || 0,
              duration: r(n.duration),
              transferSize: n.transferSize,
              encodedBodySize: n.encodedBodySize,
              decodedBodySize: n.decodedBodySize,
              startTime: 0,
              responseStart: r(n.responseStart),
              responseEnd: r(n.responseEnd),
              protocol: n.nextHopProtocol || '',
              breakdown: breakdown(n),
              isNavigation: true
            });
          }
        } catch (e) { logIgnored(e); }
        // 2. 资源条目（PerformanceResourceTiming 不暴露 method/status）
        const entries = performance.getEntriesByType('resource');
        for (const e of entries) {
          out.push({
            name: e.name,
            initiatorType: e.initiatorType,
            method: '',
            status: 0,
            duration: r(e.duration),
            transferSize: e.transferSize,
            encodedBodySize: e.encodedBodySize,
            decodedBodySize: e.decodedBodySize,
            startTime: r(e.startTime),
            responseStart: r(e.responseStart),
            responseEnd: r(e.responseEnd),
            protocol: e.nextHopProtocol || '',
            breakdown: breakdown(e),
            isNavigation: false
          });
        }
        return out;
      }
    });

    const data = results?.[0]?.result || [];
    const summary = {
      totalRequests: data.length,
      totalTransferSize: data.reduce((s, e) => s + (e.transferSize || 0), 0),
      avgDuration: data.length ? Math.round(data.reduce((s, e) => s + e.duration, 0) / data.length * 100) / 100 : 0,
      byType: {}
    };

    data.forEach(e => {
      const type = e.initiatorType || 'other';
      if (!summary.byType[type]) summary.byType[type] = { count: 0, totalSize: 0 };
      summary.byType[type].count++;
      summary.byType[type].totalSize += e.transferSize || 0;
    });

    return { success: true, entries: data, summary, pageDomain: new URL(tab.url).hostname };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 恢复持久化安全功能
 * 在 Service Worker 启动时重新注册所有已保存的规则
 */
async function restorePersistentFeatures() {
  console.log('[ToolCube] Restoring persistent security features...');

  // 检查全局开关状态
  const masterResult = await chrome.storage.local.get('toolbox_master_enabled');
  if (masterResult.toolbox_master_enabled === false) {
    console.log('[ToolCube] Master switch is off, skipping feature restoration');
    return;
  }

  try {
    const stored = await chrome.storage.local.get([
      'toolbox_tracker_blocker',
      'toolbox_https_enforcer',
      'toolbox_anti_fingerprint',
      'toolbox_custom_headers',
      'toolbox_script_injector',
      'toolbox_auto_play_next',
      'toolbox_video_unlocker',
      'toolbox_silver_fox_guard',
      'toolbox_ua_switcher'
    ]);

    // 获取已注册的内容脚本，避免不必要的重新注册
    let registeredScripts = [];
    try {
      registeredScripts = await chrome.scripting.getRegisteredContentScripts();
    } catch (e) { logIgnored(e); }
    const registeredIds = new Set(registeredScripts.map(s => s.id));

    // 恢复追踪器屏蔽（declarativeNetRequest 规则在 Service Worker 休眠期间仍然有效，无需重建）
    // 只在规则不存在时才重建
    if (stored.toolbox_tracker_blocker?.enabled) {
      try {
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        const hasTrackerRules = existingRules.some(r => r.id >= 10000 && r.id < 11000);
        if (!hasTrackerRules) {
          await trackerBlockerEnable(stored.toolbox_tracker_blocker);
          console.log('[ToolCube] Tracker blocker rules restored');
        } else {
          console.log('[ToolCube] Tracker blocker rules already active');
        }
      } catch (e) {
        console.error('[ToolCube] Failed to restore tracker blocker:', e);
      }
    }

    // 恢复 HTTPS 强制
    if (stored.toolbox_https_enforcer?.enabled) {
      try {
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        const hasHttpsRules = existingRules.some(r => r.id >= 11000 && r.id < 12000);
        if (!hasHttpsRules) {
          await httpsEnforcerEnable(stored.toolbox_https_enforcer);
          console.log('[ToolCube] HTTPS enforcer rules restored');
        } else {
          console.log('[ToolCube] HTTPS enforcer rules already active');
        }
      } catch (e) {
        console.error('[ToolCube] Failed to restore HTTPS enforcer:', e);
      }
    }

    // 恢复反指纹（检查内容脚本是否已注册）
    if (stored.toolbox_anti_fingerprint?.enabled) {
      try {
        if (!registeredIds.has('anti-fingerprint')) {
          await antiFingerprintEnable(stored.toolbox_anti_fingerprint);
          console.log('[ToolCube] Anti-fingerprint script restored');
        } else {
          console.log('[ToolCube] Anti-fingerprint script already registered');
        }
      } catch (e) {
        console.error('[ToolCube] Failed to restore anti-fingerprint:', e);
      }
    }

    // 恢复自定义请求头
    if (stored.toolbox_custom_headers?.enabled) {
      try {
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        const hasHeaderRules = existingRules.some(r => r.id >= 13000 && r.id < 14000);
        if (!hasHeaderRules) {
          await customHeadersEnable(stored.toolbox_custom_headers);
          console.log('[ToolCube] Custom headers rules restored');
        } else {
          console.log('[ToolCube] Custom headers rules already active');
        }
      } catch (e) {
        console.error('[ToolCube] Failed to restore custom headers:', e);
      }
    }

    // 恢复脚本注入（检查内容脚本是否已注册）
    if (stored.toolbox_script_injector?.enabled) {
      try {
        if (!registeredIds.has('user-scripts-runner')) {
          await scriptInjectorEnable(stored.toolbox_script_injector);
          console.log('[ToolCube] Script injector restored');
        } else {
          console.log('[ToolCube] Script injector already registered');
        }
      } catch (e) {
        console.error('[ToolCube] Failed to restore script injector:', e);
      }
    }

    // 恢复自动连播（检查内容脚本是否已注册）
    if (stored.toolbox_auto_play_next?.enabled) {
      try {
        if (!registeredIds.has('auto-play-next')) {
          await autoPlayNextEnable(stored.toolbox_auto_play_next);
          console.log('[ToolCube] Auto play next restored');
        } else {
          console.log('[ToolCube] Auto play next already registered');
        }
      } catch (e) {
        console.error('[ToolCube] Failed to restore auto play next:', e);
      }
    }

    // 恢复视频解锁（检查内容脚本是否已注册）
    if (stored.toolbox_video_unlocker?.enabled) {
      try {
        if (!registeredIds.has('video-unlocker')) {
          await videoUnlockerEnable(stored.toolbox_video_unlocker);
          console.log('[ToolCube] Video unlocker restored');
        } else {
          console.log('[ToolCube] Video unlocker already registered');
        }
      } catch (e) {
        console.error('[ToolCube] Failed to restore video unlocker:', e);
      }
    }

    // 恢复上报拦截规则（如果之前已启用）
    if (stored.toolbox_video_unlocker?.blockReports) {
      try {
        await videoUnlockerSetReportBlocking({
          enabled: true,
          patterns: stored.toolbox_video_unlocker.reportPatterns || ''
        });
        console.log('[ToolCube] Report blocking restored');
      } catch (e) {
        console.error('[ToolCube] Failed to restore report blocking:', e);
      }
    }

    // 恢复银狐木马拦截
    if (stored.toolbox_silver_fox_guard?.enabled) {
      try {
        sfgEnabled = true;
        sfgSensitivity = stored.toolbox_silver_fox_guard.sensitivity || 'medium';
        if (!sfgStateLoaded) await sfgLoadState();
        console.log('[ToolCube] Silver Fox Guard restored');
      } catch (e) {
        console.error('[ToolCube] Failed to restore Silver Fox Guard:', e);
      }
    }

    // 恢复UA切换器
    if (stored.toolbox_ua_switcher?.enabled) {
      try {
        await setDeclarativeRule(stored.toolbox_ua_switcher);
        console.log('[ToolCube] UA Switcher restored');
      } catch (e) {
        console.error('[ToolCube] Failed to restore UA Switcher:', e);
      }
    }

    console.log('[ToolCube] Persistent features restore completed');
  } catch (e) {
    console.error('[ToolCube] Failed to restore persistent features:', e);
  }
}

// ==================== 银狐木马下载拦截 ====================

const SFG_DANGEROUS_EXTS = new Set([
  '.exe', '.msi', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.wsf', '.scr', '.com', '.hta', '.cpl',
  '.dll', '.sys',  // 银狐常用DLL注入
  // 扩展：脚本/容器类（银狐新型投递载体）
  '.jar',   // Java 归档（可含恶意 class）
  '.lnk',   // Windows 快捷方式（常用于伪装图标触发）
  '.url',   // URL 快捷方式（可指向恶意下载）
  '.reg',   // 注册表脚本（可修改系统配置）
  '.chm',   // 编译HTML帮助（可含脚本与漏洞利用）
  '.iso', '.img',  // 光盘镜像（绕过 Mark-of-the-Web 保护）
  '.vhd', '.vhdx', // 虚拟硬盘（绕过 MOTW）
  '.hwp', '.hwpx', // 韩文文档（APT 常用漏洞利用载体）
  '.sh',    // Shell 脚本
  '.py', '.pyc', // Python 脚本/字节码
  '.apk',   // Android 安装包
  '.ocx',   // ActiveX 控件（可被执行）
  '.job'    // 计划任务文件（用于持久化）
]);
const SFG_ARCHIVE_EXTS = new Set([
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.cab'
]);
const SFG_DOC_EXTS = {
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};
const SFG_SUSPICIOUS_MIMES = new Set([
  'application/octet-stream', 'application/x-msdownload', 'application/x-dosexec', 'application/x-executable'
]);

let sfgEnabled = false;
let sfgSensitivity = 'medium'; // low / medium / high
let sfgStats = { scanned: 0, blocked: 0, passed: 0 };
let sfgAlerts = [];
let sfgStateLoaded = false;

// 从存储恢复银狐拦截状态（SW重启后调用）
async function sfgLoadState() {
  if (sfgStateLoaded) return;
  sfgStateLoaded = true;
  try {
    const stored = await chrome.storage.local.get(['toolbox_silver_fox_guard', 'toolbox_sfg_stats', 'toolbox_sfg_alerts']);
    if (stored.toolbox_silver_fox_guard) {
      sfgEnabled = !!stored.toolbox_silver_fox_guard.enabled;
      sfgSensitivity = stored.toolbox_silver_fox_guard.sensitivity || 'medium';
    }
    if (stored.toolbox_sfg_stats) sfgStats = stored.toolbox_sfg_stats;
    if (stored.toolbox_sfg_alerts) sfgAlerts = stored.toolbox_sfg_alerts;
    console.log('[ToolCube] Silver Fox Guard state loaded:', sfgEnabled ? 'enabled' : 'disabled');
  } catch (e) {
    console.error('[ToolCube] Failed to load SFG state:', e);
  }
}

// 灵敏度阈值配置
const SFG_THRESHOLDS = {
  low:    { high: 85, medium: 60 },
  medium: { high: 70, medium: 45 },
  high:   { high: 50, medium: 25 }
};

function sfgGetExt(filename) {
  if (!filename) return '';
  const parts = filename.split('.');
  return parts.length > 1 ? ('.' + parts.pop().toLowerCase()) : '';
}

function sfgShouldScan(ext, mime) {
  // 可执行文件
  if (SFG_DANGEROUS_EXTS.has(ext)) return { scan: true, reason: '可执行文件下载' };
  // 压缩包
  if (SFG_ARCHIVE_EXTS.has(ext)) return { scan: true, reason: '压缩包文件下载' };
  // MIME与扩展名不匹配
  if (SFG_DOC_EXTS[ext] && mime && SFG_SUSPICIOUS_MIMES.has(mime)) {
    return { scan: true, reason: `MIME不匹配(${ext}→${mime})` };
  }
  // 扩展名与MIME完全不符（文件名是.pdf但MIME是application/x-executable等）
  if (SFG_DOC_EXTS[ext] && mime && mime.includes('executable')) {
    return { scan: true, reason: `可疑MIME类型: ${mime}` };
  }
  return { scan: false, reason: '' };
}

async function sfgHandleDownload(downloadItem) {
  // 确保状态已从存储加载
  if (!sfgStateLoaded) await sfgLoadState();
  if (!sfgEnabled) return;
  const { id, filename, mime, url, finalUrl } = downloadItem;
  if (!filename && !downloadItem.filename) return;

  const fName = filename || downloadItem.filename || '';
  const ext = sfgGetExt(fName);
  const check = sfgShouldScan(ext, mime || '');
  if (!check.scan) return;

  // 暂停下载
  try { await chrome.downloads.pause(id); } catch (e) { return; }
  sfgStats.scanned++;

  const downloadUrl = url || finalUrl || '';

  // 纯JS分析：先尝试fetch文件前1MB用于PE深度分析，失败则仅基于元数据
  var fileBuffer = null;
  try {
    if (downloadUrl && !downloadUrl.startsWith('blob:') && !downloadUrl.startsWith('data:')) {
      var controller = new AbortController();
      var fetchTimer = setTimeout(function () { controller.abort(); }, 8000);
      try {
        var resp = await fetch(downloadUrl, {
          headers: { 'Range': 'bytes=0-1048575' },
          signal: controller.signal,
          cache: 'no-store'
        });
        if (resp.ok || resp.status === 206) {
          fileBuffer = await resp.arrayBuffer();
        }
      } finally {
        clearTimeout(fetchTimer);
      }
    } else if (downloadUrl && downloadUrl.startsWith('data:')) {
      // data: URI 直接解析
      var base64Match = downloadUrl.match(/^data:[^;]*;base64,(.*)$/);
      if (base64Match && base64Match[1]) {
        try {
          var binaryStr = atob(base64Match[1]);
          var bytes = new Uint8Array(binaryStr.length);
          for (var bi = 0; bi < binaryStr.length; bi++) bytes[bi] = binaryStr.charCodeAt(bi);
          fileBuffer = bytes.buffer;
        } catch (atobErr) {
          fileBuffer = null;
        }
      }
    }
  } catch (e) {
    // fetch失败，仅基于元数据分析
    fileBuffer = null;
  }

  // 调用纯JS PE分析器
  try {
    var result = await analyzeFile({
      buffer: fileBuffer,
      filename: fName.split(/[\\/]/).pop(),
      mime: mime || '',
      url: downloadUrl
    }, sfgSensitivity);

    if (result.is_malicious) {
      var score = result.risk_score || 0;
      var thresholds = SFG_THRESHOLDS[sfgSensitivity] || SFG_THRESHOLDS.medium;

      if (score >= thresholds.high) {
        // 高风险：取消下载 + 清除记录 + 警告
        try { await chrome.downloads.cancel(id); } catch (e) { logIgnored(e); }
        try { await chrome.downloads.erase({ id }); } catch (e) { logIgnored(e); }
        sfgStats.blocked++;
        sfgAlerts.unshift({
          time: Date.now(), filename: fName.split(/[\\/]/).pop(),
          url: downloadUrl, risk: 'high', score: score,
          reason: (result.reasons || []).join('; ') || '检测到恶意软件'
        });
        // 尊重用户 showNotifications 设置
        await showNotification('恶意下载已拦截！', '"' + fName.split(/[\\/]/).pop() + '"已被拦截：' + ((result.reasons || [])[0] || '疑似银狐木马'));
      } else if (score >= thresholds.medium) {
        // 中风险：恢复下载但警告
        try { await chrome.downloads.resume(id); } catch (e) { logIgnored(e); }
        sfgStats.passed++;
        sfgAlerts.unshift({
          time: Date.now(), filename: fName.split(/[\\/]/).pop(),
          url: downloadUrl, risk: 'medium', score: score,
          reason: (result.reasons || []).join('; ') || '存在可疑特征'
        });
        await showNotification('下载安全提醒', '"' + fName.split(/[\\/]/).pop() + '"存在可疑特征(风险分:' + score + ')，已恢复下载，请谨慎打开。');
      } else {
        // 低风险：恢复下载
        try { await chrome.downloads.resume(id); } catch (e) { logIgnored(e); }
        sfgStats.passed++;
      }
    } else {
      // 安全：恢复下载
      try { await chrome.downloads.resume(id); } catch (e) { logIgnored(e); }
      sfgStats.passed++;
    }
  } catch (e) {
    // 分析异常 → 恢复下载
    try { await chrome.downloads.resume(id); } catch (err) { logIgnored(err); }
    sfgStats.passed++;
  }

  // 保存统计和警报
  if (sfgAlerts.length > 50) sfgAlerts = sfgAlerts.slice(0, 50);
  try {
    await chrome.storage.local.set({ toolbox_sfg_stats: sfgStats, toolbox_sfg_alerts: sfgAlerts });
    // 通知工具页面更新警报
    chrome.runtime.sendMessage({ action: 'sfg_alert', data: sfgAlerts[0], stats: sfgStats }).catch (function (e) { logIgnored(e); });
  } catch (e) { logIgnored(e); }
}

// 注册下载监听
try {
  chrome.downloads.onCreated.addListener(sfgHandleDownload);
} catch (e) {
  console.warn('[ToolCube] chrome.downloads API not available:', e.message);
}

async function silverFoxGuardEnable(data) {
  sfgEnabled = true;
  sfgSensitivity = data?.sensitivity || 'medium';
  const config = { enabled: true, sensitivity: sfgSensitivity, updatedAt: Date.now() };
  await chrome.storage.local.set({ toolbox_silver_fox_guard: config });
  return { success: true };
}

async function silverFoxGuardDisable() {
  sfgEnabled = false;
  const stored = await chrome.storage.local.get('toolbox_silver_fox_guard');
  if (stored.toolbox_silver_fox_guard) {
    stored.toolbox_silver_fox_guard.enabled = false;
    await chrome.storage.local.set({ toolbox_silver_fox_guard: stored.toolbox_silver_fox_guard });
  }
  return { success: true };
}

async function silverFoxGuardGetStats() {
  return { success: true, stats: sfgStats, alerts: sfgAlerts.slice(0, 20) };
}

// 启动时恢复银狐拦截状态
(async function initSfg() {
  try {
    const result = await chrome.storage.local.get([
      'toolbox_silver_fox_guard', 'toolbox_sfg_stats', 'toolbox_sfg_alerts'
    ]);
    if (result.toolbox_silver_fox_guard) {
      sfgEnabled = !!result.toolbox_silver_fox_guard.enabled;
      sfgSensitivity = result.toolbox_silver_fox_guard.sensitivity || 'medium';
    }
    if (result.toolbox_sfg_stats) sfgStats = result.toolbox_sfg_stats;
    if (result.toolbox_sfg_alerts) sfgAlerts = result.toolbox_sfg_alerts;
  } catch (e) {
    console.warn('[ToolCube] initSfg failed:', e.message);
  }
})().catch(function (e) {
  console.warn('[ToolCube] initSfg unhandled:', e.message);
});

async function portScan(host, ports, timeout) {
  if (!host || !ports || !ports.length) {
    return { success: false, error: '缺少参数' };
  }
  timeout = timeout || 3000;
  const results = [];
  // 并发限制为10
  for (let i = 0; i < ports.length; i += 10) {
    const batch = ports.slice(i, i + 10);
    const batchResults = await Promise.all(batch.map(port => scanSinglePort(host, port, timeout)));
    results.push(...batchResults);
  }
  return { success: true, results };
}

/**
 * 探测单个端口。
 *
 * 浏览器不提供原始套接字，只能依据 fetch 的成败与耗时间接推断，结论天然是「推断」而非确定：
 *   - 请求成功返回（no-cors 下为 opaque 响应）→ 该端口有可响应的 HTTP(S) 服务 → open
 *   - 超时（AbortError）→ 报文被丢弃，多为防火墙过滤 → filtered
 *   - 其它错误（如连接被拒绝）→ 浏览器不暴露底层原因，「端口关闭」与「端口开放但非 HTTP 协议」
 *     无法区分 → unknown
 *
 * 早期实现用耗时阈值把「快速失败」判为开放，会把被拒绝的连接（端口已关闭）误报成 OPEN，
 * 属于明确的逻辑错误，已改为如实标注而非猜测。
 */
async function scanSinglePort(host, port, timeout) {
  const protocol = [443, 465, 993, 995, 8443].includes(port) ? 'https' : 'http';
  const url = protocol + '://' + host + ':' + port + '/';
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    await fetch(url, { mode: 'no-cors', signal: controller.signal, cache: 'no-store' });
    return { port, state: 'open', time: Math.round(performance.now() - start) };
  } catch (e) {
    const elapsed = Math.round(performance.now() - start);
    if (e && e.name === 'AbortError') return { port, state: 'filtered', time: elapsed };
    return { port, state: 'unknown', time: elapsed };
  } finally {
    clearTimeout(timer);
  }
}

console.log('[ToolCube] Background service worker loaded');

// ==================== 外部服务端点（可插拔） ====================
//
// 这里是**唯一**访问第三方在线服务的出口。所有需要联网的能力（DNS、WHOIS、IP 归属地、
// 证书透明度、子域名、汇率、泄露查询、公网 IP）都经此分发，具体使用哪家服务、
// 是否指向自建服务器，由 common/service-providers.js 的注册表 + 用户在设置页的配置决定。
//
// 这样做的好处：
//   1. 工具侧不再硬编码任何第三方地址，换服务商/自建服务无需改代码；
//   2. 参数校验、超时、响应体大小限制、协议白名单集中在同一处，不会漏掉某条路径；
//   3. 服务商协议差异被封装在 provider 内，调用方只看到归一化结果。

/** 单次外部服务请求的超时上限（毫秒） */
const SERVICE_REQUEST_TIMEOUT_MS = 20000;
/** 外部服务响应体大小上限，防止异常响应耗尽内存 */
const SERVICE_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * 读取响应文本，超过大小上限时中止
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function readLimitedText(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > SERVICE_MAX_RESPONSE_BYTES) {
    throw new Error('响应体过大（' + Math.round(declared / 1024 / 1024) + 'MB），已拒绝读取');
  }
  const text = await response.text();
  if (text.length > SERVICE_MAX_RESPONSE_BYTES) {
    throw new Error('响应体过大，已中止读取');
  }
  return text;
}

/**
 * 把 Headers 转成普通对象
 * 跨进程消息需要可结构化克隆的数据，Headers 实例不能直接传递。
 */
function headersToObject(headers) {
  const out = {};
  if (headers && typeof headers.forEach === 'function') {
    headers.forEach((value, key) => { out[key] = value; });
  }
  return out;
}

/** 返回服务类别与服务商元数据（不含函数，可安全跨进程传递） */
function serviceProviders() {
  return {
    success: true,
    kinds: SERVICE_KINDS.map(k => ({
      id: k.id,
      label: k.label,
      description: k.description,
      params: k.params,
      resultSchema: k.resultSchema,
      usedBy: k.usedBy,
      transport: k.transport || 'http',
      defaultProviderId: k.defaultProviderId
    })),
    providers: PROVIDERS.map(p => ({
      id: p.id,
      kind: p.kind,
      label: p.label,
      description: p.description || '',
      homepage: p.homepage || '',
      selfHostable: p.selfHostable !== false,
      defaultBaseUrl: p.defaultBaseUrl || '',
      fields: p.fields || []
    }))
  };
}

/** 各类别用于连通性测试的最小代价探针参数 */
function serviceProbeParams(kind) {
  switch (kind) {
    case 'dns': return { name: 'example.com', type: 'A' };
    case 'whois': return { domain: 'example.com' };
    case 'ipGeo': return { ip: '1.1.1.1' };
    case 'ct': return { domain: 'example.com' };
    case 'subdomain': return { domain: 'example.com' };
    case 'currency': return { base: 'USD' };
    // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    // k-匿名接口需要前缀 + 后缀才能定位到具体密码，故探针同样传完整拆分
    case 'breach': return { mode: 'password', prefix: '5BAA6', suffix: '1E4C9B93F3F0682250B6CF8331B7EE68FD8' };
    case 'publicIp': return {};
    case 'ssl': return { domain: 'example.com' };
    case 'portScan': return { host: 'example.com' };
    case 'proxy': return { url: 'https://example.com/' };
    case 'readability': return { url: 'https://example.com/' };
    case 'urlScan': return { url: 'https://example.com/' };
    case 'webArchive': return { url: 'https://example.com/' };
    case 'ipReputation': return { ip: '1.1.1.1' };
    default: return {};
  }
}

async function serviceConfigGet() {
  try {
    const stored = await chrome.storage.local.get(SERVICE_CONFIG_KEY);
    return { success: true, config: normalizeServiceConfig(stored[SERVICE_CONFIG_KEY]) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function serviceConfigSet(config) {
  try {
    const normalized = normalizeServiceConfig(config);
    await chrome.storage.local.set({ [SERVICE_CONFIG_KEY]: normalized });
    return { success: true, config: normalized };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function serviceConfigReset() {
  try {
    const config = defaultServiceConfig();
    await chrome.storage.local.set({ [SERVICE_CONFIG_KEY]: config });
    return { success: true, config };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 为「客户端直连」类别构造目标地址（不发请求）
 *
 * 供 STUN（交给 RTCPeerConnection）、服务端截图（作为 <img src>）等场景使用。
 * 与 serviceRequest 共用同一套参数校验与服务商解析，保证配置语义一致。
 *
 * @param {{kind:string, params:object, providerId?:string}} data
 * @returns {Promise<{success:boolean, url?:string, provider?:string, error?:string}>}
 */
async function clientRequestUrl(data) {
  const kind = data && data.kind;
  try {
    const stored = await chrome.storage.local.get(SERVICE_CONFIG_KEY);
    const resolved = buildClientRequestUrl(
      kind,
      data && data.params,
      normalizeServiceConfig(stored[SERVICE_CONFIG_KEY]),
      typeof (data && data.providerId) === 'string' ? data.providerId : ''
    );
    return { success: true, url: resolved.url, provider: resolved.provider.id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 执行一次外部服务请求
 *
 * 完整链路：参数校验 → 解析服务商与生效配置 → 构造请求 → 协议白名单 →
 *          带超时与大小限制抓取 → provider 归一化。
 *
 * @param {{kind:string, params:object, providerId?:string}} data
 *        providerId 用于「同一类别的多服务商对比」场景（如 DNS 传播检查），
 *        留空则使用用户在设置页选定的服务商。
 * @returns {Promise<{success:boolean, data?:any, error?:string, meta?:object}>}
 */
async function serviceRequest(data) {
  const kind = data && data.kind;
  if (!kind) return { success: false, error: '缺少服务类别 (kind)' };
  if (!getServiceKind(kind)) return { success: false, error: '未知的服务类别: ' + kind };
  // 客户端直连类别（STUN、服务端截图）不经过 HTTP 响应解析：
  // 前者不是 HTTP 协议；后者返回图片二进制，用 response.text() 读取会被破坏。
  if (isClientTransport(kind)) {
    return { success: false, error: '该服务类别为客户端直连（' + kind + '），请使用 clientRequestUrl' };
  }

  let params;
  try {
    params = validateParams(kind, data.params);
  } catch (e) {
    return { success: false, error: e.message };
  }

  let provider;
  let cfg;
  try {
    const stored = await chrome.storage.local.get(SERVICE_CONFIG_KEY);
    const resolved = resolveEndpoint(
      kind,
      normalizeServiceConfig(stored[SERVICE_CONFIG_KEY]),
      typeof data.providerId === 'string' ? data.providerId : ''
    );
    provider = resolved.provider;
    cfg = resolved.cfg;
  } catch (e) {
    return { success: false, error: e.message };
  }

  let request;
  try {
    request = provider.buildRequest(params, cfg);
  } catch (e) {
    return { success: false, error: e.message, provider: provider.id };
  }
  if (!request || !request.url) {
    return { success: false, error: '服务商未生成有效的请求地址', provider: provider.id };
  }

  // 协议白名单：避免自定义地址被写成 file: / data: 等危险协议
  let target;
  try {
    target = new URL(request.url);
  } catch (e) {
    return { success: false, error: '服务地址非法: ' + request.url, provider: provider.id };
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { success: false, error: '仅支持 http/https 协议的服务地址', provider: provider.id };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVICE_REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const response = await fetch(target.href, Object.assign({}, request.options, {
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store'
    }));
    const text = await readLimitedText(response);
    const envelope = {
      status: response.status,
      ok: response.ok,
      text,
      headers: headersToObject(response.headers)
    };

    let result;
    try {
      result = provider.parse(envelope, params, cfg);
    } catch (parseError) {
      return {
        success: false,
        error: (response.ok ? '' : 'HTTP ' + response.status + ': ') + parseError.message,
        provider: provider.id,
        status: response.status
      };
    }
    if (result === undefined || result === null) {
      return { success: false, error: '服务返回了空结果', provider: provider.id, status: response.status };
    }

    return {
      success: true,
      data: result,
      meta: {
        kind,
        provider: provider.id,
        status: response.status,
        duration: Math.round(performance.now() - startedAt)
      }
    };
  } catch (e) {
    const isTimeout = e.name === 'AbortError';
    return {
      success: false,
      error: isTimeout ? '请求超时（' + (SERVICE_REQUEST_TIMEOUT_MS / 1000) + 's）' : e.message,
      provider: provider.id
    };
  } finally {
    clearTimeout(timer);
  }
}

// ==================== 兼容适配层 ====================
// 以下函数保留原有 action 名称，内部统一委托给 serviceRequest。
// 旧调用方（含用户自写脚本）无需改动即可继续工作，同时自动获得「可配置服务端点」能力。

/** @deprecated 请直接使用 serviceRequest({ kind: 'dns' }) */
async function dnsLookup(domain, type, providerId) {
  return serviceRequest({
    kind: 'dns',
    params: { name: domain, type: type || 'A' },
    providerId: providerId || ''
  });
}

/** @deprecated 请直接使用 serviceRequest({ kind: 'ct' }) */
async function sslCheck(domain) {
  const result = await serviceRequest({ kind: 'ct', params: { domain } });
  if (!result.success) {
    return { success: false, error: result.error, data: { httpsSupported: null, ctLogs: null, ctError: result.error } };
  }
  const certificates = result.data.certificates || [];
  const now = Date.now();
  const current = certificates.filter(c => {
    const t = Date.parse(c.notAfter);
    return Number.isFinite(t) && t > now;
  });
  return {
    success: true,
    data: {
      ctLogs: {
        totalCerts: certificates.length,
        currentCerts: current.length,
        allCerts: certificates.slice(0, 50)
      }
    }
  };
}

// ==================== 子域名查找 ====================

/** @deprecated 请直接使用 serviceRequest({ kind: 'subdomain' }) */
async function findSubdomains(domain, source) {
  const result = await serviceRequest({
    kind: 'subdomain',
    params: { domain },
    providerId: source && source !== 'ct' ? source : ''
  });
  if (!result.success) return { success: false, error: result.error };
  // 兼容旧返回结构（results[].subdomain）
  return {
    success: true,
    results: (result.data.subdomains || []).map(s => ({
      subdomain: s.name,
      source: s.source,
      firstSeen: s.firstSeen
    }))
  };
}

// ==================== WHOIS 查询 ====================

/**
 * 打开扩展设置页面
 */
async function openOptionsPageHandler() {
  try {
    // 优先使用 openOptionsPage，失败则用 tabs.create 兜底
    if (chrome.runtime.openOptionsPage) {
      try {
        await chrome.runtime.openOptionsPage();
        return { success: true };
      } catch (_) {
        // openOptionsPage 失败，走 tabs.create 兜底
      }
    }
    const url = chrome.runtime.getURL('options/options.html');
    await chrome.tabs.create({ url });
    return { success: true };
  } catch (e) {
    console.error('[ToolCube] Failed to open options page:', e);
    return { success: false, error: e.message };
  }
}

/** @deprecated 请直接使用 serviceRequest({ kind: 'whois' }) */
async function whoisLookup(domain) {
  const result = await serviceRequest({ kind: 'whois', params: { domain } });
  if (!result.success) return { success: false, error: result.error };
  return { success: true, data: result.data, rawText: result.data.raw || '' };
}

// ==================== 通用 HTTP 代理（绕过 CORS） ====================

/**
 * 通用 HTTP 请求代理：在 background SW 中发起 fetch，绕过页面 CORS 限制
 * 供 http-tester 等工具使用
 * @param {{url:string, method?:string, headers?:object, body?:string, timeout?:number}} data
 * @returns {Promise<{success:boolean, status:number, statusText:string, headers:object, rawHeaders:string, body:string, duration:number, error?:string, redirected:boolean, finalUrl:string}>}
 */
async function fetchUrl(data) {
  if (!data || !data.url) return { success: false, error: 'Missing url' };
  const url = data.url;
  const method = (data.method || 'GET').toUpperCase();
  const headers = data.headers || {};
  const body = (method !== 'GET' && method !== 'HEAD') ? (data.body || null) : null;
  const timeout = Math.min(60000, Math.max(1000, data.timeout || 30000));

  const startTime = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const options = { method, headers, signal: controller.signal, credentials: 'omit' };
    if (body) options.body = body;
    const response = await fetch(url, options);
    clearTimeout(timer);
    const duration = Math.round(performance.now() - startTime);

    // 收集响应头
    const headersObj = {};
    const rawHeaderLines = [];
    response.headers.forEach((value, key) => {
      headersObj[key] = value;
      rawHeaderLines.push(`${key}: ${value}`);
    });

    // 读取响应体（限制 10MB 防止内存爆炸）
    const text = await response.text();
    return {
      success: true,
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: headersObj,
      rawHeaders: rawHeaderLines.join('\n'),
      body: text,
      duration,
      redirected: response.redirected,
      finalUrl: response.url,
      bodySize: new Blob([text]).size
    };
  } catch (e) {
    clearTimeout(timer);
    const duration = Math.round(performance.now() - startTime);
    const isTimeout = e.name === 'AbortError';
    return {
      success: false,
      status: 0,
      statusText: '',
      headers: {},
      rawHeaders: '',
      body: '',
      duration,
      error: isTimeout ? `请求超时（${timeout / 1000}s）` : e.message
    };
  }
}

// ==================== IP 查询代理（绕过 CORS） ====================

/**
 * 查询指定 IP 的地理位置信息（通过 ip-api.com）
 * @param {string} ip IP 地址，留空则查询本机 IP
 */
/** @deprecated 请直接使用 serviceRequest({ kind: 'ipGeo' }) */
async function ipLookup(ip) {
  return serviceRequest({ kind: 'ipGeo', params: { ip: ip || '' } });
}

/**
 * 获取本机公网 IP（尽量同时返回归属地）
 *
 * 主路径用 `ipGeo`（不传 IP 即查询调用方自身），一次请求同时拿到 IP 与地理位置；
 * 若该服务商不支持自查询或失败，降级到 `publicIp` 只取 IP。
 * 两条路径都可被用户配置为自建服务，因此这里不再硬编码任何地址。
 */
async function getMyIp() {
  const geo = await serviceRequest({ kind: 'ipGeo', params: { ip: '' } });
  if (geo.success && geo.data && geo.data.ip) {
    return { success: true, ip: geo.data.ip, data: geo.data };
  }
  const plain = await serviceRequest({ kind: 'publicIp', params: {} });
  if (plain.success && plain.data && plain.data.ip) {
    return { success: true, ip: plain.data.ip, data: null };
  }
  return { success: false, error: geo.error || plain.error || '获取本机 IP 失败' };
}
