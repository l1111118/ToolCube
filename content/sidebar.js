/**
 * ToolCube - Sidebar Controller
 * 侧边栏控制器，管理工具列表和交互
 * @version 1.3.0
 */

import { TOOLS_CONFIG, PINYIN_MAP, CATEGORIES } from '../common/tool-registry.js';
import { getI18n, localizeTool } from '../common/i18n.js';
import { TermsManager, renderTermsModal, showLockedScreen } from '../common/terms.js';
import { debounce, escapeHtml, truncate } from '../common/utils.js';

// ==================== 状态管理 ====================
function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
function safeStorage(op, ...args) { if (!isCtxValid()) return op === 'get' ? Promise.resolve({}) : Promise.resolve(); try { return chrome.storage.local[op](...args); } catch(e) { return op === 'get' ? Promise.resolve({}) : Promise.resolve(); } }

const state = {
  tools: [],
  favorites: [],
  recent: [],
  currentCategory: 'all',
  currentTool: null,
  searchQuery: '',
  isToolOpen: false,
  theme: 'auto',
  // 标记侧边栏是否因元素选择等场景临时关闭（用于保留工具 iframe）
  temporarySidebarClose: false,
  masterEnabled: true,
  enabledTools: [],
  // 工具启用/禁用状态（来自 storage.tools_status）
  toolsStatus: {}
};

// ==================== DOM元素引用 ====================
let elements = {};

// ==================== 初始化 ====================
// 消息缓冲：初始化（i18n/terms/数据加载）完成前到达的消息先入队，避免丢失
let _appReady = false;
const _pendingMessages = [];

function _onEarlyMessage(event) {
  if (!event.data || typeof event.data !== 'object') return;
  const { action } = event.data;
  if (!action) return;
  if (!_appReady) {
    // 只缓冲关键消息，其余丢弃（此时 UI 未就绪也无法处理）
    if (action === 'openTool' || action === 'openToolWithData' || action === 'sidebarOpened' ||
        action === 'sidebarClosed' || action === 'focusSearch' || action === 'videoUnlocker:setConfig') {
      _pendingMessages.push(event);
    }
    return;
  }
  handleMessage(event);
}

function _flushPendingMessages() {
  _appReady = true;
  while (_pendingMessages.length > 0) {
    try { handleMessage(_pendingMessages.shift()); } catch (e) {}
  }
}

(async function bootstrap() {
  // 在一切异步初始化之前注册消息监听，防止初始化期间消息丢失（修复首次打开工具/命令失效问题）
  window.addEventListener('message', _onEarlyMessage);

  const i18n = getI18n();
  await i18n.init();
  document.documentElement.setAttribute('lang', i18n.getCurrentLocale());

  // 协议检测：未同意则显示锁屏和弹窗
  const tm = new TermsManager();
  const accepted = await tm.hasAccepted();
  if (!accepted) {
    showLockedScreen();
    const modal = renderTermsModal({
      onAgree: () => location.reload(),
      // 不同意：留在锁屏态，不 reload（避免无限循环弹窗）
      onDisagree: () => {}
    });
    document.body.appendChild(modal);
    return;
  }

  // module 脚本是 deferred 的，DOM 在脚本执行时已就绪
  // 无需再监听 DOMContentLoaded（且 await i18n.init() 期间事件会错过）
  await initApp();
  _flushPendingMessages();
})();

async function initApp() {
  console.log('[Sidebar] Initializing...');

  // 应用 i18n 文案
  applyI18nLabels();

  initElements();
  initEventListeners();
  initStorageListener();
  await loadData();
  renderTools();

  console.log('[Sidebar] Initialized');
}

/**
 * 应用 i18n 文案到所有 data-i18n 元素
 */
function applyI18nLabels() {
  const i18n = getI18n();
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = i18n.t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = i18n.t(el.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = i18n.t(el.dataset.i18nPlaceholder);
  });
  // 版本号取自 manifest，避免在 HTML 中写死
  const versionEl = document.getElementById('sidebar-version');
  if (versionEl) versionEl.textContent = 'v' + chrome.runtime.getManifest().version;
}

/**
 * 初始化DOM元素引用
 */
function initElements() {
  elements = {
    // 头部
    btnSettings: document.getElementById('btn-settings'),
    btnClose: document.getElementById('btn-close'),
    
    // 搜索
    searchInput: document.getElementById('search-input'),
    
    // 标签
    tabs: document.querySelectorAll('.toolbox-tab'),
    
    // 容器
    toolsContainer: document.getElementById('tools-container'),
    favoritesSection: document.getElementById('favorites-section'),
    recentSection: document.getElementById('recent-section'),
    favoritesGrid: document.getElementById('favorites-grid'),
    recentGrid: document.getElementById('recent-grid'),
    masterSwitchInput: document.getElementById('master-switch-input'),
    masterSwitch: document.getElementById('master-switch'),
    enabledGrid: document.getElementById('enabled-grid'),
    enabledSection: document.getElementById('enabled-section'),
    
    // 分类网格
    textGrid: document.getElementById('text-grid'),
    encodingGrid: document.getElementById('encoding-grid'),
    dataGrid: document.getElementById('data-grid'),
    designGrid: document.getElementById('design-grid'),
    networkGrid: document.getElementById('network-grid'),
    devtoolsGrid: document.getElementById('devtools-grid'),
    geekGrid: document.getElementById('geek-grid'),
    dailyGrid: document.getElementById('daily-grid'),
    securityGrid: document.getElementById('security-grid'),
    
    // 工具内容
    toolContent: document.getElementById('tool-content'),
    btnBack: document.getElementById('btn-back'),
    currentToolTitle: document.getElementById('current-tool-title'),
    btnFavoriteTool: document.getElementById('btn-favorite-tool'),
    btnHistory: document.getElementById('btn-history'),
    toolIframeContainer: document.getElementById('tool-iframe-container'),
    
    // 底部
    statusText: document.getElementById('status-text'),
    
    // 模态框
    historyModal: document.getElementById('history-modal'),
    historyList: document.getElementById('history-list'),
    btnClearHistory: document.getElementById('btn-clear-history'),
    
    // 提示
    toast: document.getElementById('toast')
  };
}

/**
 * 初始化事件监听
 */
