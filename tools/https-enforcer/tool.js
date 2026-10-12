/**
 * HTTPS 强制 - HTTPS Enforcer
 * 将 HTTP 请求升级为 HTTPS，支持严格/宽松模式
 */
document.addEventListener('DOMContentLoaded', () => {
  const $master = document.getElementById('he-master');
  const $status = document.getElementById('he-status');
  const $upgradedCount = document.getElementById('he-upgraded-count');
  const $fallbackCount = document.getElementById('he-fallback-count');
  const $whitelist = document.getElementById('he-whitelist');
  const $pageStatus = document.getElementById('he-page-status');
  const $addCurrent = document.getElementById('he-add-current');
  const $toast = document.getElementById('toast');
  // ── PostMessage 通信路由 ──
  let _msgId = 0;
  const _pendingMsgs = new Map();

  function _handlePostMessageResponse(event) {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (event.source !== window.parent) return;
    if (!event.data || typeof event.data !== 'object') return;
    const { action, data } = event.data;
    if ((action === '__bgResponse' || action === '__contentResponse') && data && data.__id) {
      const pending = _pendingMsgs.get(data.__id);
      if (pending) {
        _pendingMsgs.delete(data.__id);
        clearTimeout(pending.timer);
        const result = data.result;
        if (action === '__bgResponse' && result && result.success === false && result.error) {
          pending.reject(new Error(result.error));
        } else {
          pending.resolve(result);
        }
      }
    }
  }
  window.addEventListener('message', _handlePostMessageResponse);

  function callBackground(action, data) {
    return new Promise((resolve, reject) => {
      const id = ++_msgId;
      const timer = setTimeout(() => {
        _pendingMsgs.delete(id);
        reject(new Error('后台调用超时'));
      // 本侧超时只是安全网：必须大于 background 的最长超时（服务请求 20s、通用代理最多 60s），
      // 否则慢请求下会先触发本侧超时，用户看到的是"后台调用超时"而不是服务端返回的可读错误。
      // 本侧超时只是安全网：必须大于 background 的最长超时（服务请求 20s、通用代理最多 60s），
    // 否则慢请求下会先触发本侧超时，用户看到的是"后台调用超时"而不是服务端返回的可读错误。
    }, 70000);
      _pendingMsgs.set(id, { resolve, reject, timer });
      window.parent.postMessage({ action: 'callBackground', data: { id, action, data } }, '*');
    });
  }

  function safeStorage(op, ...args) {
    try {
      if (op === 'get') return chrome.storage.local.get(...args).catch(() => ({}));
      return chrome.storage.local[op](...args).catch(() => {});
    } catch(e) { return op === 'get' ? Promise.resolve({}) : Promise.resolve(); }
  }

  function showToast(msg, type) {
    type = type || 'info';
    $toast.textContent = msg;
    $toast.className = 'toast toast--' + type;
    $toast.classList.add('toast--show');
    clearTimeout($toast._tm);
    $toast._tm = setTimeout(() => $toast.classList.remove('toast--show'), 3000);
  }

  function saveToHistory(data) {
    try {
      callBackground('saveToHistory', { toolId: 'https-enforcer', type: 'enforce', data });
    } catch (e) {}
  }

  function getMode() {
    const checked = document.querySelector('input[name="he-mode"]:checked');
    return checked ? checked.value : 'strict';
  }

  function getWhitelist() {
    return $whitelist.value.trim().split('\n').map(d => d.trim()).filter(Boolean);
  }

  function updateStatus(enabled) {
    if (enabled) {
      $status.textContent = '已启用';
      $status.classList.add('he-status--active');
    } else {
      $status.textContent = '未启用';
      $status.classList.remove('he-status--active');
    }
  }

  function applySettings() {
    const enabled = $master.checked;
    updateStatus(enabled);
    if (enabled) {
      const mode = getMode();
      const whitelist = getWhitelist();
      callBackground('httpsEnforcer_enable', { mode, whitelist });
      // 持久化配置
      safeStorage('set', {
        toolbox_https_enforcer: { enabled: true, mode, whitelist }
      });
      showToast('HTTPS 强制已启用 (' + (mode === 'strict' ? '严格模式' : '宽松模式') + ')', 'success');
      saveToHistory({ enabled: true, mode });
    } else {
      callBackground('httpsEnforcer_disable', null);
      // 持久化关闭状态（保留其他配置）
      safeStorage('get', 'toolbox_https_enforcer').then(res => {
        const cfg = res.toolbox_https_enforcer || {};
        safeStorage('set', { toolbox_https_enforcer: { ...cfg, enabled: false } });
      });
      showToast('HTTPS 强制已关闭', 'info');
      saveToHistory({ enabled: false });
    }
    // 更新统计显示
    updateStats();
  }

  $master.addEventListener('change', applySettings);
  document.querySelectorAll('input[name="he-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if ($master.checked) applySettings();
    });
  });
  $whitelist.addEventListener('change', () => {
    // 更新白名单域名数量显示
    updateStats();
    if ($master.checked) applySettings();
  });

  async function loadSavedState() {
    try {
      const result = await safeStorage('get', 'toolbox_https_enforcer');
      const config = result.toolbox_https_enforcer;
      if (config) {
        if (config.enabled) {
          $master.checked = true;
          updateStatus(true);
        }
        if (config.mode) {
          const radio = document.querySelector('input[name="he-mode"][value="' + config.mode + '"]');
          if (radio) radio.checked = true;
        }
        if (config.whitelist && config.whitelist.length) {
          $whitelist.value = config.whitelist.join('\n');
        }
      }
    } catch (e) {}
    // 加载完状态后更新统计显示
    updateStats();
  }

  async function checkPageStatus() {
    try {
      const response = await callBackground('getTabInfo', null);
      if (response && response.success && response.data && response.data.url) {
        const tabUrl = response.data.url;
        const isSecure = tabUrl.startsWith('https://');
        $pageStatus.textContent = isSecure ? '✅ 当前页面使用 HTTPS 连接' : '⚠️ 当前页面使用 HTTP 连接';
        $pageStatus.className = 'he-page-status' + (isSecure ? ' he-page-status--secure' : ' he-page-status--insecure');

        // ── Resource Protocol Check ──
        let resCheckEl = document.getElementById('he-resource-check');
        if (!resCheckEl) {
          resCheckEl = document.createElement('div');
          resCheckEl.id = 'he-resource-check';
          resCheckEl.style.cssText = 'margin:8px 0;padding:8px;border:1px solid var(--tt-border);border-radius:6px;font-size:12px;background:var(--tt-bg-secondary);';
          $pageStatus.parentElement.appendChild(resCheckEl);
        }

        if (isSecure) {
          // Check for insecure resources
          try {
            const networkData = await callBackground('getNetworkAnalysis', null);
            if (networkData && networkData.success && networkData.entries) {
              const httpResources = networkData.entries.filter(e => e.name && e.name.startsWith('http://'));
              if (httpResources.length > 0) {
                resCheckEl.innerHTML = '<div style="color:#f44336;font-weight:bold;">⚠️ 发现 ' + httpResources.length + ' 个不安全(HTTP)资源请求</div>' +
                  httpResources.slice(0, 5).map(r => '<div style="font-size:11px;color:var(--tt-text-secondary);">• ' + escHtml(r.name.substring(0, 80)) + '</div>').join('');
              } else {
                resCheckEl.innerHTML = '<div style="color:#4caf50;">✅ 所有资源均通过安全协议加载</div>';
              }
            } else {
              resCheckEl.innerHTML = '<div style="color:var(--tt-text-secondary);">无法检测资源协议</div>';
            }
          } catch(e) {
            resCheckEl.innerHTML = '';
          }
        }

        // ── HSTS Preload Check ──
        let hstsEl = document.getElementById('he-hsts-check');
        if (!hstsEl) {
          hstsEl = document.createElement('div');
          hstsEl.id = 'he-hsts-check';
          hstsEl.style.cssText = 'margin:4px 0;padding:6px;border:1px solid var(--tt-border);border-radius:4px;font-size:11px;background:var(--tt-bg-secondary);';
          $pageStatus.parentElement.appendChild(hstsEl);
        }
        try {
          const headerResult = await callBackground('fetchSecurityHeaders', { url: tabUrl });
          if (headerResult && headerResult.headers) {
            const hsts = headerResult.headers['strict-transport-security'];
            if (hsts) {
              const hasPreload = hsts.includes('preload');
              const hasIncludeSub = hsts.includes('includeSubDomains');
              hstsEl.innerHTML = '<div style="color:#4caf50;">✓ HSTS 已设置</div>' +
                (hasPreload ? '<div style="color:#4caf50;">✓ 包含 preload 指令（HSTS 预加载列表）</div>' : '<div style="color:#ff9800;">⚠️ 未包含 preload 指令，建议加入 HSTS 预加载列表: https://hstspreload.org/</div>') +
                (hasIncludeSub ? '<div style="color:#4caf50;">✓ 包含 includeSubDomains</div>' : '<div style="color:#ff9800;">⚠️ 未包含 includeSubDomains</div>');
            } else {
              hstsEl.innerHTML = '<div style="color:#f44336;">❌ 未设置 HSTS，建议配置 Strict-Transport-Security 头</div>';
            }
          } else {
            hstsEl.innerHTML = '';
          }
        } catch(e) { hstsEl.innerHTML = ''; }

        // ── 当前页面的不安全请求升级状态（只读检测，不提供虚假开关）──
        // 旧实现在这里放了一个「自动升级不安全请求」复选框，但它传入的 upgradeInsecure
        // 参数后台从未读取，勾选后没有任何效果 —— 属于典型的"看似有效实则无效"控件。
        // 这里改为真实检测：展示当前页面响应头里是否已包含 upgrade-insecure-requests。
        let upgradeEl = document.getElementById('he-upgrade-option');
        if (!upgradeEl) {
          upgradeEl = document.createElement('div');
          upgradeEl.id = 'he-upgrade-option';
          upgradeEl.style.cssText = 'margin:4px 0;padding:6px;border:1px solid var(--tt-border);border-radius:4px;font-size:11px;background:var(--tt-bg-secondary);';
          $pageStatus.parentElement.appendChild(upgradeEl);
        }
        upgradeEl.textContent = '⏳ 正在检测不安全请求升级状态...';
        callBackground('fetchHeaders', { url: tabUrl }).then((resp) => {
          const csp = (resp && resp.headers && (resp.headers['content-security-policy'] || resp.headers['Content-Security-Policy'])) || '';
          if (/upgrade-insecure-requests/i.test(csp)) {
            upgradeEl.innerHTML = '<span style="color:#4caf50">✅ 当前页面 CSP 已包含 upgrade-insecure-requests，不安全请求会被自动升级</span>';
          } else {
            upgradeEl.innerHTML = '<span style="color:var(--tt-text-tertiary)">ℹ️ 当前页面 CSP 未包含 upgrade-insecure-requests。'
              + '注意：浏览器扩展无法为任意站点安全地注入该指令（会覆盖站点原有 CSP），请由站点服务端配置。</span>';
          }
        }).catch(() => {
          upgradeEl.textContent = 'ℹ️ 无法读取当前页面响应头（跨域限制），跳过不安全请求升级检测';
        });

      } else {
        $pageStatus.textContent = '无法检测当前页面';
      }
    } catch (e) {
      $pageStatus.textContent = '无法检测当前页面';
    }
  }

  function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ── 统计显示 ──
  // he-upgraded-count: 启用显示 1（已启用），关闭显示 0
  // he-fallback-count: 显示白名单域名数量
  function updateStats() {
    if ($upgradedCount) $upgradedCount.textContent = $master.checked ? '1' : '0';
    if ($fallbackCount) $fallbackCount.textContent = String(getWhitelist().length);
  }

  // 将当前页域名加入白名单
  async function addCurrentDomainToWhitelist() {
    try {
      const resp = await callBackground('getTabInfo', null);
      const url = (resp && resp.success && resp.data && resp.data.url) ? resp.data.url : (resp && resp.url ? resp.url : '');
      if (!url) {
        showToast('无法获取当前页地址', 'error');
        return;
      }
      let host;
      try { host = new URL(url).hostname; } catch(e) { host = ''; }
      if (!host) {
        showToast('无法解析当前页域名', 'error');
        return;
      }
      const existing = getWhitelist();
      if (existing.includes(host)) {
        showToast('当前域名已在白名单中: ' + host, 'info');
        return;
      }
      existing.push(host);
      if ($whitelist) {
        $whitelist.value = existing.join('\n');
        $whitelist.dispatchEvent(new Event('change'));
      }
      showToast('已加入白名单: ' + host, 'success');
    } catch(e) {
      showToast('获取当前页失败: ' + (e.message || ''), 'error');
    }
  }

  // ===== 事件绑定：添加当前域名到白名单 =====
  if ($addCurrent) $addCurrent.addEventListener('click', addCurrentDomainToWhitelist);

  window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!event.data || event.source !== window.parent) return;
    if (event.data && event.data.action === 'setTheme' && event.data.data) {
      document.documentElement.setAttribute('data-theme', event.data.data.theme);
    }
  });

  loadSavedState();
  checkPageStatus();
});
