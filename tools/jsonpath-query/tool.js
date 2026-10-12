/**
 * JSONPath 查询器
 * 支持 JSONPath 核心语法：$.a.b[*].c[?(@.x>y)]
 */
(function(){
'use strict';
const $input = document.getElementById('jp-input');
const $path = document.getElementById('jp-path');
const $result = document.getElementById('jp-result');
const $resultMeta = document.getElementById('jp-result-meta');
const $error = document.getElementById('jp-error');
const $recursive = document.getElementById('jp-recursive');
const $highlightPath = document.getElementById('jp-highlight-path');

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
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

// 查询历史管理
const HISTORY_KEY = 'jsonpath-query-history';
const MAX_HISTORY = 15;
let lastQueryResult = null; // 缓存最近一次查询结果，用于导出

async function saveQueryHistory(path, matchCount) {
  try {
    const stored = await safeStorage('get', HISTORY_KEY);
    let history = stored[HISTORY_KEY] || [];
    history = history.filter(h => h.path !== path);
    history.unshift({ path, matchCount, time: Date.now() });
    if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
    await safeStorage('set', { [HISTORY_KEY]: history });
    renderQueryHistory();
  } catch (e) {}
}

async function renderQueryHistory() {
  const $list = document.getElementById('jp-history-list');
  if (!$list) return;
  try {
    const stored = await safeStorage('get', HISTORY_KEY);
    const history = stored[HISTORY_KEY] || [];
    if (history.length === 0) {
      $list.innerHTML = '<div class="jp-history-empty">暂无查询历史</div>';
      return;
    }
    $list.innerHTML = history.map(h => {
      const t = new Date(h.time);
      const timeStr = (t.getMonth()+1) + '/' + t.getDate() + ' ' + String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0');
      return '<div class="jp-history-item" data-path="' + escapeHtml(h.path) + '">' +
        '<span class="jp-history-path">' + escapeHtml(h.path) + '</span>' +
        '<span class="jp-history-meta">' + (h.matchCount != null ? h.matchCount + ' 匹配 · ' : '') + timeStr + '</span>' +
        '</div>';
    }).join('');
  } catch (e) {}
}

function showError(msg) {
  $error.textContent = '❌ ' + msg;
  $error.classList.add('jp-error--show');
}
function clearError() {
  $error.classList.remove('jp-error--show');
  $error.textContent = '';
}

/**
 * 极简 JSONPath 实现，支持：
 *  $            根
 *  .a.b         点号路径
 *  [n]          数组下标
 *  [*] / [start:end:step]  数组切片
 *  [?(@.x > y)] 过滤表达式（支持比较运算 + 逻辑 && || + 字面量）
 *  ..a          递归搜索
 */
function evalJSONPath(data, expr) {
  if (typeof data !== 'object' || data === null) throw new Error('Root is not an object/array');
  const tokens = tokenize(expr);
  let result = [data];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'dot') {
      // 必须用 hasOwnProperty 判断：`in` 会命中原型链成员，
      // 导致 $.toString / $.constructor 返回原型函数而不是"无此键"
      result = result.flatMap(v => v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, t.name) ? [v[t.name]] : []);
    } else if (t.type === 'bracket') {
      if (t.mode === 'index') {
        result = result.flatMap(v => {
          if (!Array.isArray(v) && !(typeof v === 'object' && v !== null)) return [];
          const arr = Array.isArray(v) ? v : Object.values(v);
          if (t.index < 0) {
            const idx = arr.length + t.index;
            return idx >= 0 && idx < arr.length ? [arr[idx]] : [];
          }
          return t.index < arr.length ? [arr[t.index]] : [];
        });
      } else if (t.mode === 'wild') {
        result = result.flatMap(v => {
          if (Array.isArray(v)) return v.slice();
          if (v && typeof v === 'object') return Object.values(v);
          return [];
        });
      } else if (t.mode === 'slice') {
        result = result.flatMap(v => {
          if (!Array.isArray(v)) return [];
          return sliceWithStep(v, t.start, t.end, t.step || 1);
        });
      } else if (t.mode === 'filter') {
        result = result.flatMap(v => {
          if (!Array.isArray(v)) return [];
          return v.filter(item => {
            const ctx = { '@': item, '$': data };
            try { return !!evalExpr(t.expr, ctx); } catch (e) { return false; }
          });
        });
      } else if (t.mode === 'key') {
        result = result.flatMap(v => v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, t.name) ? [v[t.name]] : []);
      } else if (t.mode === 'keys') {
        // 类似 $.a[?(@.type='x')] 之前已处理 filter
        result = [];
      }
    } else if (t.type === 'recursive') {
      // 递归搜索该键
      const key = t.name;
      const out = [];
      const seen = new Set();
      function walk(v) {
        if (v && typeof v === 'object' && !seen.has(v)) {
          seen.add(v);
          if (Array.isArray(v)) {
            v.forEach(walk);
          } else {
            if (key === '*') {
              Object.values(v).forEach(walk);
            } else if (key in v) {
              out.push(v[key]);
            }
            Object.values(v).forEach(walk);
          }
        }
      }
      result.forEach(walk);
      result = out;
    }
  }
  return result;
}

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  // 去掉首部 $
  if (expr[0] === '$') i = 1;
  while (i < expr.length) {
    const c = expr[i];
    if (c === '.') {
      if (expr[i + 1] === '.') {
        // 递归 ..
        i += 2;
        let name = '';
        if (expr[i] === '*') { i++; name = '*'; }
        else while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) { name += expr[i++]; }
        tokens.push({ type: 'recursive', name });
      } else {
        i++;
        let name = '';
        if (expr[i] === '*') { i++; name = '*'; }
        else while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) { name += expr[i++]; }
        if (name) tokens.push({ type: 'dot', name });
      }
    } else if (c === '[') {
      // 解析 []：扫描时需要跳过引号内的内容，
      // 否则 $['a]b'] 这类含 ] 的键会在引号内部提前结束，导致解析失败
      i++;
      let body = '';
      let depth = 1;
      let quote = null;
      while (i < expr.length && depth > 0) {
        const ch = expr[i];
        if (quote) {
          body += ch;
          if (ch === '\\' && i + 1 < expr.length) { body += expr[i + 1]; i += 2; continue; }
          if (ch === quote) quote = null;
          i++;
          continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; body += ch; i++; continue; }
        if (ch === '[') depth++;
        else if (ch === ']') { depth--; if (depth === 0) break; }
        body += ch;
        i++;
      }
      i++; // skip ]
      const bt = parseBracket(body);
      tokens.push({ type: 'bracket', ...bt });
    } else {
      throw new Error('Unexpected char at ' + i + ': ' + c);
    }
  }
  return tokens;
}

