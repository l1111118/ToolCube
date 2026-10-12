/**
 * 计算器 —— 表达式解析与科学计算
 *
 * 设计要点：
 *  1. 不使用 eval / new Function。扩展页 CSP 为 `script-src 'self'`（无 'unsafe-eval'），
 *     eval 会被浏览器拒绝执行；且 eval 处理用户输入本身也不安全。
 *  2. 采用递归下降解析器（recursive descent），优先级与结合性在代码中显式可读，
 *     便于扩展新函数与后续单元测试，而不是把逻辑塞进一长串 if/else。
 *  3. 支持：四则运算、幂（右结合）、括号、隐式乘法（2π、3(4+5)）、后缀阶乘与百分号、
 *     常用科学函数与常量。
 *  4. 所有定义域/取值错误（负数开方、ln(0)、阶乘非整数、除零等）统一抛出可读中文提示。
 *  5. 支持键盘输入，符合桌面计算器使用习惯。
 */

/** 数学常量 */
const CONSTANTS = Object.freeze({
  'π': Math.PI,
  'pi': Math.PI,
  'e': Math.E
});

/**
 * 科学函数表：每个函数声明自己的定义域约束与错误提示，
 * 定义域检查放在函数内部，保证"任何调用路径"都不会返回 NaN 而无提示。
 */
const FUNCTIONS = Object.freeze({
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => {
    const v = Math.tan(x);
    if (!Number.isFinite(v)) throw new Error('tan 在该角度无定义');
    return v;
  },
  asin: (x) => {
    if (x < -1 || x > 1) throw new Error('asin 的定义域为 [-1, 1]');
    return Math.asin(x);
  },
  acos: (x) => {
    if (x < -1 || x > 1) throw new Error('acos 的定义域为 [-1, 1]');
    return Math.acos(x);
  },
  atan: (x) => Math.atan(x),
  ln: (x) => {
    if (x <= 0) throw new Error('ln 的定义域为 (0, +∞)');
    return Math.log(x);
  },
  log: (x) => {
    if (x <= 0) throw new Error('log 的定义域为 (0, +∞)');
    return Math.log10(x);
  },
  log2: (x) => {
    if (x <= 0) throw new Error('log2 的定义域为 (0, +∞)');
    return Math.log2(x);
  },
  sqrt: (x) => {
    if (x < 0) throw new Error('负数不能开平方');
    return Math.sqrt(x);
  },
  cbrt: (x) => Math.cbrt(x),
  abs: (x) => Math.abs(x),
  exp: (x) => Math.exp(x)
});

/** 阶乘（仅支持非负整数，且受双精度浮点上限约束） */
function factorial(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error('阶乘仅支持非负整数');
  if (n > 170) throw new Error('阶乘参数过大（最大 170）');
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

/**
 * 词法分析：把表达式字符串切分为 token 流
 * @param {string} input
 * @returns {Array<{type:'number'|'const'|'func'|'op', value?:number, name?:string}>}
 */
function tokenize(input) {
  // 统一全角/显示用符号，使按钮插入的符号与键盘输入等价
  const s = String(input)
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/（/g, '(')
    .replace(/）/g, ')');

  const tokens = [];
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    if (ch === ' ' || ch === ',' || ch === '\t') { i++; continue; }

    if (ch >= '0' && ch <= '9' || ch === '.') {
      let j = i;
      while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.')) j++;
      const raw = s.slice(i, j);
      if ((raw.match(/\./g) || []).length > 1) throw new Error('数字格式错误: ' + raw);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error('数字格式错误: ' + raw);
      tokens.push({ type: 'number', value });
      i = j;
      continue;
    }

    if (ch === '√') { tokens.push({ type: 'func', name: 'sqrt' }); i++; continue; }
    if (ch === 'π') { tokens.push({ type: 'const', name: 'π' }); i++; continue; }

    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
      let j = i;
      while (j < s.length && /[a-zA-Z0-9]/.test(s[j])) j++;
      const word = s.slice(i, j);
      if (Object.prototype.hasOwnProperty.call(FUNCTIONS, word)) {
        tokens.push({ type: 'func', name: word });
      } else if (Object.prototype.hasOwnProperty.call(CONSTANTS, word)) {
        tokens.push({ type: 'const', name: word });
      } else {
        throw new Error('未知的函数或常量: ' + word);
      }
      i = j;
      continue;
    }

    if ('+-*/^()!%'.indexOf(ch) !== -1) { tokens.push({ type: 'op', value: ch }); i++; continue; }

    throw new Error('无法识别的字符: ' + ch);
  }

  return tokens;
}

/**
 * 语法分析 + 求值（递归下降）
 *
 * 文法（优先级由低到高）：
 *   expression := term (('+' | '-') term)*
 *   term       := unary (('*' | '/') unary | 隐式乘法)*
 *   unary      := ('+' | '-') unary | power
 *   power      := postfix ('^' unary)?          // 右结合
 *   postfix    := primary ('!' | '%')*
 *   primary    := number | const | func '(' expression ')' | '(' expression ')'
 *
 * @param {Array} tokens
 * @returns {number}
 */