function initEventListeners() {
  // 关闭按钮
  elements.btnClose.addEventListener('click', () => {
    window.parent.postMessage({ action: 'closeSidebar' }, '*');
  });

  // 设置按钮 — 通过 background 打开设置页面，失败则直接打开URL
  elements.btnSettings.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({ action: 'openOptionsPage' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          window.open(chrome.runtime.getURL('options/options.html'), '_blank');
        }
      });
    } catch (e) {
      try { window.open(chrome.runtime.getURL('options/options.html'), '_blank'); } catch (_) {}
    }
  });

  // 搜索输入
  const searchClearBtn = document.getElementById('search-clear');
  elements.searchInput.addEventListener('input', debounce((e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    if (searchClearBtn) searchClearBtn.style.display = state.searchQuery ? 'block' : 'none';
    filterTools();
  }, 200));

  // 搜索清除按钮
  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      elements.searchInput.value = '';
      state.searchQuery = '';
      searchClearBtn.style.display = 'none';
      filterTools();
      elements.searchInput.focus();
    });
  }

  // 分类标签
  elements.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      elements.tabs.forEach(t => t.classList.remove('toolbox-tab--active'));
      tab.classList.add('toolbox-tab--active');
      state.currentCategory = tab.dataset.category;
      filterByCategory();
    });
  });

  // 返回按钮
  elements.btnBack.addEventListener('click', closeTool);

  // 收藏按钮
  elements.btnFavoriteTool.addEventListener('click', toggleCurrentToolFavorite);

  // 历史记录按钮
  elements.btnHistory.addEventListener('click', showHistoryModal);

  // 清空历史
  elements.btnClearHistory.addEventListener('click', clearHistory);

  // 模态框关闭
  document.querySelector('.modal__overlay').addEventListener('click', hideHistoryModal);
  document.querySelector('.modal__close').addEventListener('click', hideHistoryModal);

  // 工具项事件委托 - 替代 90+ 个单独监听器，提升性能
  elements.toolsContainer.addEventListener('click', (e) => {
    const toolItem = e.target.closest('.tool-item');
    if (toolItem && toolItem.dataset.toolId) {
      const tool = state.tools.find(t => t.id === toolItem.dataset.toolId);
      if (tool) openTool(tool);
    }
  });
  elements.toolsContainer.addEventListener('contextmenu', (e) => {
    const toolItem = e.target.closest('.tool-item');
    if (toolItem && toolItem.dataset.toolId) {
      e.preventDefault();
      const tool = state.tools.find(t => t.id === toolItem.dataset.toolId);
      if (tool) showToolContextMenu(e, tool);
    }
  });

  // 分类头部折叠事件委托
  elements.toolsContainer.addEventListener('click', (e) => {
    const header = e.target.closest('.tools-section__header');
    if (!header) return;
    // 仅当点击的是 header 或 toggle 元素时折叠
    if (e.target === header || e.target.closest('.tools-section__toggle')) {
      handleCategoryToggle(header);
    }
  });

  // 键盘快捷键
  document.addEventListener('keydown', handleKeyDown);

  // 全局开关
  elements.masterSwitchInput.addEventListener('change', async () => {
    state.masterEnabled = elements.masterSwitchInput.checked;
    elements.masterSwitch.classList.toggle('master-switch--off', !state.masterEnabled);
    await safeStorage('set', { toolbox_master_enabled: state.masterEnabled });
    if (!state.masterEnabled) {
      safeSend({ action: 'masterSwitchOff' });
    } else {
      safeSend({ action: 'masterSwitchOn' });
    }
    renderTools();
  });

  // 监听来自父窗口的消息（已在 bootstrap 最前注册 _onEarlyMessage，避免初始化竞态丢消息）
  // 注意：此处不再重复 addEventListener，否则消息会双份处理

  // 监听系统主题变化（auto 模式跟随系统）
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (state.theme === 'auto') {
      applyTheme();
    }
  });
}

/**
 * 处理分类折叠/展开
 */
function handleCategoryToggle(header) {
  const grid = header.nextElementSibling;
  if (!grid || !grid.classList.contains('tools-grid')) return;

  const section = header.closest('.tools-section');
  // 用 section.id 作为折叠 key（favorites/recent/enabled 的 className 都是 tools-section，会互相覆盖）
  const catKey = section ? (section.id || section.dataset.category || section.className) :
                 (header.querySelector('.tools-section__title')?.textContent || '');

  let collapseState = {};
  try {
    const saved = localStorage.getItem('toolbox_category_collapse');
    if (saved) Object.assign(collapseState, JSON.parse(saved));
  } catch (e) {}

  const isCollapsed = grid.style.display === 'none';
  grid.style.display = isCollapsed ? '' : 'none';
  const toggle = header.querySelector('.tools-section__toggle');
  if (toggle) toggle.textContent = isCollapsed ? '▼' : '▶';
  collapseState[catKey] = !isCollapsed;
  try { localStorage.setItem('toolbox_category_collapse', JSON.stringify(collapseState)); } catch (e) {}
}

// ==================== 数据加载 ====================

/**
 * 加载数据
 */
async function loadData() {
  try {
    state.tools = [...TOOLS_CONFIG];
    
    // 加载设置（含主题）
    const settingsResult = await safeStorage('get', 'toolbox_settings');
    const settings = settingsResult.toolbox_settings || {};
    state.theme = settings.theme || 'auto';
    state.autoSave = settings.autoSave !== false; // autoSave 默认开启
    applyTheme();

    // 从storage加载收藏
    const result = await safeStorage('get', 'toolbox_favorites');
    state.favorites = result.toolbox_favorites || [];

    // 加载最近使用
    const historyResult = await safeStorage('get', 'toolbox_recent');
    state.recent = historyResult.toolbox_recent || [];

    // 加载全局开关状态
    const masterResult = await safeStorage('get', 'toolbox_master_enabled');
    state.masterEnabled = masterResult.toolbox_master_enabled !== false; // 默认 true

    // 加载工具启用/禁用状态（用于过滤被禁用的工具）
    const statusResult = await safeStorage('get', 'tools_status');
    state.toolsStatus = statusResult.tools_status || {};

  } catch (error) {
    console.error('[Sidebar] Failed to load data:', error);
  }
}

/**
 * 应用主题
 */