function parseBracket(body) {
  body = body.trim();
  if (body === '*') return { mode: 'wild' };
  if (/^-?\d+$/.test(body)) return { mode: 'index', index: parseInt(body, 10) };
  // 切片 start:end:step
  if (/^-?\d*:-?\d*(:-?\d*)?$/.test(body)) {
    const [s, e, st] = body.split(':');
    return { mode: 'slice', start: s ? parseInt(s, 10) : undefined, end: e ? parseInt(e, 10) : undefined, step: st ? parseInt(st, 10) : 1 };
  }
  // 过滤 ?(@.x op y) 或 ?@.x op y
  if (body.startsWith('?')) {
    // 标准写法为 ?(...)。必须剥离最外层成对括号：否则 evalExpr 在括号内部
    // 深度不为 0，找不到比较运算符，过滤条件恒为假 —— 查询会静默返回空数组。
    const expr = stripOuterParens(body.slice(1).trim());
    if (!expr) throw new Error('过滤器表达式为空: [' + body + ']');
    return { mode: 'filter', expr };
  }
  // 带引号的键：$['a-b'] / $["a b"]
  const quoted = body.match(/^(['"])([\s\S]*)\1$/);
  if (quoted) return { mode: 'key', name: quoted[2] };
  throw new Error('Unsupported bracket: [' + body + ']');
}

/**
 * 剥离最外层成对的圆括号，仅当括号包裹整个表达式时才剥离
 * （避免把 (a)+(b) 误判为整体括号）
 * @param {string} expr
 * @returns {string}
 */
function stripOuterParens(expr) {
  let s = expr.trim();
  while (s.length >= 2 && s[0] === '(' && s[s.length - 1] === ')') {
    let depth = 0;
    let wrapsWhole = true;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0 && i !== s.length - 1) { wrapsWhole = false; break; }
      }
    }
    if (!wrapsWhole || depth !== 0) break;
    s = s.slice(1, -1).trim();
  }
  return s;
}

