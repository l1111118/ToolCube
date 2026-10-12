/**
 * 银狐木马拦截工具
 * 实时检测并拦截银狐木马等恶意软件下载
 * 纯JS引擎，无需Python/外部依赖
 */
(function () {
  'use strict';

  const E = {
    enabled: document.getElementById('sfg-enabled'),
    scanned: document.getElementById('sfg-scanned'),
    blocked: document.getElementById('sfg-blocked'),
    passed: document.getElementById('sfg-passed'),
    alerts: document.getElementById('sfg-alerts'),
    clear: document.getElementById('sfg-clear'),
  };

  function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
  function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(e => { console.warn('[silver-fox-guard] safeSend error:', e); }); }
  function safeStorage(op, ...args) { if (!isCtxValid()) return op === 'get' ? Promise.resolve({}) : Promise.resolve(); try { return chrome.storage.local[op](...args); } catch(e) { console.warn('[silver-fox-guard] safeStorage error:', e); return op === 'get' ? Promise.resolve({}) : Promise.resolve(); } }

  let state = { enabled: false, sensitivity: 'medium', stats: { scanned: 0, blocked: 0, passed: 0 }, alerts: [], whitelist: [], reports: [] };

  // ── Protection Level Descriptions ──
  const PROTECTION_LEVELS = {
    low: { label: '低防护', desc: '仅拦截已知高危威胁（银狐木马、远控木马等），误报率最低', color: '#4caf50' },
    medium: { label: '中防护', desc: '拦截已知威胁和可疑行为模式，平衡安全与误报', color: '#ff9800' },
    high: { label: '高防护', desc: '严格拦截所有可疑文件和行为，可能增加误报', color: '#f44336' }
  };

  // ── Render Protection Level Description ──
  function renderProtectionLevel() {
    let levelEl = document.getElementById('sfg-protection-level');
    if (!levelEl) {
      levelEl = document.createElement('div');
      levelEl.id = 'sfg-protection-level';
      levelEl.style.cssText = 'margin:8px 0;padding:8px;border:1px solid var(--tt-border);border-radius:6px;font-size:12px;background:var(--tt-bg-secondary);';
      E.enabled.parentElement.appendChild(levelEl);
    }
    var level = PROTECTION_LEVELS[state.sensitivity] || PROTECTION_LEVELS.medium;
    levelEl.innerHTML = '<div style="font-weight:bold;margin-bottom:4px;">🛡️ 防护等级说明</div>' +
      '<div style="color:' + level.color + ';font-weight:bold;">' + level.label + '</div>' +
      '<div style="color:var(--tt-text-secondary);font-size:11px;">' + escapeHtml(level.desc) + '</div>' +
      '<div style="margin-top:6px;font-size:11px;">' +
        Object.entries(PROTECTION_LEVELS).map(function(e) {
          var isActive = e[0] === state.sensitivity;
          return '<span style="color:' + e[1].color + ';' + (isActive ? 'font-weight:bold;' : '') + '">' + e[1].label + (isActive ? ' ✓' : '') + '</span>';
        }).join(' | ') +
      '</div>';
  }

  // ── Threat Detail Panel ──
  function showThreatDetail(alert) {
    var detailEl = document.getElementById('sfg-threat-detail');
    if (!detailEl) {
      detailEl = document.createElement('div');
      detailEl.id = 'sfg-threat-detail';
      detailEl.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--tt-bg);border:1px solid var(--tt-border);border-radius:8px;padding:16px;z-index:10000;max-width:400px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
      document.body.appendChild(detailEl);
    }
    detailEl.style.display = 'block';
    detailEl.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
      '<div style="font-weight:bold;font-size:14px;">🔍 威胁详情</div>' +
      '<button id="sfg-detail-close" style="background:none;border:none;font-size:18px;cursor:pointer;">✕</button>' +
    '</div>' +
    '<div style="font-size:12px;">' +
      '<div style="margin-bottom:6px;"><strong>文件名:</strong> ' + escapeHtml(alert.filename) + '</div>' +
      '<div style="margin-bottom:6px;"><strong>威胁类型:</strong> ' + escapeHtml(alert.reason) + '</div>' +
      '<div style="margin-bottom:6px;"><strong>风险等级:</strong> <span style="color:' + (alert.risk === 'high' ? '#f44336' : alert.risk === 'medium' ? '#ff9800' : '#4caf50') + ';">' + escapeHtml(alert.risk || 'unknown') + '</span></div>' +
      (alert.score ? '<div style="margin-bottom:6px;"><strong>风险评分:</strong> ' + alert.score + '/100</div>' : '') +
      '<div style="margin-bottom:6px;"><strong>检测时间:</strong> ' + new Date(alert.time).toLocaleString('zh-CN') + '</div>' +
      (alert.url ? '<div style="margin-bottom:6px;"><strong>来源URL:</strong> ' + escapeHtml(alert.url.substring(0, 100)) + '</div>' : '') +
      (alert.details ? '<div style="margin-bottom:6px;"><strong>详细分析:</strong> ' + escapeHtml(alert.details) + '</div>' : '') +
      '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">' +
        '<button class="btn" id="sfg-whitelist-add" style="font-size:11px;padding:4px 8px;">➕ 加入白名单</button>' +
        '<button class="btn" id="sfg-report-fp" style="font-size:11px;padding:4px 8px;border-color:#ff9800;color:#ff9800;">🚨 举报误判</button>' +
        '<button class="btn" id="sfg-dismiss-detail" style="font-size:11px;padding:4px 8px;">关闭</button>' +
      '</div>' +
    '</div>';

    document.getElementById('sfg-detail-close').addEventListener('click', function() { detailEl.style.display = 'none'; });
    document.getElementById('sfg-dismiss-detail').addEventListener('click', function() { detailEl.style.display = 'none'; });
    document.getElementById('sfg-whitelist-add').addEventListener('click', function() {
      if (alert.filename && !state.whitelist.includes(alert.filename)) {
        state.whitelist.push(alert.filename);
        safeStorage('set', { toolbox_sfg_whitelist: state.whitelist });
        showToast('已将 ' + alert.filename + ' 加入白名单');
        renderWhitelist();
        detailEl.style.display = 'none';
      }
    });
    // ── 举报误判 ──
    document.getElementById('sfg-report-fp').addEventListener('click', function() {
      reportFalsePositive(alert);
      detailEl.style.display = 'none';
    });
  }

  // ── 举报误判功能 ──
  function reportFalsePositive(alert) {
    // 检查是否已举报过
    var existing = state.reports.find(function(r) {
      return r.filename === alert.filename && r.url === alert.url;
    });
    if (existing) {
      showToast('该误判已举报过，无需重复提交');
      return;
    }
    // 创建举报记录
    var report = {
      filename: alert.filename,
      reason: alert.reason,
      url: alert.url || '',
      risk: alert.risk || 'unknown',
      score: alert.score || 0,
      time: Date.now(),
      reportedAt: Date.now()
    };
    state.reports.unshift(report);
    if (state.reports.length > 30) state.reports = state.reports.slice(0, 30);
    safeStorage('set', { toolbox_sfg_reports: state.reports });
    // 同时加入白名单，避免后续重复告警
    if (alert.filename && !state.whitelist.includes(alert.filename)) {
      state.whitelist.push(alert.filename);
      safeStorage('set', { toolbox_sfg_whitelist: state.whitelist });
      renderWhitelist();
    }
    showToast('已举报误判并加入白名单: ' + alert.filename, 'success');
    renderReports();
  }

  // ── 渲染误判举报列表 ──
  function renderReports() {
    var rpEl = document.getElementById('sfg-reports');
    if (!rpEl) return;
    rpEl.innerHTML = '<div class="sfg-section-header">' +
      '<span class="sfg-section-title">🚨 误判举报记录 (' + state.reports.length + ')</span>' +
      '<button class="sfg-clear-btn" id="sfg-clear-reports">清空</button>' +
    '</div>' +
    (state.reports.length === 0
      ? '<div class="sfg-empty">暂无举报记录。在威胁详情中点击"举报误判"可提交。</div>'
      : '<div class="sfg-report-list">' + state.reports.map(function(r, i) {
          var time = new Date(r.reportedAt).toLocaleString('zh-CN');
          return '<div class="sfg-report-item">' +
            '<div class="sfg-report-name">' + escapeHtml(r.filename) + '</div>' +
            '<div class="sfg-report-reason">原判断: ' + escapeHtml(r.reason) + '</div>' +
            '<div class="sfg-report-meta">' +
              '<span>风险分: ' + (r.score || 0) + '</span>' +
              '<span>举报时间: ' + time + '</span>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>'
    );

    var clearBtn = document.getElementById('sfg-clear-reports');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        state.reports = [];
        safeStorage('remove', 'toolbox_sfg_reports');
        renderReports();
        showToast('举报记录已清空');
      });
    }
  }

  // ── Whitelist Management ──
  function renderWhitelist() {
    var wlEl = document.getElementById('sfg-whitelist');
    if (!wlEl) {
      wlEl = document.createElement('div');
      wlEl.id = 'sfg-whitelist';
      wlEl.style.cssText = 'margin:8px 0;padding:8px;border:1px solid var(--tt-border);border-radius:6px;font-size:12px;background:var(--tt-bg-secondary);';
      E.clear.parentElement.appendChild(wlEl);
    }
    wlEl.innerHTML = '<div style="font-weight:bold;margin-bottom:6px;">📋 误报白名单 (' + state.whitelist.length + ')</div>' +
      (state.whitelist.length === 0
        ? '<div style="color:var(--tt-text-secondary);font-size:11px;">暂无白名单条目。点击威胁详情中的"加入白名单"可添加。</div>'
        : state.whitelist.map(function(name, i) {
          return '<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid var(--tt-border);">' +
            '<span>' + escapeHtml(name) + '</span>' +
            '<button class="sfg-wl-remove" data-idx="' + i + '" style="background:none;border:none;color:#f44336;cursor:pointer;font-size:11px;">移除</button>' +
          '</div>';
        }).join('')
      );

    wlEl.querySelectorAll('.sfg-wl-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.dataset.idx, 10);
        state.whitelist.splice(idx, 1);
        safeStorage('set', { toolbox_sfg_whitelist: state.whitelist });
        renderWhitelist();
      });
    });
  }

  // ── Real-time Threat Log ──
  function renderThreatLog() {
    var logEl = document.getElementById('sfg-threat-log');
    if (!logEl) {
      logEl = document.createElement('div');
      logEl.id = 'sfg-threat-log';
      logEl.style.cssText = 'margin:8px 0;padding:8px;border:1px solid var(--tt-border);border-radius:6px;font-size:12px;background:var(--tt-bg-secondary);';
      E.alerts.parentElement.insertBefore(logEl, E.alerts);
    }
    var recentAlerts = state.alerts.slice(0, 10);
    logEl.innerHTML = '<div style="font-weight:bold;margin-bottom:6px;">🕐 实时威胁日志 (最近 ' + recentAlerts.length + ' 条)</div>' +
      (recentAlerts.length === 0
        ? '<div style="color:var(--tt-text-secondary);font-size:11px;">暂无威胁检测记录</div>'
        : '<div style="max-height:150px;overflow-y:auto;">' + recentAlerts.map(function(a) {
          var riskColor = a.risk === 'high' ? '#f44336' : a.risk === 'medium' ? '#ff9800' : '#4caf50';
          var time = new Date(a.time).toLocaleTimeString();
          return '<div style="display:flex;gap:6px;padding:3px 0;border-bottom:1px solid var(--tt-border);cursor:pointer;" class="sfg-log-entry" data-idx="' + state.alerts.indexOf(a) + '">' +
            '<span style="color:' + riskColor + ';font-weight:bold;">●</span>' +
            '<span>' + escapeHtml(a.filename) + '</span>' +
            '<span style="color:var(--tt-text-secondary);font-size:10px;margin-left:auto;">' + time + '</span>' +
          '</div>';
        }).join('') + '</div>'
      );

    logEl.querySelectorAll('.sfg-log-entry').forEach(function(entry) {
      entry.addEventListener('click', function() {
        var idx = parseInt(entry.dataset.idx, 10);
        if (state.alerts[idx]) showThreatDetail(state.alerts[idx]);
      });
    });
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  // ── Toast 提示（轻量实现，避免依赖外部） ──
  function showToast(msg, type) {
    type = type || 'info';
    var toast = document.getElementById('sfg-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sfg-toast';
      toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(100px);padding:10px 20px;border-radius:6px;font-size:12px;z-index:10001;opacity:0;transition:all .3s;pointer-events:none;max-width:90%;';
      document.body.appendChild(toast);
    }
    var bg = type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : '#333';
    toast.textContent = msg;
    toast.style.background = bg;
    toast.style.color = '#fff';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    toast.style.opacity = '1';
    clearTimeout(toast._tm);
    toast._tm = setTimeout(function() {
      toast.style.transform = 'translateX(-50%) translateY(100px)';
      toast.style.opacity = '0';
    }, 2500);
  }

  function updateStats() {
    E.scanned.textContent = state.stats.scanned;
    E.blocked.textContent = state.stats.blocked;
    E.passed.textContent = state.stats.passed;
  }

  function renderAlerts() {
    if (!state.alerts.length) {
      E.alerts.innerHTML = '<div class="sfg-empty">暂无警报记录</div>';
      renderThreatLog();
      return;
    }
    E.alerts.innerHTML = state.alerts.slice(0, 30).map(function (a, idx) {
      var riskClass = a.risk === 'high' ? 'sfg-alert--high' : a.risk === 'medium' ? 'sfg-alert--medium' : 'sfg-alert--low';
      var scoreClass = (a.score || 0) >= 70 ? 'sfg-alert-score--high' : 'sfg-alert-score--medium';
      var time = new Date(a.time).toLocaleTimeString();
      return '<div class="sfg-alert ' + riskClass + '" style="cursor:pointer;" data-idx="' + idx + '">' +
        '<div class="sfg-alert-name">' + escapeHtml(a.filename) + '</div>' +
        '<div class="sfg-alert-reason">' + escapeHtml(a.reason) + '</div>' +
        '<div class="sfg-alert-meta">' +
          '<span>' + time + '</span>' +
          (a.score ? '<span class="sfg-alert-score ' + scoreClass + '">风险分: ' + a.score + '</span>' : '') +
          '<span style="font-size:10px;color:var(--tt-primary);">点击查看详情</span>' +
        '</div></div>';
    }).join('');

    // Add click handlers for detail view
    E.alerts.querySelectorAll('.sfg-alert').forEach(function(el) {
      el.addEventListener('click', function() {
        var idx = parseInt(el.dataset.idx, 10);
        if (state.alerts[idx]) showThreatDetail(state.alerts[idx]);
      });
    });

    renderThreatLog();
  }

  function saveState() {
    safeStorage('set', {
      toolbox_silver_fox_guard: {
        enabled: state.enabled,
        sensitivity: state.sensitivity,
        updatedAt: Date.now()
      }
    });
  }

  async function loadSavedState() {
    try {
      const result = await safeStorage('get', ['toolbox_silver_fox_guard', 'toolbox_sfg_stats', 'toolbox_sfg_alerts', 'toolbox_sfg_whitelist', 'toolbox_sfg_reports']);
      var config = result.toolbox_silver_fox_guard;
      if (config) {
        state.enabled = !!config.enabled;
        state.sensitivity = config.sensitivity || 'medium';
        E.enabled.checked = state.enabled;
        document.querySelectorAll('.sfg-sens-btn').forEach(function (b) {
          b.classList.toggle('active', b.dataset.level === state.sensitivity);
        });
      }
      if (result.toolbox_sfg_stats) state.stats = result.toolbox_sfg_stats;
      if (result.toolbox_sfg_alerts) state.alerts = result.toolbox_sfg_alerts;
      if (result.toolbox_sfg_whitelist) state.whitelist = result.toolbox_sfg_whitelist;
      if (result.toolbox_sfg_reports) state.reports = result.toolbox_sfg_reports;
      updateStats();
      renderAlerts();
      renderProtectionLevel();
      renderWhitelist();
      renderReports();
    } catch (e) {}
  }

  // 开关
  E.enabled.addEventListener('change', function () {
    state.enabled = this.checked;
    saveState();
    renderProtectionLevel();
    if (state.enabled) {
      safeSend({ action: 'silverFoxGuard_enable', data: { sensitivity: state.sensitivity, whitelist: state.whitelist } });
    } else {
      safeSend({ action: 'silverFoxGuard_disable' });
    }
  });

  // 灵敏度
  document.querySelectorAll('.sfg-sens-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.sfg-sens-btn').forEach(function (b) { b.classList.remove('active'); });
      this.classList.add('active');
      state.sensitivity = this.dataset.level;
      saveState();
      renderProtectionLevel();
      if (state.enabled) {
        safeSend({ action: 'silverFoxGuard_enable', data: { sensitivity: state.sensitivity, whitelist: state.whitelist } });
      }
    });
  });

  // 清除警报
  E.clear.addEventListener('click', function () {
    state.alerts = [];
    safeStorage('remove', 'toolbox_sfg_alerts');
    renderAlerts();
  });

  // 监听来自background的警报更新（包裹 try-catch 防止扩展上下文失效时出错）
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg.action === 'sfg_alert') {
        state.alerts.unshift(msg.data);
        if (state.alerts.length > 50) state.alerts = state.alerts.slice(0, 50);
        state.stats = msg.stats || state.stats;
        safeStorage('set', { toolbox_sfg_alerts: state.alerts, toolbox_sfg_stats: state.stats });
        updateStats();
        renderAlerts();
      }
    });
  } catch(e) {}

  // 主题切换
  window.addEventListener('message', function (e) {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!e.data || e.source !== window.parent) return;
    if (e.data.action === 'setTheme' && e.data.data) {
      document.documentElement.setAttribute('data-theme', e.data.data.theme);
    }
  });

  // 初始化
  loadSavedState();
})();
