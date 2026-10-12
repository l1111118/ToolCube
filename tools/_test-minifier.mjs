/**
 * 代码压缩器测试（开发期使用，非扩展运行时依赖）
 *
 * 核心验证思路：压缩必须是「语义保持」的变换。因此：
 *   1) 把项目内全部 JS 文件压缩一遍，压缩结果必须仍能被 acorn 解析；
 *   2) 用 acorn 的 tokenizer 提取「原文」与「压缩后」的 token 序列并逐一比对 ——
 *      token 序列完全相同，说明注释/空白的移除没有改变任何代码含义。
 * 这两步能可靠地捕获「破坏标识符、截断字符串、误判正则」等静默错误。
 *
 * 用法： node tools/_test-minifier.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const acorn = require('../libs/acorn.js');

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

// ---------- 从 tool.js 提取纯逻辑函数 ----------
const source = readFileSync(resolve(here, '../tools/code-minifier/tool.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });

const WANTED_FUNCS = new Set(['isWordChar', 'needsSpace', 'regexAllowedAfter', 'scanQuoted', 'scanRegex', 'scanTemplate', 'scanInterpolation', 'tokenizeJS', 'minifyJS', 'beautifyJS', 'minifyCSS', 'beautifyCSS', 'minifyHTML', 'beautifyHTML']);
const WANTED_VARS = new Set(['REGEX_PRECEDING_KEYWORDS', 'CSS_PUNCT']);
const pieces = [];
(function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration' && node.id && WANTED_FUNCS.has(node.id.name)) {
    pieces.push(source.slice(node.start, node.end));
    return;
  }
  if (node.type === 'VariableDeclaration') {
    for (const decl of node.declarations) {
      if (decl.id && WANTED_VARS.has(decl.id.name)) {
        pieces.push(source.slice(node.start, node.end));
        return;
      }
    }
  }
  for (const key of Object.keys(node)) {
    if (key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value.type === 'string') walk(value);
  }
})(ast);

if (pieces.length < WANTED_FUNCS.size) {
  console.error(`仅提取到 ${pieces.length}/${WANTED_FUNCS.size} 段源码，提取逻辑可能失效`);
  process.exit(1);
}

const api = new Function(`${pieces.join('\n')}
  return { minifyJS, beautifyJS, minifyCSS, beautifyCSS, minifyHTML, beautifyHTML, tokenizeJS };`)();

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; return; }
  console.error(`✗ ${label}`);
  fail++;
}

// ---------- 1. 定向回归用例（历史缺陷 + 易错构造） ----------
const cases = [
  ['标识符不被拆坏', 'var index = 0; document.getElementById("x");', (r) => r.includes('document.getElementById') && !r.includes('do cument')],
  ['关键字不误伤标识符', 'function format(input){ return input; }', (r) => r.includes('format(input)') && r.includes('return input')],
  ['let 不拆坏 offset', 'let offset = 5; let letter = 2;', (r) => r.includes('offset') && r.includes('letter')],
  ['字符串中的 // 不被当注释', 'var u = "http://example.com/path";', (r) => r.includes('http://example.com/path')],
  ['字符串中的连续空格保留', 'var s = "a  b";', (r) => r.includes('"a  b"')],
  ['字符串中的花括号保留', 'var s = "{a: 1}";', (r) => r.includes('"{a: 1}"')],
  ['正则字面量保留', 'var re = /a\\/b[/]c/gi;', (r) => r.includes('/a\\/b[/]c/gi')],
  ['除号不被误判为正则', 'var x = a / b / c;', (r) => r.includes('a/b/c')],
  ['自增后的除号不被误判为正则', 'var x = a++ / 2 / b;', (r) => r.includes('a++/2/b')],
  ['return 后的正则保留', 'function f(){ return /ab+c/g; }', (r) => r.includes('/ab+c/g')],
  // 模板内容必须逐字节保留（包括插值表达式内部的原有空格）
  ['模板字符串原样保留', 'var t = `a  b ${x + 1} c`;', (r) => r.includes('`a  b ${x + 1} c`')],
  ['模板内嵌对象字面量不被误判结束', 'var h = `<i>${f(a,{k:1})}</i>`;', (r) => r.includes('`<i>${f(a,{k:1})}</i>`')],
  ['模板内嵌模板不被误判结束', 'var h = `<a>${list.map(x=>`<b>${x}</b>`).join("")}</a>`;', (r) => r.includes('`<a>${list.map(x=>`<b>${x}</b>`).join("")}</a>`')],
  ['ASI：return 换行语义保留', 'function f(){ return\n{x:1}; }', (r) => /return\s*\n/.test(r)],
  ['块注释跨行保留换行', 'var a = 1;\n/* c\nc */\nvar b = 2;', (r) => r.includes('var a=1;') && r.includes('var b=2;')],
  ['数值字面量不被拆开', 'var n = 1e3 + 0xFF + 1_000 + 10n;', (r) => r.includes('1e3') && r.includes('0xFF') && r.includes('1_000') && r.includes('10n')],
  ['注释被移除', 'var a = 1; // 注释\n/* 块注释 */ var b = 2;', (r) => !r.includes('注释')],
  ['加号相邻不被合并成自增', 'var x = a + +b;', (r) => r.includes('a+ +b')],
];