/**
 * 支持步长的数组切片
 * Array.prototype.slice 不接受 step 参数，原实现把 step 作为第三个实参传入会被直接忽略，
 * 导致 $[::2]、$[::-1] 等写法失效。这里按 Python 切片语义自行实现（含负索引与负步长）。
 * @param {Array} arr
 * @param {number|undefined} start
 * @param {number|undefined} end
 * @param {number} step
 * @returns {Array}
 */
function sliceWithStep(arr, start, end, step) {
  const len = arr.length;
  if (!Number.isFinite(step) || step === 0) step = 1;
  const out = [];
  if (step > 0) {
    const s = start === undefined ? 0 : (start < 0 ? Math.max(len + start, 0) : Math.min(start, len));
    const e = end === undefined ? len : (end < 0 ? Math.max(len + end, 0) : Math.min(end, len));
    for (let i = s; i < e; i += step) out.push(arr[i]);
  } else {
    const s = start === undefined ? len - 1 : (start < 0 ? len + start : Math.min(start, len - 1));
    const e = end === undefined ? -1 : (end < 0 ? len + end : Math.min(end, len - 1));
    for (let i = s; i > e; i += step) out.push(arr[i]);
  }
  return out;
}

/**
 * 极简表达式求值，支持：
 *  @.a / @['a'] 字段访问
 *  常量: 数字 / 字符串 / true / false / null
 *  比较: == != < > <= >=
 *  逻辑: && ||
 */
function evalExpr(expr, ctx) {
  // 极简：先解析为 tokens，然后 shunting-yard 风格递归下降
  // 为简化实现：手工实现一个非常受限的解析器
  expr = expr.trim();
  // 处理 OR
  const orIdx = splitTopLevel(expr, '||');
  if (orIdx >= 0) {
    const left = expr.substring(0, orIdx);
    const right = expr.substring(orIdx + 2);
    return evalExpr(left, ctx) || evalExpr(right, ctx);
  }
  const andIdx = splitTopLevel(expr, '&&');
  if (andIdx >= 0) {
    const left = expr.substring(0, andIdx);
    const right = expr.substring(andIdx + 2);
    return evalExpr(left, ctx) && evalExpr(right, ctx);
  }
  // 比较
  for (const op of ['<=', '>=', '==', '!=', '<', '>']) {
    const idx = splitTopLevelOp(expr, op);
    if (idx >= 0) {
      const left = expr.substring(0, idx).trim();
      const right = expr.substring(idx + op.length).trim();
      const lv = evalValue(left, ctx);
      const rv = evalValue(right, ctx);
      switch (op) {
        case '==': return lv == rv; // eslint-disable-line
        case '!=': return lv != rv; // eslint-disable-line
        case '<': return lv < rv;
        case '>': return lv > rv;
        case '<=': return lv <= rv;
        case '>=': return lv >= rv;
      }
    }
  }
  return evalValue(expr, ctx);
}

