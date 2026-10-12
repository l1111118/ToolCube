/**
 * 弹出菜单脚本 - Enhanced (with i18n + Terms)
 */
import { TOOLS_CONFIG } from '../common/tool-registry.js';
import { getI18n, localizeTool } from '../common/i18n.js';
import { TermsManager, renderTermsModal, showLockedScreen } from '../common/terms.js';
import { debounce, escapeHtml } from '../common/utils.js';


// 启动：检测协议 → 检测语言 → 渲染
(async function bootstrap() {
  const i18n = getI18n();
  await i18n.init();
  document.documentElement.setAttribute('lang', i18n.getCurrentLocale());

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
    // 阻止默认 DOMContentLoaded 初始化
    return;
  }
  // module 脚本是 deferred 的，DOM 在脚本执行时已就绪
  // 无需再监听 DOMContentLoaded（且 await 会导致事件错过）
  try {
    await initApp();
  } catch (e) {
    console.error('[Popup] init failed:', e);
  }
})();

async function initApp() {
  const i18n = getI18n();
  // 应用静态文案
  applyI18nLabels();

  // 主题切换
  initTheme();

  // 渲染所有工具
  renderAllTools(TOOLS_CONFIG);
  document.getElementById('tool-count').textContent = `${TOOLS_CONFIG.length}`;

  // 搜索功能
  initSearch();

  // 初始化全局开关
  await initMasterSwitch();

  // 打开侧边栏 — 通过 background 中转（background 有动态注入兜底）
  document.getElementById('btn-toggle-sidebar').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    if (!isInjectablePage(tab.url)) {
      showToast(getI18n().t('popup.internalPageUnsupported'), 'error');
      return;
    }
    try {
      await chrome.runtime.sendMessage({ action: 'toggleSidebar', data: { tabId: tab.id } });
      window.close();
    } catch (e) {
      console.error('[Popup] 打开侧边栏失败:', e);
      showToast(getI18n().t('popup.cannotOpenSidebar'), 'error');
    }
  });

  // 快速搜索 — 通过 background 中转，打开后聚焦搜索框
  document.getElementById('btn-quick-search').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    if (!isInjectablePage(tab.url)) {
      showToast(getI18n().t('popup.internalPageUnsupported'), 'error');
      return;
    }
    try {
      await chrome.runtime.sendMessage({ action: 'toggleSidebar', data: { tabId: tab.id, forceOpen: true } });
      // 补发 focusSearch，让"快速搜索"名副其实
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'focusSearch' });
      } catch (e) { /* 侧边栏刚打开时注入可能未就绪，忽略 */ }
      window.close();
    } catch (e) {
      console.error('[Popup] 快速搜索失败:', e);
      showToast(getI18n().t('popup.cannotOpenSearch'), 'error');
    }
  });

  // 设置
  document.getElementById('btn-options').addEventListener('click', () => {
    try { chrome.runtime.openOptionsPage(); } catch(e) {}
    window.close();
  });

  // 帮助：跳转到项目主页。
  // 地址取自 manifest 的 homepage_url，避免在代码里硬编码一个可能失效的站点域名。
  document.getElementById('btn-help').addEventListener('click', () => {
    const home = chrome.runtime.getManifest().homepage_url;
    if (home) chrome.tabs.create({ url: home });
    window.close();
  });

  // 加载最近使用和收藏
  await loadRecentTools();
  await loadFavoriteTools();

  // 监听语言变化（用户可能在设置页切换语言时 popup 仍然打开）
  initStorageListener();
}

/**
 * 初始化全局开关
 */
async function initMasterSwitch() {
  const input = document.getElementById('master-switch-input');
  if (!input) return;

  // 读取当前状态
  try {
    const result = await chrome.storage.local.get('toolbox_master_enabled');
    input.checked = result.toolbox_master_enabled !== false;
  } catch (e) {
    input.checked = true;
  }

  // 监听切换
  input.addEventListener('change', async () => {
    const enabled = input.checked;

    // 先写入 storage（不依赖 background），确保状态持久化
    try {
      await chrome.storage.local.set({ toolbox_master_enabled: enabled });
    } catch (e) {}

    // 通知 background 执行相关操作
    try {
      await chrome.runtime.sendMessage({
        action: enabled ? 'masterSwitchOn' : 'masterSwitchOff'
      });
    } catch (e) {
      // background 未响应不影响开关本身（storage 已写入，页面刷新后生效）
      console.warn('[Popup] background 未响应，但开关状态已保存', e);
    }

    showToast(getI18n().t(enabled ? 'masterSwitch.on' : 'masterSwitch.off'), 'success');
  });
}

function applyI18nLabels() {
  const i18n = getI18n();
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    el.textContent = i18n.t(key);
  });
  // placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = i18n.t(el.dataset.i18nPlaceholder);
  });
  // title
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = i18n.t(el.dataset.i18nTitle);
  });
  // 兜底：搜索框 placeholder
  const searchInput = document.getElementById('search-input');
  if (searchInput && !searchInput.hasAttribute('data-i18n-placeholder')) {
    searchInput.placeholder = i18n.t('sidebar.search');
  }
  // 版本号取自 manifest，避免在 HTML 中写死
  const versionEl = document.getElementById('popup-version');
  if (versionEl) versionEl.textContent = 'v' + chrome.runtime.getManifest().version;
}

/**
 * 监听存储变化（语言切换时实时刷新 popup UI）
 */
function initStorageListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.toolbox_settings) {
      const newSettings = changes.toolbox_settings.newValue;
      const oldSettings = changes.toolbox_settings.oldValue;
      if (newSettings && newSettings.language && newSettings.language !== (oldSettings?.language)) {
        const i18n = getI18n();
        i18n.currentLocale = newSettings.language;
        document.documentElement.setAttribute('lang', newSettings.language);
        applyI18nLabels();
        renderAllTools(TOOLS_CONFIG);
      }
    }
  });
}

