/**
 * CSS美化工具
 */
const elements = {
  inputArea: document.getElementById('input-area'),
  outputArea: document.getElementById('output-area'),
  btnFormat: document.getElementById('btn-format'),
  btnMinify: document.getElementById('btn-minify'),
  btnCopy: document.getElementById('btn-copy'),
  btnClear: document.getElementById('btn-clear'),
  toast: document.getElementById('toast')
};

function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
document.addEventListener('DOMContentLoaded', () => {
  elements.btnFormat.addEventListener('click', formatCSS);
  elements.btnMinify.addEventListener('click', minifyCSS);
  elements.btnCopy.addEventListener('click', copyOutput);
  elements.btnClear.addEventListener('click', () => {
    elements.inputArea.value = '';
    elements.outputArea.value = '';
  });
  window.addEventListener('message', handleMessage);
  loadSavedData();
});

/**
 * 需要参与「去空白」处理的标点
 */
const CSS_PUNCT = '{};:,>+~';

/**
 * 按「注释 / 字符串 / url() / 普通代码」切分 CSS
 *
 * 为什么要切分而不是直接全局正则替换：冒号与逗号在 url() 与字符串内部必须原样保留。
 * 早期实现用一个「冒号加空白」的全局正则处理，结果把
 *   a:hover            → "a: hover"
 *   url(http://host/a) → "url(http: //host/a)"
 *   p::before          → "p: : before"
 * 全部改坏。切分后只对普通代码片段做转换，字面量片段原样输出。
 *
 * @param {string} css
 * @returns {Array<{type:'code'|'string'|'url'|'comment', text:string}>}
 */
function lexCss(css) {
  const parts = [];
  let buf = '';
  let i = 0;
  const n = css.length;
  const flush = () => { if (buf) { parts.push({ type: 'code', text: buf }); buf = ''; } };

  while (i < n) {
    const ch = css[i];

    if (ch === '/' && css[i + 1] === '*') {
      flush();
      let end = css.indexOf('*/', i + 2);
      end = end === -1 ? n : end + 2;
      parts.push({ type: 'comment', text: css.slice(i, end) });
      i = end;
      continue;
    }

    if (ch === '"' || ch === "'") {
      flush();
      let j = i + 1;
      while (j < n) {
        if (css[j] === '\\') { j += 2; continue; }
        if (css[j] === ch) { j++; break; }
        j++;
      }
      parts.push({ type: 'string', text: css.slice(i, j) });
      i = j;
      continue;
    }

    if (/^url\(/i.test(css.substr(i, 4))) {
      flush();
      let j = css.indexOf(')', i + 4);
      j = j === -1 ? n : j + 1;
      parts.push({ type: 'url', text: css.slice(i, j) });
      i = j;
      continue;
    }

    buf += ch;
    i++;
  }
  flush();
  return parts;
}

function formatCSS() {
  const css = elements.inputArea.value.trim();
  if (!css) { showToast('请输入CSS代码', 'error'); return; }

  try {
    const parts = lexCss(css);
    const INDENT = '  ';
    let out = '';
    let indent = 0;
    let blockDepth = 0;
    let parenDepth = 0;
    let pendingSpace = false;
    let prevChar = '';

    const newline = () => {
      out = out.replace(/[ \t]+$/, '');
      if (!out.endsWith('\n')) out += '\n';
      out += INDENT.repeat(indent);
      pendingSpace = false;
      prevChar = '';
    };
    const emit = (text) => {
      if (pendingSpace && out && !out.endsWith('\n') && !out.endsWith(' ')) out += ' ';
      pendingSpace = false;
      out += text;
      prevChar = text[text.length - 1];
    };

    for (const part of parts) {
      if (part.type === 'comment') {
        newline();
        out += part.text;
        newline();
        continue;
      }
      if (part.type === 'string' || part.type === 'url') {
        emit(part.text);
        continue;
      }

      for (const ch of part.text) {
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
          pendingSpace = true;
          continue;
        }
        if (ch === '{') {
          out = out.replace(/[ \t]+$/, '');
          out += ' {';
          blockDepth++;
          indent++;
          newline();
          continue;
        }
        if (ch === '}') {
          blockDepth = Math.max(0, blockDepth - 1);
          indent = Math.max(0, indent - 1);
          newline();
          out += '}';
          prevChar = '}';
          continue;
        }
        if (ch === ';') {
          out = out.replace(/[ \t]+$/, '');
          out += ';';
          newline();
          continue;
        }
        if (ch === ':') {
          // 伪元素 ::before —— 紧邻的前一个字符就是冒号，不补空格
          if (prevChar === ':') { out += ch; prevChar = ':'; continue; }
          // 仅声明（块内）与 @media 条件（括号内）需要补空格；
          // 选择器伪类 a:hover 处于块外且不在括号内，不能补空格
          const isDeclaration = blockDepth > 0 || parenDepth > 0;
          out = out.replace(/[ \t]+$/, '');
          out += isDeclaration ? ': ' : ':';
          prevChar = ':';
          continue;
        }
        if (ch === '(') { parenDepth++; emit(ch); continue; }
        if (ch === ')') { parenDepth = Math.max(0, parenDepth - 1); emit(ch); continue; }
        if (ch === ',') {
          out = out.replace(/[ \t]+$/, '') + ',';
          pendingSpace = true;
          prevChar = ',';
          continue;
        }
        emit(ch);
      }
    }

    elements.outputArea.value = out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    showToast('格式化完成', 'success');
    saveToHistory('format');
  } catch (e) {
    showToast('格式化失败', 'error');
  }
}