function applyTheme() {
  const isDark = state.theme === 'dark' || 
    (state.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  // 同时设置两个属性，二者服务不同用途，缺一不可：
  //  - data-theme：sidebar.css 自身的选择器使用（如 .search-highlight 的暗色样式），
  //    也被下方 loadToolIframe 读取以决定传给工具 iframe 的主题。
  //  - data-toolbox-theme：styles.css 中 --toolbox-* 暗色变量选择器使用。
  //    styles.css 同时被「宿主页面」与「本侧边栏 iframe」引用，两侧必须使用同一属性名；
  //    若此处漏设，侧边栏内的暗色主题变量将不生效（整块侧边栏退化为亮色）。
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-toolbox-theme', isDark ? 'dark' : 'light');
  
  // 通知宿主页面 injector 同步主题（修复白边问题）
  window.parent.postMessage({
    action: 'setTheme',
    data: { theme: state.theme }
  }, '*');

  // 通知当前打开的工具 iframe 切换主题
  const toolIframe = elements.toolIframeContainer?.querySelector('iframe');
  if (toolIframe && toolIframe.contentWindow) {
    toolIframe.contentWindow.postMessage({
      action: 'setTheme',
      data: { theme: isDark ? 'dark' : 'light' }
    }, '*');
  }
}

/**
 * 保存收藏
 */
async function saveFavorites() {
  try {
    await safeStorage('set', { toolbox_favorites: state.favorites });
  } catch (error) {
    console.error('[Sidebar] Failed to save favorites:', error);
  }
}

/**
 * 保存最近使用
 */
async function saveRecent() {
  try {
    // 只保留最近6个
    const recent = state.recent.slice(0, 6);
    await safeStorage('set', { toolbox_recent: recent });
  } catch (error) {
    console.error('[Sidebar] Failed to save recent:', error);
  }
}

async function loadEnabledTools() {
  state.enabledTools = [];
  // 检查所有持久化功能的开启状态
  const storageKeys = [
    'toolbox_auto_play_next',
    'toolbox_video_unlocker',
    'toolbox_tracker_blocker',
    'toolbox_https_enforcer',
    'toolbox_anti_fingerprint',
    'toolbox_custom_headers',
    'toolbox_script_injector',
    'toolbox_video_speed',
    'toolbox_silver_fox_guard',
    'toolbox_resource_sniffer',
    'toolbox_ua_switcher'
  ];

  // toolId 到 storage key 的映射
  const toolStorageMap = {
    'auto-play-next': 'toolbox_auto_play_next',
    'video-unlocker': 'toolbox_video_unlocker',
    'tracker-blocker': 'toolbox_tracker_blocker',
    'https-enforcer': 'toolbox_https_enforcer',
    'anti-fingerprint': 'toolbox_anti_fingerprint',
    'custom-headers': 'toolbox_custom_headers',
    'script-injector': 'toolbox_script_injector',
    'video-speed': 'toolbox_video_speed',
    'silver-fox-guard': 'toolbox_silver_fox_guard',
    'resource-sniffer': 'toolbox_resource_sniffer',
    'user-agent-switcher': 'toolbox_ua_switcher'
  };

  try {
    const result = await safeStorage('get', storageKeys);
    for (const [toolId, storageKey] of Object.entries(toolStorageMap)) {
      const config = result[storageKey];
      if (!config) continue;
      const isEnabled = storageKey === 'toolbox_video_speed'
        ? config.speed !== undefined && config.speed !== 1
        : storageKey === 'toolbox_resource_sniffer'
        ? config.isLiveMonitor === true
        : config?.enabled === true;
      if (isEnabled) {
        const tool = state.tools.find(t => t.id === toolId);
        if (tool) state.enabledTools.push(tool);
      }
    }
  } catch (e) {
    console.error('[Sidebar] Failed to load enabled tools:', e);
  }
}

// ==================== 渲染 ====================

// 防抖：避免短时间内多次 renderTools 导致异步竞态（重复渲染"已开启"功能）
let _renderToolsTimer = null;

/**
 * 渲染工具列表（带防抖）
 */
function renderTools() {
  clearTimeout(_renderToolsTimer);
  _renderToolsTimer = setTimeout(_doRenderTools, 50);
}

/**
 * 实际渲染逻辑
 */
function _doRenderTools() {
  // 清空网格
  elements.favoritesGrid.innerHTML = '';
  elements.recentGrid.innerHTML = '';
  elements.enabledGrid.innerHTML = '';
  elements.textGrid.innerHTML = '';
  elements.encodingGrid.innerHTML = '';
  elements.dataGrid.innerHTML = '';
  elements.designGrid.innerHTML = '';
  elements.networkGrid.innerHTML = '';
  if (elements.devtoolsGrid) elements.devtoolsGrid.innerHTML = '';
  if (elements.geekGrid) elements.geekGrid.innerHTML = '';
  if (elements.dailyGrid) elements.dailyGrid.innerHTML = '';
  if (elements.securityGrid) elements.securityGrid.innerHTML = '';
  
  // 渲染收藏
  const favoriteTools = state.tools.filter(t => state.favorites.includes(t.id));
  if (favoriteTools.length === 0) {
    elements.favoritesSection.classList.add('tools-section--hidden');
  } else {
    elements.favoritesSection.classList.remove('tools-section--hidden');
    favoriteTools.forEach(tool => {
      elements.favoritesGrid.appendChild(createToolItem(tool, true));
    });
  }
  
  // 按分类渲染（最多6个最近使用）
  const recentTools = state.recent
    .slice(0, 6)
    .map(id => state.tools.find(t => t.id === id))
    .filter(Boolean);
  if (recentTools.length === 0) {
    elements.recentSection.classList.add('tools-section--hidden');
  } else {
    elements.recentSection.classList.remove('tools-section--hidden');
    recentTools.forEach(tool => {
      elements.recentGrid.appendChild(createToolItem(tool));
    });
  }

  // 渲染已开启的功能
  loadEnabledTools().then(() => {
    // 再次清空，防止异步期间有旧数据残留
    elements.enabledGrid.innerHTML = '';
    if (state.enabledTools.length === 0) {
      elements.enabledSection.classList.add('tools-section--hidden');
    } else {
      elements.enabledSection.classList.remove('tools-section--hidden');
      state.enabledTools.forEach(tool => {
        elements.enabledGrid.appendChild(createToolItem(tool));
      });
    }

    // 应用全局开关状态
    elements.masterSwitchInput.checked = state.masterEnabled;
    elements.masterSwitch.classList.toggle('master-switch--off', !state.masterEnabled);
    if (!state.masterEnabled) {
      elements.enabledSection.classList.add('tools-section--hidden');
    }
  });

  // 按分类渲染（跳过被禁用的工具）
  state.tools.forEach(tool => {
    // 工具被显式禁用时不渲染到分类列表
    if (state.toolsStatus[tool.id]?.enabled === false) return;
    const item = createToolItem(tool);
    switch (tool.category) {
      case 'text':
        elements.textGrid.appendChild(item);
        break;
      case 'encoding':
        elements.encodingGrid.appendChild(item);
        break;
      case 'data':
        elements.dataGrid.appendChild(item);
        break;
      case 'design':
        elements.designGrid.appendChild(item);
        break;
      case 'network':
        elements.networkGrid.appendChild(item);
        break;
      case 'devtools':
        if (elements.devtoolsGrid) elements.devtoolsGrid.appendChild(item);
        break;
      case 'geek':
        if (elements.geekGrid) elements.geekGrid.appendChild(item);
        break;
      case 'daily':
        if (elements.dailyGrid) elements.dailyGrid.appendChild(item);
        break;
      case 'security':
        if (elements.securityGrid) elements.securityGrid.appendChild(item);
        break;
    }
  });

  // 初始化分类折叠功能
  initCategoryCollapse();

  // 重新应用当前分类筛选（修复：切到收藏/最近 tab 后任何渲染都会跳回全部）
  if (typeof filterByCategory === 'function') {
    filterByCategory();
  }
}

/**
 * 创建工具项元素
 */
function createToolItem(tool, isFavorite = false) {
  const div = document.createElement('div');
  div.className = `tool-item ${isFavorite ? 'tool-item--favorite' : ''}`;
  div.dataset.toolId = tool.id;
  div.dataset.category = tool.category;

  // 本地化显示名称（繁体/英文）
  const localized = localizeTool(tool);

  div.innerHTML = `
    <div class="tool-item__icon">
      ${localized.icon}
    </div>
    <div class="tool-item__name">${escapeHtml(localized.name)}</div>
  `;

  // 使用事件委托代替单独监听器（在 initEventListeners 中注册）
  return div;
}

/**
 * 初始化分类折叠功能
 */
function initCategoryCollapse() {
  const collapseState = {};
  try {
    const saved = localStorage.getItem('toolbox_category_collapse');
    if (saved) Object.assign(collapseState, JSON.parse(saved));
  } catch(e) {}

  document.querySelectorAll('.tools-section__header').forEach(header => {
    const grid = header.nextElementSibling;
    if (!grid || !grid.classList.contains('tools-grid')) return;

    let toggle = header.querySelector('.tools-section__toggle');
    if (!toggle) {
      toggle = document.createElement('span');
      toggle.className = 'tools-section__toggle';
      toggle.style.cssText = 'cursor:pointer;font-size:11px;margin-left:auto;opacity:.6;transition:opacity .15s;padding:2px 6px;border-radius:3px';
      header.appendChild(toggle);
    }

    const section = header.closest('.tools-section');
    // 与 handleCategoryToggle 使用一致的 key（优先 section.id）
    const catKey = section ? (section.id || section.dataset.category || section.className) :
                   (header.querySelector('.tools-section__title')?.textContent || '');
    const isCollapsed = collapseState[catKey] || false;

    if (isCollapsed) grid.style.display = 'none';
    toggle.textContent = isCollapsed ? '▶' : '▼';
    header.style.cursor = 'pointer';
    // 点击由 elements.toolsContainer 上的事件委托统一处理
  });
}

// ==================== 工具操作 ====================

/**
 * 打开工具
 */
function openTool(tool, params = null) {
  // 全局开关检查：关闭时不允许打开工具
  if (!state.masterEnabled) {
    showToast(getI18n().t('masterSwitch.disabledHint'));
    return;
  }
  console.log('[Sidebar] Opening tool:', tool.id);

  // 本地化工具名称（按当前语言显示）
  const localized = localizeTool(tool);
  state.currentTool = localized;
  state.isToolOpen = true;

  // 更新标题
  elements.currentToolTitle.textContent = localized.name;

  // 更新收藏按钮状态
  updateFavoriteButton();

  // 添加到最近使用
  addToRecent(tool.id);

  // 更新工具使用统计
  updateToolStats(tool.id);

  // 加载工具iframe
  loadToolIframe(tool, params);

  // 显示工具内容
  elements.toolContent.classList.add('tool-content--active');

  // 更新状态
  setStatus(getI18n().t('sidebar.usingTool') + localized.name);
}

/**
 * 加载工具iframe
 */
function loadToolIframe(tool, params = null) {
  elements.toolIframeContainer.innerHTML = '';

  const iframe = document.createElement('iframe');
  iframe.className = 'tool-iframe';
  iframe.src = chrome.runtime.getURL(`tools/${tool.id}/tool.html`);
  iframe.allow = 'clipboard-read; clipboard-write';

  iframe.onload = async () => {
    // 传递主题给工具
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    iframe.contentWindow.postMessage({
      action: 'setTheme',
      data: { theme: isDark ? 'dark' : 'light' }
    }, '*');
    // 传递参数给工具
    if (params) {
      iframe.contentWindow.postMessage({
        action: 'setData',
        data: params
      }, '*');
    } else if (state.autoSave !== false) {
      // autoSave 恢复：从 storage 读取上次保存的输入
      try {
        const result = await safeStorage('get', `toolbox_autosave_${tool.id}`);
        const saved = result[`toolbox_autosave_${tool.id}`];
        if (saved) {
          iframe.contentWindow.postMessage({ action: 'setData', data: saved }, '*');
        }
      } catch (e) {}
    }
  };

  elements.toolIframeContainer.appendChild(iframe);
}

/**
 * 关闭工具
 */
async function closeTool() {
  // autoSave：关闭前向工具请求输入数据并保存
  if (state.currentTool && state.autoSave !== false) {
    try {
      await _saveToolInput(state.currentTool.id);
    } catch (e) {}
  }

  state.currentTool = null;
  state.isToolOpen = false;

  elements.toolContent.classList.remove('tool-content--active');
  elements.toolIframeContainer.innerHTML = '';

  setStatus(getI18n().t('sidebar.ready'));
}

/**
 * autoSave 辅助：向工具 iframe 请求输入数据并保存到 storage
 * 工具可通过监听 __getToolInput 消息返回 { action: '__getToolInputResult', data: ... }
 */
function _saveToolInput(toolId) {
  return new Promise((resolve) => {
    const iframe = elements.toolIframeContainer.querySelector('iframe');
    if (!iframe || !iframe.contentWindow) { resolve(); return; }

    let done = false;
    const handler = (e) => {
      // 只接受该工具 iframe 的应答：宿主页面同样能向本窗口 postMessage，
      // 若不校验来源，任意网站都能伪造自动保存内容（下次打开工具时会回填进输入框）。
      if (e.source !== iframe.contentWindow) return;
      if (e.data?.action === '__getToolInputResult' && !done) {
        done = true;
        window.removeEventListener('message', handler);
        const value = e.data.data;
        // 只接受字符串：自动保存的取值口径固定为「工具主输入框的文本」
        if (typeof value === 'string' && value) {
          safeStorage('set', { [`toolbox_autosave_${toolId}`]: value });
        }
        resolve();
      }
    };
    window.addEventListener('message', handler);
    try { iframe.contentWindow.postMessage({ action: '__getToolInput' }, '*'); } catch (e) {}
    // 200ms 超时，不阻塞关闭流程
    setTimeout(() => {
      if (!done) { done = true; window.removeEventListener('message', handler); resolve(); }
    }, 200);
  });
}

/**
 * 添加到最近使用
 */
function addToRecent(toolId) {
  // 移除已存在的
  const index = state.recent.indexOf(toolId);
  if (index > -1) {
    state.recent.splice(index, 1);
  }
  
  // 添加到开头
  state.recent.unshift(toolId);
  
  // 限制数量
  if (state.recent.length > 6) {
    state.recent = state.recent.slice(0, 6);
  }
  
  saveRecent();
  renderTools();
}

/**
 * 更新工具统计
 */
async function updateToolStats(toolId) {
  try {
    const result = await safeStorage('get', 'tools_status');
    const status = result.tools_status || {};
    
    if (!status[toolId]) {
      status[toolId] = { enabled: true, useCount: 0 };
    }
    
    status[toolId].useCount = (status[toolId].useCount || 0) + 1;
    status[toolId].lastUsed = Date.now();
    
    await safeStorage('set', { tools_status: status });
  } catch (error) {
    console.error('[Sidebar] Failed to update tool stats:', error);
  }
}

// ==================== 收藏管理 ====================

/**
 * 切换当前工具收藏状态
 */
async function toggleCurrentToolFavorite() {
  if (!state.currentTool) return;
  
  const toolId = state.currentTool.id;
  const index = state.favorites.indexOf(toolId);
  
  if (index > -1) {
    state.favorites.splice(index, 1);
    showToast(getI18n().t('toast.removedFav'));
  } else {
    state.favorites.push(toolId);
    showToast(getI18n().t('toast.addedFav'));
  }
  
  await saveFavorites();
  updateFavoriteButton();
  renderTools();
}

/**
 * 更新收藏按钮状态
 */
function updateFavoriteButton() {
  if (!state.currentTool) return;
  
  const isFavorite = state.favorites.includes(state.currentTool.id);
  elements.btnFavoriteTool.innerHTML = isFavorite 
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
}

// ==================== 搜索和过滤 ====================

/**
 * 过滤工具
 */
function filterTools() {
  const query = state.searchQuery;
  const toolItems = document.querySelectorAll('.tool-item');
  const sections = document.querySelectorAll('.tools-section');

  if (!query) {
    // 显示所有（但尊重分类筛选状态）
    toolItems.forEach(item => item.classList.remove('tool-item--hidden', 'tool-item--highlight'));
    filterByCategory();
    toggleNoResultsHint(false);
    return;
  }

  // 缓存工具查找（用 Map 避免 N 次 find）
  const toolsById = new Map(state.tools.map(t => [t.id, t]));

  // 一次性遍历所有 item（避免多次 DOM 查询）
  const sectionVisibility = new Map();
  let totalVisible = 0;
  toolItems.forEach(item => {
    const toolId = item.dataset.toolId;
    const tool = toolsById.get(toolId);
    if (tool && matchesSearch(tool, query)) {
      item.classList.remove('tool-item--hidden');
      item.classList.add('tool-item--highlight');
      totalVisible++;
      // 统计每个 section 的可见项
      const section = item.closest('.tools-section');
      if (section) sectionVisibility.set(section, (sectionVisibility.get(section) || 0) + 1);
    } else {
      item.classList.add('tool-item--hidden');
      item.classList.remove('tool-item--highlight');
    }
  });

  // 隐藏空分类
  sections.forEach(section => {
    if ((sectionVisibility.get(section) || 0) === 0) {
      section.classList.add('tools-section--hidden');
    } else {
      section.classList.remove('tools-section--hidden');
    }
  });

  // 无结果提示
  toggleNoResultsHint(totalVisible === 0);
}

/**
 * 显示/隐藏无搜索结果提示
 */
function toggleNoResultsHint(show) {
  let hint = document.getElementById('no-results-hint');
  if (show) {
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'no-results-hint';
      hint.style.cssText = 'text-align:center;padding:60px 20px;color:var(--toolbox-text-secondary,#888);';
      hint.innerHTML = '<div style="font-size:48px;margin-bottom:12px;opacity:0.5;">🔍</div><div style="font-size:16px;margin-bottom:8px;">' + escapeHtml(getI18n().t('sidebar.noSearchResult')) + '</div><div style="font-size:12px;opacity:0.7;">' + escapeHtml(getI18n().t('sidebar.searchHint')) + '</div>';
      elements.toolsContainer.appendChild(hint);
    }
    hint.style.display = '';
  } else if (hint) {
    hint.style.display = 'none';
  }
}