function initTheme() {
  const toggle = document.getElementById('theme-toggle');
  
  // 加载主题
  try {
  chrome.storage.local.get('toolbox_settings', (r) => {
    const theme = r.toolbox_settings?.theme || 'auto';
    const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme(isDark);
  });
  } catch(e) {}

  toggle.addEventListener('click', () => {
    const isDark = document.body.dataset.theme === 'dark';
    applyTheme(!isDark);
    try {
    chrome.storage.local.get('toolbox_settings', (r) => {
      const settings = r.toolbox_settings || {};
      settings.theme = !isDark ? 'dark' : 'light';
      chrome.storage.local.set({ toolbox_settings: settings });
    });
    } catch(e) {}
  });
}

function applyTheme(isDark) {
  document.body.dataset.theme = isDark ? 'dark' : 'light';
  document.getElementById('theme-toggle').textContent = isDark ? '☀️' : '🌙';
}

function initSearch() {
  const input = document.getElementById('search-input');
  const clearBtn = document.getElementById('search-clear');
  const noResults = document.getElementById('no-results');
  const list = document.getElementById('all-tools-list');
  
  input.addEventListener('input', debounce(() => {
    const query = input.value.trim().toLowerCase();
    clearBtn.hidden = !query;
    
    if (!query) {
      renderAllTools(TOOLS_CONFIG);
      noResults.hidden = true;
      return;
    }
    
    const filtered = TOOLS_CONFIG.filter(t => 
      t.name.toLowerCase().includes(query) || 
      t.id.toLowerCase().includes(query) ||
      (t.desc && t.desc.toLowerCase().includes(query))
    );
    
    if (filtered.length === 0) {
      list.innerHTML = '';
      noResults.hidden = false;
    } else {
      noResults.hidden = true;
      renderAllTools(filtered);
    }
  }, 200));
  
  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.hidden = true;
    renderAllTools(TOOLS_CONFIG);
    noResults.hidden = true;
    input.focus();
  });
}

function renderAllTools(tools) {
  const container = document.getElementById('all-tools-list');
  container.innerHTML = '';
  // DocumentFragment 批量插入，避免逐项回流（工具数量较多时明显提速）
  const frag = document.createDocumentFragment();
  for (const tool of tools) {
    frag.appendChild(createToolItem(tool));
  }
  container.appendChild(frag);
}

async function loadRecentTools() {
  try {
    const result = await chrome.storage.local.get('toolbox_recent');
    const recent = result.toolbox_recent || [];
    const container = document.getElementById('recent-tools-list');
    
    if (recent.length === 0) return;
    
    container.innerHTML = '';
    recent.slice(0, 6).forEach(toolId => {
      const tool = TOOLS_CONFIG.find(t => t.id === toolId);
      if (tool) container.appendChild(createToolItem(tool));
    });
  } catch (e) {
    console.error('Load recent failed:', e);
  }
}

async function loadFavoriteTools() {
  try {
    const result = await chrome.storage.local.get('toolbox_favorites');
    const favorites = result.toolbox_favorites || [];
    const container = document.getElementById('favorite-tools-list');

    if (favorites.length === 0) {
      document.getElementById('fav-section').style.display = 'none';
      return;
    }

    container.innerHTML = '';
    favorites.forEach(toolId => {
      const tool = TOOLS_CONFIG.find(t => t.id === toolId);
      if (tool) {
        const item = createToolItem(tool);
        item.classList.add('favorite');
        container.appendChild(item);
      }
    });
  } catch (e) {
    console.error('Load favorites failed:', e);
  }
}

/**
 * 检查 URL 是否支持注入 content script
 * 浏览器内部页面（chrome://, about:, moz-extension:, file://）不支持
 */
function isInjectablePage(url) {
  if (!url) return false;
  return /^https?:\/\//i.test(url) || /^file:\/\//i.test(url);
}

function showToast(msg, type) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast toast--' + (type || 'info') + ' toast--show';
  clearTimeout(el._tid);
  el._tid = setTimeout(() => el.classList.remove('toast--show'), 2500);
}

function createToolItem(tool) {
  const div = document.createElement('div');
  div.className = 'tool-item';
  // 本地化工具显示（繁体/英文）
  const localized = localizeTool(tool);
  div.innerHTML = `
    <span class="tool-icon">${escapeHtml(localized.icon)}</span>
    <span class="tool-name">${escapeHtml(localized.name)}</span>
    ${localized.desc ? `<span class="tool-desc">${escapeHtml(localized.desc)}</span>` : ''}
  `;
  div.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    if (!isInjectablePage(tab.url)) {
      showToast(getI18n().t('popup.internalPageUnsupported'), 'error');
      return;
    }
    try {
      // 经 background 中转：background 的 openTool 自带 content script 注入兜底，
      // 直接 tabs.sendMessage 在未注入页面（安装扩展前已打开的标签页）必然失败
      // 注意：popup 无 sender.tab，必须显式传 tabId
      const resp = await chrome.runtime.sendMessage({
        action: 'openTool',
        data: { toolId: tool.id, tabId: tab.id }
      });
      if (resp && resp.success === false) {
        showToast(resp.error || getI18n().t('popup.cannotOpenTool'), 'error');
        return;
      }
      window.close();
    } catch (e) {
      console.error('[Popup] 无法打开工具:', e);
      showToast(getI18n().t('popup.cannotOpenTool'), 'error');
    }
  });
  return div;
}
