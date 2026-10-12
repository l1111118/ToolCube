/**
 * CURL 命令生成器
 * - 可视化构造 cURL 命令
 * - 支持 headers / body (json/form/urlencoded/raw) / 高级选项
 * - 可在浏览器内执行 (fetch) 测试
 * @version 1.3.0
 */
(function () {
  'use strict';

  window.addEventListener('message',function(e){
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）
if(!e.data||e.source!==window.parent)return;if(e.data&&e.data.action==='setTheme'&&e.data.data)document.documentElement.setAttribute('data-theme',e.data.data.theme);});

  // ── 与后台通信 ──
  // 「执行测试」此前用工具页直连 fetch：既受工具页 CORS 限制（跨域目标会失败），
  // 也绕过了扩展唯一的网络出口。现统一经后台 fetchUrl 代理。
  let _msgId = 0;
  const _pending = new Map();
  function callBackground(action, data) {
    return new Promise((resolve, reject) => {
      const id = ++_msgId;
      const timer = setTimeout(() => { _pending.delete(id); reject(new Error('请求超时')); }, 65000);
      _pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ action: 'callBackground', data: { id, action, data } }, '*');
    });
  }
  window.addEventListener('message', function (e) {
      if (e.origin !== location.origin) return;
    if (!e.data || e.source !== window.parent) return;
    if (e.data.action !== '__bgResponse') return;
    const d = e.data.data;
    if (!d || d.__id === undefined) return;
    const p = _pending.get(d.__id);
    if (!p) return;
    _pending.delete(d.__id);
    clearTimeout(p.timer);
    const r = d.result;
    if (r && r.success === false && r.error) p.reject(new Error(r.error));
    else p.resolve(r);
  });

  // 状态
  const state = {
    method: 'POST',
    url: '',
    headers: [
      { key: 'User-Agent', value: 'ToolCube/1.0', enabled: true }
    ],
    bodyType: 'none',
    bodyJson: '',
    bodyRaw: '',
    formFields: [{ key: '', value: '', enabled: true }],
    urlFields: [{ key: '', value: '', enabled: true }],
    opts: {
      follow: false,
      insecure: true,
      verbose: false,
      showError: false,
      compressed: false,
      timeout: 30
    }
  };

  // DOM
  const E = {
    methodSelect: document.getElementById('method-select'),
    urlInput: document.getElementById('url-input'),
    headersList: document.getElementById('headers-list'),
    btnAddHeader: document.getElementById('btn-add-header'),
    bodySection: document.getElementById('body-section'),
    bodyJson: document.getElementById('body-json'),
    bodyRaw: document.getElementById('body-raw'),
    formFields: document.getElementById('form-fields'),
    urlFields: document.getElementById('url-fields'),
    btnAddForm: document.getElementById('btn-add-form'),
    btnAddUrl: document.getElementById('btn-add-url'),
    optFollow: document.getElementById('opt-follow'),
    optInsecure: document.getElementById('opt-insecure'),
    optVerbose: document.getElementById('opt-verbose'),
    optShowError: document.getElementById('opt-show-error'),
    optCompressed: document.getElementById('opt-compressed'),
    optTimeout: document.getElementById('opt-timeout'),
    curlOutput: document.getElementById('curl-output'),
    btnCopy: document.getElementById('btn-copy'),
    btnReset: document.getElementById('btn-reset'),
    btnExecute: document.getElementById('btn-execute'),
    execStatus: document.getElementById('exec-status'),
    execResult: document.getElementById('exec-result'),
    tabs: document.querySelectorAll('.cg-tab'),
    panes: document.querySelectorAll('.cg-body-pane')
  };

  // ==================== 渲染 ====================

  function renderHeaders() {
    E.headersList.innerHTML = state.headers.map((h, i) =>
      '<div class="cg-hdr-row">' +
        '<label style="display:flex;align-items:center"><input type="checkbox" data-hdr-enabled="' + i + '"' + (h.enabled ? ' checked' : '') + '></label>' +
        '<input type="text" placeholder="Header" value="' + escapeAttr(h.key) + '" data-hdr-key="' + i + '">' +
        '<input type="text" placeholder="Value" value="' + escapeAttr(h.value) + '" data-hdr-val="' + i + '">' +
        '<button class="cg-btn-del" data-hdr-del="' + i + '">删除</button>' +
      '</div>'
    ).join('');
  }

  function renderFormList(container, fields, prefix) {
    container.innerHTML = fields.map((f, i) =>
      '<div class="cg-hdr-row">' +
        '<label style="display:flex;align-items:center"><input type="checkbox" data-' + prefix + '-en="' + i + '"' + (f.enabled ? ' checked' : '') + '></label>' +
        '<input type="text" placeholder="key" value="' + escapeAttr(f.key) + '" data-' + prefix + '-k="' + i + '">' +
        '<input type="text" placeholder="value" value="' + escapeAttr(f.value) + '" data-' + prefix + '-v="' + i + '">' +
        '<button class="cg-btn-del" data-' + prefix + '-del="' + i + '">删除</button>' +
      '</div>'
    ).join('');
  }

  function renderAll() {
    renderHeaders();
    renderFormList(E.formFields, state.formFields, 'frm');
    renderFormList(E.urlFields, state.urlFields, 'url');
    updateCurl();
  }

  // ==================== 生成 CURL ====================

  function updateCurl() {
    const parts = [];
    parts.push('curl -X ' + state.method);

    // URL
    const url = state.url.trim();
    if (url) {
      parts.push(shellQuote(url));
    } else {
      parts.push('""');
    }

    // Headers
    state.headers.forEach(h => {
      if (h.enabled && h.key.trim()) {
        parts.push('-H ' + shellQuote(h.key + ': ' + h.value));
      }
    });

    // Body
    if (state.bodyType === 'json' && state.bodyJson.trim()) {
      parts.push('-H ' + shellQuote('Content-Type: application/json'));
      parts.push('--data-raw ' + shellQuote(state.bodyJson));
    } else if (state.bodyType === 'raw' && state.bodyRaw.trim()) {
      parts.push('--data-raw ' + shellQuote(state.bodyRaw));
    } else if (state.bodyType === 'form') {
      state.formFields.forEach(f => {
        if (f.enabled && f.key.trim()) {
          parts.push('-F ' + shellQuote(f.key + '=' + f.value));
        }
      });
    } else if (state.bodyType === 'urlencoded') {
      state.urlFields.forEach(f => {
        if (f.enabled && f.key.trim()) {
          parts.push('--data-urlencode ' + shellQuote(f.key + '=' + f.value));
        }
      });
    }

    // Options
    if (state.opts.follow) parts.push('-L');
    if (state.opts.insecure) parts.push('-k');
    if (state.opts.verbose) parts.push('-v');
    if (state.opts.showError) parts.push('--show-error');
    if (state.opts.compressed) parts.push('--compressed');
    if (state.opts.timeout > 0) parts.push('--max-time ' + state.opts.timeout);

    E.curlOutput.textContent = parts.join(' \\\n  ');
    updateBodyVisibility();
  }

  function updateBodyVisibility() {
    const m = state.method;
    const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(m);
    E.bodySection.style.opacity = hasBody ? '1' : '0.5';
    E.bodySection.style.pointerEvents = hasBody ? 'auto' : 'none';
  }

  // ==================== 执行 (fetch) ====================

  async function executeRequest() {
    if (!state.url.trim()) {
      setStatus('请填写 URL', 'error');
      return;
    }
    setStatus('执行中...', '');
    E.execResult.textContent = '';
    const startTime = Date.now();

    const headers = {};
    state.headers.forEach(h => {
      if (h.enabled && h.key.trim()) {
        headers[h.key] = h.value;
      }
    });

    let body = undefined;
    if (state.bodyType === 'json' && state.bodyJson.trim()) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      body = state.bodyJson;
    } else if (state.bodyType === 'raw' && state.bodyRaw.trim()) {
      body = state.bodyRaw;
    } else if (state.bodyType === 'urlencoded') {
      const params = new URLSearchParams();
      state.urlFields.forEach(f => {
        if (f.enabled && f.key.trim()) params.append(f.key, f.value);
      });
      headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded';
      body = params.toString();
    } else if (state.bodyType === 'form') {
      // fetch 不直接支持 multipart，回退到 json 提示
      setStatus('注意: 浏览器 fetch 不支持 multipart/form-data, 请改用 JSON 或 urlencoded', 'error');
      return;
    }

    try {
      // 经后台 fetchUrl 代理执行：绕过工具页 CORS 限制，并统一走扩展的网络出口。
      // fetchUrl 的 GET/HEAD 不带 body，其他方法按需携带。
      const r = await callBackground('fetchUrl', {
        url: state.url,
        method: state.method,
        headers,
        body: (state.method !== 'GET' && state.method !== 'HEAD') ? body : null,
        timeout: state.opts.timeout > 0 ? state.opts.timeout * 1000 : 30000
      });
      if (!r || !r.success) {
        const msg = (r && r.error) || '请求失败';
        E.execResult.textContent = '错误: ' + msg;
        setStatus('✗ ' + msg, 'error');
        return;
      }
      const elapsed = r.duration || (Date.now() - startTime);
      let bodyOut = r.body || '';
      try {
        const json = JSON.parse(bodyOut);
        bodyOut = JSON.stringify(json, null, 2);
      } catch (e) { /* not json */ }
      const out = [
        'HTTP ' + r.status + ' ' + r.statusText,
        '耗时: ' + elapsed + ' ms',
        r.finalUrl && r.finalUrl !== state.url ? '最终地址: ' + r.finalUrl : '',
        '',
        'Response Headers:',
        r.rawHeaders || formatHeaders(r.headers),
        '',
        'Body:',
        bodyOut
      ].filter(Boolean).join('\n');
      E.execResult.textContent = out;
      setStatus('✓ ' + r.status + ' ' + r.statusText + ' (' + elapsed + 'ms)', 'success');
    } catch (e) {
      const msg = /超时/.test(e.message) ? '请求超时 (' + state.opts.timeout + 's)' : e.message;
      E.execResult.textContent = '错误: ' + msg;
      setStatus('✗ ' + msg, 'error');
    }
  }

  function formatHeaders(h) {
    const out = [];
    if (h && typeof h.forEach === 'function') {
      h.forEach((v, k) => out.push(k + ': ' + v));
    } else if (h && typeof h === 'object') {
      for (const [k, v] of Object.entries(h)) out.push(k + ': ' + v);
    }
    return out.join('\n');
  }

  function setStatus(msg, type) {
    E.execStatus.textContent = msg;
    E.execStatus.className = 'cg-status ' + (type || '');
  }

  // ==================== 工具函数 ====================

  function shellQuote(s) {
    if (s == null) return '""';
    s = String(s);
    if (s === '') return '""';
    // 使用单引号包裹，转义内部的单引号
    return "'" + s.replace(/'/g, "'\\''") + "'";
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  // ==================== 事件绑定 ====================

  E.methodSelect.addEventListener('change', e => {
    state.method = e.target.value;
    updateCurl();
  });

  E.urlInput.addEventListener('input', e => {
    state.url = e.target.value;
    updateCurl();
  });

  // 监听 headers / form / url 字段变化
  document.addEventListener('input', e => {
    const t = e.target;
    if (!t.dataset) return;

    if (t.dataset.hdrKey != null) {
      state.headers[+t.dataset.hdrKey].key = t.value;
      updateCurl();
    } else if (t.dataset.hdrVal != null) {
      state.headers[+t.dataset.hdrVal].value = t.value;
      updateCurl();
    } else if (t.dataset.frmK != null) {
      state.formFields[+t.dataset.frmK].key = t.value;
      updateCurl();
    } else if (t.dataset.frmV != null) {
      state.formFields[+t.dataset.frmV].value = t.value;
      updateCurl();
    } else if (t.dataset.urlK != null) {
      state.urlFields[+t.dataset.urlK].key = t.value;
      updateCurl();
    } else if (t.dataset.urlV != null) {
      state.urlFields[+t.dataset.urlV].value = t.value;
      updateCurl();
    } else if (t.id === 'body-json') {
      state.bodyJson = t.value;
      updateCurl();
    } else if (t.id === 'body-raw') {
      state.bodyRaw = t.value;
      updateCurl();
    }
  });

  document.addEventListener('change', e => {
    const t = e.target;
    if (!t.dataset) return;
    if (t.dataset.hdrEnabled != null) {
      state.headers[+t.dataset.hdrEnabled].enabled = t.checked;
      updateCurl();
    } else if (t.dataset.frmEn != null) {
      state.formFields[+t.dataset.frmEn].enabled = t.checked;
      updateCurl();
    } else if (t.dataset.urlEn != null) {
      state.urlFields[+t.dataset.urlEn].enabled = t.checked;
      updateCurl();
    }
  });

  // 删除按钮
  document.addEventListener('click', e => {
    const t = e.target;
    if (t.dataset.hdrDel != null) {
      state.headers.splice(+t.dataset.hdrDel, 1);
      renderAll();
    } else if (t.dataset.frmDel != null) {
      state.formFields.splice(+t.dataset.frmDel, 1);
      renderAll();
    } else if (t.dataset.urlDel != null) {
      state.urlFields.splice(+t.dataset.urlDel, 1);
      renderAll();
    }
  });

  E.btnAddHeader.addEventListener('click', () => {
    state.headers.push({ key: '', value: '', enabled: true });
    renderAll();
  });
  E.btnAddForm.addEventListener('click', () => {
    state.formFields.push({ key: '', value: '', enabled: true });
    renderAll();
  });
  E.btnAddUrl.addEventListener('click', () => {
    state.urlFields.push({ key: '', value: '', enabled: true });
    renderAll();
  });

  // 切换 body 类型
  E.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      E.tabs.forEach(t => t.classList.remove('cg-tab--active'));
      tab.classList.add('cg-tab--active');
      const type = tab.dataset.type;
      state.bodyType = type;
      E.panes.forEach(p => {
        p.classList.toggle('cg-body-pane--active', p.dataset.pane === type);
      });
      updateCurl();
    });
  });

  // 选项
  ['optFollow', 'optInsecure', 'optVerbose', 'optShowError', 'optCompressed'].forEach((id, i) => {
    const keys = ['follow', 'insecure', 'verbose', 'showError', 'compressed'];
    E[id].addEventListener('change', e => {
      state.opts[keys[i]] = e.target.checked;
      updateCurl();
    });
  });
  E.optTimeout.addEventListener('input', e => {
    state.opts.timeout = parseInt(e.target.value, 10) || 0;
    updateCurl();
  });

  // 复制
  E.btnCopy.addEventListener('click', () => {
    const text = E.curlOutput.textContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      E.btnCopy.textContent = '✓ 已复制';
      setTimeout(() => { E.btnCopy.innerHTML = '📋 复制'; }, 1500);
    }).catch(() => {
      E.btnCopy.textContent = '✗ 复制失败';
    });
  });

  // 重置
  E.btnReset.addEventListener('click', () => {
    if (!confirm('确定重置所有字段吗？')) return;
    state.url = '';
    state.headers = [{ key: 'User-Agent', value: 'ToolCube/1.0', enabled: true }];
    state.bodyType = 'none';
    state.bodyJson = '';
    state.bodyRaw = '';
    state.formFields = [{ key: '', value: '', enabled: true }];
    state.urlFields = [{ key: '', value: '', enabled: true }];
    E.urlInput.value = '';
    E.bodyJson.value = '';
    E.bodyRaw.value = '';
    E.tabs[0].click();
    renderAll();
  });

  // 执行
  E.btnExecute.addEventListener('click', executeRequest);

  // ==================== cURL 解析 (双向转换) ====================

  function parseCurlCommand(cmd) {
    cmd = cmd.trim();
    if (!cmd.startsWith('curl')) return null;
    const result = { method: 'GET', url: '', headers: [], bodyType: 'none', bodyJson: '', bodyRaw: '', formFields: [], urlFields: [], opts: {} };
    // Tokenize respecting quotes
    const tokens = [];
    let current = '', inQuote = false, quoteChar = '';
    for (let i = 0; i < cmd.length; i++) {
      const c = cmd[i];
      if (inQuote) { if (c === quoteChar) inQuote = false; else current += c; continue; }
      if (c === '"' || c === "'") { inQuote = true; quoteChar = c; continue; }
      if (c === '\\' && i + 1 < cmd.length) { current += cmd[++i]; continue; }
      if (/\s/.test(c)) { if (current) { tokens.push(current); current = ''; } continue; }
      current += c;
    }
    if (current) tokens.push(current);

    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === '-X' && tokens[i+1]) { result.method = tokens[++i]; }
      else if (t === '-H' && tokens[i+1]) { const h = tokens[++i]; const ci = h.indexOf(':'); if (ci > 0) result.headers.push({ key: h.substring(0, ci).trim(), value: h.substring(ci+1).trim(), enabled: true }); }
      else if (t === '-d' || t === '--data' || t === '--data-raw') { result.bodyRaw = tokens[++i] || ''; result.bodyType = 'raw'; try { JSON.parse(result.bodyRaw); result.bodyJson = result.bodyRaw; result.bodyType = 'json'; } catch(e){} }
      else if (t === '--data-urlencode' && tokens[i+1]) { const f = tokens[++i]; const eq = f.indexOf('='); result.urlFields.push({ key: eq > 0 ? f.substring(0, eq) : f, value: eq > 0 ? f.substring(eq+1) : '', enabled: true }); result.bodyType = 'urlencoded'; }
      else if (t === '-F' && tokens[i+1]) { const f = tokens[++i]; const eq = f.indexOf('='); result.formFields.push({ key: eq > 0 ? f.substring(0, eq) : f, value: eq > 0 ? f.substring(eq+1) : '', enabled: true }); result.bodyType = 'form'; }
      else if (t === '-L' || t === '--location') { result.opts.follow = true; }
      else if (t === '-k' || t === '--insecure') { result.opts.insecure = true; }
      else if (t === '-v' || t === '--verbose') { result.opts.verbose = true; }
      else if (t === '--compressed') { result.opts.compressed = true; }
      else if (t === '--max-time' && tokens[i+1]) { result.opts.timeout = parseInt(tokens[++i], 10) || 0; }
      else if (!t.startsWith('-') && !result.url) { result.url = t; }
    }
    return result;
  }

  // 从cURL命令导入
  var btnImport = document.getElementById('btn-import-curl');
  var curlImportArea = document.getElementById('curl-import-area');
  if (btnImport && curlImportArea) {
    btnImport.addEventListener('click', function() {
      var cmd = curlImportArea.value.trim();
      if (!cmd) return;
      var parsed = parseCurlCommand(cmd);
      if (!parsed) { setStatus('无法解析cURL命令', 'error'); return; }
      state.method = parsed.method;
      state.url = parsed.url;
      state.headers = parsed.headers.length ? parsed.headers : state.headers;
      state.bodyType = parsed.bodyType;
      state.bodyJson = parsed.bodyJson;
      state.bodyRaw = parsed.bodyRaw;
      state.formFields = parsed.formFields.length ? parsed.formFields : state.formFields;
      state.urlFields = parsed.urlFields.length ? parsed.urlFields : state.urlFields;
      if (parsed.opts) Object.assign(state.opts, parsed.opts);
      E.urlInput.value = state.url;
      E.bodyJson.value = state.bodyJson;
      E.bodyRaw.value = state.bodyRaw;
      if (state.opts.follow) E.optFollow.checked = true;
      if (state.opts.insecure) E.optInsecure.checked = true;
      if (state.opts.verbose) E.optVerbose.checked = true;
      if (state.opts.compressed) E.optCompressed.checked = true;
      if (state.opts.timeout) E.optTimeout.value = state.opts.timeout;
      renderAll();
      setStatus('✓ 已从cURL导入', 'success');
    });
  }

  // ==================== 代码生成 ====================

  function generatePythonRequests() {
    var parts = [];
    parts.push('import requests\n');
    var url = state.url.trim() || 'http://example.com';
    var method = state.method.toLowerCase();
    parts.push('response = requests.' + method + '(\n');
    parts.push('    "' + url + '",\n');
    var headers = {};
    state.headers.forEach(function(h) { if (h.enabled && h.key.trim()) headers[h.key] = h.value; });
    if (Object.keys(headers).length) parts.push('    headers=' + JSON.stringify(headers, null, 4).replace(/\n/g, '\n    ') + ',\n');
    if (state.bodyType === 'json' && state.bodyJson.trim()) {
      try { parts.push('    json=' + JSON.stringify(JSON.parse(state.bodyJson), null, 4).replace(/\n/g, '\n    ') + ',\n'); } catch(e) { parts.push('    data="' + state.bodyJson.replace(/"/g, '\\"') + '",\n'); }
    } else if (state.bodyType === 'urlencoded' && state.urlFields.length) {
      var data = {}; state.urlFields.forEach(function(f) { if (f.enabled && f.key.trim()) data[f.key] = f.value; });
      parts.push('    data=' + JSON.stringify(data) + ',\n');
    }
    parts.push(')\n');
    parts.push('print(response.status_code)\nprint(response.text)');
    return parts.join('');
  }

  function generateFetchCode() {
    var parts = [];
    var url = state.url.trim() || 'http://example.com';
    var method = state.method;
    parts.push('fetch("' + url + '", {\n');
    parts.push('  method: "' + method + '",\n');
    var headers = {};
    state.headers.forEach(function(h) { if (h.enabled && h.key.trim()) headers[h.key] = h.value; });
    if (state.bodyType === 'json' && state.bodyJson.trim()) { headers['Content-Type'] = headers['Content-Type'] || 'application/json'; }
    if (Object.keys(headers).length) parts.push('  headers: ' + JSON.stringify(headers, null, 4).replace(/\n/g, '\n  ') + ',\n');
    if (state.bodyType === 'json' && state.bodyJson.trim()) {
      try { parts.push('  body: JSON.stringify(' + JSON.stringify(JSON.parse(state.bodyJson), null, 2).replace(/\n/g, '\n  ') + '),\n'); } catch(e) { parts.push('  body: "' + state.bodyJson.replace(/"/g, '\\"') + '",\n'); }
    } else if (state.bodyType === 'urlencoded' && state.urlFields.length) {
      var params = []; state.urlFields.forEach(function(f) { if (f.enabled && f.key.trim()) params.push('"' + f.key + '": "' + f.value + '"'); });
      parts.push('  body: new URLSearchParams({' + params.join(', ') + '}),\n');
    }
    parts.push('})\n  .then(res => res.json())\n  .then(data => console.log(data))\n  .catch(err => console.error(err));');
    return parts.join('');
  }

  function generateGoCode() {
    var method = state.method;
    var url = state.url.trim() || 'http://example.com';
    var code = 'package main\n\nimport (\n\t"fmt"\n\t"io"\n\t"net/http"';
    if (state.bodyType === 'json') code += '\n\t"strings"';
    code += '\n)\n\nfunc main() {\n';
    if (state.bodyType === 'json' && state.bodyJson.trim()) {
      code += '\tbody := strings.NewReader(\`' + state.bodyJson + '\`)\n';
      code += '\treq, err := http.NewRequest("' + method + '", "' + url + '", body)\n';
    } else {
      code += '\treq, err := http.NewRequest("' + method + '", "' + url + '", nil)\n';
    }
    code += '\tif err != nil {\n\t\tpanic(err)\n\t}\n';
    state.headers.forEach(function(h) { if (h.enabled && h.key.trim()) code += '\treq.Header.Set("' + h.key + '", "' + h.value + '")\n'; });
    code += '\tclient := &http.Client{}\n\tresp, err := client.Do(req)\n\tif err != nil {\n\t\tpanic(err)\n\t}\n\tdefer resp.Body.Close()\n\tbody, _ := io.ReadAll(resp.Body)\n\tfmt.Println(resp.StatusCode)\n\tfmt.Println(string(body))\n}';
    return code;
  }

  function showCodeGen(type) {
    var code = '';
    var lang = '';
    if (type === 'python') { code = generatePythonRequests(); lang = 'Python (requests)'; }
    else if (type === 'js') { code = generateFetchCode(); lang = 'JavaScript (fetch)'; }
    else if (type === 'go') { code = generateGoCode(); lang = 'Go (net/http)'; }
    else if (type === 'php') { code = generatePhpCode(); lang = 'PHP (cURL)'; }
    else if (type === 'node') { code = generateNodeCode(); lang = 'Node.js (http/https)'; }
    if (!code) return;
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';
    var box = document.createElement('div');
    box.style.cssText = 'background:var(--tt-bg-primary);border-radius:8px;padding:16px;max-width:600px;width:90%;max-height:80vh;overflow:auto';
    box.innerHTML = '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><strong>' + escapeAttr(lang) + ' 代码</strong><button id="codegen-close" style="cursor:pointer">✕</button></div><pre style="white-space:pre-wrap;font-size:12px;background:var(--tt-bg-secondary);padding:12px;border-radius:4px;overflow:auto;max-height:60vh">' + escapeAttr(code) + '</pre><button id="codegen-copy" style="margin-top:8px;padding:6px 16px;cursor:pointer;border-radius:4px;border:1px solid var(--tt-border-color);background:var(--tt-bg-secondary)">📋 复制代码</button>';
    modal.appendChild(box);
    document.body.appendChild(modal);
    document.getElementById('codegen-close').onclick = function() { document.body.removeChild(modal); };
    document.getElementById('codegen-copy').onclick = function() { navigator.clipboard.writeText(code).then(function() { document.getElementById('codegen-copy').textContent = '✓ 已复制'; }); };
    modal.addEventListener('click', function(e) { if (e.target === modal) document.body.removeChild(modal); });
  }

  // 代码生成按钮
  var btnGenPython = document.getElementById('btn-gen-python');
  var btnGenJs = document.getElementById('btn-gen-js');
  var btnGenGo = document.getElementById('btn-gen-go');
  var btnGenPhp = document.getElementById('btn-gen-php');
  var btnGenNode = document.getElementById('btn-gen-node');
  if (btnGenPython) btnGenPython.addEventListener('click', function() { showCodeGen('python'); });
  if (btnGenJs) btnGenJs.addEventListener('click', function() { showCodeGen('js'); });
  if (btnGenGo) btnGenGo.addEventListener('click', function() { showCodeGen('go'); });
  if (btnGenPhp) btnGenPhp.addEventListener('click', function() { showCodeGen('php'); });
  if (btnGenNode) btnGenNode.addEventListener('click', function() { showCodeGen('node'); });

  // ==================== 认证 ====================
  var authType = document.getElementById('auth-type');
  var authKey = document.getElementById('auth-key');
  var authSecret = document.getElementById('auth-secret');
  var btnApplyAuth = document.getElementById('btn-apply-auth');
  // 认证类型切换时显示/隐藏第二个输入框
  if (authType) authType.addEventListener('change', function() {
    var t = this.value;
    if (authSecret) {
      if (t === 'basic') { authSecret.style.display = ''; authSecret.placeholder = '密码'; authKey.placeholder = '用户名'; }
      else if (t === 'apikey-header') { authSecret.style.display = ''; authSecret.placeholder = 'Header 名称 (如 X-API-Key)'; authKey.placeholder = 'API Key 值'; }
      else if (t === 'oauth') { authSecret.style.display = ''; authSecret.placeholder = 'Token 端点 URL (可选)'; authKey.placeholder = 'Access Token'; }
      else { authSecret.style.display = 'none'; authKey.placeholder = 'Token / API Key'; }
    }
  });
  if (btnApplyAuth) btnApplyAuth.addEventListener('click', function() {
    var t = authType ? authType.value : 'none';
    var key = authKey ? authKey.value.trim() : '';
    var secret = authSecret ? authSecret.value.trim() : '';
    if (t === 'none' || !key) { setStatus('请填写认证凭据', 'error'); return; }
    if (t === 'bearer') {
      state.headers.push({ key: 'Authorization', value: 'Bearer ' + key, enabled: true });
    } else if (t === 'basic') {
      var raw = key + ':' + secret;
      var encoded;
      try { encoded = btoa(raw); } catch(e) { encoded = raw; }
      state.headers.push({ key: 'Authorization', value: 'Basic ' + encoded, enabled: true });
    } else if (t === 'apikey-header') {
      var hdrName = secret || 'X-API-Key';
      state.headers.push({ key: hdrName, value: key, enabled: true });
    } else if (t === 'apikey-query') {
      // 将 API Key 作为查询参数附加到 URL
      var sep = state.url.indexOf('?') >= 0 ? '&' : '?';
      state.url = state.url + sep + 'api_key=' + encodeURIComponent(key);
      if (E.urlInput) E.urlInput.value = state.url;
    } else if (t === 'oauth') {
      state.headers.push({ key: 'Authorization', value: 'Bearer ' + key, enabled: true });
    }
    renderAll();
    setStatus('✓ 已应用 ' + (authType.options[authType.selectedIndex].text) + ' 认证', 'success');
    if (authKey) authKey.value = '';
    if (authSecret) authSecret.value = '';
  });

  // ==================== PHP 代码生成 ====================
  function generatePhpCode() {
    var url = state.url.trim() || 'http://example.com';
    var method = state.method;
    var code = '<?php\n$ch = curl_init();\n';
    code += 'curl_setopt($ch, CURLOPT_URL, "' + url + '");\n';
    code += 'curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\n';
    code += 'curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "' + method + '");\n';
    var headers = [];
    state.headers.forEach(function(h) { if (h.enabled && h.key.trim()) headers.push(h.key + ': ' + h.value); });
    if (state.bodyType === 'json' && state.bodyJson.trim()) headers.push('Content-Type: application/json');
    if (headers.length) {
      code += 'curl_setopt($ch, CURLOPT_HTTPHEADER, array(\n';
      headers.forEach(function(h) { code += '    "' + h.replace(/"/g, '\\"') + '",\n'; });
      code += '));\n';
    }
    if (state.bodyType === 'json' && state.bodyJson.trim()) {
      code += 'curl_setopt($ch, CURLOPT_POSTFIELDS, \'' + state.bodyJson.replace(/'/g, "\\'") + '\');\n';
    } else if (state.bodyType === 'urlencoded' && state.urlFields.length) {
      var params = [];
      state.urlFields.forEach(function(f) { if (f.enabled && f.key.trim()) params.push(f.key + '=' + f.value); });
      code += 'curl_setopt($ch, CURLOPT_POSTFIELDS, "' + params.join('&') + '");\n';
    } else if (state.bodyType === 'raw' && state.bodyRaw.trim()) {
      code += 'curl_setopt($ch, CURLOPT_POSTFIELDS, \'' + state.bodyRaw.replace(/'/g, "\\'") + '\');\n';
    }
    if (state.opts.follow) code += 'curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);\n';
    if (state.opts.insecure) code += 'curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);\n';
    code += '$response = curl_exec($ch);\n';
    code += '$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);\n';
    code += 'curl_close($ch);\n';
    code += 'echo "HTTP " . $httpCode . "\\n";\necho $response;\n?>';
    return code;
  }

  // ==================== Node.js 代码生成 ====================
  function generateNodeCode() {
    var url = state.url.trim() || 'http://example.com';
    var method = state.method;
    var code = "const https = require('https');\nconst http = require('http');\n\n";
    var headers = {};
    state.headers.forEach(function(h) { if (h.enabled && h.key.trim()) headers[h.key] = h.value; });
    if (state.bodyType === 'json' && state.bodyJson.trim()) headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    var bodyData = 'null';
    if (state.bodyType === 'json' && state.bodyJson.trim()) {
      bodyData = 'JSON.stringify(' + state.bodyJson + ')';
    } else if (state.bodyType === 'raw' && state.bodyRaw.trim()) {
      bodyData = "'" + state.bodyRaw.replace(/'/g, "\\'") + "'";
    } else if (state.bodyType === 'urlencoded' && state.urlFields.length) {
      var params = [];
      state.urlFields.forEach(function(f) { if (f.enabled && f.key.trim()) params.push(f.key + '=' + encodeURIComponent(f.value)); });
      bodyData = "'" + params.join('&') + "'";
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    code += 'const options = {\n  method: "' + method + '",\n';
    if (Object.keys(headers).length) {
      code += '  headers: ' + JSON.stringify(headers, null, 2).replace(/\n/g, '\n  ') + ',\n';
    }
    code += '};\n\n';
    code += 'const mod = url.startsWith("https") ? https : http;\n';
    code += 'const req = mod.request("' + url + '", options, (res) => {\n';
    code += '  let data = "";\n  res.on("data", (chunk) => { data += chunk; });\n';
    code += '  res.on("end", () => {\n    console.log(`HTTP ${res.statusCode}`);\n    console.log(data);\n  });\n});\n';
    code += 'req.on("error", (e) => { console.error(e.message); });\n';
    if (bodyData !== 'null') code += 'req.write(' + bodyData + ');\n';
    code += 'req.end();';
    return code;
  }

  // 初始化
  renderAll();
})();
