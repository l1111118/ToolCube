/**
 * CORS测试器
 */
document.addEventListener('DOMContentLoaded', () => {
  const targetUrl = document.getElementById('target-url');
  const originDisplay = document.getElementById('origin-display');
  const methodSelect = document.getElementById('method-select');
  // 请求实际携带的 Origin：浏览器禁止页面脚本伪造 Origin（Fetch 规范中的
  // forbidden header），因此这里只能拿到扩展自身的来源，并据此做真实的风险评估。
  // 旧实现允许用户填写任意 Origin 并随请求发送，但该头会被浏览器静默丢弃，
  // 导致"多 Origin / 特殊字符 Origin"测试全部在测同一个 Origin，结论毫无意义。
  const realOrigin = location.origin;
  if (originDisplay) originDisplay.value = realOrigin;
  const customHeaders = document.getElementById('custom-headers');
  const requestBody = document.getElementById('request-body');
  const btnPreflight = document.getElementById('btn-preflight');
  const btnActual = document.getElementById('btn-actual');
  const resultsSection = document.getElementById('results-section');
  const responseStatus = document.getElementById('response-status');
  const corsHeaders = document.getElementById('cors-headers');
  const assessment = document.getElementById('assessment');
  const allHeadersToggle = document.getElementById('all-headers-toggle');
  const allHeaders = document.getElementById('all-headers');
  const historyList = document.getElementById('history-list');
  const btnClearHistory = document.getElementById('btn-clear-history');
  const toastEl = document.getElementById('toast');
  function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
  function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
  function safeStorage(op, ...args) { if (!isCtxValid()) return op === 'get' ? Promise.resolve({}) : Promise.resolve(); try { return chrome.storage.local[op](...args); } catch(e) { return op === 'get' ? Promise.resolve({}) : Promise.resolve(); } }

  const HISTORY_KEY = 'cors-tester-history';
  const MAX_HISTORY = 5;

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

  allHeadersToggle.addEventListener('click', () => {
    const visible = allHeaders.style.display !== 'none';
    allHeaders.style.display = visible ? 'none' : 'block';
    allHeadersToggle.textContent = visible ? '所有响应头 ▾' : '所有响应头 ▴';
  });

  function renderCorsHeader(name, value) {
    return `<div class="cors-header-item">
      <span class="cors-header-name">${escapeHtml(name)}</span>
      <span class="cors-header-value">${escapeHtml(value || '(未设置)')}</span>
    </div>`;
  }

  function assessRisk(headers, origin) {
    const acao = headers.get('access-control-allow-origin');
    const acac = headers.get('access-control-allow-credentials');
    const findings = [];
    let level = 'info';

    if (!acao) {
      level = 'low';
      findings.push('🔒 未发现CORS响应头 — 服务器不支持CORS或未配置');
    } else if (acao === '*') {
      level = 'high';
      findings.push('⚠️ Access-Control-Allow-Origin: * — 允许任意来源访问');
      if (acac === 'true') {
        level = 'critical';
        findings.push('🚨 Access-Control-Allow-Credentials: true 与通配符 * 同时存在 — 严重安全漏洞！');
      }
    } else if (acao === realOrigin) {
      // 反射型：服务器把请求的 Origin 原样回显到 ACAO。
      // 由于页面无法伪造 Origin，这里比对的是真实请求来源；
      // 若 ACAO 与之相等，说明服务器对"任意来源"都会反射，属于高危配置。
      level = 'high';
      findings.push('⚠️ 服务器反射了请求的Origin — 任意来源都会被允许');
      if (acac === 'true') {
        level = 'critical';
        findings.push('🚨 反射Origin + Credentials: true — 可窃取认证数据，严重漏洞！');
      }
    } else {
      level = 'medium';
      findings.push(`ℹ️ 允许特定来源: ${acao}`);
      if (acac === 'true') {
        findings.push('⚠️ 允许携带认证信息 — 确保来源白名单配置正确');
      }
    }

    const acam = headers.get('access-control-allow-methods');
    if (acam) findings.push(`允许的方法: ${acam}`);

    const acah = headers.get('access-control-allow-headers');
    if (acah) findings.push(`允许的头部: ${acah}`);

    const acma = headers.get('access-control-max-age');
    if (acma) findings.push(`预检缓存时间: ${acma}秒`);

    return { level, findings };
  }

  async function sendCORSRequest(preflight) {
    const url = targetUrl.value.trim();
    if (!url) { showToast('请输入目标URL', 'error'); return; }

    // 不再伪造 Origin：Fetch 规范禁止页面设置该头，写了也会被浏览器丢弃。
    // 请求携带的是扩展真实来源，风险评估据此进行。
    let headers = {};
    try {
      const custom = customHeaders.value.trim();
      if (custom) Object.assign(headers, JSON.parse(custom));
    } catch (e) {
      showToast('自定义Headers格式错误', 'error'); return;
    }

    const method = preflight ? 'OPTIONS' : methodSelect.value;
    const body = (!preflight && (method === 'POST' || method === 'PUT')) ? requestBody.value : undefined;

    btnPreflight.disabled = true;
    btnActual.disabled = true;
    resultsSection.style.display = 'block';
    responseStatus.textContent = '请求中...';
    responseStatus.className = 'status-display';
    corsHeaders.innerHTML = '';
    assessment.innerHTML = '';
    allHeaders.innerHTML = '';

    try {
      const options = { method, headers, mode: 'cors' };
      if (body) options.body = body;

      const resp = await fetch(url, options);
      const respHeaders = resp.headers;

      responseStatus.textContent = `${resp.status} ${resp.statusText}`;
      responseStatus.className = 'status-display ' + (resp.ok ? 'status--ok' : 'status--warn');

      const corsNames = [
        'access-control-allow-origin',
        'access-control-allow-methods',
        'access-control-allow-headers',
        'access-control-allow-credentials',
        'access-control-max-age'
      ];

      let headersHtml = '';
      for (const name of corsNames) {
        headersHtml += renderCorsHeader(name, respHeaders.get(name));
      }
      corsHeaders.innerHTML = headersHtml;

      const risk = assessRisk(respHeaders, realOrigin);
      assessment.className = 'assessment assessment--' + risk.level;
      // findings 内插了服务器返回的原始响应头（ACAO/ACAM/ACAH/Max-Age），
      // 必须整体转义后再注入 DOM，否则被测试的恶意服务器可通过响应头执行脚本（扩展页 XSS）
      assessment.innerHTML = risk.findings.map(f => `<div>${escapeHtml(f)}</div>`).join('');

      let allHeadersText = '';
      respHeaders.forEach((value, key) => {
        allHeadersText += `${key}: ${value}\n`;
      });
      allHeaders.textContent = allHeadersText;

      saveToHistory(url, method, risk.level);
    } catch (error) {
      responseStatus.textContent = '请求失败';
      responseStatus.className = 'status-display status--error';
      assessment.className = 'assessment assessment--info';
      assessment.innerHTML = `<div>ℹ️ 请求被阻止: ${escapeHtml(error.message)}</div>
        <div>这可能意味着服务器未配置CORS或网络不可达</div>`;
    }

    btnPreflight.disabled = false;
    btnActual.disabled = false;
  }

  btnPreflight.addEventListener('click', () => sendCORSRequest(true));
  btnActual.addEventListener('click', () => sendCORSRequest(false));

  // ==================== 反射Origin检测 ====================
  // 说明：浏览器禁止页面脚本伪造 Origin（Fetch forbidden header），因此无法真正
  // 模拟"来自 evil.com 的请求"。旧实现的「多Origin测试」与「特殊字符Origin测试」
  // 都依赖设置 Origin 头，该头会被浏览器静默丢弃，所有请求实际携带同一个 Origin，
  // 结论毫无意义 —— 属于典型的"看似有效实则无效"。
  //
  // 这里改为**真实可行**的检测：用扩展自身 Origin 发起 OPTIONS 请求，判断服务器
  // 是否把该 Origin 原样反射到 ACAO。反射型配置意味着服务器对任意来源都会放行，
  // 是最常见、也最危险的 CORS 配置错误。
  var btnMultiOrigin = document.getElementById('btn-multi-origin');
  var multiOriginResult = document.getElementById('multi-origin-result');
  if (btnMultiOrigin && multiOriginResult) {
    btnMultiOrigin.addEventListener('click', async () => {
      const url = targetUrl.value.trim();
      if (!url) { showToast('请输入目标URL', 'error'); return; }
      multiOriginResult.innerHTML = '<div style="color:var(--tt-text-tertiary);font-size:12px">⏳ 正在检测...</div>';
      try {
        const resp = await fetch(url, { method: 'OPTIONS', mode: 'cors', signal: AbortSignal.timeout(8000) });
        const acao = resp.headers.get('access-control-allow-origin');
        const acac = resp.headers.get('access-control-allow-credentials');
        const reflected = acao === realOrigin;
        const wildcard = acao === '*';
        let risk, label, color;
        if ((wildcard || reflected) && acac === 'true') { risk = 'critical'; label = '严重'; color = '#b71c1c'; }
        else if (wildcard || reflected) { risk = 'high'; label = '高风险'; color = '#ef4444'; }
        else if (acao) { risk = 'medium'; label = '中等'; color = '#f59e0b'; }
        else { risk = 'low'; label = '安全'; color = 'var(--tt-success)'; }

        multiOriginResult.innerHTML =
          '<div style="font-size:12px;margin-bottom:8px;color:var(--tt-text-secondary)">🔀 反射Origin检测结果</div>' +
          '<table class="result-table" style="font-size:12px"><tbody>' +
          '<tr><td>请求 Origin</td><td><code>' + escapeHtml(realOrigin) + '</code></td></tr>' +
          '<tr><td>Access-Control-Allow-Origin</td><td>' + (acao ? '<code>' + escapeHtml(acao) + '</code>' : '<span style="color:var(--tt-text-tertiary)">未返回</span>') + '</td></tr>' +
          '<tr><td>Access-Control-Allow-Credentials</td><td>' + (acac ? escapeHtml(acac) : '—') + '</td></tr>' +
          '<tr><td>是否反射请求 Origin</td><td>' + (reflected ? '✅ 是（反射型配置，任意来源都会被放行）' : wildcard ? '通配符 *（任意来源）' : '否') + '</td></tr>' +
          '<tr><td>风险评级</td><td style="color:' + color + ';font-weight:600">' + label + '</td></tr>' +
          '</tbody></table>' +
          '<div style="font-size:11px;color:var(--tt-text-tertiary);margin-top:6px">ℹ️ 浏览器禁止页面伪造 Origin，无法模拟其他来源的请求；如需精确的多来源测试，请在服务端进行。</div>';
      } catch (e) {
        multiOriginResult.innerHTML = '<div style="font-size:12px;color:var(--tt-text-tertiary)">❌ 检测失败: ' + escapeHtml(e.message) + '</div>';
      }
    });
  }

  // ==================== CORS评分 ====================
  var btnCorsScore = document.getElementById('btn-cors-score');
  var corsScoreResult = document.getElementById('cors-score-result');
  if (btnCorsScore && corsScoreResult) {
    btnCorsScore.addEventListener('click', async () => {
      const url = targetUrl.value.trim();
      if (!url) { showToast('请输入目标URL', 'error'); return; }
      corsScoreResult.innerHTML = '<div style="color:var(--tt-text-tertiary);font-size:12px">⏳ CORS配置评分中...</div>';
      let score = 100;
      const findings = [];
      try {
        
        const resp = await fetch(url, { method: 'OPTIONS', mode: 'cors', signal: AbortSignal.timeout(8000) });
        const acao = resp.headers.get('access-control-allow-origin');
        const acac = resp.headers.get('access-control-allow-credentials');
        const acam = resp.headers.get('access-control-allow-methods');
        const acah = resp.headers.get('access-control-allow-headers');
        if (!acao) { findings.push('✅ 未设置CORS — 服务器默认拒绝跨域'); score += 0; }
        else if (acao === '*') { findings.push('🚨 ACAO为通配符* (-30分)'); score -= 30; }
        else if (acao === realOrigin) { findings.push('🚨 反射请求Origin (-40分)'); score -= 40; }
        else { findings.push('✅ 限制为特定来源 (+0分)'); }
        if (acac === 'true') { findings.push('⚠️ 允许凭证 (-20分)'); score -= 20; }
        if (acac === 'true' && (acao === '*' || acao === realOrigin)) { findings.push('🚨 凭证+宽泛Origin = 严重漏洞 (-30分)'); score -= 30; }
        if (acam && /DELETE|PUT|PATCH/i.test(acam)) { findings.push('⚠️ 允许危险方法 (-5分)'); score -= 5; }
        if (!resp.headers.get('access-control-max-age')) { findings.push('ℹ️ 未设置预检缓存 (-0分)'); }
      } catch (e) {
        findings.push('ℹ️ 请求被阻止 — 可能未配置CORS');
        score = 80;
      }
      score = Math.max(0, Math.min(100, score));
      const grade = score >= 90 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F';
      const gradeColor = score >= 90 ? 'var(--tt-success)' : score >= 70 ? '#f59e0b' : '#ef4444';
      corsScoreResult.innerHTML = '<div style="text-align:center;margin:12px 0"><div style="font-size:36px;font-weight:bold;color:' + gradeColor + '">' + grade + '</div><div style="font-size:14px;color:var(--tt-text-tertiary)">CORS安全评分: ' + score + '/100</div></div>' +
        findings.map(f => '<div style="font-size:12px;padding:4px 0">' + f + '</div>').join('');
    });
  }

  // ==================== 修复建议 ====================
  var btnCorsFix = document.getElementById('btn-cors-fix');
  var corsFixResult = document.getElementById('cors-fix-result');
  if (btnCorsFix && corsFixResult) {
    btnCorsFix.addEventListener('click', async () => {
      const url = targetUrl.value.trim();
      if (!url) { showToast('请输入目标URL', 'error'); return; }
      corsFixResult.innerHTML = '<div style="color:var(--tt-text-tertiary);font-size:12px">⏳ 分析CORS配置...</div>';
      const suggestions = [];
      try {
        
        const resp = await fetch(url, { method: 'OPTIONS', mode: 'cors', signal: AbortSignal.timeout(8000) });
        const acao = resp.headers.get('access-control-allow-origin');
        const acac = resp.headers.get('access-control-allow-credentials');
        if (acao === '*') suggestions.push({ title: '移除通配符Origin', desc: '将 Access-Control-Allow-Origin: * 改为具体白名单域名。通配符*允许任何网站访问资源。', code: 'Access-Control-Allow-Origin: https://trusted-domain.com' });
        if (acao === realOrigin) suggestions.push({ title: '修复Origin反射', desc: '服务器不应直接反射请求Origin头。应维护白名单并在服务端验证Origin。', code: '// 服务端验证\nconst allowed = ["https://app.example.com"];\nif (allowed.includes(req.headers.origin)) {\n  res.setHeader("Access-Control-Allow-Origin", req.headers.origin);\n}' });
        if (acac === 'true' && acao !== 'null') suggestions.push({ title: '凭证+宽泛Origin', desc: 'Access-Control-Allow-Credentials: true 与宽泛的Origin组合是严重漏洞。浏览器会自动携带Cookie，攻击者可窃取用户数据。', code: '// 始终验证Origin白名单\nif (allowedOrigins.includes(origin)) {\n  res.setHeader("Access-Control-Allow-Origin", origin);\n  res.setHeader("Access-Control-Allow-Credentials", "true");\n}' });
        if (!resp.headers.get('access-control-max-age')) suggestions.push({ title: '设置预检缓存', desc: '设置 Access-Control-Max-Age 减少预检请求次数。', code: 'Access-Control-Max-Age: 86400' });
      } catch (e) {
        suggestions.push({ title: 'CORS未配置', desc: '服务器未返回CORS头，这实际上是安全的默认行为。如需允许跨域，请正确配置。', code: '' });
      }
      if (suggestions.length === 0) {
        corsFixResult.innerHTML = '<div style="font-size:12px;color:var(--tt-success)">✅ CORS配置看起来安全</div>';
      } else {
        corsFixResult.innerHTML = suggestions.map(s =>
          '<div style="margin-bottom:12px;padding:8px;border-left:3px solid var(--tt-primary);background:var(--tt-bg-secondary);border-radius:0 4px 4px 0">' +
          '<div style="font-weight:bold;font-size:13px;margin-bottom:4px">' + s.title + '</div>' +
          '<div style="font-size:12px;color:var(--tt-text-tertiary);margin-bottom:4px">' + s.desc + '</div>' +
          (s.code ? '<pre style="font-size:11px;white-space:pre-wrap;padding:4px;background:var(--tt-bg-primary);border-radius:3px">' + escapeHtml(s.code) + '</pre>' : '') +
          '</div>'
        ).join('');
      }
    });
  }

  async function saveToHistory(url, method, risk) {
    try {
      const stored = await safeStorage('get', HISTORY_KEY);
      let history = stored[HISTORY_KEY] || [];
      history.unshift({ url, method, risk, time: Date.now() });
      if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
      await safeStorage('set', { [HISTORY_KEY]: history });
      renderHistory();
    } catch (e) {}
    try {
      await safeSend({
        action: 'saveToHistory',
        data: { toolId: 'cors-tester', type: method, data: { url, method, risk } }
      });
    } catch (e) {}
  }

  async function renderHistory() {
    try {
      const stored = await safeStorage('get', HISTORY_KEY);
      const history = stored[HISTORY_KEY] || [];
      if (history.length === 0) {
        historyList.innerHTML = '<div class="info-placeholder--small">暂无测试历史</div>';
        return;
      }
      historyList.innerHTML = history.map(h => {
        const riskClass = 'risk--' + (h.risk || 'info');
        const riskLabel = { critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW', info: 'INFO' }[h.risk] || h.risk;
        return `<div class="history-item" data-url="${escapeHtml(h.url)}" data-method="${escapeHtml(h.method)}">
          <span class="history-url">${escapeHtml(h.url)}</span>
          <span class="history-risk ${riskClass}">${riskLabel}</span>
        </div>`;
      }).join('');
    } catch (e) {}
  }

  historyList.addEventListener('click', (e) => {
    const item = e.target.closest('.history-item');
    if (item) {
      targetUrl.value = item.dataset.url;
      methodSelect.value = item.dataset.method || 'GET';
    }
  });

  btnClearHistory.addEventListener('click', async () => {
    try { await safeStorage('remove', HISTORY_KEY); } catch (e) {}
    renderHistory();
    showToast('历史已清除');
  });

  renderHistory();
});

window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!event.data || event.source !== window.parent) return;
  if (event.data.action === 'setTheme' && event.data.data) {
    document.documentElement.setAttribute('data-theme', event.data.data.theme);
  }
  if (event.data.action === 'setData') {
    const inputArea = document.getElementById('target-url');
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
