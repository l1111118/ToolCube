/**
 * 自定义脚本注入 - Script Injector
 * 向匹配的网页注入自定义 JS/CSS 脚本
 */
document.addEventListener('DOMContentLoaded', () => {
  const $master = document.getElementById('si-master');
  const $status = document.getElementById('si-status');
  const $rules = document.getElementById('si-rules');
  const $addRule = document.getElementById('si-add-rule');
  const $toast = document.getElementById('toast');
  function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
  function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(e => { console.warn('[script-injector] safeSend error:', e); }); }
  function safeStorage(op, ...args) { if (!isCtxValid()) return op === 'get' ? Promise.resolve({}) : Promise.resolve(); try { return chrome.storage.local[op](...args); } catch(e) { console.warn('[script-injector] safeStorage error:', e); return op === 'get' ? Promise.resolve({}) : Promise.resolve(); } }

  const PRESETS = {
    darkmode: {
      name: '暗黑模式强制',
      urlPattern: '*://*/*',
      type: 'css',
      code: 'html,body{background-color:#1a1a2e!important;color:#e0e0e0!important}*{background-color:transparent!important;color:inherit!important}a{color:#66b2ff!important}img{opacity:.85}input,textarea,select{background-color:#2a2a3e!important;color:#e0e0e0!important;border-color:#444!important}',
      runAt: 'document_start',
      enabled: true
    },
    contextmenu: {
      name: '禁用右键限制',
      urlPattern: '*://*/*',
      type: 'js',
      code: '(function(){var e=document;e.oncontextmenu=null;e.addEventListener("contextmenu",function(e){e.stopPropagation()},true);var o=EventTarget.prototype.addEventListener;EventTarget.prototype.addEventListener=function(t,a,b){if(t==="contextmenu")return;o.call(this,t,a,b)};console.log("[ScriptInjector] 右键限制已移除")})();',
      runAt: 'document_end',
      enabled: true
    },
    select: {
      name: '禁用选择限制',
      urlPattern: '*://*/*',
      type: 'js',
      code: '(function(){var e=document;e.onselectstart=null;e.oncopy=null;e.addEventListener("selectstart",function(e){e.stopPropagation()},true);e.addEventListener("copy",function(e){e.stopPropagation()},true);e.addEventListener("cut",function(e){e.stopPropagation()},true);console.log("[ScriptInjector] 选择限制已移除")})();',
      runAt: 'document_end',
      enabled: true
    },
    jquery: {
      name: '注入 jQuery 3.x',
      urlPattern: '*://*/*',
      type: 'js',
      code: '(function(){if(!window.jQuery){var s=document.createElement("script");s.src="https://code.jquery.com/jquery-3.7.1.min.js";s.integrity="sha256-/JqT3SQfawRcv/BIHPThkBvs0OEvtFFmqPF/lYI/Cxo=";s.crossOrigin="anonymous";document.head.appendChild(s);console.log("[ScriptInjector] jQuery 3.7.1 已注入")}})();',
      runAt: 'document_start',
      enabled: true
    },
    analytics_blocker: {
      name: '阻止 Google Analytics',
      urlPattern: '*://*/*',
      type: 'js',
      code: '(function(){Object.defineProperty(window,"ga",{get:function(){return function(){}},set:function(){}});Object.defineProperty(window,"gtag",{get:function(){return function(){}},set:function(){}});var origCreate=document.createElement.bind(document);document.createElement=function(tag){var el=origCreate(tag);if(tag==="script"){var origSrc=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,"src");Object.defineProperty(el,"src",{set:function(v){if(v&&v.includes("google-analytics"))return;origSrc.set.call(this,v)},get:function(){return origSrc.get.call(this)}})}return el};console.log("[ScriptInjector] Google Analytics 已阻止")})();',
      runAt: 'document_start',
      enabled: true
    },
    readability: {
      name: '阅读模式样式',
      urlPattern: '*://*/*',
      type: 'css',
      code: 'body{max-width:680px!important;margin:0 auto!important;padding:20px!important;font-size:18px!important;line-height:1.8!important;color:#333!important;background:#fff!important}img{max-width:100%!important;height:auto!important}nav,header,footer,.sidebar,.ad,.advertisement,#comments{display:none!important}',
      runAt: 'document_end',
      enabled: true
    },
    // ── 脚本库注入 ──
    lodash: {
      name: '注入 Lodash 4.x',
      urlPattern: '*://*/*',
      type: 'js',
      code: '(function(){if(!window._){var s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js";s.integrity="sha256-qXBd/EfAdjOA2FyGtbi1Cy5wrxg/XTwfRyYpYp9ez2Q=";s.crossOrigin="anonymous";document.head.appendChild(s);console.log("[ScriptInjector] Lodash 4.17.21 已注入")}})();',
      runAt: 'document_start',
      enabled: true
    },
    // ── 工具函数模板 ──
    perf_monitor: {
      name: '性能监控工具',
      urlPattern: '*://*/*',
      type: 'js',
      code: '(function(){window.PerfMonitor={marks:{},start:function(n){this.marks[n]=performance.now()},end:function(n){var s=this.marks[n];if(s){var d=performance.now()-s;console.log("[Perf] "+n+": "+d.toFixed(2)+"ms");return d}return 0},fps:function(cb,frames){frames=frames||60;var c=0,prev=performance.now();function tick(t){c++;if(c>=frames){var fps=Math.round(c*1000/(t-prev));cb(fps);c=0;prev=t}requestAnimationFrame(tick)}requestAnimationFrame(tick)},mem:function(){if(performance.memory){return{used:Math.round(performance.memory.usedJSHeapSize/1048576)+"MB",total:Math.round(performance.memory.totalJSHeapSize/1048576)+"MB",limit:Math.round(performance.memory.jsHeapSizeLimit/1048576)+"MB"}}return null},timing:function(){var t=performance.timing;return{dns:t.domainLookupEnd-t.domainLookupStart,tcp:t.connectEnd-t.connectStart,req:t.responseEnd-t.requestStart,dom:t.domComplete-t.responseEnd,load:t.loadEventEnd-t.navigationStart}}};console.log("[ScriptInjector] 性能监控工具已加载: PerfMonitor")})();',
      runAt: 'document_end',
      enabled: true
    },
    dom_helper: {
      name: 'DOM 助手工具',
      urlPattern: '*://*/*',
      type: 'js',
      code: '(function(){window.DomHelper={$:function(s,c){return(c||document).querySelector(s)},$$:function(s,c){return Array.prototype.slice.call((c||document).querySelectorAll(s))},create:function(tag,attrs,children){var el=document.createElement(tag);if(attrs)for(var k in attrs){if(k==="class")el.className=attrs[k];else if(k==="style")el.style.cssText=attrs[k];else el.setAttribute(k,attrs[k])}if(children){if(!Array.isArray(children))children=[children];children.forEach(function(c){if(typeof c==="string")el.appendChild(document.createTextNode(c));else if(c)el.appendChild(c)})}return el},on:function(el,evt,fn,opt){el.addEventListener(evt,fn,opt);return el},delegate:function(el,evt,sel,fn){el.addEventListener(evt,function(e){var t=e.target.closest(sel);if(t)fn.call(t,e)})},waitFor:function(sel,timeout){timeout=timeout||5000;return new Promise(function(res,rej){var el=document.querySelector(sel);if(el)return res(el);var obs=new MutationObserver(function(){var el=document.querySelector(sel);if(el){obs.disconnect();res(el)}});obs.observe(document.body,{childList:true,subtree:true});setTimeout(function(){obs.disconnect();rej(new Error("waitFor timeout: "+sel))},timeout)})}};console.log("[ScriptInjector] DOM 助手已加载: DomHelper")})();',
      runAt: 'document_end',
      enabled: true
    },
    debug_console: {
      name: '调试日志增强',
      urlPattern: '*://*/*',
      type: 'js',
      code: '(function(){var origLog=console.log,origErr=console.error,origWarn=console.warn;window.DebugLog=[];function ts(){return new Date().toLocaleTimeString()}console.log=function(){var a=Array.prototype.slice.call(arguments);window.DebugLog.push({t:ts(),type:"log",args:a});origLog.apply(console,arguments)};console.error=function(){var a=Array.prototype.slice.call(arguments);window.DebugLog.push({t:ts(),type:"error",args:a});origErr.apply(console,arguments)};console.warn=function(){var a=Array.prototype.slice.call(arguments);window.DebugLog.push({t:ts(),type:"warn",args:a});origWarn.apply(console,arguments)};window.DebugLog.export=function(){var text=window.DebugLog.filter(function(e){return typeof e==="object"}).map(function(e){return"["+e.t+"] "+e.type.toUpperCase()+": "+e.args.join(" ")}).join("\\n");var b=new Blob([text],{type:"text/plain"});var a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="debug-log.txt";a.click()};console.log("[ScriptInjector] 调试日志增强已加载: DebugLog.export() 导出日志")})();',
      runAt: 'document_start',
      enabled: true
    }
  };

  let rules = [];

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
      safeSend({
        action: 'saveToHistory',
        data: { toolId: 'script-injector', type: 'inject', data }
      });
    } catch (e) {}
  }

  function escapeAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function updateStatus(enabled) {
    if (enabled) {
      $status.textContent = '已启用';
      $status.classList.add('si-status--active');
    } else {
      $status.textContent = '未启用';
      $status.classList.remove('si-status--active');
    }
  }

  function collectRules() {
    const result = [];
    $rules.querySelectorAll('.si-rule').forEach(el => {
      const name = el.querySelector('.si-rule-name').value.trim();
      const urlPattern = el.querySelector('.si-rule-pattern').value.trim();
      const type = el.querySelector('.si-rule-type').value;
      const code = el.querySelector('.si-rule-code').value;
      const runAt = el.querySelector('.si-rule-runat').value;
      const enabled = el.querySelector('.si-rule-enabled').checked;
      if (name) {
        result.push({ name, urlPattern, type, code, runAt, enabled });
      }
    });
    return result;
  }

  // ── 语法检查 ──
  // 背景：扩展页 CSP 为 `script-src 'self'`（不含 'unsafe-eval'），
  // new Function() / eval() 会被浏览器以 CSP 拒绝执行。旧实现把这条 CSP 报错
  // 当作"语法错误"上报，导致**任何合法的 JS 规则都被标记为 ⚠️**，语法检查实质失效。
  // 现改用 acorn（在 tool.html 中于本脚本之前引入）做纯静态解析：
  // 不执行代码、完全满足 CSP，且能给出精确的行:列与错误原因。
  // acorn 不可用时降级为括号配平检查，并在提示中明确标注降级状态，避免误导用户。
  function getAcorn() {
    return (typeof window !== 'undefined' && window.acorn && typeof window.acorn.parse === 'function')
      ? window.acorn
      : null;
  }

  /**
   * JS 语法检查
   * @param {string} code
   * @returns {{valid:boolean, errors:string[], degraded:boolean}}
   */
  function checkJsSyntax(code) {
    const acorn = getAcorn();
    if (acorn) {
      try {
        acorn.parse(code, {
          ecmaVersion: 'latest',
          sourceType: 'script',
          allowReturnOutsideFunction: true,
          allowAwaitOutsideFunction: true
        });
        return { valid: true, errors: [], degraded: false };
      } catch (err) {
        return { valid: false, errors: [err && err.message ? err.message : '语法错误'], degraded: false };
      }
    }
    const structural = checkStructuralBalance(code);
    return { valid: structural.errors.length === 0, errors: structural.errors, degraded: true };
  }

  /**
   * 结构性配平检查（acorn 不可用时的降级方案）
   * 先剥离字符串/模板串/注释，再检查 {} () [] 是否配平。
   * 局限：不识别正则字面量，含正则的代码可能漏报，因此调用方需展示 degraded 标记。
   * @param {string} code
   * @returns {{errors:string[]}}
   */
  function checkStructuralBalance(code) {
    const errors = [];
    const stack = [];
    const pairs = { '}': '{', ')': '(', ']': '[' };
    let i = 0;
    let line = 1;
    const n = code.length;
    while (i < n) {
      const ch = code[i];
      const next = code[i + 1];
      if (ch === '\n') { line++; i++; continue; }
      if (ch === '/' && next === '/') { while (i < n && code[i] !== '\n') i++; continue; }
      if (ch === '/' && next === '*') {
        i += 2;
        while (i < n && !(code[i] === '*' && code[i + 1] === '/')) { if (code[i] === '\n') line++; i++; }
        i += 2;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        const quote = ch;
        i++;
        while (i < n && code[i] !== quote) {
          if (code[i] === '\\') { i += 2; continue; }
          if (code[i] === '\n') { line++; if (quote !== '`') break; }
          i++;
        }
        i++;
        continue;
      }
      if (ch === '{' || ch === '(' || ch === '[') { stack.push({ ch, line }); i++; continue; }
      if (ch === '}' || ch === ')' || ch === ']') {
        const top = stack.pop();
        if (!top || top.ch !== pairs[ch]) errors.push(`第 ${line} 行出现不匹配的 "${ch}"`);
        i++;
        continue;
      }
      i++;
    }
    for (const item of stack) errors.push(`第 ${item.line} 行的 "${item.ch}" 未闭合`);
    return { errors };
  }

  function checkSyntax(code, type) {
    if (!code.trim()) return { valid: true, errors: [], degraded: false };
    if (type === 'js') return checkJsSyntax(code);
    if (type === 'css') {
      // CSS 仅做花括号配平（不剥离注释，避免把 url(//host/a.png) 误判为注释）
      let braceCount = 0;
      for (const ch of code) {
        if (ch === '{') braceCount++;
        if (ch === '}') braceCount--;
      }
      return braceCount !== 0
        ? { valid: false, errors: ['花括号不匹配 (差 ' + braceCount + ')'], degraded: false }
        : { valid: true, errors: [], degraded: false };
    }
    return { valid: true, errors: [], degraded: false };
  }

  /** 生成语法检查结果的 tooltip 文案 */
  function syntaxTooltip(syntax) {
    if (!syntax.valid) return syntax.errors.join('; ');
    return syntax.degraded ? '已通过基础配平检查（完整解析器未加载，未做深度校验）' : '语法检查通过';
  }

  function renderRules() {
    $rules.innerHTML = rules.map((rule, i) => {
      const syntax = checkSyntax(rule.code, rule.type);
      const syntaxIcon = syntax.valid ? '✅' : '⚠️';
      const enabledStyle = rule.enabled ? '' : 'opacity:0.5;';
      return `
      <div class="si-rule" data-index="${i}" style="${enabledStyle}">
        <div class="si-rule-row">
          <span class="si-rule-label">名称</span>
          <input type="text" class="si-input si-rule-name" value="${escapeAttr(rule.name)}" placeholder="规则名称">
          <label class="si-toggle-sm" title="启用/禁用"><input type="checkbox" class="si-rule-enabled" ${rule.enabled ? 'checked' : ''}><span class="si-toggle-sm-slider"></span></label>
          <span title="执行顺序" style="font-size:11px;color:var(--tt-text-secondary);">#${i + 1}</span>
          <button class="si-rule-up" title="上移" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button class="si-rule-down" title="下移" ${i === rules.length - 1 ? 'disabled' : ''}>▼</button>
          <span title="${escapeAttr(syntaxTooltip(syntax))}">${syntaxIcon}</span>
          <button class="si-rule-delete">删除</button>
        </div>
        <div class="si-rule-row">
          <span class="si-rule-label">URL</span>
          <input type="text" class="si-input si-rule-pattern" value="${escapeAttr(rule.urlPattern)}" placeholder="*://*.example.com/*">
          <span class="si-rule-label">类型</span>
          <select class="si-select si-rule-type">
            <option value="js" ${rule.type === 'js' ? 'selected' : ''}>JavaScript</option>
            <option value="css" ${rule.type === 'css' ? 'selected' : ''}>CSS</option>
          </select>
          <span class="si-rule-label">时机</span>
          <select class="si-select si-rule-runat">
            <option value="document_start" ${rule.runAt === 'document_start' ? 'selected' : ''}>document_start</option>
            <option value="document_end" ${rule.runAt === 'document_end' ? 'selected' : ''}>document_end</option>
            <option value="document_idle" ${rule.runAt === 'document_idle' ? 'selected' : ''}>document_idle</option>
          </select>
        </div>
        <div class="si-rule-row">
          <span class="si-rule-label">代码</span>
          <textarea class="si-textarea si-rule-code" placeholder="在此输入代码...">${escapeHtml(rule.code)}</textarea>
        </div>
        ${!syntax.valid ? '<div style="color:#f44336;font-size:11px;padding:2px 0;">⚠️ 语法问题: ' + escapeHtml(syntax.errors.join('; ')) + '</div>' : ''}
      </div>
    `}).join('');

    $rules.querySelectorAll('.si-rule').forEach(el => {
      const idx = parseInt(el.dataset.index, 10);
      el.querySelector('.si-rule-delete').addEventListener('click', () => {
        rules.splice(idx, 1);
        renderRules();
        if ($master.checked) applySettings();
      });
      // Enable/Disable toggle
      el.querySelector('.si-rule-enabled').addEventListener('change', (e) => {
        rules[idx].enabled = e.target.checked;
        el.style.opacity = e.target.checked ? '1' : '0.5';
        if ($master.checked) applySettings();
      });
      // Move up
      const upBtn = el.querySelector('.si-rule-up');
      if (upBtn) upBtn.addEventListener('click', () => {
        if (idx > 0) { [rules[idx], rules[idx - 1]] = [rules[idx - 1], rules[idx]]; renderRules(); if ($master.checked) applySettings(); }
      });
      // Move down
      const downBtn = el.querySelector('.si-rule-down');
      if (downBtn) downBtn.addEventListener('click', () => {
        if (idx < rules.length - 1) { [rules[idx], rules[idx + 1]] = [rules[idx + 1], rules[idx]]; renderRules(); if ($master.checked) applySettings(); }
      });
      el.querySelectorAll('.si-rule-name, .si-rule-pattern, .si-rule-type, .si-rule-runat').forEach(input => {
        input.addEventListener('change', () => { if ($master.checked) applySettings(); });
      });
      // Syntax check on code change
      const codeArea = el.querySelector('.si-rule-code');
      if (codeArea) codeArea.addEventListener('input', () => {
        const typeSelect = el.querySelector('.si-rule-type');
        const syntax = checkSyntax(codeArea.value, typeSelect.value);
        // Update syntax icon (find it by position)
        const icons = el.querySelectorAll('span[title]');
        icons.forEach(icon => {
          if (icon.textContent === '✅' || icon.textContent === '⚠️') {
            icon.textContent = syntax.valid ? '✅' : '⚠️';
            icon.title = syntaxTooltip(syntax);
          }
        });
      });
    });
  }

  function applySettings() {
    const enabled = $master.checked;
    updateStatus(enabled);
    rules = collectRules();
    if (enabled) {
      // 为 background.js 添加 disabled 和 matches/urlPatterns 字段
      const bgRules = rules.map(r => ({
        ...r,
        disabled: !r.enabled,
        matches: r.urlPattern ? [r.urlPattern] : ['<all_urls>'],
        urlPatterns: r.urlPattern ? [r.urlPattern] : ['<all_urls>']
      }));
      safeSend({
        action: 'scriptInjector_enable',
        data: { rules: bgRules }
      });
      showToast('脚本注入已启用 (' + rules.filter(r => r.enabled).length + ' 条活跃规则)', 'success');
      saveToHistory({ enabled: true, ruleCount: rules.length });
    } else {
      safeSend({ action: 'scriptInjector_disable' });
      showToast('脚本注入已关闭', 'info');
      saveToHistory({ enabled: false });
    }
  }

  $master.addEventListener('change', applySettings);

  $addRule.addEventListener('click', () => {
    rules.push({ name: '', urlPattern: '*://*/*', type: 'js', code: '', runAt: 'document_end', enabled: true });
    renderRules();
  });

  document.querySelectorAll('.si-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = PRESETS[btn.dataset.preset];
      if (!preset) return;
      const existing = rules.findIndex(r => r.name === preset.name);
      if (existing >= 0) {
        rules[existing] = { ...preset };
      } else {
        rules.push({ ...preset });
      }
      renderRules();
      showToast('已应用预设: ' + preset.name, 'success');
      if ($master.checked) applySettings();
    });
  });

  async function loadSavedState() {
    try {
      const result = await safeStorage('get', 'toolbox_script_injector');
      const config = result.toolbox_script_injector;
      if (config) {
        if (config.enabled) {
          $master.checked = true;
          updateStatus(true);
        }
        if (config.rules && config.rules.length) {
          rules = config.rules.map(r => ({
            name: r.name || '',
            urlPattern: r.urlPattern || r.matches?.[0] || '*://*/*',
            type: r.type || 'js',
            code: r.code || '',
            runAt: r.runAt || 'document_end',
            enabled: r.enabled !== undefined ? r.enabled : !r.disabled
          }));
        }
        renderRules();
      }
    } catch (e) {}
  }

  // ── 导入/导出功能 ──
  function renderImportExport() {
    let ieEl = document.getElementById('si-import-export');
    if (!ieEl) {
      ieEl = document.createElement('div');
      ieEl.id = 'si-import-export';
      ieEl.className = 'si-ie';
      // 插入到自定义规则区块之前
      const rulesSection = $rules.closest('.si-section');
      if (rulesSection && rulesSection.parentElement) {
        rulesSection.parentElement.insertBefore(ieEl, rulesSection);
      } else {
        $addRule.parentElement.appendChild(ieEl);
      }
    }
    ieEl.innerHTML = '<div class="si-ie-title">📦 规则导入/导出</div>' +
      '<div class="si-ie-actions">' +
        '<button class="btn si-ie-btn" id="si-export-btn">📤 导出规则 (JSON)</button>' +
        '<button class="btn si-ie-btn" id="si-import-btn">📥 导入规则 (JSON)</button>' +
        '<input type="file" id="si-import-file" accept=".json" style="display:none;">' +
      '</div>';

    document.getElementById('si-export-btn').addEventListener('click', () => {
      const currentRules = collectRules();
      const json = JSON.stringify(currentRules, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'script-injector-rules.json'; a.click();
      URL.revokeObjectURL(url);
      showToast('规则已导出 (' + currentRules.length + ' 条)', 'success');
    });

    document.getElementById('si-import-btn').addEventListener('click', () => {
      document.getElementById('si-import-file').click();
    });

    document.getElementById('si-import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const imported = JSON.parse(ev.target.result);
          if (Array.isArray(imported)) {
            let count = 0;
            imported.forEach(r => {
              if (r.name || r.code) {
                rules.push({
                  name: r.name || '',
                  urlPattern: r.urlPattern || '*://*/*',
                  type: r.type || 'js',
                  code: r.code || '',
                  runAt: r.runAt || 'document_end',
                  enabled: r.enabled !== undefined ? r.enabled : true
                });
                count++;
              }
            });
            renderRules();
            showToast('已导入 ' + count + ' 条规则', 'success');
            if ($master.checked) applySettings();
          } else {
            showToast('无效的 JSON 格式', 'error');
          }
        } catch (err) {
          showToast('JSON 解析失败: ' + err.message, 'error');
        }
        e.target.value = '';
      };
      reader.readAsText(file);
    });
  }

  window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!event.data || event.source !== window.parent) return;
    if (event.data && event.data.action === 'setTheme' && event.data.data) {
      document.documentElement.setAttribute('data-theme', event.data.data.theme);
    }
  });

  renderImportExport();
  loadSavedState();
});