for (const [label, input, check] of cases) {
  let out;
  try {
    out = api.minifyJS(input);
  } catch (e) {
    console.error(`✗ ${label}：压缩抛错 ${e.message}`);
    fail++;
    continue;
  }
  ok(check(out), `${label}（实际输出：${out}）`);
  // 输出必须仍是合法 JS
  try {
    acorn.parse(out, { ecmaVersion: 'latest', sourceType: 'script' });
  } catch (e) {
    console.error(`✗ ${label}：压缩结果不是合法 JS → ${e.message}\n    输出：${out}`);
    fail++;
  }
}

// ---------- 2. 全项目文件：压缩后可解析 + token 序列一致 ----------
function collectJsFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.workbuddy-ai' || name === '.git') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) collectJsFiles(full, acc);
    else if (name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

/** 提取 token 序列（忽略位置信息），用于语义等价比对 */
function tokenSignature(code, sourceType) {
  const tokens = [];
  const tokenizer = acorn.tokenizer(code, { ecmaVersion: 'latest', sourceType, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
  for (;;) {
    const t = tokenizer.getToken();
    if (t.type.label === 'eof') break;
    tokens.push(`${t.type.label}:${typeof t.value === 'number' ? t.value : String(t.value)}`);
  }
  return tokens;
}

const files = collectJsFiles(projectRoot).filter(f => !f.includes('_test-') && !f.includes('_verify-') && !f.includes('libs' + (process.platform === 'win32' ? '\\' : '/')));
let checked = 0;
let mismatch = 0;

for (const file of files) {
  const code = readFileSync(file, 'utf8');
  // 判断原文的解析模式
  let sourceType = null;
  for (const st of ['module', 'script']) {
    try {
      acorn.parse(code, { ecmaVersion: 'latest', sourceType: st, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
      sourceType = st;
      break;
    } catch (e) { /* 尝试下一种 */ }
  }
  if (!sourceType) continue; // 原文本身无法解析，跳过

  let minified;
  try {
    minified = api.minifyJS(code);
  } catch (e) {
    console.error(`✗ ${file}：压缩抛错 ${e.message}`);
    mismatch++;
    continue;
  }

  try {
    acorn.parse(minified, { ecmaVersion: 'latest', sourceType, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
  } catch (e) {
    console.error(`✗ ${file}：压缩结果无法解析 → ${e.message}`);
    mismatch++;
    continue;
  }

  const before = tokenSignature(code, sourceType);
  const after = tokenSignature(minified, sourceType);
  checked++;
  if (before.length !== after.length) {
    console.error(`✗ ${file}：token 数量不一致 ${before.length} → ${after.length}`);
    mismatch++;
    continue;
  }
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) {
      console.error(`✗ ${file}：第 ${i} 个 token 不一致 "${before[i]}" → "${after[i]}"`);
      mismatch++;
      break;
    }
  }
}

console.log(`\n全项目文件 token 等价性：已校验 ${checked} 个文件，不一致 ${mismatch} 个`);
ok(mismatch === 0, '所有文件的压缩结果 token 序列应与原文完全一致');
ok(checked > 50, `应校验到足够多的文件（实际 ${checked}）`);

// ---------- 3. CSS / HTML 定向用例 ----------
{
  const css = 'a:hover{color:red} .x{background:url(http://a.com/b.png)} p::before{content:"a  b"}';
  const min = api.minifyCSS(css);
  ok(min.includes('a:hover{color:red}'), `CSS 压缩：伪类不被加空格（实际 ${min}）`);
  ok(min.includes('url(http://a.com/b.png)'), 'CSS 压缩：url 内的 :// 保留');
  ok(min.includes('"a  b"'), 'CSS 压缩：字符串内空格保留');
  ok(min.includes('p::before'), 'CSS 压缩：::before 保留');

  const bcss = api.beautifyCSS(css);
  ok(bcss.includes('a:hover'), `CSS 美化：伪类不被写成 "a: hover"（实际 ${bcss.replace(/\n/g, ' ')}）`);
  ok(bcss.includes('url(http://a.com/b.png)'), 'CSS 美化：url 内的 :// 保留');
  ok(bcss.includes('p::before'), 'CSS 美化：::before 不被拆开');

  const html = '<div>\n  <!-- 注释 -->\n  <pre>  a   b  </pre>\n  <p title="x  y">t</p>\n</div>';
  const mh = api.minifyHTML(html);
  ok(!mh.includes('注释'), 'HTML 压缩：注释被移除');
  ok(mh.includes('<pre>  a   b  </pre>'), `HTML 压缩：pre 内容保留（实际 ${mh}）`);
  ok(mh.includes('title="x  y"'), 'HTML 压缩：属性值内空格保留');
}

console.log(`\n代码压缩器测试：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