function minifyCSS() {
  const css = elements.inputArea.value.trim();
  if (!css) { showToast('请输入CSS代码', 'error'); return; }

  try {
    const parts = lexCss(css);
    let out = '';
    let pendingSpace = false;

    for (const part of parts) {
      if (part.type === 'comment') continue;

      if (part.type === 'string' || part.type === 'url') {
        if (pendingSpace && out && CSS_PUNCT.indexOf(out[out.length - 1]) === -1) out += ' ';
        pendingSpace = false;
        out += part.text;
        continue;
      }

      for (const ch of part.text) {
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
          pendingSpace = true;
          continue;
        }
        if (CSS_PUNCT.indexOf(ch) !== -1) {
          pendingSpace = false;
          out += ch;
          continue;
        }
        if (pendingSpace && out && CSS_PUNCT.indexOf(out[out.length - 1]) === -1) out += ' ';
        pendingSpace = false;
        out += ch;
      }
    }

    elements.outputArea.value = out
      .replace(/;\s*}/g, '}')
      .replace(/\s*!\s*important/gi, ' !important')
      .trim();
    showToast('压缩完成', 'success');
    saveToHistory('minify');
  } catch (e) {
    showToast('压缩失败', 'error');
  }
}

async function copyOutput() {
  const text = elements.outputArea.value;
  if (!text) { showToast('没有可复制的内容', 'error'); return; }
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制', 'success');
  } catch (e) {
    showToast('复制失败', 'error');
  }
}

function showToast(msg, type = 'info') {
  elements.toast.textContent = msg;
  elements.toast.className = 'toast toast--' + type;
  elements.toast.classList.add('toast--show');
  setTimeout(() => elements.toast.classList.remove('toast--show'), 3000);
}

async function saveToHistory(action) {
  try {
    await safeSend({
      action: 'saveToHistory',
      data: { toolId: 'css-beautifier', type: action, data: { action } }
    });
  } catch (e) {}
}

async function loadSavedData() {
  try {
    const res = await safeSend({ action: 'getToolData', data: { toolId: 'css-beautifier' } });
    if (res && res.input) elements.inputArea.value = res.input;
  } catch (e) {}
}

function handleMessage(e) {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!e.data || e.source !== window.parent) return;
  const { action, data } = e.data;
  if (action === 'setTheme' && data && data.theme) { document.documentElement.setAttribute('data-theme', data.theme); return; }
  if (action === 'setData' && typeof data === 'string') {
    elements.inputArea.value = data;
    formatCSS();
  }
}
