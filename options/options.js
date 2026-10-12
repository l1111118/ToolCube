/**
 * ToolCube - Settings Page
 * @version 1.3.0
 */
import { TOOLS_CONFIG } from '../common/tool-registry.js';
import { StorageManager } from '../common/storage.js';
import { getI18n } from '../common/i18n.js';
import { TermsManager, renderTermsModal, showLockedScreen } from '../common/terms.js';
import { escapeHtml } from '../common/utils.js';


const DEFAULTS = { theme: 'auto', sidebarPosition: 'right', sidebarWidth: 400, autoSave: true, showNotifications: true, showFloatingBtn: true, language: 'zh-CN' };

/** i18n 简写：等价于 getI18n().t(key)，避免每处重复书写 getI18n() */
function i18nT(key, fallback) { return getI18n().t(key, fallback); }

// 启动时执行：检测协议 → 显示弹窗
(async function bootstrap() {
  const i18n = getI18n();
  await i18n.init();
  const tm = new TermsManager();
  const accepted = await tm.hasAccepted();
  if (!accepted) {
    // 显示锁屏 + 弹窗
    showLockedScreen();
    const modal = renderTermsModal({
      onAgree: () => location.reload(),
      // 不同意：留在锁屏态，不 reload（避免无限循环弹窗）
      onDisagree: () => {}
    });
    document.body.appendChild(modal);
  } else {
    // 已同意：应用语言环境到 <html lang>
    document.documentElement.setAttribute('lang', i18n.getCurrentLocale());
    // module 脚本是 deferred 的，DOM 在脚本执行时已就绪
    // 无需再监听 DOMContentLoaded（且 await 会导致事件错过）
    await initApp();
  }
})();

/**
 * 依据 manifest 的 homepage_url 生成文档链接
 *
 * 为什么不把仓库地址写死在 HTML 里：仓库地址因部署者而异，
 * 硬编码会导致发布后链接指向别人的仓库。manifest 的 homepage_url 本来就必须由
 * 发布者填写，因此以它为唯一来源，未填写时隐藏链接而不是给出一个坏链接。
 */
function initDocsLink() {
  const link = document.getElementById('svc-docs-link');
  if (!link) return;
  let homepage = '';
  try {
    homepage = (chrome.runtime.getManifest().homepage_url || '').trim();
  } catch (e) {
    homepage = '';
  }
  if (!/^https?:\/\/\S+$/i.test(homepage)) {
    // 未配置或不是合法 URL：隐藏链接，避免用户点进一个无效页面
    link.hidden = true;
    link.removeAttribute('href');
    return;
  }
  link.href = homepage.replace(/\/+$/, '') + '/blob/main/docs/SELF-HOSTING.md';
}

/**
 * 填充「关于 → 问题反馈」入口
 *
 * 与文档链接同理：反馈地址随部署者而异，统一以 manifest 的 homepage_url 为唯一来源。
 * 这样既避免把个人邮箱等私人信息写进开源仓库，也避免硬编码一个可能失效的站点。
 */
function initAboutLink() {
  const link = document.getElementById('about-issue-link');
  if (!link) return;
  let homepage = '';
  try {
    homepage = (chrome.runtime.getManifest().homepage_url || '').trim();
  } catch (e) {
    homepage = '';
  }
  if (!/^https?:\/\/\S+$/i.test(homepage)) {
    link.hidden = true;
    link.removeAttribute('href');
    return;
  }
  link.href = homepage.replace(/\/+$/, '') + '/issues';
}

async function initApp() {
  // 各初始化步骤相互独立：任何一步失败都只记录日志，不应阻止后续步骤与事件绑定。
  // 否则（例如服务端点元数据读取异常）会让整个设置页变成"点了没反应"。
  const steps = [
    ['主题', applyTheme],
    ['导航', initNav],
    ['设置', loadSettings],
    ['工具列表', loadTools],
    ['服务端点', loadServiceEndpoints]
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (e) {
      console.error('[Options] 初始化步骤失败: ' + name, e);
    }
  }
  initEvents();
  initThemeListener();
  initDocsLink();
  initAboutLink();
  applyI18nLabels();
}

// ==================== 服务端点（可插拔外部服务） ====================
//
// 这一段把「工具访问哪个外部服务」做成用户可配置项：
// 每个服务类别（DNS / WHOIS / IP 归属地 / CT / 子域名 / 汇率 / 泄露查询 / 公网 IP）
// 都可以切换服务商，或直接填写自建服务地址。
//
// 界面完全由 background 返回的注册表元数据驱动渲染（见 common/service-providers.js），
// 因此后续新增服务商或新增服务类别时，这里**无需改动**即可自动出现。