function splitTopLevelOp(expr, op) {
  let depth = 0, inStr = null;
  for (let i = 0; i < expr.length - op.length + 1; i++) {
    const c = expr[i];
    if (inStr) {
      if (c === inStr && expr[i - 1] !== '\\') inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (depth === 0 && expr.substring(i, i + op.length) === op) return i;
  }
  return -1;
}

function splitTopLevel(expr, op) {
  let depth = 0, inStr = null;
  for (let i = 0; i < expr.length - op.length + 1; i++) {
    const c = expr[i];
    if (inStr) {
      if (c === inStr && expr[i - 1] !== '\\') inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && expr.substring(i, i + op.length) === op) return i;
  }
  return -1;
}

function evalValue(v, ctx) {
  v = v.trim();
  if (v === '@' || v === '$') return ctx[v];
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
  if ((v[0] === '"' && v[v.length-1] === '"') || (v[0] === "'" && v[v.length-1] === "'")) {
    return v.substring(1, v.length - 1).replace(/\\'/g, "'").replace(/\\"/g, '"');
  }
  // 路径访问：@.a.b、@['a-b']、@[0].name、$ 开头同理
  if (v.startsWith('@') || v.startsWith('$')) {
    const root = ctx[v[0]];
    const rest = v.substring(1);
    const parts = [];
    const re = /\.([A-Za-z_$][\w$]*)|\[\s*(?:'([^']*)'|"([^"]*)"|(-?\d+))\s*\]/g;
    let m;
    let consumed = 0;
    while ((m = re.exec(rest)) !== null) {
      if (m.index !== consumed) break; // 出现无法解析的片段
      if (m[1] !== undefined) parts.push(m[1]);
      else if (m[2] !== undefined) parts.push(m[2]);
      else if (m[3] !== undefined) parts.push(m[3]);
      else parts.push(Number(m[4]));
      consumed = re.lastIndex;
    }
    if (parts.length === 0 || consumed !== rest.length) throw new Error('Cannot eval: ' + v);
    let cur = root;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }
  throw new Error('Cannot eval: ' + v);
}

function highlightJSON(obj) {
  // 极简 JSON 着色
  const json = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  return escapeHtml(json)
    .replace(/&quot;((?:[^&]|&(?!quot;))*?)&quot;(\s*:)/g, '<span class="jp-result-hl">"$1"</span>$2')
    .replace(/\b(true|false|null)\b/g, '<span style="color:var(--tt-primary)">$1</span>')
    .replace(/(?<![\w-])-?\b\d+(\.\d+)?\b/g, '<span style="color:var(--tt-warning)">$&</span>');
}

let _queryTimer = null;
function runQuery() {
  clearError();
  if (_queryTimer) clearTimeout(_queryTimer);
  const inputRaw = $input.value.trim();
  const path = $path.value.trim();
  if (!inputRaw) { showError('请输入 JSON'); return; }
  if (!path) { showError('请输入 JSONPath 表达式'); return; }
  $result.innerHTML = '<div style="color:var(--tt-text-tertiary);padding:16px">⏳ 查询中...</div>';
  _queryTimer = setTimeout(() => { showError('查询超时 (10秒)'); $result.innerHTML = ''; }, 10000);
  let data;
  try { data = JSON.parse(inputRaw); }
  catch (e) { clearTimeout(_queryTimer); showError('JSON 解析错误: ' + e.message); return; }
  let result;
  try { result = evalJSONPath(data, path); }
  catch (e) { clearTimeout(_queryTimer); showError('JSONPath 错误: ' + e.message); return; }
  clearTimeout(_queryTimer);
  // 渲染上限：超大结果集会显著拖慢 innerHTML 与语法着色，这里只渲染前 100 条；
  // 导出与统计仍使用完整结果（lastQueryResult），保证数据不丢失。
  const RENDER_LIMIT = 100;
  const truncated = result.length > RENDER_LIMIT;
  const shown = truncated ? result.slice(0, RENDER_LIMIT) : result;
  const out = $recursive.checked || shown.length <= 1 ? JSON.stringify(shown, null, 2) : '[\n' + shown.map(x => '  ' + JSON.stringify(x)).join(',\n') + '\n]';
  // 根据路径高亮开关决定是否着色输出
  $result.innerHTML = ($highlightPath && $highlightPath.checked) ? highlightJSON(out) : escapeHtml(out);
  $resultMeta.textContent = `${result.length} 个匹配 · 路径: ${path}` + (truncated ? ` · 仅显示前 ${RENDER_LIMIT} 个` : '');
  // 缓存结果用于导出
  lastQueryResult = { path: path, result: result, time: Date.now() };
  // 保存查询历史
  saveQueryHistory(path, result.length);
}

function formatInput() {
  try { $input.value = JSON.stringify(JSON.parse($input.value), null, 2); clearError(); }
  catch (e) { showError('JSON 解析错误: ' + e.message); }
}

// 压缩JSON
function minifyInput() {
  try { $input.value = JSON.stringify(JSON.parse($input.value)); clearError(); }
  catch (e) { showError('JSON 解析错误: ' + e.message); }
}

// JSON验证
function validateJSON() {
  const raw = $input.value.trim();
  if (!raw) { showError('请输入 JSON'); return; }
  try {
    const parsed = JSON.parse(raw);
    const stats = getJSONStats(parsed);
    $error.textContent = '';
    $error.classList.add('jp-error--show');
    $error.style.color = 'var(--tt-success)';
    $error.innerHTML = '✅ JSON 格式正确 | 类型: ' + (Array.isArray(parsed) ? '数组' : typeof parsed === 'object' ? '对象' : typeof parsed) +
      ' | 键数: ' + stats.keys + ' | 深度: ' + stats.depth + ' | 大小: ' + (raw.length > 1024 ? (raw.length / 1024).toFixed(1) + ' KB' : raw.length + ' B');
  } catch (e) {
    showError('JSON 无效: ' + e.message);
  }
}

// JSON统计
function getJSONStats(obj) {
  let keys = 0, depth = 0;
  function walk(v, d) {
    if (d > depth) depth = d;
    if (v && typeof v === 'object') {
      const entries = Array.isArray(v) ? v : Object.values(v);
      keys += Array.isArray(v) ? v.length : Object.keys(v).length;
      entries.forEach(item => walk(item, d + 1));
    }
  }
  walk(obj, 0);
  return { keys, depth };
}

// 生成JSON树形视图
function buildTreeView(data, path, depth) {
  if (depth > 10) return '<span style="color:var(--tt-text-tertiary)">...</span>';
  if (data === null) return '<span style="color:var(--tt-text-tertiary)">null</span>';
  if (typeof data !== 'object') return '<span>' + escapeHtml(JSON.stringify(data)) + '</span>';

  const isArray = Array.isArray(data);
  const entries = isArray ? data.map((v, i) => [i, v]) : Object.entries(data);
  if (entries.length === 0) return isArray ? '<span style="color:var(--tt-text-tertiary)">[]</span>' : '<span style="color:var(--tt-text-tertiary)">{}</span>';

  let html = '';
  entries.forEach(([key, val], idx) => {
    const curPath = isArray ? path + '[' + key + ']' : path + '.' + key;
    const isLast = idx === entries.length - 1;
    const comma = isLast ? '' : ',';
    const typeColor = val === null ? 'var(--tt-text-tertiary)' : Array.isArray(val) ? 'var(--tt-primary)' : typeof val === 'object' ? 'var(--tt-primary)' : typeof val === 'string' ? 'var(--tt-success)' : typeof val === 'number' ? 'var(--tt-warning)' : 'var(--tt-text-tertiary)';
    const typeLabel = val === null ? 'null' : Array.isArray(val) ? 'Array[' + val.length + ']' : typeof val === 'object' ? 'Object{' + Object.keys(val).length + '}' : typeof val;

    if (val && typeof val === 'object') {
      html += '<div class="jp-tree-node" style="margin-left:' + (depth * 16) + 'px;cursor:pointer" data-path="' + escapeHtml(curPath) + '">';
      html += '<span class="jp-tree-toggle" style="display:inline-block;width:16px;text-align:center">▶</span>';
      html += '<span style="color:var(--tt-primary)">' + escapeHtml(String(key)) + '</span>';
      html += '<span style="color:var(--tt-text-tertiary);font-size:11px;margin-left:4px">' + typeLabel + '</span>';
      html += '</div>';
      html += '<div class="jp-tree-children" style="display:none">' + buildTreeView(val, curPath, depth + 1) + '</div>';
    } else {
      html += '<div class="jp-tree-leaf" style="margin-left:' + ((depth + 1) * 16) + 'px" data-path="' + escapeHtml(curPath) + '">';
      html += '<span style="color:var(--tt-primary)">' + escapeHtml(String(key)) + '</span>: ';
      html += '<span style="color:' + typeColor + '">' + escapeHtml(JSON.stringify(val)) + '</span>' + comma;
      html += '</div>';
    }
  });
  return html;
}

function showTreeView() {
  const raw = $input.value.trim();
  if (!raw) { showError('请输入 JSON'); return; }
  let data;
  try { data = JSON.parse(raw); } catch (e) { showError('JSON 解析错误: ' + e.message); return; }
  clearError();
  let html = '<div style="font-family:monospace;font-size:13px;line-height:1.6;max-height:400px;overflow:auto;padding:8px">';
  if (Array.isArray(data)) {
    html += '<div style="color:var(--tt-text-tertiary)">Array[' + data.length + ']</div>';
  } else if (typeof data === 'object' && data !== null) {
    html += '<div style="color:var(--tt-text-tertiary)">Object{' + Object.keys(data).length + '}</div>';
  }
  html += buildTreeView(data, '$', 0);
  html += '</div>';
  $result.innerHTML = html;
  $resultMeta.textContent = '树形视图 · 点击节点展开/折叠 · 点击路径可查询';
  // 绑定树节点点击
  $result.querySelectorAll('.jp-tree-node').forEach(node => {
    node.addEventListener('click', function() {
      const children = this.nextElementSibling;
      if (children) {
        const visible = children.style.display !== 'none';
        children.style.display = visible ? 'none' : 'block';
        this.querySelector('.jp-tree-toggle').textContent = visible ? '▶' : '▼';
      }
      const path = this.dataset.path;
      if (path) { $path.value = path; }
    });
  });
}

// 常用查询模板
const QUERY_TEMPLATES = [
  { name: '所有键', path: '$.*' },
  { name: '第一个元素', path: '$[0]' },
  { name: '最后元素', path: '$[-1]' },
  { name: '前N个', path: '$[:5]' },
  { name: '过滤查询', path: '$[?(@.price>10)]' },
  { name: '获取所有name', path: '$..name' },
  { name: '键值对', path: '$[*]' },
  { name: '奇偶索引', path: '$[::2]' },
];


async function pickFromPage() {
  try {
    // 通过 background.js 代理抓取页面中的 JSON 数据
    const response = await callBackground('extractPageJsonData', null);
    if (response && response.success && response.sources && response.sources.length) {
      const list = response.sources;
      const choice = prompt('检测到以下全局变量:\n' + list.map((s, i) => `${i+1}. ${s.key}`).join('\n') + '\n输入编号或直接粘贴其他 JSON:');
      if (choice === null) return;
      const idx = parseInt(choice, 10) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < list.length) {
        $input.value = JSON.stringify(list[idx].value, null, 2);
      } else {
        $input.value = choice;
      }
    } else {
      alert('当前页面未发现 JSON 数据');
    }
  } catch (e) {
    alert('获取失败: ' + e.message);
  }
}

