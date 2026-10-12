/**
 * SQL格式化工具
 */
const elements = {
  inputArea: document.getElementById('input-area'),
  outputArea: document.getElementById('output-area'),
  btnFormat: document.getElementById('btn-format'),
  btnMinify: document.getElementById('btn-minify'),
  btnCopy: document.getElementById('btn-copy'),
  dialectSelect: document.getElementById('dialect-select'),
  toast: document.getElementById('toast')
};

function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
// SQL关键字
const KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE',
  'CREATE', 'DROP', 'ALTER', 'TABLE', 'INDEX', 'VIEW',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON',
  'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET',
  'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN',
  'VALUES', 'SET', 'INTO', 'AS', 'DISTINCT', 'ALL'
];

/**
 * 各方言的关键字补充表。
 *
 * 方言选项的实际作用就是决定「哪些词会被识别为大写关键字」——
 * 例如 T-SQL 的 TOP、PostgreSQL 的 RETURNING/ILIKE、SQLite 的 PRAGMA。
 * 旧实现里这个下拉框被读取后从未使用，选任何方言结果都完全一样，
 * 属于典型的「看着有用实则无效」控件。
 */
const DIALECT_KEYWORDS = {
  standard: [],
  mysql: ['REPLACE', 'DUPLICATE', 'KEY', 'ENGINE', 'AUTO_INCREMENT', 'UNSIGNED', 'IFNULL', 'LOCK', 'SHOW', 'DESCRIBE', 'STRAIGHT_JOIN'],
  postgresql: ['ILIKE', 'SIMILAR', 'RETURNING', 'SERIAL', 'CONFLICT', 'DO', 'NOTHING', 'ARRAY', 'JSONB', 'LATERAL', 'ONLY', 'VACUUM', 'ANALYZE', 'TRUNCATE'],
  sqlite: ['AUTOINCREMENT', 'PRAGMA', 'ATTACH', 'DETACH', 'WITHOUT', 'ROWID', 'GLOB', 'REINDEX', 'REPLACE', 'CONFLICT']
};

/** 方言显示名（用于提示文案） */
const DIALECT_LABELS = {
  standard: '标准SQL',
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  sqlite: 'SQLite'
};

/** 当前方言下的完整关键字表 */
function getKeywords() {
  const dialect = elements.dialectSelect ? elements.dialectSelect.value : 'standard';
  return KEYWORDS.concat(DIALECT_KEYWORDS[dialect] || []);
}

document.addEventListener('DOMContentLoaded', () => {
  elements.btnFormat.addEventListener('click', formatSQL);
  elements.btnMinify.addEventListener('click', minifySQL);
  elements.btnCopy.addEventListener('click', copyOutput);
  window.addEventListener('message', handleMessage);
  loadSavedData();
});

/**
 * SQL 词法切分：把源码切成「字符串 / 注释 / 普通代码」三类片段
 *
 * 为什么必须先切分：关键字大写、括号换行、逗号换行、空白折叠这些替换
 * 一旦作用到字符串字面量与注释上就会破坏语义，例如
 *   select * from t where name = 'select'
 * 中的 'select' 会被改写成换行 + 大写，SQL 语义被破坏。
 * 切分后只对普通代码片段做转换，字符串与注释原样保留。
 *
 * @param {string} sql
 * @returns {Array<{type:'code'|'string'|'comment', text:string}>}
 */
function lexSql(sql) {
  const parts = [];
  let buf = '';
  let i = 0;
  const n = sql.length;
  const flush = () => { if (buf) { parts.push({ type: 'code', text: buf }); buf = ''; } };

  while (i < n) {
    const ch = sql[i];

    // 行注释：-- 到行尾
    if (ch === '-' && sql[i + 1] === '-') {
      flush();
      let j = i;
      while (j < n && sql[j] !== '\n') j++;
      parts.push({ type: 'comment', text: sql.slice(i, j) });
      i = j;
      continue;
    }

    // 块注释
    if (ch === '/' && sql[i + 1] === '*') {
      flush();
      let end = sql.indexOf('*/', i + 2);
      end = end === -1 ? n : end + 2;
      parts.push({ type: 'comment', text: sql.slice(i, end) });
      i = end;
      continue;
    }

    // 字符串与带引号的标识符：'...' / "..." / `...`（成对引号表示转义）
    if (ch === "'" || ch === '"' || ch === '`') {
      flush();
      let j = i + 1;
      while (j < n) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) { j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      parts.push({ type: 'string', text: sql.slice(i, j) });
      i = j;
      continue;
    }

    // SQL Server 方括号标识符
    if (ch === '[') {
      const close = sql.indexOf(']', i + 1);
      if (close !== -1) {
        flush();
        parts.push({ type: 'string', text: sql.slice(i, close + 1) });
        i = close + 1;
        continue;
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return parts;
}

function formatSQL() {
  const raw = elements.inputArea.value.trim();
  if (!raw) { showToast('请输入SQL语句', 'error'); return; }

  try {
    // 用占位符把字符串与注释「挖空」，只对代码片段做格式化，最后原样填回
    const holes = [];
    let code = '';
    for (const part of lexSql(raw)) {
      if (part.type === 'code') {
        code += part.text;
      } else {
        code += '\u0000' + holes.length + '\u0000';
        holes.push(part.text);
      }
    }

    code = code.replace(/\s+/g, ' ');

    // 关键字大写并换行（关键字表按当前方言选择）
    getKeywords().forEach(kw => {
      code = code.replace(new RegExp('\\b' + kw + '\\b', 'gi'), '\n' + kw.toUpperCase());
    });

    // 处理括号与逗号
    code = code.replace(/\(/g, '(\n  ').replace(/\)/g, '\n)');
    code = code.replace(/,\s*/g, ',\n  ');

    // 清理多余空行
    code = code.replace(/\n\s*\n/g, '\n').trim();

    elements.outputArea.value = code.replace(/\u0000(\d+)\u0000/g, (m, idx) => holes[Number(idx)]);
    const dialect = elements.dialectSelect ? elements.dialectSelect.value : 'standard';
    showToast('格式化完成（' + (DIALECT_LABELS[dialect] || dialect) + '）', 'success');
    saveToHistory('format');
  } catch (e) {
    showToast('格式化失败', 'error');
  }
}

function minifySQL() {
  const raw = elements.inputArea.value.trim();
  if (!raw) { showToast('请输入SQL语句', 'error'); return; }

  try {
    let out = '';
    let pendingSpace = false;
    let lastChar = '';

    const emit = (text) => {
      if (pendingSpace && lastChar && !/[\s(,.]/.test(lastChar)) out += ' ';
      pendingSpace = false;
      out += text;
      lastChar = text[text.length - 1];
    };

    for (const part of lexSql(raw)) {
      if (part.type === 'comment') continue;

      if (part.type === 'string') {
        emit(part.text);
        continue;
      }

      for (const ch of part.text) {
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
          pendingSpace = true;
          continue;
        }
        if ('(),;'.indexOf(ch) !== -1) {
          out = out.replace(/[ \t]+$/, '');
          out += ch;
          lastChar = ch;
          pendingSpace = false;
          continue;
        }
        emit(ch);
      }
    }

    elements.outputArea.value = out.trim();
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
      data: { toolId: 'sql-formatter', type: action, data: { action } }
    });
  } catch (e) {}
}

async function loadSavedData() {
  try {
    const res = await safeSend({ action: 'getToolData', data: { toolId: 'sql-formatter' } });
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
    formatSQL();
  }
}