function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expectOp = (value) => {
    const t = peek();
    if (!t || t.type !== 'op' || t.value !== value) throw new Error('缺少 "' + value + '"');
    pos++;
  };

  /** 判断该 token 是否可以作为一个 primary 的起始（用于隐式乘法） */
  const startsPrimary = (t) => !!t && (
    t.type === 'number' ||
    t.type === 'const' ||
    t.type === 'func' ||
    (t.type === 'op' && t.value === '(')
  );

  function parseExpression() {
    let left = parseTerm();
    for (;;) {
      const t = peek();
      if (!t || t.type !== 'op' || (t.value !== '+' && t.value !== '-')) break;
      next();
      const right = parseTerm();
      left = t.value === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm() {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (t && t.type === 'op' && (t.value === '*' || t.value === '/')) {
        next();
        const right = parseUnary();
        if (t.value === '/') {
          if (right === 0) throw new Error('除数不能为 0');
          left = left / right;
        } else {
          left = left * right;
        }
        continue;
      }
      // 隐式乘法：2π、3(4+5)、2sin(1)
      if (startsPrimary(t)) {
        left = left * parseUnary();
        continue;
      }
      break;
    }
    return left;
  }

  function parseUnary() {
    const t = peek();
    if (t && t.type === 'op' && (t.value === '-' || t.value === '+')) {
      next();
      const value = parseUnary();
      return t.value === '-' ? -value : value;
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePostfix();
    const t = peek();
    if (t && t.type === 'op' && t.value === '^') {
      next();
      const exponent = parseUnary();
      const result = Math.pow(base, exponent);
      if (Number.isNaN(result)) throw new Error('幂运算结果无定义');
      if (!Number.isFinite(result)) throw new Error('幂运算结果超出可表示范围');
      return result;
    }
    return base;
  }

  function parsePostfix() {
    let value = parsePrimary();
    for (;;) {
      const t = peek();
      if (!t || t.type !== 'op') break;
      if (t.value === '!') { next(); value = factorial(value); continue; }
      if (t.value === '%') { next(); value = value / 100; continue; }
      break;
    }
    return value;
  }

  function parsePrimary() {
    const t = next();
    if (!t) throw new Error('表达式不完整');

    if (t.type === 'number') return t.value;
    if (t.type === 'const') return CONSTANTS[t.name];

    if (t.type === 'func') {
      const argStart = peek();
      if (!argStart || argStart.type !== 'op' || argStart.value !== '(') {
        throw new Error('函数 ' + t.name + ' 后需要括号，例如 ' + t.name + '(2)');
      }
      next();
      const arg = parseExpression();
      expectOp(')');
      return FUNCTIONS[t.name](arg);
    }

    if (t.type === 'op' && t.value === '(') {
      const value = parseExpression();
      expectOp(')');
      return value;
    }

    throw new Error('表达式语法错误：意外的 "' + (t.value || t.name || '') + '"');
  }

  const result = parseExpression();
  if (pos < tokens.length) throw new Error('表达式语法错误：存在多余的内容');
  return result;
}

/**
 * 消除双精度浮点噪声（例如 0.1 + 0.2 = 0.30000000000000004）
 * @param {number} value
 * @returns {number}
 */
function normalize(value) {
  const rounded = Number(value.toPrecision(12));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * 计算表达式
 * @param {string} expression
 * @returns {{ok:true, value:number} | {ok:false, error:string}}
 */
function evaluate(expression) {
  const trimmed = String(expression || '').trim();
  if (!trimmed) return { ok: false, error: '' };
  try {
    const value = parse(tokenize(trimmed));
    if (Number.isNaN(value)) return { ok: false, error: '结果无定义' };
    if (!Number.isFinite(value)) return { ok: false, error: '结果超出可表示范围' };
    return { ok: true, value: normalize(value) };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : '表达式错误' };
  }
}

/**
 * 数值展示格式：极大/极小值使用科学计数法，避免出现一长串零
 * @param {number} value
 * @returns {string}
 */
function formatNumber(value) {
  if (!Number.isFinite(value)) return 'Error';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-9)) return value.toExponential(6);
  return String(value);
}

