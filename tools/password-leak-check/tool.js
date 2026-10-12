/**
 * 密码泄露检测 - 使用 Have I Been Pwned k-匿名 API
 * 仅发送 SHA-1 哈希前5位，完整密码不会离开本机
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // DOM 引用
  const E = {
    // 单密码模式
    input: document.getElementById('pwd-input'),
    btnToggle: document.getElementById('btn-toggle'),
    btnCheck: document.getElementById('btn-check'),
    meterFill: document.getElementById('meter-fill'),
    strengthText: document.getElementById('strength-text'),
    resultSection: document.getElementById('result-section'),
    resultArea: document.getElementById('result-area'),
    hashSection: document.getElementById('hash-section'),
    hashPrefix: document.getElementById('hash-prefix'),
    hashSuffix: document.getElementById('hash-suffix'),
    // 批量检查模式
    batchInput: document.getElementById('batch-input'),
    btnBatchCheck: document.getElementById('btn-batch-check'),
    btnBatchClear: document.getElementById('btn-batch-clear'),
    batchCount: document.getElementById('batch-count'),
    batchResultSection: document.getElementById('batch-result-section'),
    batchSummary: document.getElementById('batch-summary'),
    batchList: document.getElementById('batch-list'),
    btnBatchExport: document.getElementById('btn-batch-export'),
    // 邮箱泄露模式
    emailInput: document.getElementById('email-input'),
    btnEmailCheck: document.getElementById('btn-email-check'),
    hibpApikey: document.getElementById('hibp-apikey'),
    btnApikeyToggle: document.getElementById('btn-apikey-toggle'),
    emailResultSection: document.getElementById('email-result-section'),
    emailResultArea: document.getElementById('email-result-area'),
    // 历史记录模式
    historyList: document.getElementById('history-list'),
    btnHistoryRefresh: document.getElementById('btn-history-refresh'),
    toast: document.getElementById('toast')
  };
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


  // ==================== 工具函数 ====================

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }
  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function showToast(msg) {
    E.toast.textContent = msg;
    E.toast.className = 'toast toast--show';
    setTimeout(() => { E.toast.classList.remove('toast--show'); }, 2500);
  }

  // 历史记录保存（type: password/email/batch，data 视类型而定）
  async function saveToHistory(type, data) {
    try {
      await callBackground('saveToHistory', {
          toolId: 'password-leak-check',
          type: type,
          data: data
        });
    } catch (e) {}
  }

  // 格式化时间戳为可读字符串
  function formatTime(ts) {
    if (!ts) return '-';
    try {
      const d = new Date(ts);
      const pad = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
             ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    } catch (e) { return String(ts); }
  }

  // 邮箱格式校验
  function isValidEmail(email) {
    return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
  }

  // ==================== SHA-1 哈希 ====================

  async function sha1(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  // ==================== 密码强度评估 (Enhanced) ====================

  // Top 100 common weak passwords
  const WEAK_PASSWORDS = new Set([
    'password', '123456', '12345678', '1234', 'qwerty', '12345', 'dragon', 'pussy',
    'baseball', 'football', 'letmein', 'monkey', '696969', 'abc123', 'mustang',
    'michael', 'shadow', 'master', 'jennifer', '111111', '2000', 'jordan', 'superman',
    'harley', '1234567', 'hunter', 'fuckyou', 'trustno1', 'ranger', 'buster',
    'thomas', 'tiggr', 'robert', 'soccer', 'fuck', 'batman', 'test', 'pass',
    'killer', 'hockey', 'george', 'charlie', 'andrew', 'michelle', 'love', 'sunshine',
    'jessica', 'pepper', 'daniel', 'access', '123456789', '654321', 'joshua', 'maggie',
    'starwars', 'silver', 'william', 'dallas', 'yankees', '123123', 'ashley', '666666',
    'hello', 'charlie', 'donald', 'password1', 'qwerty123', 'admin', 'welcome',
    'login', 'princess', 'football', 'charlie123', 'admin123', 'letmein1', 'welcome1',
    '1234567890', 'password123', 'iloveyou', '000000', '123abc', '1q2w3e4r', 'aaaaaa',
    'qwertyuiop', 'zxcvbnm', 'asdfghjkl', 'mnbvcxz', 'poiuytrewq', 'lkjhgfdsa',
    'abcdef', 'abcdefg', 'abcdefgh', '123456789a', 'aa123456', 'password!', 'P@ssw0rd',
    'passw0rd', '123qwe', 'zxcvbn', 'qazwsx', '1qaz2wsx', 'qweasdzxc', 'zaq12wsx'
  ]);

  function evaluateStrength(pwd) {
    if (!pwd) return { level: 0, label: '-', details: [] };

    let score = 0;
    const details = [];
    const len = pwd.length;
    const hasLower = /[a-z]/.test(pwd);
    const hasUpper = /[A-Z]/.test(pwd);
    const hasDigit = /[0-9]/.test(pwd);
    const hasSymbol = /[^a-zA-Z0-9]/.test(pwd);
    const charsetCount = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;

    // Common password check
    if (WEAK_PASSWORDS.has(pwd.toLowerCase())) {
      details.push('⚠️ 该密码属于常见弱密码 Top 100');
      return { level: 1, label: '极弱 (常见密码)', details };
    }

    // Length scoring
    if (len < 6) { details.push('❌ 密码过短 (< 6位)'); }
    else if (len < 8) { details.push('⚠️ 密码长度不足8位'); score += 1; }
    else if (len < 12) { details.push('密码长度8-11位'); score += 2; }
    else if (len < 16) { details.push('✓ 密码长度12-15位'); score += 3; }
    else { details.push('✓ 密码长度 >= 16位'); score += 4; }

    // Character diversity
    if (hasLower) details.push('✓ 包含小写字母');
    if (hasUpper) details.push('✓ 包含大写字母');
    if (hasDigit) details.push('✓ 包含数字');
    if (hasSymbol) details.push('✓ 包含特殊字符');

    if (charsetCount >= 2) score += 1;
    if (charsetCount >= 3) score += 1;
    if (charsetCount >= 4) score += 1;
    if (charsetCount < 2) details.push('⚠️ 字符种类过少，建议混合使用大小写、数字、特殊字符');

    // Deductions
    if (/^\d+$/.test(pwd)) { score = Math.min(score, 2); details.push('❌ 纯数字密码'); }
    if (/^[a-z]+$/.test(pwd)) { score = Math.min(score, 2); details.push('❌ 纯字母密码'); }
    if (/(.)\1{2,}/.test(pwd)) { score -= 1; details.push('⚠️ 包含重复字符'); }
    if (/^(123|abc|qwe|asd|zxc)/i.test(pwd)) { score -= 1; details.push('⚠️ 包含常见序列'); }

    const level = Math.max(1, Math.min(5, score));
    const labels = ['', '极弱', '较弱', '中等', '良好', '极强'];
    return { level, label: labels[level], details };
  }

  function updateStrengthMeter() {
    const pwd = E.input.value;
    const result = evaluateStrength(pwd);
    E.meterFill.className = 'plc-meter__fill' + (result.level > 0 ? ' s' + result.level : '');
    E.strengthText.textContent = result.label;

    const colors = ['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981'];
    E.strengthText.style.color = result.level > 0 ? colors[result.level] : '';
  }

  // ==================== 密码生成器 ====================

  function generatePassword(length, options) {
    length = Math.max(8, Math.min(64, length || 16));
    const chars = [];
    if (options.lower !== false) chars.push('abcdefghijklmnopqrstuvwxyz');
    if (options.upper !== false) chars.push('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    if (options.digits !== false) chars.push('0123456789');
    if (options.symbols !== false) chars.push('!@#$%^&*()_+-=[]{}|;:,.<>?');
    if (chars.length === 0) chars.push('abcdefghijklmnopqrstuvwxyz');
    const allChars = chars.join('');
    let password = '';
    // Ensure at least one char from each selected set
    for (const set of chars) {
      password += set[Math.floor(Math.random() * set.length)];
    }
    for (let i = password.length; i < length; i++) {
      password += allChars[Math.floor(Math.random() * allChars.length)];
    }
    // Shuffle
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  function showPasswordGenerator() {
    const genSection = document.getElementById('plc-generator');
    if (genSection) { genSection.style.display = genSection.style.display === 'none' ? '' : 'none'; return; }
    const section = document.createElement('div');
    section.id = 'plc-generator';
    section.style.cssText = 'margin-top:12px;padding:12px;border:1px solid var(--tt-border);border-radius:8px;background:var(--tt-bg-secondary);';
    section.innerHTML = `
      <div style="font-weight:bold;margin-bottom:8px;">🔑 密码生成器</div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
        <label style="font-size:12px;">长度: <input type="number" id="plc-gen-len" value="16" min="8" max="64" style="width:50px;"></label>
        <label style="font-size:12px;"><input type="checkbox" id="plc-gen-upper" checked> 大写</label>
        <label style="font-size:12px;"><input type="checkbox" id="plc-gen-digits" checked> 数字</label>
        <label style="font-size:12px;"><input type="checkbox" id="plc-gen-symbols" checked> 特殊字符</label>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="text" id="plc-gen-output" readonly style="flex:1;font-family:monospace;padding:6px 8px;border:1px solid var(--tt-border);border-radius:4px;background:var(--tt-bg);color:var(--tt-text);">
        <button class="btn" id="plc-gen-btn" style="font-size:12px;padding:4px 10px;">生成</button>
        <button class="btn" id="plc-gen-copy" style="font-size:12px;padding:4px 10px;">📋</button>
        <button class="btn" id="plc-gen-use" style="font-size:12px;padding:4px 10px;">使用</button>
      </div>
    `;
    E.resultSection.parentElement.insertBefore(section, E.resultSection);

    const genBtn = document.getElementById('plc-gen-btn');
    const genOutput = document.getElementById('plc-gen-output');
    const genCopy = document.getElementById('plc-gen-copy');
    const genUse = document.getElementById('plc-gen-use');

    function doGenerate() {
      const len = parseInt(document.getElementById('plc-gen-len').value, 10) || 16;
      const pwd = generatePassword(len, {
        upper: document.getElementById('plc-gen-upper').checked,
        digits: document.getElementById('plc-gen-digits').checked,
        symbols: document.getElementById('plc-gen-symbols').checked
      });
      genOutput.value = pwd;
    }
    genBtn.addEventListener('click', doGenerate);
    genCopy.addEventListener('click', () => {
      navigator.clipboard.writeText(genOutput.value).then(() => showToast('已复制到剪贴板')).catch(() => showToast('复制失败'));
    });
    genUse.addEventListener('click', () => {
      E.input.value = genOutput.value;
      updateStrengthMeter();
      showToast('已填入密码');
    });
    doGenerate();
  }

  // ==================== 泄露检测 ====================

  function getSeverityLevel(count) {
    if (count <= 3) return { label: '低风险', cls: 'plc-severity--low' };
    if (count <= 50) return { label: '中风险', cls: 'plc-severity--medium' };
    if (count <= 500) return { label: '高风险', cls: 'plc-severity--high' };
    return { label: '极高风险', cls: 'plc-severity--critical' };
  }

  async function checkPassword() {
    const pwd = E.input.value;
    if (!pwd) {
      showToast('请输入密码');
      return;
    }

    // 显示加载状态
    E.resultSection.style.display = '';
    E.hashSection.style.display = 'none';
    E.resultArea.innerHTML = '<div class="plc-loading"><div class="plc-loading__spinner"></div><div class="plc-loading__text">正在检测密码泄露情况...</div></div>';

    try {
      // 1. SHA-1 哈希（完整密码不出本机，只上传前 5 位）
      const hash = await sha1(pwd);
      const prefix = hash.substring(0, 5);
      const suffix = hash.substring(5);

      // 2. 经 background 服务层查询（breach 类别，k-匿名模型）。
      //    之所以不再直接 fetch：接口地址应可被替换（自建 / 兼容 HIBP 的服务），
      //    且响应文本的解析已下沉到 provider，工具只消费归一化结果 { count }。
      const r = await callBackground('serviceRequest', {
        kind: 'breach',
        params: { mode: 'password', prefix, suffix }
      });
      if (!r || !r.success) throw new Error((r && r.error) || '泄露查询失败');
      const matchCount = (r.data && typeof r.data.count === 'number') ? r.data.count : 0;

      // 3. 显示哈希信息
      E.hashSection.style.display = '';
      E.hashPrefix.textContent = prefix;
      E.hashSuffix.textContent = suffix;

      // 4. 显示结果 (Enhanced with detailed breach info)
      if (matchCount === 0) {
        E.resultArea.innerHTML =
          '<div class="plc-result plc-result--safe">' +
            '<div class="plc-result__icon">✅</div>' +
            '<div class="plc-result__message">该密码未在已知泄露数据库中发现</div>' +
            '<div style="font-size:11px;color:var(--tt-text-secondary);margin-top:4px;">仅发送了 SHA-1 哈希前5位到 HIBP API，完整密码未离开本机</div>' +
          '</div>';
      } else {
        const severity = getSeverityLevel(matchCount);
        const breachDesc = matchCount <= 3 ? '少量泄露' : matchCount <= 50 ? '多次泄露' : matchCount <= 500 ? '大量泄露' : '极大量泄露';
        E.resultArea.innerHTML =
          '<div class="plc-result plc-result--leaked">' +
            '<div class="plc-result__icon">⚠️</div>' +
            '<div class="plc-result__message">该密码已在 <span class="plc-result__count">' + matchCount.toLocaleString() + '</span> 次数据泄露中出现！</div>' +
            '<span class="plc-severity ' + severity.cls + '">' + severity.label + '</span>' +
            '<div style="font-size:11px;color:var(--tt-text-secondary);margin-top:6px;">' +
              '<div>泄露程度: ' + breachDesc + '</div>' +
              '<div>该密码被 ' + matchCount.toLocaleString() + ' 个用户在不同网站使用，存在极高的被撞库攻击风险。</div>' +
              (matchCount > 100 ? '<div style="color:#ef4444;font-weight:bold;">⚠️ 强烈建议立即更换此密码！</div>' : '') +
            '</div>' +
          '</div>' +
          '<button class="btn" id="plc-gen-trigger" style="margin-top:8px;font-size:12px;padding:4px 10px;">🔑 生成安全密码</button>';
        const genTrigger = document.getElementById('plc-gen-trigger');
        if (genTrigger) genTrigger.addEventListener('click', showPasswordGenerator);
      }

      saveToHistory('password', {
        leaked: matchCount > 0,
        count: matchCount,
        hashPrefix: prefix,
        severity: matchCount > 0 ? getSeverityLevel(matchCount).label : '安全'
      });

    } catch (e) {
      E.resultArea.innerHTML =
        '<div class="plc-result plc-result--leaked">' +
          '<div class="plc-result__icon">❌</div>' +
          '<div class="plc-result__message">检测失败: ' + escapeHtml(e.message) + '</div>' +
        '</div>';
      E.hashSection.style.display = 'none';
    }
  }

  // ==================== 批量检查 ====================

  // 检查单个密码泄露次数（经 background 服务层的 breach 类别），返回 { count, hashPrefix }
  // k-匿名模型要求同时提交前缀与后缀：服务端只按前缀返回一批后缀计数，
  // 本地再用后缀定位目标密码。旧实现漏传后缀（引用了未定义变量），
  // 导致批量检测的每一项都在抛错后被记为"检测失败"。
  async function checkSinglePasswordHash(pwd) {
    const hash = await sha1(pwd);
    const prefix = hash.substring(0, 5);
    const suffix = hash.substring(5);
    const r = await callBackground('serviceRequest', {
      kind: 'breach',
      params: { mode: 'password', prefix, suffix }
    });
    if (!r || !r.success) throw new Error((r && r.error) || '泄露查询失败');
    const count = (r.data && typeof r.data.count === 'number') ? r.data.count : 0;
    return { count, hashPrefix: prefix };
  }

  // 更新批量输入计数
  function updateBatchCount() {
    if (!E.batchInput) return;
    const lines = E.batchInput.value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (E.batchCount) E.batchCount.textContent = lines.length + ' 个密码';
  }

  // 批量检测主流程
  let batchResultsCache = [];
  async function runBatchCheck() {
    if (!E.batchInput) return;
    const passwords = E.batchInput.value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (passwords.length === 0) {
      showToast('请输入至少一个密码');
      return;
    }
    if (passwords.length > 50) {
      showToast('为避免 API 限流，单次最多检查 50 个密码');
      return;
    }

    E.batchResultSection.style.display = '';
    E.batchSummary.innerHTML = '<div class="plc-loading"><div class="plc-loading__spinner"></div><div class="plc-loading__text">正在检测 0/' + passwords.length + ' ...</div></div>';
    E.batchList.innerHTML = '';

    batchResultsCache = [];
    let safeCount = 0, leakCount = 0;

    for (let i = 0; i < passwords.length; i++) {
      const pwd = passwords[i];
      // 更新进度
      E.batchSummary.querySelector('.plc-loading__text').textContent = '正在检测 ' + (i + 1) + '/' + passwords.length + ' ...';
      try {
        const result = await checkSinglePasswordHash(pwd);
        const severity = result.count > 0 ? getSeverityLevel(result.count) : null;
        batchResultsCache.push({
          password: pwd,
          count: result.count,
          hashPrefix: result.hashPrefix,
          severity: severity ? severity.label : '安全'
        });
        if (result.count > 0) leakCount++; else safeCount++;
      } catch (e) {
        batchResultsCache.push({
          password: pwd,
          count: -1,
          hashPrefix: '',
          severity: '检测失败',
          error: e.message
        });
      }
    }

    // 渲染汇总
    E.batchSummary.innerHTML =
      '<div class="plc-batch-stat plc-batch-stat--total"><div class="plc-batch-stat__num">' + passwords.length + '</div><div class="plc-batch-stat__label">总计</div></div>' +
      '<div class="plc-batch-stat plc-batch-stat--safe"><div class="plc-batch-stat__num">' + safeCount + '</div><div class="plc-batch-stat__label">未泄露</div></div>' +
      '<div class="plc-batch-stat plc-batch-stat--leak"><div class="plc-batch-stat__num">' + leakCount + '</div><div class="plc-batch-stat__label">已泄露</div></div>';

    // 渲染列表
    E.batchList.innerHTML = batchResultsCache.map(r => {
      const isLeak = r.count > 0;
      const isFail = r.count === -1;
      const cls = isFail ? '' : (isLeak ? 'plc-batch-item--leak' : 'plc-batch-item--safe');
      const countCls = isLeak ? '' : 'plc-batch-item__count--safe';
      const countText = isFail ? '失败' : (isLeak ? r.count.toLocaleString() + ' 次' : '未泄露');
      const sevBadge = isLeak ? '<span class="plc-batch-item__sev plc-severity ' + getSeverityLevel(r.count).cls + '">' + r.severity + '</span>' : '';
      return '<div class="plc-batch-item ' + cls + '">' +
        '<span class="plc-batch-item__pwd" title="' + escapeAttr(r.password) + '">' + escapeHtml(r.password) + '</span>' +
        '<span class="plc-batch-item__count ' + countCls + '">' + countText + '</span>' +
        sevBadge +
      '</div>';
    }).join('');

    // 保存历史
    saveToHistory('batch', {
      total: passwords.length,
      safe: safeCount,
      leaked: leakCount
    });

    showToast('批量检测完成：' + leakCount + ' 个泄露，' + safeCount + ' 个安全');
  }

  // 导出批量结果为 JSON
  function exportBatchJSON() {
    if (batchResultsCache.length === 0) {
      showToast('暂无可导出的结果');
      return;
    }
    const report = {
      tool: 'password-leak-check',
      mode: 'batch',
      scanTime: new Date().toISOString(),
      total: batchResultsCache.length,
      results: batchResultsCache.map(r => ({
        password: r.password,
        leaked: r.count > 0,
        count: r.count,
        severity: r.severity,
        hashPrefix: r.hashPrefix
      }))
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'password-batch-check-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('已导出 JSON 报告');
  }

  // ==================== 邮箱泄露检查 ====================

  async function checkEmailBreach() {
    const email = (E.emailInput.value || '').trim();
    if (!email) {
      showToast('请输入邮箱地址');
      return;
    }
    if (!isValidEmail(email)) {
      showToast('邮箱格式不正确');
      return;
    }

    const apiKey = (E.hibpApikey.value || '').trim();
    E.emailResultSection.style.display = '';
    E.emailResultArea.innerHTML = '<div class="plc-loading"><div class="plc-loading__spinner"></div><div class="plc-loading__text">正在查询邮箱泄露情况...</div></div>';

    // 无 API Key：跳转 HIBP 官网查询（CORS 限制无法直接调用 v3 API）
    if (!apiKey) {
      E.emailResultArea.innerHTML =
        '<div class="plc-result plc-result--leaked" style="background:var(--tt-bg);border:1px solid var(--tt-border);border-radius:8px;">' +
          '<div class="plc-result__icon">🔗</div>' +
          '<div class="plc-result__message" style="color:var(--tt-text);">未填写 HIBP API Key</div>' +
          '<div style="font-size:12px;color:var(--tt-text-secondary);line-height:1.6;text-align:left;margin-top:6px;">' +
            'HIBP v3 API 要求提供 API Key 才能查询邮箱泄露。<br>' +
            '您可以通过以下方式查询：<br>' +
            '1. 前往 <a href="https://haveibeenpwned.com" target="_blank" rel="noopener" style="color:var(--tt-primary);">haveibeenpwned.com</a> 官网直接查询<br>' +
            '2. 在 <a href="https://haveibeenpwned.com/API/Key" target="_blank" rel="noopener" style="color:var(--tt-primary);">HIBP API Key</a> 页面购买 API Key 后填入上方输入框' +
          '</div>' +
          '<button class="btn btn--primary" id="btn-open-hibp" style="margin-top:10px;">🌐 前往 HIBP 官网查询</button>' +
        '</div>';
      const openBtn = document.getElementById('btn-open-hibp');
      if (openBtn) {
        openBtn.addEventListener('click', () => {
          window.open('https://haveibeenpwned.com/account/' + encodeURIComponent(email), '_blank', 'noopener');
        });
      }
      return;
    }

    // 有 API Key：经 background 服务层查询（breach 类别，邮箱模式）
    try {
      // 邮箱泄露查询同样改走服务层：接口地址与 API Key 由「设置 → 服务端点」统一配置，
      // 工具侧此处仅做前置校验以提前给出友好提示。响应已归一化为 { breaches: [...] }，
      // 404（未泄露）也由 provider 归一化为空数组，工具无需再判断 HTTP 状态码。
      const r = await callBackground('serviceRequest', {
        kind: 'breach',
        params: { mode: 'email', email }
      });
      if (!r || !r.success) throw new Error((r && r.error) || '邮箱泄露查询失败');
      const breaches = (r.data && Array.isArray(r.data.breaches)) ? r.data.breaches : [];

      if (breaches.length === 0) {
        E.emailResultArea.innerHTML =
          '<div class="plc-result plc-result--safe">' +
            '<div class="plc-result__icon">✅</div>' +
            '<div class="plc-result__message">该邮箱未在已知数据泄露事件中出现</div>' +
          '</div>';
        saveToHistory('email', { email: email, leaked: false, breachCount: 0 });
        return;
      }

      // 渲染泄露事件列表（字段取自归一化契约 name/title/domain/breachDate/dataClasses）
      const totalBreaches = breaches.length;
      E.emailResultArea.innerHTML =
        '<div class="plc-result plc-result--leaked" style="margin-bottom:12px;">' +
          '<div class="plc-result__icon">⚠️</div>' +
          '<div class="plc-result__message">该邮箱在 <span class="plc-result__count">' + totalBreaches + '</span> 次数据泄露事件中出现！</div>' +
        '</div>' +
        breaches.map(b => {
          const date = b.breachDate || '-';
          const domain = b.domain || '';
          const title = escapeHtml(b.title || b.name || '未知');
          const dataClasses = Array.isArray(b.dataClasses) ? b.dataClasses.map(dc => '<span class="plc-breach-type">' + escapeHtml(dc) + '</span>').join('') : '';
          return '<div class="plc-breach-item">' +
            '<div class="plc-breach-head">' +
              '<span class="plc-breach-name">' + title + '</span>' +
              '<span class="plc-breach-date">📅 ' + escapeHtml(date) + '</span>' +
              (domain ? '<span class="plc-breach-date">🌐 ' + escapeHtml(domain) + '</span>' : '') +
            '</div>' +
            (domain ? '<div class="plc-breach-domains">来源域名: ' + escapeHtml(domain) + '</div>' : '') +
            '<div class="plc-breach-types">' + dataClasses + '</div>' +
          '</div>';
        }).join('');

      saveToHistory('email', { email: email, leaked: true, breachCount: totalBreaches });

    } catch (e) {
      E.emailResultArea.innerHTML =
        '<div class="plc-result plc-result--leaked">' +
          '<div class="plc-result__icon">❌</div>' +
          '<div class="plc-result__message">查询失败: ' + escapeHtml(e.message) + '</div>' +
        '</div>';
    }
  }

  // ==================== 历史记录加载 ====================

  async function loadHistory() {
    if (!E.historyList) return;
    E.historyList.innerHTML = '<div class="plc-loading"><div class="plc-loading__spinner"></div><div class="plc-loading__text">正在加载历史记录...</div></div>';
    try {
      const resp = await callBackground('getHistory', { toolId: 'password-leak-check', limit: 50 });
      const items = (resp && resp.success && Array.isArray(resp.data)) ? resp.data : (Array.isArray(resp) ? resp : []);
      if (items.length === 0) {
        E.historyList.innerHTML = '<div class="plc-empty">暂无检查记录</div>';
        return;
      }
      E.historyList.innerHTML = items.map(item => {
        const type = item.type || 'check';
        const data = item.data || {};
        const ts = formatTime(item.timestamp);
        let icon = '🔍', title = '检查记录', meta = ts, countHtml = '', leakCls = '';
        if (type === 'password') {
          if (data.leaked) {
            icon = '⚠️';
            title = '密码泄露检查';
            countHtml = '<span class="plc-history-item__count">' + (data.count || 0).toLocaleString() + ' 次</span>';
            leakCls = 'plc-history-item--leak';
          } else {
            icon = '✅';
            title = '密码泄露检查';
            countHtml = '<span class="plc-history-item__count" style="color:#22c55e;">未泄露</span>';
            leakCls = 'plc-history-item--safe';
          }
          meta = ts + (data.severity ? ' · ' + data.severity : '');
        } else if (type === 'email') {
          if (data.leaked) {
            icon = '📧⚠️';
            title = '邮箱泄露检查 · ' + (data.email || '');
            countHtml = '<span class="plc-history-item__count">' + (data.breachCount || 0) + ' 个事件</span>';
            leakCls = 'plc-history-item--leak';
          } else {
            icon = '📧✅';
            title = '邮箱泄露检查 · ' + (data.email || '');
            countHtml = '<span class="plc-history-item__count" style="color:#22c55e;">未泄露</span>';
            leakCls = 'plc-history-item--safe';
          }
        } else if (type === 'batch') {
          icon = '📚';
          title = '批量检查';
          const safe = data.safe || 0, leaked = data.leaked || 0, total = data.total || 0;
          countHtml = '<span class="plc-history-item__count">泄露 ' + leaked + '/' + total + '</span>';
          leakCls = leaked > 0 ? 'plc-history-item--leak' : 'plc-history-item--safe';
          meta = ts + ' · 共 ' + total + ' 个 · 安全 ' + safe + ' · 泄露 ' + leaked;
        }
        return '<div class="plc-history-item ' + leakCls + '">' +
          '<span class="plc-history-item__icon">' + icon + '</span>' +
          '<div class="plc-history-item__body">' +
            '<div class="plc-history-item__title">' + escapeHtml(title) + '</div>' +
            '<div class="plc-history-item__meta">' + escapeHtml(meta) + '</div>' +
          '</div>' +
          countHtml +
        '</div>';
      }).join('');
    } catch (e) {
      E.historyList.innerHTML = '<div class="plc-empty">加载失败: ' + escapeHtml(e.message) + '</div>';
    }
  }

  // ==================== 模式切换 ====================

  function switchMode(mode) {
    document.querySelectorAll('.plc-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.mode === mode);
    });
    document.querySelectorAll('.plc-mode').forEach(m => {
      m.style.display = 'none';
    });
    const target = document.getElementById('mode-' + mode);
    if (target) target.style.display = 'flex';
    // 切换到历史模式时自动加载
    if (mode === 'history') loadHistory();
  }

  // ==================== 事件绑定 ====================

  E.btnCheck.addEventListener('click', checkPassword);

  E.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') checkPassword();
  });

  E.btnToggle.addEventListener('click', () => {
    if (E.input.type === 'password') {
      E.input.type = 'text';
      E.btnToggle.textContent = '🙈';
    } else {
      E.input.type = 'password';
      E.btnToggle.textContent = '👁';
    }
  });

  E.input.addEventListener('input', updateStrengthMeter);

  // ===== 模式切换 Tab =====
  document.querySelectorAll('.plc-tab').forEach(tab => {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  });

  // ===== 批量检查 =====
  if (E.btnBatchCheck) E.btnBatchCheck.addEventListener('click', runBatchCheck);
  if (E.btnBatchClear) {
    E.btnBatchClear.addEventListener('click', () => {
      if (E.batchInput) {
        E.batchInput.value = '';
        updateBatchCount();
        if (E.batchResultSection) E.batchResultSection.style.display = 'none';
        batchResultsCache = [];
      }
    });
  }
  if (E.batchInput) {
    E.batchInput.addEventListener('input', updateBatchCount);
  }
  if (E.btnBatchExport) E.btnBatchExport.addEventListener('click', exportBatchJSON);

  // ===== 邮箱泄露检查 =====
  if (E.btnEmailCheck) E.btnEmailCheck.addEventListener('click', checkEmailBreach);
  if (E.emailInput) {
    E.emailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') checkEmailBreach();
    });
  }
  if (E.btnApikeyToggle) {
    E.btnApikeyToggle.addEventListener('click', () => {
      if (E.hibpApikey.type === 'password') {
        E.hibpApikey.type = 'text';
        E.btnApikeyToggle.textContent = '🙈';
      } else {
        E.hibpApikey.type = 'password';
        E.btnApikeyToggle.textContent = '👁';
      }
    });
  }

  // ===== 历史记录 =====
  if (E.btnHistoryRefresh) E.btnHistoryRefresh.addEventListener('click', loadHistory);

  // 初始化强度条
  updateStrengthMeter();
  // 初始化批量计数
  updateBatchCount();
});

// 主题切换和 setData 消息监听
window.addEventListener('message', function(event) {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!event.data || event.source !== window.parent) return;
  if (event.data && event.data.action === 'setTheme' && event.data.data) {
    document.documentElement.setAttribute('data-theme', event.data.data.theme);
  }
  if (event.data && event.data.action === 'setData') {
    const input = document.getElementById('pwd-input');
    if (input && typeof event.data.data === 'string') {
      input.value = event.data.data;
      input.dispatchEvent(new Event('input'));
    }
  }
});