/** 注册表元数据（kinds + providers），来自 background 的 serviceProviders */
let serviceMeta = null;
/** 当前编辑中的配置，结构见 normalizeServiceConfig */
let serviceConfig = null;

async function loadServiceEndpoints() {
  const container = document.getElementById('service-endpoints');
  if (!container) return;
  try {
    const [metaResp, cfgResp] = await Promise.all([
      chrome.runtime.sendMessage({ action: 'serviceProviders' }),
      chrome.runtime.sendMessage({ action: 'serviceConfigGet' })
    ]);
    if (!metaResp || !metaResp.success || !cfgResp || !cfgResp.success) {
      container.innerHTML = '<div class="svc-loading">' + escapeHtml(i18nT('services.loadFail')) + '</div>';
      return;
    }
    serviceMeta = metaResp;
    serviceConfig = cfgResp.config;
    container.innerHTML = serviceMeta.kinds.map(renderServiceCard).join('');
    container.querySelectorAll('.svc-card').forEach(bindServiceCard);
  } catch (e) {
    container.innerHTML = '<div class="svc-loading">' + escapeHtml(i18nT('services.loadFailPrefix') + e.message) + '</div>';
  }
}

/** 服务类别 / 服务商 / 字段的本地化名称（缺省回退到注册表中的原文） */
function kindLabel(k) { return i18nT('serviceKind.' + k.id + '.label', k.label); }
function kindDesc(k) { return i18nT('serviceKind.' + k.id + '.desc', k.description); }
function fieldLabel(f) { return i18nT('serviceField.' + f.key, f.label); }
function providerLabel(p) {
  // 所有 custom 服务商共用同一名称，无需按类别区分
  return p.id === 'custom'
    ? i18nT('serviceProvider.custom.label', p.label)
    : i18nT('serviceProvider.' + p.kind + '.' + p.id + '.label', p.label);
}

/** 渲染单个服务类别的配置卡片 */
function renderServiceCard(kind) {
  const entry = serviceConfig[kind.id] || {};
  const providers = serviceMeta.providers.filter(p => p.kind === kind.id);
  const provider = providers.find(p => p.id === entry.providerId) || providers[0] || { fields: [] };
  const fields = provider.fields || [];
  // 客户端直连类别（STUN、服务端截图）不通过 HTTP 请求，因此没有「保存并测试」，
  // 显示一条说明即可，避免按钮点了永远失败造成误解。
  const isClient = kind.transport === 'client';

  const providerOptions = providers.map(p =>
    `<option value="${escapeHtml(p.id)}"${p.id === provider.id ? ' selected' : ''}>${escapeHtml(providerLabel(p))}</option>`
  ).join('');

  const fieldHtml = fields.map(f => {
    const value = entry[f.key] || '';
    const placeholder = f.placeholder || (f.key === 'baseUrl' && provider.defaultBaseUrl ? provider.defaultBaseUrl : '');
    return `<div class="svc-field">
      <label class="svc-field-label">${escapeHtml(fieldLabel(f))}${f.required ? ' <span class="svc-required">*</span>' : ''}</label>
      <input class="svc-input" data-field="${escapeHtml(f.key)}" type="${f.type === 'password' ? 'password' : 'text'}"
             value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" spellcheck="false">
    </div>`;
  }).join('');

  const homepage = provider.homepage
    ? `<a class="svc-home" href="${escapeHtml(provider.homepage)}" target="_blank" rel="noopener">${escapeHtml(i18nT('services.providerDoc'))}</a>`
    : '';

  const testBtn = isClient
    ? ''
    : `<button class="btn btn--secondary btn--sm svc-test" type="button">${escapeHtml(i18nT('services.testBtn'))}</button>`;
  const clientHint = isClient
    ? `<span class="svc-schema">${escapeHtml(i18nT('services.clientOnlyHint'))}</span>`
    : '';

  return `<div class="svc-card" data-kind="${escapeHtml(kind.id)}">
    <div class="svc-card-head">
      <div>
        <div class="svc-card-title">${escapeHtml(kindLabel(kind))}</div>
        <div class="svc-card-desc">${escapeHtml(kindDesc(kind))}</div>
      </div>
      <div class="svc-card-actions">${testBtn}</div>
    </div>
    <div class="svc-card-body">
      <div class="svc-field">
        <label class="svc-field-label">${escapeHtml(i18nT('services.fieldProvider'))}</label>
        <select class="svc-input svc-provider">${providerOptions}</select>
      </div>
      ${fieldHtml}
      <div class="svc-meta">
        ${clientHint}
        <span class="svc-schema">${escapeHtml(i18nT('services.fieldResultSchema'))}<code>${escapeHtml(kind.resultSchema)}</code></span>
        ${homepage}
      </div>
      <div class="svc-test-result" hidden></div>
    </div>
  </div>`;
}

