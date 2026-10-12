/**
 * 追踪拦截器 - Tracker Blocker
 * 持续拦截追踪请求，关闭页面后仍生效
 */
document.addEventListener('DOMContentLoaded', () => {
  const $master = document.getElementById('tb-master');
  const $status = document.getElementById('tb-status');
  const $blockedCount = document.getElementById('tb-blocked-count');
  const $custom = document.getElementById('tb-custom');
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

  // ===== 分类目录（单一数据源：由后台给出实际生效的域名数量）=====
  // 旧实现前端另存一份 BLOCKLIST 用于展示数量，与后台真正生效的域名表不一致，
  // 造成「界面显示 N 条规则、实际拦截的是另一批域名」的假象；其中「恶意软件」
  // 分类更是只填了 example.com 占位域名，永远不可能命中任何真实请求。
  let categoryCounts = {};

  async function loadCategoryCatalog() {
    try {
      const resp = await callBackground('trackerBlocker_getCatalog', null);
      if (resp && resp.success && Array.isArray(resp.categories)) {
        categoryCounts = {};
        resp.categories.forEach(c => { categoryCounts[c.id] = c.count; });
      }
    } catch (e) {
      // 拉取失败时保持空表：数量显示为 0，而不是退回到伪造的本地常量
    }
    updateCategoryCounts();
    updateRuleCount();
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
      callBackground('saveToHistory', { toolId: 'tracker-blocker', type: 'block', data });
    } catch (e) {}
  }

  function getCategories() {
    const cats = {};
    document.querySelectorAll('.tb-cat-check').forEach(cb => {
      cats[cb.dataset.cat] = cb.checked;
    });
    return cats;
  }

  function getCustomDomains() {
    return $custom.value.trim().split('\n').map(d => d.trim()).filter(Boolean);
  }

  function updateStatus(enabled) {
    if (enabled) {
      $status.textContent = '已启用';
      $status.classList.add('tb-status--active');
    } else {
      $status.textContent = '未启用';
      $status.classList.remove('tb-status--active');
    }
  }

  /**
   * 把当前界面设置下发到后台并更新状态显示。
   *
   * 必须等待后台返回真实结果：旧实现 fire-and-forget 地调用后立即提示"已启用"，
   * 即使后台因为分类为空等原因拒绝启用，界面也照样显示成功。
   */
  async function applySettings() {
    const enabled = $master.checked;
    updateStatus(enabled);
    if (enabled) {
      const categoriesObj = getCategories();
      const categories = Object.entries(categoriesObj).filter(([, v]) => v).map(([k]) => k);
      const customDomains = getCustomDomains();
      const whitelist = getWhitelistDomains();
      try {
        const resp = await callBackground('trackerBlocker_enable', { categories, customDomains, whitelist });
        if (!resp || !resp.success) {
          $blockedCount.textContent = '0';
          showToast('启用失败: ' + ((resp && resp.error) || '未知错误'), 'error');
          return;
        }
        // 以后台返回的规则数为准（界面不再自行估算）
        if ($blockedCount) $blockedCount.textContent = resp.rulesCount;
        showToast('追踪拦截已启用 · ' + resp.rulesCount + ' 条规则'
          + (resp.whitelistCount ? ' · ' + resp.whitelistCount + ' 个白名单' : ''), 'success');
        saveToHistory({ enabled: true, categories, rulesCount: resp.rulesCount });
      } catch (e) {
        $blockedCount.textContent = '0';
        showToast('启用失败: ' + (e.message || e), 'error');
      }
    } else {
      // 关闭时显示 0
      if ($blockedCount) $blockedCount.textContent = '0';
      try {
        await callBackground('trackerBlocker_disable', null);
        showToast('追踪拦截已关闭', 'info');
      } catch (e) {
        showToast('关闭失败: ' + (e.message || e), 'error');
      }
      saveToHistory({ enabled: false });
    }
  }

  // ── Whitelist Management ──
  const $whitelist = document.getElementById('tb-whitelist');
  function getWhitelistDomains() {
    return $whitelist ? $whitelist.value.trim().split('\n').map(d => d.trim()).filter(Boolean) : [];
  }
  if ($whitelist) {
    $whitelist.addEventListener('change', () => {
      if ($master.checked) applySettings();
    });
  }

  // ── 已启用规则数显示 ──
  // 启用时按后台目录中的实际域名数 + 自定义域名数估算；关闭时显示 0。
  // 真正启用后由 applySettings 用后台返回的 rulesCount 覆盖，保证与实际一致。
  function updateRuleCount() {
    if (!$blockedCount) return;
    if (!$master.checked) {
      $blockedCount.textContent = '0';
      return;
    }
    const cats = getCategories();
    let count = 0;
    Object.entries(cats).forEach(([cat, on]) => {
      if (on && typeof categoryCounts[cat] === 'number') count += categoryCounts[cat];
    });
    count += getCustomDomains().length;
    $blockedCount.textContent = count;
  }

  // ── Preset Rules ──
  const PRESET_RULES = {
    social: { label: '社交媒体追踪', cats: ['social'], desc: '拦截社交平台的内嵌追踪脚本' },
    ads: { label: '广告追踪', cats: ['ad'], desc: '拦截广告与广告交易平台' },
    analytics: { label: '分析追踪', cats: ['analytics'], desc: '拦截分析统计与行为采集脚本' },
    privacy: { label: '隐私保护', cats: ['analytics', 'other', 'social'], desc: '拦截分析、数据交易、社交追踪，保留广告' },
    light: { label: '轻量拦截', cats: ['ad', 'social'], desc: '仅拦截广告和社交追踪，保留分析统计' },
    fpcrypto: { label: '仅指纹与挖矿', cats: ['fingerprint', 'crypto'], desc: '仅拦截浏览器指纹识别与网页挖矿脚本' },
    all: { label: '全量拦截', cats: ['ad', 'social', 'analytics', 'fingerprint', 'crypto', 'other'], desc: '拦截所有类别的追踪器（最严格）' }
  };

  document.querySelectorAll('.tb-preset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const preset = PRESET_RULES[btn.dataset.preset];
      if (!preset) return;
      document.querySelectorAll('.tb-cat-check').forEach(cb => {
        cb.checked = preset.cats.includes(cb.dataset.cat);
      });
      if ($master.checked) {
        // 已启用时立即按新预设重下发；提示由 applySettings 给出（含真实规则数）
        await applySettings();
      } else {
        showToast('已应用预设: ' + preset.label + '（开启开关后生效）', 'success');
      }
    });
  });

  // 动态更新各分类域名数量（数据来自后台目录）
  function updateCategoryCounts() {
    document.querySelectorAll('.tb-cat-item').forEach(item => {
      const cb = item.querySelector('.tb-cat-check');
      const countEl = item.querySelector('.tb-cat-count');
      if (cb && countEl) {
        const count = categoryCounts[cb.dataset.cat];
        countEl.textContent = typeof count === 'number' ? count : '—';
      }
    });
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
      const existing = getWhitelistDomains();
      if (existing.includes(host)) {
        showToast('当前域名已在白名单中: ' + host, 'info');
        return;
      }
      existing.push(host);
      if ($whitelist) {
        $whitelist.value = existing.join('\n');
        // 触发 change 事件以应用设置
        $whitelist.dispatchEvent(new Event('change'));
      }
      showToast('已加入白名单: ' + host, 'success');
    } catch(e) {
      showToast('获取当前页失败: ' + (e.message || ''), 'error');
    }
  }

  $master.addEventListener('change', applySettings);
  document.querySelectorAll('.tb-cat-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if ($master.checked) applySettings();
    });
  });
  $custom.addEventListener('change', () => {
    if ($master.checked) applySettings();
  });

  // ===== 添加当前域名到白名单 =====
  const $addCurrent = document.getElementById('tb-add-current');
  if ($addCurrent) $addCurrent.addEventListener('click', addCurrentDomainToWhitelist);

  async function loadSavedState() {
    try {
      const result = await safeStorage('get', 'toolbox_tracker_blocker');
      const config = result.toolbox_tracker_blocker;
      if (config) {
        if (config.enabled) {
          $master.checked = true;
          updateStatus(true);
        }
        if (config.categories) {
          // 兼容数组和对象两种格式
          const catArray = Array.isArray(config.categories) ? config.categories : Object.entries(config.categories).filter(([, v]) => v).map(([k]) => k);
          document.querySelectorAll('.tb-cat-check').forEach(cb => {
            if (Array.isArray(config.categories)) {
              cb.checked = catArray.includes(cb.dataset.cat);
            } else {
              if (config.categories[cb.dataset.cat] !== undefined) {
                cb.checked = config.categories[cb.dataset.cat];
              }
            }
          });
        }
        if (config.customDomains && config.customDomains.length) {
          $custom.value = config.customDomains.join('\n');
        }
        // 白名单此前只保存不还原，重启后界面上是空的（后台却仍在按旧白名单放行），
        // 会让用户以为白名单丢了而重复添加。这里一并还原。
        if (config.whitelist && config.whitelist.length && $whitelist) {
          $whitelist.value = config.whitelist.join('\n');
        }
      }
    } catch (e) {}
    // 加载完状态后更新已启用规则数显示
    updateRuleCount();
  }

  window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!event.data || event.source !== window.parent) return;
    if (event.data && event.data.action === 'setTheme' && event.data.data) {
      document.documentElement.setAttribute('data-theme', event.data.data.theme);
    }
  });

  loadSavedState();
  // 分类数量由后台目录提供（单一数据源），拉取成功后再刷新显示
  loadCategoryCatalog();
});