document.getElementById('btn-query').addEventListener('click', runQuery);
document.getElementById('btn-format').addEventListener('click', formatInput);
document.getElementById('btn-pick').addEventListener('click', pickFromPage);
// 新增按钮绑定
var btnMinify = document.getElementById('btn-minify');
if (btnMinify) btnMinify.addEventListener('click', minifyInput);
var btnValidate = document.getElementById('btn-validate');
if (btnValidate) btnValidate.addEventListener('click', validateJSON);
var btnTree = document.getElementById('btn-tree');
if (btnTree) btnTree.addEventListener('click', showTreeView);
document.querySelectorAll('.jp-preset').forEach(btn => {
  btn.addEventListener('click', () => { $path.value = btn.dataset.path; runQuery(); });
});
// 绑定查询模板
document.querySelectorAll('.jp-template').forEach(btn => {
  btn.addEventListener('click', () => {
    const path = btn.dataset.path;
    if (path) { $path.value = path; runQuery(); }
  });
});
$path.addEventListener('keydown', (e) => { if (e.key === 'Enter') runQuery(); });

// ==================== 批量查询 ====================
function runBatchQuery() {
  clearError();
  const inputRaw = $input.value.trim();
  const batchInput = document.getElementById('jp-batch-input');
  if (!batchInput) return;
  const paths = batchInput.value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!inputRaw) { showError('请输入 JSON'); return; }
  if (paths.length === 0) { showError('请输入至少一条 JSONPath 表达式'); return; }
  let data;
  try { data = JSON.parse(inputRaw); }
  catch (e) { showError('JSON 解析错误: ' + e.message); return; }
  const results = [];
  for (const path of paths) {
    try {
      const r = evalJSONPath(data, path);
      results.push({ path: path, ok: true, count: r.length, values: r });
      saveQueryHistory(path, r.length);
    } catch (e) {
      results.push({ path: path, ok: false, error: e.message });
    }
  }
  let html = '<div style="padding:8px;font-family:var(--tt-font-mono);font-size:12px;line-height:1.6">';
  for (const r of results) {
    if (r.ok) {
      html += '<div style="margin-bottom:10px;padding:8px;border-left:3px solid var(--tt-success);background:var(--tt-bg-secondary);border-radius:0 4px 4px 0">';
      html += '<div style="font-weight:600;color:var(--tt-primary)">' + escapeHtml(r.path) + ' <span style="color:var(--tt-text-muted);font-weight:normal">(' + r.count + ' 匹配)</span></div>';
      html += '<pre style="margin-top:4px;white-space:pre-wrap;word-break:break-all;font-size:11px">' + escapeHtml(JSON.stringify(r.values, null, 2)) + '</pre>';
      html += '</div>';
    } else {
      html += '<div style="margin-bottom:10px;padding:8px;border-left:3px solid var(--tt-danger);background:var(--tt-bg-secondary);border-radius:0 4px 4px 0">';
      html += '<div style="font-weight:600;color:var(--tt-danger)">' + escapeHtml(r.path) + '</div>';
      html += '<div style="color:var(--tt-danger);font-size:11px">' + escapeHtml(r.error) + '</div>';
      html += '</div>';
    }
  }
  html += '</div>';
  $result.innerHTML = html;
  $resultMeta.textContent = '批量查询 · ' + results.length + ' 条表达式 · ' + results.filter(r => r.ok).length + ' 成功';
  lastQueryResult = { path: 'batch', result: results, time: Date.now() };
}