/** 绑定单个卡片的输入与测试按钮 */
function bindServiceCard(card) {
  const kindId = card.dataset.kind;
  const entry = serviceConfig[kindId];

  card.querySelector('.svc-provider').addEventListener('change', (e) => {
    entry.providerId = e.target.value;
    // 只重绘当前卡片：切换服务商可能改变可用字段（如是否需要 API Key），
    // 同时避免影响其他卡片中尚未保存的输入。
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderServiceCard(serviceMeta.kinds.find(k => k.id === kindId));
    const fresh = wrapper.firstElementChild;
    card.replaceWith(fresh);
    bindServiceCard(fresh);
  });

  card.querySelectorAll('.svc-input[data-field]').forEach(input => {
    input.addEventListener('input', () => {
      entry[input.dataset.field] = input.value.trim();
    });
  });

  const testBtn = card.querySelector('.svc-test');
  // 客户端直连类别没有测试按钮（不经过 HTTP 请求），这里必须判空
  if (testBtn) testBtn.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const resultEl = card.querySelector('.svc-test-result');
    resultEl.hidden = false;
    resultEl.className = 'svc-test-result';
    resultEl.textContent = i18nT('services.testing');
    btn.disabled = true;
    try {
      // 先落盘再测试：否则测的是上一次保存的配置，与用户眼前的输入不一致
      const saved = await saveServiceEndpoints();
      if (!saved) {
        resultEl.className = 'svc-test-result svc-test-result--fail';
        resultEl.textContent = i18nT('services.testSaveFail');
        return;
      }
      const resp = await chrome.runtime.sendMessage({ action: 'serviceTest', data: { kind: kindId } });
      if (resp && resp.success) {
        resultEl.className = 'svc-test-result svc-test-result--ok';
        resultEl.textContent = i18nT('services.testOk')
          .replace('{provider}', (resp.meta && resp.meta.provider) || i18nT('services.unknownProvider'))
          .replace('{ms}', resp.meta && resp.meta.duration != null ? resp.meta.duration : '?');
      } else {
        resultEl.className = 'svc-test-result svc-test-result--fail';
        resultEl.textContent = i18nT('services.testFail') + ((resp && resp.error) || i18nT('toast.unknownError'));
      }
    } catch (err) {
      resultEl.className = 'svc-test-result svc-test-result--fail';
      resultEl.textContent = i18nT('services.testFail') + err.message;
    } finally {
      btn.disabled = false;
    }
  });
}

/**
 * 保存服务端点配置
 * @param {boolean} [notify=true] 是否弹出成功提示
 * @returns {Promise<boolean>} 是否保存成功
 */
async function saveServiceEndpoints(notify = true) {
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'serviceConfigSet', data: { config: serviceConfig } });
    if (!resp || !resp.success) {
      if (notify) toast('❌ ' + i18nT('services.saveFailPrefix') + ((resp && resp.error) || i18nT('toast.unknownError')), 'error');
      return false;
    }
    serviceConfig = resp.config; // 使用规范化后的结果，避免界面与存储不一致
    if (notify) toast(i18nT('services.saveOk'), 'success');
    return true;
  } catch (e) {
    if (notify) toast('❌ ' + i18nT('services.saveFailPrefix') + e.message, 'error');
    return false;
  }
}

async function resetServiceEndpoints() {
  if (!confirm(i18nT('services.resetConfirm'))) return;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'serviceConfigReset' });
    if (resp && resp.success) {
      serviceConfig = resp.config;
      const container = document.getElementById('service-endpoints');
      container.innerHTML = serviceMeta.kinds.map(renderServiceCard).join('');
      container.querySelectorAll('.svc-card').forEach(bindServiceCard);
      toast(i18nT('services.resetOk'), 'success');
    } else {
      toast('❌ ' + i18nT('services.resetFail'), 'error');
    }
  } catch (e) {
    toast('❌ ' + i18nT('services.resetFail') + ': ' + e.message, 'error');
  }
}

