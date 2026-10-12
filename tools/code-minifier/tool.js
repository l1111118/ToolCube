/**
 * 代码压缩 / 美化 - JS / CSS / HTML
 *
 * 设计说明（为什么不用全局正则替换）：
 * 注释符号、空白、冒号等都可能出现在字符串、模板串或正则字面量内部。
 * 早期实现直接用正则删行注释、用空白折叠替换压空白、用单词边界给关键字补空格，
 * 结果会把 "http://x" 截断成 "http:"、把 document 拆成 "do cument"、
 * 把字符串内的连续空格改掉 —— 静默产出错误代码。
 * 本实现改为「词法扫描 + 按 token 重组」：先区分字面量与普通代码，
 * 只在代码区域做转换，字面量内容原样保留。
 */
document.addEventListener('DOMContentLoaded', () => {
  const I = document.getElementById('input-area');
  const O = document.getElementById('output-area');
  const Vi = document.getElementById('validation-icon');
  const Vt = document.getElementById('validation-text');
  const lang = document.getElementById('lang-select');

  // ==================== 通用字符分类 ====================

  /** 标识符/数字可用的字符 */
  function isWordChar(ch) {
    return /[A-Za-z0-9_$]/.test(ch);
  }

  /** 仅在必要时才输出一个空格，避免两个 token 粘连成别的 token */
  function needsSpace(prevCh, nextCh) {
    if (!prevCh || !nextCh) return false;
    if (isWordChar(prevCh) && isWordChar(nextCh)) return true;
    // 相邻运算符不得被合并：+ + → ++，- - → --，/ / → //，/ * → /*，< ! → <!--
    if ((prevCh === '+' && nextCh === '+') ||
        (prevCh === '-' && nextCh === '-') ||
        (prevCh === '/' && (nextCh === '/' || nextCh === '*')) ||
        (prevCh === '<' && nextCh === '!')) return true;
    // 数字后紧跟点号会被解析为小数（1 . toString() 与 1.toString() 不同）
    if (/[0-9]/.test(prevCh) && nextCh === '.') return true;
    return false;
  }

  // ==================== JS 词法扫描 ====================

  /** 这些关键字之后出现的 `/` 是正则字面量的开始，而不是除号 */
  const REGEX_PRECEDING_KEYWORDS = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'throw', 'case', 'do', 'else', 'yield', 'await', 'default'
  ]);

  /** 判断 `上一个 token` 之后是否允许出现正则字面量 */
  function regexAllowedAfter(prev) {
    if (!prev) return true;
    if (REGEX_PRECEDING_KEYWORDS.has(prev)) return true;
    if (prev === ')' || prev === ']' || prev === '}' || prev === '++' || prev === '--') return false;
    const lastCh = prev[prev.length - 1];
    if (lastCh === '"' || lastCh === "'" || lastCh === '`') return false;
    if (isWordChar(lastCh)) return false; // 标识符 / 数字
    return true;
  }

  /**
   * 扫描字符串字面量，返回结束位置（含结尾引号；未闭合则返回行尾或文件末尾）
   */
  function scanQuoted(code, start, quote) {
    const n = code.length;
    let j = start + 1;
    while (j < n) {
      if (code[j] === '\\') { j += 2; continue; }
      if (code[j] === quote) return j + 1;
      if (code[j] === '\n') return j; // 未闭合（非法源码），就此截断以免吞掉后续内容
      j++;
    }
    return n;
  }

  /**
   * 尝试扫描正则字面量，返回结束位置（含标志位）；若该位置并不构成正则则返回 0
   */
  function scanRegex(code, start) {
    const n = code.length;
    let j = start + 1;
    let inClass = false;
    while (j < n) {
      const ch = code[j];
      if (ch === '\\') { j += 2; continue; }
      if (ch === '\n') return 0;
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) {
        j++;
        while (j < n && /[a-z]/i.test(code[j])) j++;
        return j;
      }
      j++;
    }
    return 0;
  }

  /**
   * 扫描模板字符串，返回结束位置（含结尾反引号）
   * 模板内可嵌套任意表达式（含对象字面量、字符串、正则与嵌套模板），
   * 因此 ${} 内部必须交给 scanInterpolation 处理，不能只做简单的花括号计数 ——
   * 否则插值内的对象字面量会把计数带偏，导致把内层模板的反引号误判为外层结束，
   * 后续内容被当成普通代码并压掉空白（模板内容被静默改写）。
   */
  function scanTemplate(code, start) {
    const n = code.length;
    let j = start + 1;
    while (j < n) {
      const ch = code[j];
      if (ch === '\\') { j += 2; continue; }
      if (ch === '`') return j + 1;
      if (ch === '$' && code[j + 1] === '{') {
        j = scanInterpolation(code, j + 2);
        continue;
      }
      j++;
    }
    return n;
  }

  /**
   * 扫描 ${ 之后的插值表达式，返回匹配的 } 之后的位置
   */
  function scanInterpolation(code, start) {
    const n = code.length;
    let j = start;
    let braceDepth = 1;
    let lastSignificant = '';
    while (j < n && braceDepth > 0) {
      const ch = code[j];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') { j++; continue; }
      if (ch === '/' && code[j + 1] === '/') { while (j < n && code[j] !== '\n') j++; continue; }
      if (ch === '/' && code[j + 1] === '*') {
        j += 2;
        while (j < n && !(code[j] === '*' && code[j + 1] === '/')) j++;
        j += 2;
        continue;
      }
      if (ch === '"' || ch === "'") { j = scanQuoted(code, j, ch); lastSignificant = ch; continue; }
      if (ch === '`') { j = scanTemplate(code, j); lastSignificant = '`'; continue; }
      if (ch === '/' && regexAllowedAfter(lastSignificant)) {
        const end = scanRegex(code, j);
        if (end > 0) { j = end; lastSignificant = '/'; continue; }
      }
      if (ch === '{') { braceDepth++; j++; lastSignificant = '{'; continue; }
      if (ch === '}') { braceDepth--; j++; lastSignificant = '}'; continue; }
      lastSignificant = ch;
      j++;
    }
    return j;
  }

  /**
   * 词法扫描 JS 源码，产出 token 序列（注释与空白被丢弃，但记录其前方是否有换行）
   * @param {string} code
   * @returns {Array<{type:string, text:string, newlineBefore:boolean}>}
   */
  function tokenizeJS(code) {
    const tokens = [];
    const n = code.length;
    let i = 0;
    let pendingNewline = false;
    let prev = '';

    const push = (type, text) => {
      tokens.push({ type, text, newlineBefore: pendingNewline });
      pendingNewline = false;
      prev = text;
    };

    while (i < n) {
      const ch = code[i];
      const next = code[i + 1];

      // ---- 空白 ----
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f' || ch === '\v' || ch === '\u00a0') {
        if (ch === '\n' || ch === '\r') pendingNewline = true;
        i++;
        continue;
      }

      // ---- 行注释 ----
      if (ch === '/' && next === '/') {
        i += 2;
        while (i < n && code[i] !== '\n') i++;
        continue;
      }

      // ---- 块注释（内部换行同样影响 ASI，需要保留换行标记）----
      if (ch === '/' && next === '*') {
        i += 2;
        while (i < n && !(code[i] === '*' && code[i + 1] === '/')) {
          if (code[i] === '\n') pendingNewline = true;
          i++;
        }
        i += 2;
        continue;
      }

      // ---- 字符串字面量 ----
      if (ch === '"' || ch === "'") {
        const end = scanQuoted(code, i, ch);
        push('string', code.slice(i, end));
        i = end;
        continue;
      }

      // ---- 模板字符串（含 ${} 插值，插值内可嵌套任意表达式）----
      if (ch === '`') {
        const end = scanTemplate(code, i);
        push('template', code.slice(i, end));
        i = end;
        continue;
      }

      // ---- 正则字面量（仅在语法上允许出现的位置尝试）----
      if (ch === '/' && regexAllowedAfter(prev)) {
        const end = scanRegex(code, i);
        if (end > 0) {
          push('regex', code.slice(i, end));
          i = end;
          continue;
        }
        // 未能构成正则（例如 `a / b`）→ 按普通运算符处理，落入下方分支
      }

      // ---- 数字字面量 ----
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(next || ''))) {
        let j = i;
        if (ch === '0' && next && /[xXbBoO]/.test(next)) {
          j = i + 2;
          while (j < n && /[0-9a-fA-F_]/.test(code[j])) j++;
        } else {
          while (j < n && /[0-9_]/.test(code[j])) j++;
          if (code[j] === '.') {
            j++;
            while (j < n && /[0-9_]/.test(code[j])) j++;
          }
          if (code[j] === 'e' || code[j] === 'E') {
            let k = j + 1;
            if (code[k] === '+' || code[k] === '-') k++;
            if (/[0-9]/.test(code[k] || '')) {
              j = k;
              while (j < n && /[0-9_]/.test(code[j])) j++;
            }
          }
        }
        if (code[j] === 'n') j++; // BigInt 后缀
        push('number', code.slice(i, j));
        i = j;
        continue;
      }

      // ---- 标识符 / 关键字 ----
      if (isWordChar(ch)) {
        let j = i;
        while (j < n && isWordChar(code[j])) j++;
        push('word', code.slice(i, j));
        i = j;
        continue;
      }

      // ---- 运算符 / 标点：按最长匹配取出 ++ 与 --，它们是正则判定的关键 ----
      if ((ch === '+' || ch === '-') && next === ch) {
        push('punct', ch + ch);
        i += 2;
        continue;
      }
      push('punct', ch);
      i++;
    }

    return tokens;
  }

  // ==================== JS 压缩 ====================

  /**
   * JS 压缩：去除注释与多余空白
   *
   * 换行被保留（连续空行折叠为一行）。原因：ASI（自动分号插入）依赖换行，
   * `return\n{a:1}` 与 `return {a:1}` 语义完全不同。要安全地合并换行必须完整实现
   * ASI 的受限产生式规则，风险远大于收益，因此这里保留行结构 ——
   * 仍能去掉全部注释与行内冗余空白，且保证语义不变。
   * @param {string} code
   * @returns {string}
   */
  function minifyJS(code) {
    const tokens = tokenizeJS(code);
    let out = '';
    for (const token of tokens) {
      if (!out) {
        out = token.text;
        continue;
      }
      if (token.newlineBefore) {
        out += '\n' + token.text;
      } else if (needsSpace(out[out.length - 1], token.text[0])) {
        out += ' ' + token.text;
      } else {
        out += token.text;
      }
    }
    return out.trim();
  }

  // ==================== JS 美化 ====================

  /**
   * JS 美化：按 token 重组并缩进
   * 括号栈用于决定 `;` / `,` 是否换行：`for(;;)` 与函数实参内不换行，对象/数组字面量内换行。
   * @param {string} code
   * @returns {string}
   */
  function beautifyJS(code) {
    const tokens = tokenizeJS(code);
    const INDENT = '  ';
    const stack = [];
    let out = '';
    let indent = 0;

    const write = (text) => { out += text; };
    const newline = () => {
      out = out.replace(/[ \t]+$/, '');
      if (!out.endsWith('\n')) out += '\n';
      write(INDENT.repeat(indent));
    };

    for (const token of tokens) {
      const text = token.text;
      const top = stack[stack.length - 1];

      if (text === '{') {
        if (out && !out.endsWith(' ') && !out.endsWith('\n')) write(' ');
        write('{');
        stack.push('{');
        indent++;
        newline();
        continue;
      }
      if (text === '(' || text === '[') {
        write(text);
        stack.push(text);
        continue;
      }
      if (text === '}' || text === ')' || text === ']') {
        const open = text === '}' ? '{' : (text === ')' ? '(' : '[');
        if (stack[stack.length - 1] === open) stack.pop();
        if (text === '}') {
          indent = Math.max(0, indent - 1);
          newline();
          write('}');
        } else {
          out = out.replace(/[ \t]+$/, '');
          write(text);
        }
        continue;
      }
      if (text === ';') {
        out = out.replace(/[ \t]+$/, '');
        write(';');
        // for(;;) 内的分号不换行
        if (!stack.includes('(')) newline();
        else write(' ');
        continue;
      }
      if (text === ',') {
        out = out.replace(/[ \t]+$/, '');
        write(',');
        if (top === '{' || top === '[') newline();
        else write(' ');
        continue;
      }

      // 普通 token：必要时补一个空格
      if (out && !out.endsWith('\n') && !out.endsWith(' ') &&
          needsSpace(out[out.length - 1], text[0])) {
        write(' ');
      }
      write(text);
    }

    return out.split('\n').map(l => l.replace(/[ \t]+$/, '')).filter(l => l.trim()).join('\n');
  }

  // ==================== CSS ====================

  const CSS_PUNCT = '{};:,>+~';

  /**
   * CSS 压缩：去除注释与多余空白，保留字符串字面量内容
   * @param {string} code
   * @returns {string}
   */
  function minifyCSS(code) {
    let out = '';
    let i = 0;
    const n = code.length;
    let pendingSpace = false;

    while (i < n) {
      const ch = code[i];

      if (ch === '/' && code[i + 1] === '*') {
        i += 2;
        while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++;
        i += 2;
        continue;
      }

      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < n) {
          if (code[j] === '\\') { j += 2; continue; }
          if (code[j] === ch) { j++; break; }
          j++;
        }
        // 字符串前的空白按需保留（避免与前一 token 粘连）
        if (pendingSpace && out && CSS_PUNCT.indexOf(out[out.length - 1]) === -1) out += ' ';
        pendingSpace = false;
        out += code.slice(i, j);
        i = j;
        continue;
      }

      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
        pendingSpace = true;
        i++;
        continue;
      }

      if (CSS_PUNCT.indexOf(ch) !== -1) {
        pendingSpace = false;
        out += ch;
        i++;
        continue;
      }

      if (pendingSpace && out && CSS_PUNCT.indexOf(out[out.length - 1]) === -1) out += ' ';
      pendingSpace = false;
      out += ch;
      i++;
    }

    return out
      .replace(/;\s*}/g, '}')
      .replace(/\s*!\s*important/gi, ' !important')
      .trim();
  }

  /**
   * CSS 美化：按 `{` `}` `;` 断行缩进
   * `:` 只在「声明位置」补空格：选择器伪类（a:hover、p::before）与 url(...) 内部不动，
   * 否则会产出 `a: hover` / `url(http: //host/a.png)` 这类破坏性结果。
   * @param {string} code
   * @returns {string}
   */
  function beautifyCSS(code) {
    let out = '';
    let i = 0;
    const n = code.length;
    let blockDepth = 0;
    let parenDepth = 0;
    let urlDepth = 0;
    let prevSignificant = '';

    while (i < n) {
      const ch = code[i];

      if (ch === '/' && code[i + 1] === '*') {
        const end = code.indexOf('*/', i + 2);
        const stop = end === -1 ? n : end + 2;
        out += code.slice(i, stop);
        i = stop;
        continue;
      }

      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < n) {
          if (code[j] === '\\') { j += 2; continue; }
          if (code[j] === ch) { j++; break; }
          j++;
        }
        out += code.slice(i, j);
        prevSignificant = ch;
        i = j;
        continue;
      }

      // url(...) 内部的 ":"（如 http://）必须原样保留
      if (urlDepth === 0 && /^url\($/i.test(code.substr(i, 4))) {
        out += code.substr(i, 4);
        urlDepth++;
        parenDepth++;
        prevSignificant = '(';
        i += 4;
        continue;
      }

      if (ch === '(') { parenDepth++; out += ch; prevSignificant = ch; i++; continue; }
      if (ch === ')') {
        if (urlDepth > 0) urlDepth--;
        parenDepth = Math.max(0, parenDepth - 1);
        out += ch;
        prevSignificant = ch;
        i++;
        continue;
      }

      if (ch === '{') {
        out = out.replace(/[ \t]+$/, '') + ' {\n  ';
        blockDepth++;
        prevSignificant = '{';
        i++;
        continue;
      }
      if (ch === '}') {
        blockDepth = Math.max(0, blockDepth - 1);
        out = out.replace(/[ \t\n]+$/, '') + '\n}\n';
        prevSignificant = '}';
        i++;
        continue;
      }
      if (ch === ';') {
        out = out.replace(/[ \t]+$/, '') + ';\n  ';
        prevSignificant = ';';
        i++;
        continue;
      }
      if (ch === ':') {
        // 伪元素 ::before：前面已是冒号，不加空格
        if (prevSignificant === ':') { out += ch; i++; continue; }
        // url(...) 内部（如 http://）必须原样保留，不能补空格
        if (urlDepth > 0) { out += ch; prevSignificant = ':'; i++; continue; }
        // 选择器伪类（块外且不在括号内）→ 不加空格；声明与 @media 条件 → 补空格
        const isDeclaration = blockDepth > 0 || parenDepth > 0;
        out = out.replace(/[ \t]+$/, '');
        out += isDeclaration ? ': ' : ':';
        prevSignificant = ':';
        i++;
        continue;
      }

      out += ch;
      if (!/\s/.test(ch)) prevSignificant = ch;
      i++;
    }

    return out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  // ==================== HTML ====================

  /**
   * HTML 压缩：移除注释、标签间空白与多余空格
   * 注意：跳过 `<pre>` / `<textarea>` / `<script>` / `<style>` 的内容与属性值内部，
   * 否则会破坏预格式文本、内联脚本与含空格的属性值。
   * @param {string} code
   * @returns {string}
   */
  function minifyHTML(code) {
    // 先保护需要原样保留的区块，处理完再还原
    const preserved = [];
    const protect = (match) => {
      preserved.push(match);
      return '\u0000' + (preserved.length - 1) + '\u0000';
    };

    let out = code
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(pre|textarea|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, protect);

    // 属性值内的引号内容保护
    out = out.replace(/"[^"]*"|'[^']*'/g, protect);

    out = out
      .replace(/>\s+</g, '><')
      .replace(/\s+/g, ' ')
      .trim();

    return out.replace(/\u0000(\d+)\u0000/g, (m, idx) => preserved[Number(idx)]);
  }

  /**
   * HTML 美化：按标签断行缩进
   * 保留 `<pre>`/`<textarea>`/`<script>`/`<style>` 的原始内容。
   * @param {string} code
   * @returns {string}
   */
  function beautifyHTML(code) {
    const preserved = [];
    const protect = (match) => {
      preserved.push(match);
      return '\u0000' + (preserved.length - 1) + '\u0000';
    };
    let src = code.replace(/<(pre|textarea|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, protect);

    const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
      'link', 'meta', 'param', 'source', 'track', 'wbr']);
    const lines = [];
    let indent = 0;
    let i = 0;
    const n = src.length;

    while (i < n) {
      if (src[i] === '<') {
        const end = src.indexOf('>', i);
        if (end === -1) break;
        const tag = src.slice(i, end + 1);
        const closeMatch = tag.match(/^<\s*\/\s*([a-zA-Z0-9-]+)/);
        const openMatch = tag.match(/^<\s*([a-zA-Z0-9-]+)/);
        const isComment = tag.startsWith('<!--');
        const isDecl = tag.startsWith('<!') || tag.startsWith('<?');

        if (closeMatch) {
          indent = Math.max(0, indent - 1);
          lines.push('  '.repeat(indent) + tag);
        } else if (isComment || isDecl) {
          lines.push('  '.repeat(indent) + tag);
        } else if (openMatch) {
          const name = openMatch[1].toLowerCase();
          const selfClosing = tag.endsWith('/>') || VOID_TAGS.has(name);
          lines.push('  '.repeat(indent) + tag);
          if (!selfClosing) indent++;
        } else {
          lines.push('  '.repeat(indent) + tag);
        }
        i = end + 1;
        continue;
      }
      // 文本节点
      const nextTag = src.indexOf('<', i);
      const stop = nextTag === -1 ? n : nextTag;
      const text = src.slice(i, stop).trim();
      if (text) lines.push('  '.repeat(indent) + text);
      i = stop;
    }

    return lines.join('\n')
      .replace(/\u0000(\d+)\u0000/g, (m, idx) => '\n' + preserved[Number(idx)] + '\n')
      .trim();
  }

  // ==================== 交互 ====================

  function minify() {
    const t = I.value.trim();
    if (!t) return;
    const l = lang.value;
    let r = '';
    try {
      if (l === 'js') r = minifyJS(t);
      else if (l === 'css') r = minifyCSS(t);
      else if (l === 'html') r = minifyHTML(t);
    } catch (e) {
      Vi.textContent = '❌';
      Vt.textContent = '压缩失败: ' + e.message;
      return;
    }
    O.value = r;
    const pct = t.length > 0 ? ((1 - r.length / t.length) * 100).toFixed(1) : '0.0';
    Vi.textContent = '✅';
    Vt.textContent = '压缩完成 | 减少' + pct + '% | ' + t.length + '→' + r.length + '字符';
    document.getElementById('output-status').textContent = r.length + '字符';
  }

  function beautify() {
    const t = I.value.trim();
    if (!t) return;
    const l = lang.value;
    let r = '';
    try {
      if (l === 'js') r = beautifyJS(t);
      else if (l === 'css') r = beautifyCSS(t);
      else if (l === 'html') r = beautifyHTML(t);
    } catch (e) {
      Vi.textContent = '❌';
      Vt.textContent = '美化失败: ' + e.message;
      return;
    }
    O.value = r;
    Vi.textContent = '✅';
    Vt.textContent = '美化完成 | ' + r.length + '字符';
    document.getElementById('output-status').textContent = r.length + '字符';
  }

  document.getElementById('btn-minify').onclick = minify;
  document.getElementById('btn-beautify').onclick = beautify;
  document.getElementById('btn-swap').onclick = function () {
    const t = I.value;
    I.value = O.value;
    O.value = t;
  };
  document.getElementById('btn-copy').onclick = function () {
    if (O.value) navigator.clipboard.writeText(O.value).catch(function () {});
  };
  document.getElementById('btn-clear').onclick = function () {
    I.value = O.value = '';
    Vt.textContent = '支持JS/CSS/HTML代码压缩和美化';
    document.getElementById('output-status').textContent = '';
    document.getElementById('input-status').textContent = '';
  };
  document.getElementById('btn-paste').onclick = function () {
    navigator.clipboard.readText().then(function (t) {
      I.value = t;
      I.dispatchEvent(new Event('input'));
    }).catch(function () {});
  };
  I.oninput = function () {
    document.getElementById('input-status').textContent = I.value.length + '字符';
  };
});

window.addEventListener('message', function (e) {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!e.data || e.source !== window.parent) return;
  if (e.data && e.data.action === 'setTheme' && e.data.data) {
    document.documentElement.setAttribute('data-theme', e.data.data.theme);
  }
  if (e.data && e.data.action === 'setData') {
    const el = document.getElementById('input-area');
    if (el && typeof e.data.data === 'string') {
      el.value = e.data.data;
      el.dispatchEvent(new Event('input'));
    }
  }
});