// ==================== 导出结果 ====================
function exportResult() {
  if (!lastQueryResult || !lastQueryResult.result) { showError('请先执行查询'); return; }
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';
  const box = document.createElement('div');
  box.style.cssText = 'background:var(--tt-bg);border-radius:8px;padding:16px;max-width:360px;width:90%';
  box.innerHTML = '<h3 style="margin:0 0 12px;font-size:14px">💾 导出查询结果</h3>' +
    '<button id="exp-json" style="display:block;width:100%;margin-bottom:8px;padding:8px;cursor:pointer;border-radius:4px;border:1px solid var(--tt-border);background:var(--tt-bg-secondary);color:var(--tt-text)">📋 导出为 JSON</button>' +
    '<button id="exp-csv" style="display:block;width:100%;margin-bottom:8px;padding:8px;cursor:pointer;border-radius:4px;border:1px solid var(--tt-border);background:var(--tt-bg-secondary);color:var(--tt-text)">📊 导出为 CSV</button>' +
    '<button id="exp-txt" style="display:block;width:100%;margin-bottom:8px;padding:8px;cursor:pointer;border-radius:4px;border:1px solid var(--tt-border);background:var(--tt-bg-secondary);color:var(--tt-text)">📄 导出为 TXT</button>' +
    '<button id="exp-close" style="display:block;width:100%;padding:8px;cursor:pointer;border-radius:4px;border:1px solid var(--tt-border)">关闭</button>';
  modal.appendChild(box);
  document.body.appendChild(modal);
  function close() { document.body.removeChild(modal); }
  document.getElementById('exp-close').onclick = close;
  document.getElementById('exp-json').onclick = function() {
    const text = JSON.stringify(lastQueryResult.result, null, 2);
    navigator.clipboard.writeText(text).then(() => { clearError(); $resultMeta.textContent = '已导出 JSON 到剪贴板'; });
    close();
  };
  document.getElementById('exp-csv').onclick = function() {
    let csv = 'index,value\n';
    const arr = Array.isArray(lastQueryResult.result) ? lastQueryResult.result : [lastQueryResult.result];
    arr.forEach((v, i) => { csv += i + ',"' + JSON.stringify(v).replace(/"/g, '""') + '"\n'; });
    navigator.clipboard.writeText(csv).then(() => { $resultMeta.textContent = '已导出 CSV 到剪贴板'; });
    close();
  };
  document.getElementById('exp-txt').onclick = function() {
    const arr = Array.isArray(lastQueryResult.result) ? lastQueryResult.result : [lastQueryResult.result];
    const text = arr.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join('\n');
    navigator.clipboard.writeText(text).then(() => { $resultMeta.textContent = '已导出 TXT 到剪贴板'; });
    close();
  };
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
}

// ==================== 绑定新增按钮 ====================
var btnBatch = document.getElementById('btn-batch');
var btnRunBatch = document.getElementById('btn-run-batch');
var batchPanel = document.getElementById('jp-batch-panel');
if (btnBatch) btnBatch.addEventListener('click', function() {
  if (batchPanel) batchPanel.style.display = batchPanel.style.display === 'none' ? 'block' : 'none';
});
if (btnRunBatch) btnRunBatch.addEventListener('click', runBatchQuery);

var btnExport = document.getElementById('btn-export');
if (btnExport) btnExport.addEventListener('click', exportResult);

var btnSyntax = document.getElementById('btn-syntax');
var syntaxPanel = document.getElementById('jp-syntax-panel');
if (btnSyntax) btnSyntax.addEventListener('click', function() {
  if (syntaxPanel) syntaxPanel.style.display = syntaxPanel.style.display === 'none' ? 'block' : 'none';
});

var btnClearHistory = document.getElementById('btn-clear-history');
if (btnClearHistory) btnClearHistory.addEventListener('click', async function() {
  try { await safeStorage('remove', HISTORY_KEY); } catch (e) {}
  renderQueryHistory();
  $resultMeta.textContent = '历史已清空';
});

// 历史项点击重新查询
var historyList = document.getElementById('jp-history-list');
if (historyList) historyList.addEventListener('click', function(e) {
  var item = e.target.closest('.jp-history-item');
  if (item && item.dataset.path) {
    $path.value = item.dataset.path;
    runQuery();
  }
});

// 初始渲染历史
renderQueryHistory();

window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!e.data || e.source !== window.parent) return;
  if (e.data && e.data.action === 'setTheme' && e.data.data) document.documentElement.setAttribute('data-theme', e.data.data.theme);
});

// 默认示例
$input.value = JSON.stringify({
  store: {
    book: [
      { category: "reference", author: "Nigel Rees", title: "Sayings of the Century", price: 8.95 },
      { category: "fiction", author: "Evelyn Waugh", title: "Sword of Honour", price: 12.99 },
      { category: "fiction", author: "Herman Melville", title: "Moby Dick", isbn: "0-553-21311-3", price: 8.99 },
      { category: "fiction", author: "J. R. R. Tolkien", title: "The Lord of the Rings", isbn: "0-395-19395-8", price: 22.99 }
    ],
    bicycle: { color: "red", price: 19.95 }
  }
}, null, 2);
$path.value = '$.store.book[*].title';
setTimeout(runQuery, 100);
})();