// ==================== 国际化 ====================

function applyI18nLabels() {
  const i18n = getI18n();
  // 设置页各 section 标题与按钮
  const map = {
    '[data-section="general"]': 'settings.general',
    '[data-section="services"]': 'settings.services',
    '[data-section="tools"]': 'settings.tools',
    '[data-section="shortcuts"]': 'settings.shortcuts',
    '[data-section="data"]': 'settings.data',
    '[data-section="about"]': 'settings.about'
  };
  for (const [sel, key] of Object.entries(map)) {
    const el = document.querySelector(sel);
    if (el) {
      // 保留 emoji 前缀
      const text = el.textContent.trim();
      const emoji = text.match(/^[\p{Emoji}]+/u);
      const newText = i18n.t(key);
      el.textContent = (emoji ? emoji[0] + ' ' : '') + newText;
    }
  }
  // 设置项 label
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = i18n.t(el.dataset.i18n);
  });
  // 版本号统一取自 manifest，避免在 HTML/JS 中多处写死
  const versionEl = document.getElementById('about-version');
  if (versionEl) versionEl.textContent = i18n.t('about.version') + ' ' + chrome.runtime.getManifest().version;
}

// ==================== 主题管理 ====================

function applyTheme() {
  chrome.storage.local.get('toolbox_settings', (r) => {
    const s = r.toolbox_settings || {};
    const theme = s.theme || 'auto';
    const isDark = theme === 'dark' ||
      (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  });
}

function initThemeListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.toolbox_settings) {
      const newSettings = changes.toolbox_settings.newValue;
      if (newSettings && newSettings.theme) {
        const theme = newSettings.theme;
        const isDark = theme === 'dark' ||
          (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        const themeSelect = document.getElementById('theme-select');
        if (themeSelect && themeSelect.value !== theme) {
          themeSelect.value = theme;
        }
      }
    }
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyTheme();
  });
}

function initNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const section = item.dataset.section;
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-item--active'));
      item.classList.add('nav-item--active');
      document.querySelectorAll('.section').forEach(sec => sec.classList.toggle('section--active', sec.id === section));
    });
  });
}

async function loadSettings() {
  try {
    const i18n = getI18n();
    const r = await chrome.storage.local.get('toolbox_settings');
    const raw = r.toolbox_settings;
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      // toolbox_settings 为 null/undefined/非对象，直接使用默认值
      applySettingsToUI(DEFAULTS, i18n);
      return;
    }
    const s = { ...DEFAULTS, ...raw };
    applySettingsToUI(s, i18n);
  } catch(e) { toast(i18nT('data.loadFail'), 'error'); }
}

function applySettingsToUI(s, i18n) {
  document.getElementById('theme-select').value = s.theme || 'auto';
  document.getElementById('position-select').value = s.sidebarPosition || 'right';
  document.getElementById('width-range').value = s.sidebarWidth || 400;
  document.getElementById('width-value').textContent = (s.sidebarWidth || 400) + 'px';
  document.getElementById('auto-save').checked = s.autoSave !== false;
  document.getElementById('show-notifications').checked = s.showNotifications !== false;
  document.getElementById('show-floating-btn').checked = s.showFloatingBtn !== false;

  // 同步语言选择器
  document.querySelectorAll('#lang-selector .lang-selector__item').forEach(btn => {
    btn.classList.toggle('lang-selector__item--active', btn.dataset.lang === (s.language || i18n.getCurrentLocale()));
  });
}

async function loadTools() {
  try {
    const r = await chrome.storage.local.get('tools_status');
    const status = r.tools_status || {};
    const container = document.getElementById('tools-manager');
    container.innerHTML = TOOLS_CONFIG.map(tool => {
      const enabled = status[tool.id] ? status[tool.id].enabled !== false : true;
      return `<div class="tool-manage-item" data-tool="${escapeHtml(tool.id)}">
        <span class="tool-icon">${escapeHtml(tool.icon)}</span>
        <span class="tool-name">${escapeHtml(tool.name)}</span>
        <div class="tool-toggle ${enabled ? 'tool-toggle--active' : ''}" data-tool="${escapeHtml(tool.id)}"></div>
      </div>`;
    }).join('');
    container.querySelectorAll('.tool-toggle').forEach(toggle => {
      toggle.addEventListener('click', () => toggle.classList.toggle('tool-toggle--active'));
    });
  } catch(e) { toast(i18nT('toast.toolsLoadFail'), 'error'); }
}