document.addEventListener('DOMContentLoaded', () => {
  const displayEl = document.getElementById('calc-display');
  const prevEl = document.getElementById('calc-prev');
  const sciPanel = document.getElementById('calc-sci');
  const modeToggle = document.getElementById('calc-mode-toggle');
  const copyBtn = document.getElementById('calc-copy');

  /** 当前表达式（以字符串形式保存，用户可见且可编辑式撤销） */
  let expression = '';
  /** 上一次提交的错误信息（仅在按下 "=" 后展示，避免输入过程中频繁报错干扰） */
  let lastError = '';

  function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch (e) { return false; } }
  function safeStorage(op, ...args) {
    if (!isCtxValid()) return op === 'get' ? Promise.resolve({}) : Promise.resolve();
    try { return chrome.storage.local[op](...args); } catch (e) { return op === 'get' ? Promise.resolve({}) : Promise.resolve(); }
  }

  function render() {
    displayEl.textContent = expression || '0';
    if (lastError) {
      prevEl.textContent = '⚠️ ' + lastError;
      return;
    }
    // 实时预览：仅当表达式可完整求值时展示，输入过程中不打扰
    if (!expression) { prevEl.textContent = ''; return; }
    const preview = evaluate(expression);
    prevEl.textContent = preview.ok ? '= ' + formatNumber(preview.value) : '';
  }

  /** 删除最后一个 token；函数名连同左括号整体删除，避免留下 "sin" 之类的残缺片段 */
  function removeLastToken(expr) {
    if (!expr) return '';
    const names = Object.keys(FUNCTIONS).sort((a, b) => b.length - a.length);
    for (const name of names) {
      if (expr.endsWith(name + '(')) return expr.slice(0, -(name.length + 1));
    }
    if (expr.endsWith('√(')) return expr.slice(0, -2);
    return expr.slice(0, -1);
  }

  /** 切换末尾数字的正负号 */
  function toggleSign(expr) {
    if (!expr) return '-';
    const match = expr.match(/(\d+\.?\d*)$/);
    if (!match) return expr + '-';
    const start = expr.length - match[1].length;
    if (start > 0 && expr[start - 1] === '-') {
      const before = expr[start - 2];
      // 仅当该 '-' 是"一元负号"（前一位是运算符或表达式开头）时才移除
      if (before === undefined || '+-*/^(%!'.indexOf(before) !== -1) {
        return expr.slice(0, start - 1) + match[1];
      }
    }
    return expr.slice(0, start) + '-' + match[1];
  }

  function commit() {
    if (!expression) return;
    const result = evaluate(expression);
    if (!result.ok) {
      lastError = result.error || '表达式错误';
      render();
      return;
    }
    prevEl.textContent = expression + ' =';
    expression = formatNumber(result.value);
    lastError = '';
    displayEl.textContent = expression;
  }

  function handleKey(key) {
    if (!key) return;
    switch (key) {
      case 'C':
        expression = '';
        lastError = '';
        render();
        return;
      case 'BACK':
        expression = removeLastToken(expression);
        lastError = '';
        render();
        return;
      case 'NEG':
        expression = toggleSign(expression);
        lastError = '';
        render();
        return;
      case 'RECIP':
        expression = expression ? '1/(' + expression + ')' : '1/(';
        lastError = '';
        render();
        return;
      case '=':
        commit();
        return;
      default:
        expression += key;
        lastError = '';
        render();
    }
  }

  document.querySelectorAll('.calc-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleKey(btn.dataset.key));
  });

  // ── 键盘输入 ──
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key;
    if (key >= '0' && key <= '9') { handleKey(key); e.preventDefault(); return; }
    if ('+-*/.()^%!'.indexOf(key) !== -1) { handleKey(key); e.preventDefault(); return; }
    if (key === '×') { handleKey('×'); e.preventDefault(); return; }
    if (key === 'Enter' || key === '=') { handleKey('='); e.preventDefault(); return; }
    if (key === 'Backspace') { handleKey('BACK'); e.preventDefault(); return; }
    if (key === 'Delete' || key === 'Escape') { handleKey('C'); e.preventDefault(); return; }
    if (key === 'p' || key === 'P') { handleKey('π'); e.preventDefault(); }
  });

  // ── 科学模式开关（记忆用户选择） ──
  function applySciMode(enabled) {
    sciPanel.hidden = !enabled;
    modeToggle.textContent = enabled ? '基础模式' : '科学模式';
    modeToggle.classList.toggle('btn--primary', enabled);
    modeToggle.classList.toggle('btn--secondary', !enabled);
  }

  modeToggle.addEventListener('click', () => {
    const enabled = sciPanel.hidden;
    applySciMode(enabled);
    safeStorage('set', { toolbox_calc_sci_mode: enabled });
  });

  safeStorage('get', 'toolbox_calc_sci_mode').then((result) => {
    applySciMode(!!(result && result.toolbox_calc_sci_mode));
  });

  // ── 复制结果 ──
  copyBtn.addEventListener('click', async () => {
    const text = displayEl.textContent || '';
    const original = copyBtn.textContent;
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = '✅ 已复制';
    } catch (e) {
      copyBtn.textContent = '❌ 复制失败';
    }
    setTimeout(() => { copyBtn.textContent = original; }, 1500);
  });

  // ── 从 sidebar 传入数据（右键菜单 / 自动保存恢复） ──
  window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!e.data || e.source !== window.parent) return;
    if (e.data.action === 'setTheme' && e.data.data) {
      document.documentElement.setAttribute('data-theme', e.data.data.theme);
    }
    if (e.data.action === 'setData') {
      const payload = e.data.data;
      const value = typeof payload === 'string' ? payload : (payload && (payload.text || payload.value));
      if (typeof value === 'string' && value.trim()) {
        expression = value.trim();
        lastError = '';
        render();
      }
    }
  });

  render();
});