/**
 * 检查工具是否匹配搜索
 */
function matchesSearch(tool, query) {
  // 名称匹配（简体 + 英文）
  if (tool.name.toLowerCase().includes(query)) return true;
  if (tool.nameEn.toLowerCase().includes(query)) return true;

  // 繁体名称匹配（zh-TW 模式下显示繁体，需支持繁体搜索）
  const localized = localizeTool(tool);
  if (localized.name && localized.name !== tool.name && localized.name.toLowerCase().includes(query)) return true;

  // ID匹配
  if (tool.id.toLowerCase().includes(query)) return true;

  // 分类名匹配（中文 + 英文）
  const category = CATEGORIES.find(c => c.id === tool.category);
  if (category) {
    if (category.name.toLowerCase().includes(query)) return true;
    if (category.nameEn.toLowerCase().includes(query)) return true;
  }

  // 拼音匹配（支持完整 id、id 前缀和前两段前缀）
  const parts = tool.id.split('-');
  const pinyinKeys = PINYIN_MAP[tool.id] || PINYIN_MAP[parts[0]] || PINYIN_MAP[parts.slice(0, 2).join('-')] || [];
  // 单字拼音匹配
  for (const py of pinyinKeys) {
    if (py.includes(query)) return true;
  }
  // 多字拼音组合匹配（拼接所有拼音，支持连续输入如"tupian"）
  const joinedPinyin = pinyinKeys.join('');
  if (joinedPinyin.includes(query)) return true;
  // 拼音首字母组合匹配（如"ysgl"匹配"颜色管理"）
  const initials = pinyinKeys.filter(py => /^[a-z]/i.test(py)).map(py => py[0]).join('');
  if (initials.includes(query)) return true;

  // 描述也参与匹配
  if (tool.desc && tool.desc.toLowerCase().includes(query)) return true;

  return false;
}