/**
 * 安全地绑定事件：元素不存在时跳过并告警，而不是抛错
 *
 * 为什么需要：原先逐个 `getElementById(...).addEventListener(...)`，
 * 一旦某个 id 因 HTML 调整而缺失，异常会中断 initEvents，
 * 导致**其后所有按钮全部失效**（表现为"点了没反应"，且不报错给用户）。
 * 逐个绑定互不影响，问题只影响对应的那一个控件。
 *
 * @param {string} id 元素 id
 * @param {string} type 事件类型
 * @param {Function} handler 处理函数
 */
function bind(id, type, handler) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn('[Options] 未找到元素，跳过事件绑定: #' + id);
    return;
  }
  el.addEventListener(type, handler);
}

function initEvents() {
  bind('width-range', 'input', e => {
    document.getElementById('width-value').textContent = e.target.value + 'px';
  });
  bind('btn-save-general', 'click', saveGeneral);
  bind('btn-reset-general', 'click', resetGeneral);
  bind('btn-save-tools', 'click', saveTools);
  bind('btn-reset-tools', 'click', resetTools);
  bind('btn-open-shortcuts', 'click', openShortcutSettings);
  bind('btn-export', 'click', exportData);
  bind('btn-import', 'change', importData);
  bind('btn-clear-all', 'click', clearAll);

  // 服务端点
  bind('btn-save-services', 'click', () => saveServiceEndpoints());
  bind('btn-reset-services', 'click', resetServiceEndpoints);

  // 主题选择即时预览（无需点保存即可看到效果，保存时仍会持久化）
  document.getElementById('theme-select').addEventListener('change', (e) => {
    const theme = e.target.value;
    const isDark = theme === 'dark' ||
      (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  });

  // 语言切换
  document.querySelectorAll('#lang-selector .lang-selector__item').forEach(btn => {
    btn.addEventListener('click', async () => {
      const lang = btn.dataset.lang;
      const i18n = getI18n();
      await i18n.setLocale(lang);
      // 立即高亮新选项
      document.querySelectorAll('#lang-selector .lang-selector__item').forEach(b => {
        b.classList.toggle('lang-selector__item--active', b.dataset.lang === lang);
      });
      // 更新 html lang 属性
      document.documentElement.setAttribute('lang', lang);
      // 刷新设置页自身 UI 文案
      applyI18nLabels();
      toast(getI18n().t('toast.settingsSaved'), 'success');
    });
  });
}

/**
 * 打开浏览器的「扩展快捷键设置」入口
 *
 * 为什么需要按浏览器分流：原先固定打开 Mozilla 的帮助页，在 Chrome / Edge 上是错误跳转
 * （用户会被带到一份讲 Firefox 的文档）。Chrome 与 Edge 提供可直接打开的内部设置页，
 * 因此优先跳那里；Firefox 不允许扩展用 tabs.create 打开 about:addons，
 * 只能落到官方帮助文档。三种情况都保证有可用的出口。
 */
function openShortcutSettings() {
  const ua = navigator.userAgent || '';
  let url;
  if (/\bEdg\//.test(ua)) {
    url = 'edge://extensions/shortcuts';
  } else if (/\bFirefox\//.test(ua)) {
    url = 'https://support.mozilla.org/kb/manage-extension-shortcuts-firefox';
  } else {
    url = 'chrome://extensions/shortcuts';
  }
  try {
    chrome.tabs.create({ url });
  } catch (e) {
    console.warn('[Options] 无法打开快捷键设置页:', e);
  }
}

async function saveGeneral() {
  const theme = document.getElementById('theme-select').value;
  // 读取当前语言（优先从 UI 选择器，回退到 i18n 当前区域）
  const activeLangBtn = document.querySelector('#lang-selector .lang-selector__item--active');
  const language = activeLangBtn ? activeLangBtn.dataset.lang : getI18n().getCurrentLocale();
  const settings = {
    theme: theme,
    language: language,
    sidebarPosition: document.getElementById('position-select').value,
    sidebarWidth: parseInt(document.getElementById('width-range').value, 10),
    autoSave: document.getElementById('auto-save').checked,
    showNotifications: document.getElementById('show-notifications').checked,
    showFloatingBtn: document.getElementById('show-floating-btn').checked
  };
  try {
    const r = await chrome.storage.local.get('toolbox_settings');
    const current = r.toolbox_settings || {};
    await chrome.storage.local.set({ toolbox_settings: { ...current, ...settings } });
    const isDark = theme === 'dark' ||
      (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    toast(i18nT('toast.settingsSaved'), 'success');
  } catch(e) { toast('❌ ' + i18nT('data.saveFail'), 'error'); }
}

async function resetGeneral() {
  document.getElementById('theme-select').value = DEFAULTS.theme;
  document.getElementById('position-select').value = DEFAULTS.sidebarPosition;
  document.getElementById('width-range').value = DEFAULTS.sidebarWidth;
  document.getElementById('width-value').textContent = DEFAULTS.sidebarWidth + 'px';
  document.getElementById('auto-save').checked = DEFAULTS.autoSave;
  document.getElementById('show-notifications').checked = DEFAULTS.showNotifications;
  document.getElementById('show-floating-btn').checked = DEFAULTS.showFloatingBtn;
  // 重置语言选择器到默认值
  document.querySelectorAll('#lang-selector .lang-selector__item').forEach(btn => {
    btn.classList.toggle('lang-selector__item--active', btn.dataset.lang === DEFAULTS.language);
  });
  toast(i18nT('toast.settingsReset'), 'success');
  // 重置 UI 后自动保存
  await saveGeneral();
}

async function saveTools() {
  try {
    const r = await chrome.storage.local.get('tools_status');
    const status = r.tools_status || {};
    document.querySelectorAll('.tool-manage-item').forEach(item => {
      const id = item.dataset.tool;
      const enabled = item.querySelector('.tool-toggle').classList.contains('tool-toggle--active');
      status[id] = { ...(status[id] || { useCount: 0, lastUsed: null }), enabled };
    });
    TOOLS_CONFIG.forEach(tool => {
      if (!status[tool.id]) {
        status[tool.id] = { enabled: true, useCount: 0, lastUsed: null };
      }
    });
    await chrome.storage.local.set({ tools_status: status });
    toast(i18nT('toast.toolsSaved'), 'success');
  } catch(e) { toast('❌ ' + i18nT('data.saveFail'), 'error'); }
}

async function resetTools() {
  // 恢复默认：将所有工具设为启用，保留使用统计
  try {
    const r = await chrome.storage.local.get('tools_status');
    const status = r.tools_status || {};
    TOOLS_CONFIG.forEach(tool => {
      status[tool.id] = { ...(status[tool.id] || { useCount: 0, lastUsed: null }), enabled: true };
    });
    await chrome.storage.local.set({ tools_status: status });
    // 重新加载工具列表 UI
    await loadTools();
    toast(i18nT('toast.toolsResetOk'), 'success');
  } catch(e) { toast('❌ ' + i18nT('toast.toolsResetFail'), 'error'); }
}

async function exportData() {
  try {
    const storage = new StorageManager();
    const data = await storage.exportAllData();
    data.exportDate = new Date().toISOString();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `toolbox-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(i18nT('data.exportSuccess'), 'success');
  } catch(e) { toast(i18nT('data.exportFail'), 'error'); }
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      toast('❌ ' + i18nT('data.importInvalidJson'), 'error');
      e.target.value = ''; // 重置文件输入，允许重复选择同一文件
      return;
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      toast('❌ ' + i18nT('data.importBadShape'), 'error');
      e.target.value = '';
      return;
    }
    const storage = new StorageManager();
    await storage.importAllData(data);
    toast(i18nT('data.importSuccess'), 'success');
    await loadSettings();
    await loadTools();
  } catch(e) { toast(i18nT('data.importFail') + ': ' + e.message, 'error'); }
  e.target.value = ''; // 重置文件输入，允许重复选择同一文件
}

async function clearAll() {
  if (!confirm('⚠️ ' + i18nT('confirm.clearAll'))) return;
  try {
    const storage = new StorageManager();
    await storage.clearAllData();
    // 清除数据后需要重新同意协议
    await chrome.storage.local.remove(['toolbox_terms_v1', 'toolbox_first_run_done_v1']);
    toast(i18nT('data.clearSuccess'), 'success');
    await loadSettings();
    await loadTools();
    // 重新弹窗
    setTimeout(() => location.reload(), 800);
  } catch(e) { toast(i18nT('data.clearFail'), 'error'); }
}

function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast toast--' + (type || 'info') + ' toast--show';
  clearTimeout(el._tid);
  el._tid = setTimeout(() => el.classList.remove('toast--show'), 2500);
}
