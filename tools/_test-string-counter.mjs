/**
 * 字符串统计测试
 *
 * 从 `tools/string-counter/tool.js` 提取纯函数 `analyzeText` 求值，
 * 覆盖空输入、空白、中英文混排、多行、UTF-8 字节数等边界。
 *
 * 用法： node tools/_test-string-counter.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const acorn = require('../libs/acorn.js');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const src = readFileSync(resolve(root, 'tools/string-counter/tool.js'), 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });

const WANT_CONSTS = new Set(['CJK_RE', 'SENTENCE_RE', 'SPECIAL_RE']);
const pieces = [];
(function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration' && node.id && node.id.name === 'analyzeText') {
    pieces.push(src.slice(node.start, node.end));
  }
  if (node.type === 'VariableDeclaration') {
    for (const d of node.declarations) {
      if (d.id && WANT_CONSTS.has(d.id.name)) pieces.push(src.slice(node.start, node.end));
    }
  }
  for (const key of Object.keys(node)) {
    if (['start', 'end', 'loc', 'range'].includes(key)) continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v.type === 'string') walk(v);
  }
})(ast);

const analyzeText = new Function(`${pieces.join('\n')}; return analyzeText;`)();

let pass = 0;
let fail = 0;
function ok(cond, label, extra = '') {
  if (cond) { pass++; return; }
  console.error(`✗ ${label}${extra ? '\n    ' + extra : ''}`);
  fail++;
}
function eq(actual, expected, label) {
  ok(JSON.stringify(actual) === JSON.stringify(expected), label,
    `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

// ---------- 空与空白 ----------
eq(analyzeText(''), {
  chars: 0, nospace: 0, words: 0, lines: 0, sentences: 0,
  bytes: 0, chinese: 0, digits: 0, spaces: 0, specials: 0
}, '空文本各项均应为 0');

const blanks = analyzeText('   ');
ok(blanks.chars === 3 && blanks.words === 0 && blanks.lines === 1 && blanks.nospace === 0 && blanks.spaces === 3,
  '纯空白：字符 3 / 词 0 / 行 1 / 无空格 0 / 空格 3', JSON.stringify(blanks));

// ---------- 英文 ----------
eq(analyzeText('hello world'), {
  chars: 11, nospace: 10, words: 2, lines: 1, sentences: 0,
  bytes: 11, chinese: 0, digits: 0, spaces: 1, specials: 0
}, '英文单词统计正确');

// ---------- 中文（含全角标点）----------
const cn = analyzeText('你好，世界。');
ok(cn.chinese === 4, '中文 4 字', `实际 ${cn.chinese}`);
ok(cn.chars === 6, '总字符 6（含全角标点）', `实际 ${cn.chars}`);
ok(cn.specials === 2, '全角标点计为特殊字符 2 个', `实际 ${cn.specials}`);
ok(cn.bytes === 18, 'UTF-8 字节 18（每字 3 字节）', `实际 ${cn.bytes}`);

// ---------- 多行与句子 ----------
const multi = analyzeText('a\nb\nc');
ok(multi.lines === 3, '三行文本行数为 3', `实际 ${multi.lines}`);
ok(multi.chars === 5, '三行文本字符数为 5（含换行符）', `实际 ${multi.chars}`);

const sent = analyzeText('Hi. Bye!');
ok(sent.sentences === 2, '两个句子', `实际 ${sent.sentences}`);

// ---------- 数字与 emoji 字节 ----------
ok(analyzeText('a1b2').digits === 2, '数字计数 2');
ok(analyzeText('😀').bytes === 4 && analyzeText('😀').chars === 2, 'emoji：UTF-8 4 字节、JS 长度 2');

// ---------- 健壮性 ----------
eq(analyzeText(null), {
  chars: 0, nospace: 0, words: 0, lines: 0, sentences: 0,
  bytes: 0, chinese: 0, digits: 0, spaces: 0, specials: 0
}, 'null 输入应视为空文本（不抛错）');

console.log(`\n字符串统计测试：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