/**
 * 按分类过滤
 */
function filterByCategory() {
  const category = state.currentCategory;
  const sections = document.querySelectorAll('.tools-section');
  
  sections.forEach(section => {
    if (category === 'all') {
      section.classList.remove('tools-section--hidden');
    } else if (category === 'favorites') {
      section.classList.toggle('tools-section--hidden', section.id !== 'favorites-section');
    } else if (category === 'recent') {
      section.classList.toggle('tools-section--hidden', section.id !== 'recent-section');
    } else if (category === 'enabled') {
      section.classList.toggle('tools-section--hidden', section.id !== 'enabled-section');
    } else {
      const sectionCategory = section.dataset.category;
      section.classList.toggle('tools-section--hidden', sectionCategory !== category);
    }
  });
}

// ==================== 历史记录 ====================

/**
 * 显示历史记录模态框
 */
async function showHistoryModal() {
  if (!state.currentTool) return;
  
  try {
    // 从background获取历史记录
    const response = await safeSend({
      action: 'getHistory',
      data: { toolId: state.currentTool.id, limit: 20 }
    });

    // 兼容裸数组与 {success,data} 两种返回形态（失败时兜底为空数组）
    let history = [];
    if (Array.isArray(response)) {
      history = response;
    } else if (response && response.success && Array.isArray(response.data)) {
      history = response.data;
    }
    renderHistoryList(history);
    
    elements.historyModal.classList.add('modal--active');
  } catch (error) {
    console.error('[Sidebar] Failed to load history:', error);
    showToast(getI18n().t('toast.historyLoadFail'), 'error');
  }
}

/**
 * 隐藏历史记录模态框
 */
function hideHistoryModal() {
  elements.historyModal.classList.remove('modal--active');
}

/**
 * 渲染历史记录列表
 */
function renderHistoryList(history) {
  elements.historyList.innerHTML = '';
  
  if (history.length === 0) {
    elements.historyList.innerHTML = `
      <div class="history-empty">
        <div class="empty-state__icon">📝</div>
        <div class="empty-state__text">${escapeHtml(getI18n().t('history.empty'))}</div>
      </div>
    `;
    return;
  }
  
  history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <div class="history-item__icon">📋</div>
      <div class="history-item__content">
        <div class="history-item__title">${escapeHtml(truncate(item.data?.title || getI18n().t('sidebar.unnamed'), 30))}</div>
        <div class="history-item__time">${escapeHtml(formatTime(item.timestamp))}</div>
      </div>
      <button class="toolbox-btn toolbox-btn--icon history-item__action" data-id="${escapeHtml(item.id)}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    `;
    
    div.addEventListener('click', () => {
      loadHistoryItem(item);
      hideHistoryModal();
    });
    
    const deleteBtn = div.querySelector('.history-item__action');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteHistoryItem(item.id);
    });
    
    elements.historyList.appendChild(div);
  });
}

/**
 * 加载历史记录项
 */
function loadHistoryItem(item) {
  const iframe = elements.toolIframeContainer.querySelector('iframe');
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.postMessage({
      action: 'loadHistory',
      data: item.data
    }, '*');
  }
}

