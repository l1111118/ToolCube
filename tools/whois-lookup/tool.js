/**
 * WHOIS查询工具
 */
document.addEventListener('DOMContentLoaded', () => {
  const domainInput = document.getElementById('domain-input');
  const btnQuery = document.getElementById('btn-query');
  const btnCurrentDomain = document.getElementById('btn-current-domain');
  const availabilityBar = document.getElementById('availability-bar');
  const availabilityText = document.getElementById('availability-text');
  const resultArea = document.getElementById('result-area');
  const toastEl = document.getElementById('toast');
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

  // 到期提醒存储键
  const REMINDER_KEY = 'whois-expiry-reminders';
  const REMINDER_THRESHOLD = 30; // 默认提醒阈值：30天

  async function saveToHistory(domain) {
    try {
      await callBackground('saveToHistory', { toolId: 'whois-lookup', type: 'query', data: { domain } });
    } catch (e) {}
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showToast(msg, type = 'info') {
    toastEl.textContent = msg;
    toastEl.className = 'toast toast--' + type;
    toastEl.classList.add('toast--show');
    setTimeout(() => toastEl.classList.remove('toast--show'), 3000);
  }

  function formatDate(dateStr) {
    if (!dateStr) return '--';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return escapeHtml(dateStr);
      return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      return escapeHtml(dateStr);
    }
  }

  // 域名状态码解释
  function explainStatus(status) {
    if (!status) return '';
    var s = status.toLowerCase().trim();
    var map = {
      'clientdeleteprohibited': '禁止删除',
      'clienttransferprohibited': '禁止转移',
      'clientupdateprohibited': '禁止修改',
      'clientrenewprohibited': '禁止续期',
      'serverdeleteprohibited': '服务器禁止删除',
      'servertransferprohibited': '服务器禁止转移',
      'serverupdateprohibited': '服务器禁止修改',
      'serverrenewprohibited': '服务器禁止续期',
      'clienthold': '暂停解析',
      'serverhold': '服务器暂停解析',
      'inactive': '未激活',
      'ok': '正常',
      'pendingcreate': '创建中',
      'pendingdelete': '删除中',
      'pendingtransfer': '转移中',
      'pendingrenew': '续期中',
      'addperiod': '新增期',
      'renewperiod': '续费期',
      'redemptionperiod': '赎回期',
      'pendingrestore': '恢复中',
      'autorenewperiod': '自动续费期',
      'transferperiod': '转移期'
    };
    // 尝试匹配（去掉 http://icann.org/epp# 前缀）
    var clean = s.replace(/^https?:\/\/[^/]+\/[^#]*#/, '').toLowerCase();
    return map[clean] || '';
  }

  // 计算域名到期倒计时
  function getExpiryCountdown(expiryStr) {
    if (!expiryStr) return null;
    try {
      var d = Array.isArray(expiryStr) ? new Date(expiryStr[0]) : new Date(expiryStr);
      if (isNaN(d.getTime())) return null;
      var now = new Date();
      var diffMs = d.getTime() - now.getTime();
      var diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      return diffDays;
    } catch(e) { return null; }
  }

  function renderField(label, value) {
    if (!value) return '';
    return `<div class="field"><span class="field-label">${escapeHtml(label)}</span><span class="field-value"><code>${escapeHtml(String(value))}</code></span></div>`;
  }

  function renderResults(data, rawText) {
    let html = '';

    // Domain info
    html += '<div class="section"><div class="section-title">域名信息</div>';
    html += renderField('域名', data.domain);
    html += renderField('域名ID', data.registryDomainId);
    const statuses = data.status || [];
    if (statuses.length > 0 || typeof statuses === 'string') {
      var statusList = Array.isArray(statuses) ? statuses : [statuses];
      var statusHtml = statusList.map(function(s) {
        var explain = explainStatus(s);
        return escapeHtml(s) + (explain ? ' <span style="font-size:11px;color:var(--tt-text-tertiary)">(' + explain + ')</span>' : '');
      }).join(', ');
      html += renderField('状态', '');
      html += '<div class="field"><span class="field-value" style="font-size:12px">' + statusHtml + '</span></div>';
    }
    html += '</div>';

    // Registrar
    html += '<div class="section"><div class="section-title">注册商</div>';
    html += renderField('注册商', data.registrar);
    html += renderField('注册商URL', data.registrarUrl);
    html += renderField('WHOIS服务器', data.whoisServer);
    html += '</div>';

    // Dates
    html += '<div class="section"><div class="section-title">重要日期</div>';
    const creation = data.creationDate;
    const expiry = data.expirationDate;
    const updated = data.updatedDate;
    if (Array.isArray(creation)) {
      html += renderField('注册日期', creation[0]);
    } else {
      html += renderField('注册日期', creation ? formatDate(creation) : '');
    }
    if (Array.isArray(expiry)) {
      html += renderField('到期日期', expiry[0]);
    } else {
      html += renderField('到期日期', expiry ? formatDate(expiry) : '');
    }
    // 到期倒计时
    var daysLeft = getExpiryCountdown(expiry);
    if (daysLeft !== null) {
      var countdownColor = daysLeft < 0 ? '#ef4444' : daysLeft < 30 ? '#f59e0b' : daysLeft < 90 ? 'var(--tt-primary)' : 'var(--tt-success)';
      var countdownText = daysLeft < 0 ? '已过期 ' + Math.abs(daysLeft) + ' 天' : daysLeft + ' 天后到期';
      html += '<div style="padding:8px 0"><span style="font-size:13px;color:' + countdownColor + ';font-weight:bold">⏰ ' + countdownText + '</span></div>';
      if (daysLeft > 0 && daysLeft <= 30) {
        html += '<div style="padding:4px 8px;background:rgba(245,158,11,0.1);border-radius:4px;font-size:12px;color:#f59e0b">⚠️ 域名即将到期，建议尽快续费！</div>';
      } else if (daysLeft < 0) {
        html += '<div style="padding:4px 8px;background:rgba(239,68,68,0.1);border-radius:4px;font-size:12px;color:#ef4444">🚨 域名已过期，可能随时被删除或抢注！</div>';
      }
    }
    if (Array.isArray(updated)) {
      html += renderField('更新日期', updated[0]);
    } else {
      html += renderField('更新日期', updated ? formatDate(updated) : '');
    }
    html += '</div>';

    // Name servers
    html += '<div class="section"><div class="section-title">域名服务器</div>';
    const ns = data.nameServers || [];
    const nsList = Array.isArray(ns) ? ns : (typeof ns === 'string' ? ns.split(',').map(s => s.trim()) : []);
    for (const server of nsList) {
      html += renderField('NS', server);
    }
    if (nsList.length === 0) html += '<div class="field"><span class="field-value" style="color:var(--tt-text-tertiary)">无数据</span></div>';
    html += '</div>';

    // Registrant
    html += '<div class="section"><div class="section-title">注册人</div>';
    const reg = {};
    html += renderField('组织', data.registrantOrganization);
    html += renderField('国家', data.registrantCountry);
    html += renderField('邮箱', data.registrantEmail);
    if (!data.registrantOrganization && !data.registrantCountry && !data.registrantEmail) {
      html += '<div class="field"><span class="field-value" style="color:var(--tt-text-tertiary)">注册人信息已脱敏或不可用</span></div>';
    }
    html += '</div>';

    // Raw data
    html += '<div class="raw-section">';
    html += '<div class="raw-toggle" id="raw-toggle">📄 原始WHOIS数据 ▾</div>';
    html += `<div class="raw-content" id="raw-content">${escapeHtml(rawText || JSON.stringify(data, null, 2))}</div>`;
    html += '<button class="btn-copy-raw" id="btn-copy-raw">📋 复制原始数据</button>';
    html += '</div>';

    resultArea.innerHTML = html;

    // Bind raw toggle
    document.getElementById('raw-toggle').addEventListener('click', () => {
      document.getElementById('raw-content').classList.toggle('visible');
    });
    document.getElementById('btn-copy-raw').addEventListener('click', () => {
      const raw = rawText || JSON.stringify(data, null, 2);
      navigator.clipboard.writeText(raw).then(() => showToast('已复制原始数据')).catch(() => showToast('复制失败', 'error'));
    });
  }

  /**
   * 查询域名注册信息
   *
   * 数据来源由「设置 → 服务端点」的 whois 类别决定（RDAP / whoisjs / 自建服务）。
   * 依次尝试「用户在设置页选定的服务商」→「同类别的其他服务商」，全部失败才提示错误。
   * 各家返回格式的差异已由 provider 归一化（见 common/service-providers.js），
   * 因此这里只消费统一结构，不再保留历史上那套多别名兼容代码：
   *   { domain, registrar, registrarUrl, whoisServer, creationDate, expirationDate,
   *     updatedDate, nameServers[], status[], registrantOrganization,
   *     registrantCountry, registrantEmail, registryDomainId, raw }
   */
  async function queryWhois(domain) {
    resultArea.innerHTML = '<div class="loading">⏳ 查询中...</div>';
    availabilityBar.style.display = 'none';
    btnQuery.disabled = true;

    // 候选服务商：先用用户配置（providerId 留空即用配置），再依次降级到同类别的其他服务商
    let candidates = [''];
    try {
      const meta = await callBackground('serviceProviders', null);
      if (meta && meta.success) {
        candidates = [''].concat(
          (meta.providers || []).filter(p => p.kind === 'whois').map(p => p.id)
        );
      }
    } catch (e) {
      // 注册表不可用时只尝试用户配置，不阻断主流程
    }

    let data = null;
    let lastError = '';
    const tried = new Set();
    for (const providerId of candidates) {
      if (providerId && tried.has(providerId)) continue;
      try {
        const r = await callBackground('serviceRequest', { kind: 'whois', params: { domain }, providerId });
        if (r && r.meta && r.meta.provider) tried.add(r.meta.provider);
        if (r && r.success && r.data) { data = r.data; break; }
        if (r && r.error) lastError = r.error;
      } catch (e) {
        lastError = e.message;
      }
    }

    if (!data) {
      resultArea.innerHTML = '<div class="error-msg">❌ 查询失败：'
        + escapeHtml(lastError || '无法连接到 WHOIS/RDAP 服务，请检查域名或稍后重试') + '</div>';
      btnQuery.disabled = false;
      return;
    }

    const rawText = data.raw || JSON.stringify(data, null, 2);

    // 可注册判定：注册时间、注册商、域名服务器三者皆无才认为可能可注册。
    // 只判 status 为空数组是不够的 —— 归一化后 status 默认就是空数组，
    // 会把所有未返回状态的已注册域名误判为"可注册"。
    const looksUnregistered = !data.creationDate && !data.registrar
      && (!data.nameServers || data.nameServers.length === 0);
    availabilityBar.style.display = 'block';
    availabilityBar.className = 'availability-bar ' + (looksUnregistered ? 'available' : 'taken');
    availabilityText.textContent = looksUnregistered ? '✅ 域名可能可注册' : 'ℹ️ 域名已注册';

    renderResults(data, rawText);
    saveExpiryReminder(domain, data);

    btnQuery.disabled = false;
    saveToHistory(domain);
  }

  btnQuery.addEventListener('click', () => {
    const domain = domainInput.value.trim();
    if (!domain) { showToast('请输入域名', 'error'); return; }
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    domainInput.value = cleanDomain;
    queryWhois(cleanDomain);
  });

  domainInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const domain = domainInput.value.trim();
      if (domain) {
        const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        domainInput.value = cleanDomain;
        queryWhois(cleanDomain);
      }
    }
  });

  btnCurrentDomain.addEventListener('click', () => {
    callBackground('getTabInfo', null).then((response) => {
      if (response && response.success && response.data && response.data.url) {
        try {
          const url = new URL(response.data.url);
          domainInput.value = url.hostname;
          queryWhois(url.hostname);
        } catch {
          showToast('无法获取当前页面域名', 'error');
        }
      } else {
        showToast('无法获取当前页面域名', 'error');
      }
    });
  });

  // ==================== 域名到期提醒管理 ====================
  // 保存域名到期信息到本地存储
  async function saveExpiryReminder(domain, data) {
    try {
      const expiry = data.expirationDate;
      if (!expiry) return;
      const expiryDate = Array.isArray(expiry) ? new Date(expiry[0]) : new Date(expiry);
      if (isNaN(expiryDate.getTime())) return;
      const stored = await safeStorage('get', REMINDER_KEY);
      let reminders = stored[REMINDER_KEY] || [];
      // 更新或添加
      const idx = reminders.findIndex(r => r.domain === domain);
      const entry = {
        domain: domain,
        expiry: expiryDate.toISOString(),
        registrar: data.registrar || '',
        queriedAt: Date.now()
      };
      if (idx >= 0) reminders[idx] = entry;
      else reminders.push(entry);
      await safeStorage('set', { [REMINDER_KEY]: reminders });
    } catch (e) {}
  }

  // 渲染到期提醒列表
  async function renderReminderList() {
    const reminderList = document.getElementById('reminder-list');
    if (!reminderList) return;
    try {
      const stored = await safeStorage('get', REMINDER_KEY);
      const reminders = stored[REMINDER_KEY] || [];
      if (reminders.length === 0) {
        reminderList.innerHTML = '<div class="info-placeholder">暂无到期提醒<br><span style="font-size:11px;color:var(--tt-text-tertiary)">查询域名后会自动添加到期提醒</span></div>';
        return;
      }
      // 按到期时间排序
      reminders.sort((a, b) => new Date(a.expiry) - new Date(b.expiry));
      let html = '';
      for (const r of reminders) {
        const expiryDate = new Date(r.expiry);
        const now = new Date();
        const daysLeft = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        let statusColor, statusText, statusBg;
        if (daysLeft < 0) { statusColor = '#ef4444'; statusText = '已过期 ' + Math.abs(daysLeft) + ' 天'; statusBg = 'rgba(239,68,68,0.1)'; }
        else if (daysLeft <= 30) { statusColor = '#f59e0b'; statusText = daysLeft + ' 天后到期'; statusBg = 'rgba(245,158,11,0.1)'; }
        else if (daysLeft <= 90) { statusColor = 'var(--tt-primary)'; statusText = daysLeft + ' 天后到期'; statusBg = 'rgba(59,130,246,0.1)'; }
        else { statusColor = 'var(--tt-success)'; statusText = daysLeft + ' 天后到期'; statusBg = 'rgba(34,197,94,0.1)'; }
        html += '<div class="reminder-item" style="padding:10px;border-radius:6px;background:' + statusBg + ';margin-bottom:8px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<div><strong>' + escapeHtml(r.domain) + '</strong>' +
          (r.registrar ? '<span style="font-size:11px;color:var(--tt-text-tertiary);margin-left:8px">' + escapeHtml(r.registrar) + '</span>' : '') + '</div>' +
          '<button class="btn-remove-reminder" data-domain="' + escapeHtml(r.domain) + '" style="background:none;border:none;color:var(--tt-text-tertiary);cursor:pointer;font-size:14px">✕</button>' +
          '</div>' +
          '<div style="font-size:12px;color:' + statusColor + ';margin-top:4px">⏰ ' + statusText + ' (' + formatDate(r.expiry) + ')</div>' +
          '</div>';
      }
      reminderList.innerHTML = html;
      // 绑定删除按钮
      reminderList.querySelectorAll('.btn-remove-reminder').forEach(btn => {
        btn.addEventListener('click', async function() {
          const domain = this.dataset.domain;
          const stored = await safeStorage('get', REMINDER_KEY);
          let reminders = stored[REMINDER_KEY] || [];
          reminders = reminders.filter(r => r.domain !== domain);
          await safeStorage('set', { [REMINDER_KEY]: reminders });
          renderReminderList();
          showToast('已删除 ' + domain + ' 的提醒');
        });
      });
    } catch (e) {
      reminderList.innerHTML = '<div class="info-placeholder">加载提醒失败</div>';
    }
  }

  // 到期提醒按钮和模态框事件
  var btnReminders = document.getElementById('btn-reminders');
  var reminderModal = document.getElementById('reminder-modal');
  var reminderClose = document.getElementById('reminder-close');
  if (btnReminders && reminderModal) {
    btnReminders.addEventListener('click', () => {
      reminderModal.style.display = 'flex';
      renderReminderList();
    });
  }
  if (reminderClose) {
    reminderClose.addEventListener('click', () => {
      reminderModal.style.display = 'none';
    });
  }
  if (reminderModal) {
    reminderModal.addEventListener('click', (e) => {
      if (e.target === reminderModal) reminderModal.style.display = 'none';
    });
  }
});

window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!event.data || event.source !== window.parent) return;
  if (event.data.action === 'setTheme' && event.data.data) {
    document.documentElement.setAttribute('data-theme', event.data.data.theme);
  }
  if (event.data.action === 'setData') {
    const inputArea = document.getElementById('domain-input');
    if (inputArea && typeof event.data.data === 'string') {
      inputArea.value = event.data.data;
    }
  }
});

function showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast toast--' + type;
  el.classList.add('toast--show');
  setTimeout(() => el.classList.remove('toast--show'), 3000);
}