/**
 * 删除历史记录项
 */
async function deleteHistoryItem(id) {
  try {
    await safeSend({
      action: 'deleteHistory',
      data: { id }
    });
    
    showHistoryModal(); // 刷新列表
  } catch (error) {
    console.error('[Sidebar] Failed to delete history:', error);
  }
}

/**
 * 清空历史记录
 */
async function clearHistory() {
  if (!state.currentTool) return;

  // Firefox 会拦截跨源 iframe 的 confirm() 并静默返回 false，改用自绘确认弹窗
  const ok = await showConfirmModal(getI18n().t('confirm.clearToolHistory'));
  if (!ok) return;

  try {
    await safeSend({
      action: 'clearToolHistory',
      data: { toolId: state.currentTool.id }
    });

    hideHistoryModal();
    showToast(getI18n().t('toast.historyCleared'));
  } catch (error) {
    console.error('[Sidebar] Failed to clear history:', error);
    showToast(getI18n().t('toast.historyClearFail'), 'error');
  }
}

/**
 * 自绘确认弹窗（替代被 Firefox iframe 拦截的 confirm()）
 * @param {string} message
 * @returns {Promise<boolean>}
 */
function showConfirmModal(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.45);
      display: flex; align-items: center; justify-content: center; z-index: 99999;
    `;
    const box = document.createElement('div');
    box.className = 'confirm-box';
    box.style.cssText = `
      background: var(--toolbox-bg, #fff); border: 1px solid var(--toolbox-border, rgba(0,0,0,.12));
      border-radius: 12px; padding: 20px 22px; max-width: 320px; width: 86%;
      box-shadow: 0 8px 30px rgba(0,0,0,.2);
    `;
    const msg = document.createElement('div');
    msg.textContent = message;
    msg.style.cssText = 'font-size:14px; line-height:1.6; color:var(--toolbox-text-primary,#333); margin-bottom:18px;';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:10px; justify-content:flex-end;';

    const btnCancel = document.createElement('button');
    btnCancel.textContent = getI18n().t('btn.cancel');
    btnCancel.style.cssText = 'padding:7px 16px; border-radius:8px; border:1px solid var(--toolbox-border,rgba(0,0,0,.15)); background:transparent; cursor:pointer; font-size:13px;';
    const btnOk = document.createElement('button');
    btnOk.textContent = getI18n().t('btn.confirmClear');
    btnOk.style.cssText = 'padding:7px 16px; border-radius:8px; border:none; background:#e5484d; color:#fff; cursor:pointer; font-size:13px;';

    const done = (val) => { overlay.remove(); resolve(val); };
    btnCancel.addEventListener('click', () => done(false));
    btnOk.addEventListener('click', () => done(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    actions.appendChild(btnCancel);
    actions.appendChild(btnOk);
    box.appendChild(msg);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

// ==================== 上下文菜单 ====================

/**
 * 显示工具右键菜单
 */
function showToolContextMenu(e, tool) {
  // 创建菜单
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.cssText = `
    position: fixed;
    left: ${e.clientX}px;
    top: ${e.clientY}px;
    background: var(--toolbox-bg);
    border: 1px solid var(--toolbox-border);
    border-radius: var(--toolbox-radius-md);
    box-shadow: var(--toolbox-shadow-2);
    z-index: 10000;
    min-width: 150px;
  `;
  
  const isFavorite = state.favorites.includes(tool.id);
  
  menu.innerHTML = `
    <div class="context-menu-item" data-action="favorite">
      ${isFavorite ? getI18n().t('sidebar.unfavorite') : getI18n().t('sidebar.addFavorite')}
    </div>
    <div class="context-menu-item" data-action="open">
      ${getI18n().t('sidebar.openInNewTab')}
    </div>
  `;
  
  menu.querySelectorAll('.context-menu-item').forEach(item => {
    item.style.cssText = `
      padding: var(--toolbox-spacing-sm) var(--toolbox-spacing-md);
      cursor: pointer;
      transition: background var(--toolbox-transition-fast);
    `;
    item.addEventListener('mouseenter', () => {
      item.style.background = 'var(--toolbox-bg-hover)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.background = 'transparent';
    });
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      if (action === 'favorite') {
        toggleToolFavorite(tool.id);
      } else if (action === 'open') {
        chrome.tabs.create({
          url: chrome.runtime.getURL(`tools/${tool.id}/tool.html`)
        });
      }
      menu.remove();
    });
  });
  
  document.body.appendChild(menu);
  
  // 点击其他地方关闭菜单
  const closeMenu = () => {
    menu.remove();
    document.removeEventListener('click', closeMenu);
  };
  setTimeout(() => {
    document.addEventListener('click', closeMenu);
  }, 0);
}

/**
 * 切换工具收藏
 */
async function toggleToolFavorite(toolId) {
  const index = state.favorites.indexOf(toolId);
  
  if (index > -1) {
    state.favorites.splice(index, 1);
    showToast(getI18n().t('toast.removedFav'));
  } else {
    state.favorites.push(toolId);
    showToast(getI18n().t('toast.addedFav'));
  }
  
  await saveFavorites();
  renderTools();
}

// ==================== 消息处理 ====================

/**
 * 处理来自父窗口和工具 iframe 的消息
 */
/**
 * 只允许「工具 iframe」发起的特权代理动作
 *
 * 安全说明（重要）：侧边栏被注入到宿主页面中，因此 `window.parent` 就是**宿主页面本身**。
 * 页面脚本可以拿到本 iframe 的 contentWindow 并向其 postMessage，于是
 * `event.source === window.parent` 只能说明"消息来自宿主页面"，**不能**当作可信凭据。
 * 若不加以区分，任意网站都能通过 postMessage 让侧边栏代为调用后台的**任意** action
 * （例如改写服务端点把查询重定向到攻击者服务器、读取 Cookie、触发下载），属于提权。
 *
 * 页面无法伪造成工具 iframe：工具 iframe 位于本 iframe 的 DOM 中，跨源不可访问，
 * 页面拿不到它的 contentWindow 引用。因此以 event.source 是否等于工具 iframe 的
 * contentWindow 作为特权动作的判据是可靠的。
 */
const TOOL_ONLY_ACTIONS = new Set(['callBackground', 'sendToContent']);

function handleMessage(event) {
    // 验证消息来源：仅接受父窗口（宿页面 injector）和工具 iframe
  const toolIframe = elements.toolIframeContainer?.querySelector('iframe');
  const isParent = event.source === window.parent;
  const isToolIframe = toolIframe && event.source === toolIframe.contentWindow;
  if (!isParent && !isToolIframe) return;
  if (!event || !event.data || typeof event.data !== 'object') return;
  const { action, data } = event.data;
  if (!action) return;

  // 特权代理必须来自工具 iframe（详见 TOOL_ONLY_ACTIONS 的说明）
  if (TOOL_ONLY_ACTIONS.has(action) && !isToolIframe) {
    console.warn('[Sidebar] 已拒绝来自宿主页面的特权请求:', action);
    return;
  }

  switch (action) {
    case 'sidebarOpened':
      console.log('[Sidebar] Sidebar opened');
      // 临时关闭流程结束，重置标志
      state.temporarySidebarClose = false;
      break;
    case 'sidebarClosed':
      // 临时关闭（元素选择）保留工具 iframe，仅隐藏工具内容区
      // 永久关闭（用户主动 X）才完整清理
      if (state.temporarySidebarClose) {
        elements.toolContent.classList.remove('tool-content--active');
        setStatus(getI18n().t('sidebar.ready'));
      } else {
        closeTool();
      }
      break;
    case 'openTool':
      if (data && data.toolId) {
        const tool = state.tools.find(t => t.id === data.toolId);
        if (tool) {
          openTool(tool, data.params);
        }
      }
      break;
    case 'openToolWithData':
      if (data && data.toolId) {
        const tool = state.tools.find(t => t.id === data.toolId);
        if (tool) {
          openTool(tool, data.input);
        }
      }
      break;
    case 'focusSearch':
      elements.searchInput.focus();
      break;
    // 根据action决定消息路由 → 转发到页面injector
    case 'setVideoSpeed':
    case 'setABLoop':
    case 'setTimeAccel':
    case 'setPreservesPitch':
    case 'enterPiP':
    case 'detectVideos':
    case 'getVideoStatus':
    case 'videoControl':
    case 'videoUnlocker:setConfig':
    case 'videoUnlocker:scan':
    case 'videoUnlocker:getStatus':
    case 'videoUnlocker:seekTo':
    case 'videoUnlocker:extractUrls':
    case 'videoUnlocker:forceFullscreen':
    case 'videoUnlocker:downloadVideo':
    case 'getPageInfo':
    case 'captureScreenshot':
    // 截图工具的「拖选区域」：在宿主页面上显示选区浮层，由 injector 完成截图与裁剪
    case 'startRegionSelection':
    case 'getElementInfo':
    case 'getDomTree':
    case 'modifyElement':
    case 'extractLinks':
    case 'extractColors':
    case 'showRuler':
    case 'hideRuler':
    // 屏幕标尺扩展功能：颜色拾取、参考线、元素标注
    case 'startColorPick':
    case 'stopColorPick':
    case 'addGuideLine':
    case 'annotateElement':
    case 'clearAnnotations':
    case 'clearGuides':
    case 'highlightElement':
    case 'hideHighlight':
    case 'deleteElement':
    case 'getEventListeners':
    case 'checkLinkStatus':
    case 'extractResources':
    case 'clearNetworkCache':
    case 'toggleLiveMonitor':
    case 'collectWebVitals':
    case 'capturePageAsHtml':
    case 'getStorageSnapshot':
    case 'setStorageItem':
    case 'removeStorageItem':
    case 'clearStorage':
    case 'startClipboardWatch':
    case 'stopClipboardWatch':
      window.parent.postMessage({ action, data }, '*');
      break;
    // 工具 iframe → 后台 service worker
    case 'callBackground':
      {
        const { id, action: bgAction, data: bgData } = data || {};
        const iframe = elements.toolIframeContainer?.querySelector('iframe');
        if (!iframe) {
          // iframe 不存在时也要回复，避免工具端永远等待
          window.postMessage({ action: '__bgResponse', data: { __id: id, result: { success: false, error: 'No tool iframe' } } }, '*');
          break;
        }
        safeSend({ action: bgAction, data: bgData }).then((response) => {
          if (iframe.contentWindow) {
            iframe.contentWindow.postMessage({ action: '__bgResponse', data: { __id: id, result: response || { success: false, error: 'No response' } } }, '*');
          }
        }).catch((e) => {
          if (iframe.contentWindow) {
            iframe.contentWindow.postMessage({ action: '__bgResponse', data: { __id: id, result: { success: false, error: e?.message || 'Background call failed' } } }, '*');
          }
        });
      }
      break;
    // 工具 iframe → content script
    case 'sendToContent':
      {
        const { id, action: cAction, data: cData } = data || {};
        const pendingId = id;
        const iframe = elements.toolIframeContainer?.querySelector('iframe');
        if (!iframe) break;
        const onContentResponse = (e) => {
          if (!e.data || e.source !== window.parent) return;
          if (e.data && e.data.action === '__contentResponse' && e.data.data && e.data.data.__id === pendingId) {
            window.removeEventListener('message', onContentResponse);
            clearTimeout(timer);
            if (iframe.contentWindow) {
              iframe.contentWindow.postMessage({ action: '__contentResponse', data: { __id: pendingId, result: e.data.data.result } }, '*');
            }
          }
        };
        const timer = setTimeout(() => {
          window.removeEventListener('message', onContentResponse);
          if (iframe.contentWindow) {
            iframe.contentWindow.postMessage({ action: '__contentResponse', data: { __id: pendingId, result: { success: false, error: 'content script timeout' } } }, '*');
          }
        }, 15000);
        window.addEventListener('message', onContentResponse);
        window.parent.postMessage({ action: cAction, data: cData, __id: pendingId }, '*');
      }
      break;
    // 元素选择开始 — 先隐藏侧边栏再开始选择（避免侧边栏遮挡页面元素）
    case 'startElementSelection':
      state.temporarySidebarClose = true;  // 标记为临时关闭，保留工具 iframe
      window.parent.postMessage({ action: 'closeSidebar' }, '*');
      setTimeout(() => {
        window.parent.postMessage({ action: 'startElementSelection', data }, '*');
      }, 350); // 等待侧边栏关闭动画完成
      break;
    // 元素选择取消 — 重新打开侧边栏
    case 'stopElementSelection':
      state.temporarySidebarClose = false;
      window.parent.postMessage({ action: 'openSidebar' }, '*');
      window.parent.postMessage({ action: 'stopElementSelection', data }, '*');
      break;
    // 接收宿页面转发的消息，传给工具iframe
    case 'videoStatus':
    case 'detectVideosResult':
      {
        const _tf2 = elements.toolIframeContainer?.querySelector('iframe');
        if (_tf2 && _tf2.contentWindow) {
          _tf2.contentWindow.postMessage({ action, data }, '*');
        }
      }
      break;
    case 'videoUnlocker:status':
    case 'videoUnlocker:scanResult':
    case 'videoUnlocker:pong':
    case 'videoUnlocker:extractUrlsResult':
    case 'videoUnlocker:fullscreenResult':
    case 'videoUnlocker:downloadResult':
      {
        const _tfVu = elements.toolIframeContainer?.querySelector('iframe');
        if (_tfVu && _tfVu.contentWindow) {
          _tfVu.contentWindow.postMessage({ action, data }, '*');
        }
      }
      break;
    // 自动连播 - 转发 MAIN world 经 injector 传来的检测/日志事件到工具 iframe
    case 'apn:detectionTriggered':
    case 'apn:log':
    case 'apn:nextFound':
      {
        const _tfApn = elements.toolIframeContainer?.querySelector('iframe');
        if (_tfApn && _tfApn.contentWindow) {
          _tfApn.contentWindow.postMessage({ action, data }, '*');
        }
      }
      break;
    case 'pageInfo':
      {
        const _tf3 = elements.toolIframeContainer?.querySelector('iframe');
        if (_tf3 && _tf3.contentWindow) {
          _tf3.contentWindow.postMessage({ action: 'pageInfo', data }, '*');
        }
      }
      break;
    case 'screenshotResult':
      {
        const _tf4 = elements.toolIframeContainer?.querySelector('iframe');
        if (_tf4 && _tf4.contentWindow) {
          _tf4.contentWindow.postMessage({ action: 'screenshotResult', data }, '*');
        }
      }
      break;
    case 'selectedText':
      // injector 从页面读取的选中文本 → 转发给当前工具 iframe
      {
        const _tfSel = elements.toolIframeContainer?.querySelector('iframe');
        if (_tfSel && _tfSel.contentWindow) {
          _tfSel.contentWindow.postMessage({ action: 'selectedText', data }, '*');
        }
      }
      break;
    // 元素选择完成 — 重新打开侧边栏并转发结果
    case 'elementSelected':
    case 'selectionComplete':
      {
        // 先重新打开侧边栏
        window.parent.postMessage({ action: 'openSidebar' }, '*');
        // 重新显示工具内容区（如果之前临时关闭被隐藏了）
        if (state.currentTool) {
          elements.toolContent.classList.add('tool-content--active');
        }
        // 延迟转发数据，等侧边栏打开后再传给工具iframe
        const _tf5 = elements.toolIframeContainer?.querySelector('iframe');
        if (_tf5 && _tf5.contentWindow) {
          setTimeout(() => {
            if (_tf5.contentWindow) {
              _tf5.contentWindow.postMessage({ action, data }, '*');
            }
          }, 400);
        }
      }
      break;
    case 'elementComputed':
    case 'domTree':
    case 'linkList':
    case 'colorList':
    // 屏幕标尺颜色拾取结果回传
    case 'colorPickResult':
    case 'elementDeleted':
    case 'eventListenersResult':
    case 'linkStatusResult':
    case 'resourceList':
    case 'resourceUpdate':
    case 'liveMonitorStarted':
    case 'liveMonitorStopped':
    case 'pageCaptureResult':
    case 'storageSnapshot':
    case 'storageOpResult':
    case 'clipboardUpdate':
    case 'clipboardError':
    case 'webVitals':
      // 注意：__contentResponse 不在此列表 —— 它由 case 'sendToContent' 内的
      // onContentResponse 监听处理（带 __id 匹配），这里再转发会造成工具端收到重复应答
      {
        const _tf6 = elements.toolIframeContainer?.querySelector('iframe');
        if (_tf6 && _tf6.contentWindow) {
          _tf6.contentWindow.postMessage({ action, data }, '*');
        }
      }
      break;
    // url-parser 请求获取当前页面URL
    case 'getCurrentUrl':
      {
        window.parent.postMessage({ action: 'getPageInfo' }, '*');
      }
      break;
  }
}

// ==================== 键盘处理 ====================

/**
 * 键盘事件处理
 */
function handleKeyDown(e) {
  // ESC：优先清除搜索，其次关闭工具
  if (e.key === 'Escape') {
    if (document.activeElement === elements.searchInput && state.searchQuery) {
      e.preventDefault();
      elements.searchInput.value = '';
      state.searchQuery = '';
      const clearBtn = document.getElementById('search-clear');
      if (clearBtn) clearBtn.style.display = 'none';
      filterTools();
      return;
    }
    if (state.isToolOpen) {
      closeTool();
    }
  }

  // Ctrl+K聚焦搜索
  if (e.ctrlKey && e.key === 'k') {
    e.preventDefault();
    elements.searchInput.focus();
  }

  // / 单键聚焦搜索（非输入框聚焦时）
  if (e.key === '/' && document.activeElement !== elements.searchInput && !/input|textarea/i.test(document.activeElement?.tagName)) {
    e.preventDefault();
    elements.searchInput.focus();
  }
}

// ==================== 工具函数 ====================
// debounce / truncate / escapeHtml 已从 common/utils.js 统一引入，此处不再重复定义
/**
 * 格式化时间
 */
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  // 小于1分钟
  if (diff < 60000) return getI18n().t('time.justNow');
  // 小于1小时
  if (diff < 3600000) return getI18n().t('time.minutesAgo').replace('{n}', Math.floor(diff / 60000));
  // 小于1天
  if (diff < 86400000) return getI18n().t('time.hoursAgo').replace('{n}', Math.floor(diff / 3600000));
  // 小于7天
  if (diff < 604800000) return getI18n().t('time.daysAgo').replace('{n}', Math.floor(diff / 86400000));
  
  return date.toLocaleDateString();
}

/**
 * 显示提示消息
 */
function showToast(message, type = 'info') {
  elements.toast.textContent = message;
  elements.toast.className = `toolbox-toast toolbox-toast--${type}`;
  elements.toast.classList.add('toolbox-toast--show');
  
  setTimeout(() => {
    elements.toast.classList.remove('toolbox-toast--show');
  }, 3000);
}

/**
 * 设置状态文本
 */
function setStatus(text) {
  elements.statusText.textContent = text;
}

/**
 * 初始化存储变化监听（主题 + 语言实时同步）
 */
function initStorageListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.toolbox_settings) {
      const newSettings = changes.toolbox_settings.newValue;
      if (newSettings) {
        // 主题变化
        if (newSettings.theme && newSettings.theme !== state.theme) {
          state.theme = newSettings.theme;
          applyTheme();
        }
        // autoSave 设置同步
        state.autoSave = newSettings.autoSave !== false;
        // 语言变化
        const i18n = getI18n();
        if (newSettings.language && newSettings.language !== i18n.getCurrentLocale()) {
          i18n.currentLocale = newSettings.language;
          document.documentElement.setAttribute('lang', newSettings.language);
          applyI18nLabels();
          renderTools();
          if (state.currentTool) {
            // 更新当前打开的工具标题
            const tool = state.tools.find(t => t.id === state.currentTool.id);
            if (tool) {
              const localized = localizeTool(tool);
              if (elements.currentToolTitle) {
                elements.currentToolTitle.textContent = localized.icon + ' ' + localized.name;
              }
            }
          }
        }
      }
    }
    if (areaName === 'local') {
      // 持久化功能状态变化时刷新"已开启的功能"
      const featureKeys = ['toolbox_auto_play_next', 'toolbox_video_unlocker', 'toolbox_tracker_blocker', 'toolbox_https_enforcer', 'toolbox_anti_fingerprint', 'toolbox_custom_headers', 'toolbox_script_injector', 'toolbox_video_speed', 'toolbox_video_speed_enabled', 'toolbox_silver_fox_guard', 'toolbox_resource_sniffer'];
      for (const key of featureKeys) {
        if (changes[key]) {
          renderTools();
          break;
        }
      }
      // 工具启用/禁用状态变化时刷新（同步 options 页的修改）
      if (changes.tools_status) {
        state.toolsStatus = changes.tools_status.newValue || {};
        renderTools();
      }
      // 全局开关变化
      if (changes.toolbox_master_enabled) {
        state.masterEnabled = changes.toolbox_master_enabled.newValue !== false;
        elements.masterSwitchInput.checked = state.masterEnabled;
        elements.masterSwitch.classList.toggle('master-switch--off', !state.masterEnabled);
        renderTools();
      }
    }
  });
}
