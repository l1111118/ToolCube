/**
 * 文本对比 LCS 测试（开发期使用，非扩展运行时依赖）
 *
 * 本轮对 buildLCS 做了两项优化（公共前后缀裁剪 + 扁平 Uint32Array）。
 * 裁剪只有在「不改变最优解」的前提下才安全，因此本测试的核心是：
 *   用朴素二维 DP 求出参照 LCS 长度，与优化实现的结果逐例比对，
 *   并验证返回的序列确实是两侧的公共子序列。
 * 另外验证大输入（裁剪后中间部分很小）的耗时。
 *
 * 用法： node tools/_test-text-diff.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const acorn = require('../libs/acorn.js');

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../tools/text-diff/tool.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });

const WANTED = new Set(['linesEqual', 'buildLCS']);
const WANTED_VARS = new Set(['MAX_DIFF_CELLS']);
const pieces = [];
(function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration' && node.id && WANTED.has(node.id.name)) {
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

if (pieces.length !== WANTED.size + WANTED_VARS.size) {
  console.error(`仅提取到 ${pieces.length}/${WANTED.size + WANTED_VARS.size} 段源码`);
  process.exit(1);
}

const api = new Function(`${pieces.join('\n')}
  return { buildLCS, linesEqual };`)();

let pass = 0;
let fail = 0;
function ok(cond, label, extra = '') {
  if (cond) { pass++; return; }
  console.error(`✗ ${label}${extra ? '\n    ' + extra : ''}`);
  fail++;
}

/** 朴素二维 DP 求 LCS 长度（参照实现，与被测代码无共享逻辑） */
function referenceLcsLength(a, b, ignoreCase) {
  const eq = (x, y) => (ignoreCase ? x.toLowerCase() === y.toLowerCase() : x === y);
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = eq(a[i - 1], b[j - 1]) ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

/** 校验 seq 是否为 a 与 b 的公共子序列 */
function isCommonSubsequence(seq, a, b, ignoreCase) {
  const eq = (x, y) => (ignoreCase ? x.toLowerCase() === y.toLowerCase() : x === y);
  const walk = (arr) => {
    let k = 0;
    for (const line of arr) {
      if (k < seq.length && eq(line, seq[k])) k++;
    }
    return k === seq.length;
  };
  return walk(a) && walk(b);
}

// ---------- 1. 定向用例 ----------
const cases = [
  [['a', 'b', 'c'], ['a', 'b', 'c']],
  [['a', 'b', 'c'], ['a', 'c']],
  [['a', 'b', 'c'], ['x', 'y']],
  [['a'], []],
  [[], ['b']],
  [[], []],
  [['A', 'B'], ['B', 'A']],
  [['1', '2', '1'], ['1', '1']],
  [['x', 'a', 'b', 'c', 'y'], ['x', 'a', 'c', 'y']],
  [['a', 'a', 'a'], ['a', 'a']],
  [['p', 'q', 'r', 's'], ['q', 's']],
  [['same', 'same', 'same'], ['same', 'same', 'same']],
];

for (const [a, b] of cases) {
  const r = api.buildLCS(a, b, false);
  const expected = referenceLcsLength(a, b, false);
  ok(!r.tooLarge, `LCS(${JSON.stringify(a)}, ${JSON.stringify(b)}) 不应超限`);
  ok(r.lcs.length === expected,
    `LCS 长度应为最优值 ${expected}`,
    `实际 ${r.lcs.length}（${JSON.stringify(r.lcs)}）`);
  ok(isCommonSubsequence(r.lcs, a, b, false), 'LCS 应为两侧的公共子序列');
}

// ---------- 2. 随机等价性测试（验证前后缀裁剪不改变最优解）----------
{
  const ALPHABET = ['a', 'b', 'c', 'd'];
  let seed = 20260927;
  const rand = (max) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % max; };
  const randomLines = (len) => Array.from({ length: len }, () => ALPHABET[rand(ALPHABET.length)]);

  let mismatches = 0;
  let checked = 0;
  for (let t = 0; t < 3000; t++) {
    const a = randomLines(rand(14));
    const b = randomLines(rand(14));
    const r = api.buildLCS(a, b, false);
    const expected = referenceLcsLength(a, b, false);
    checked++;
    if (r.lcs.length !== expected || !isCommonSubsequence(r.lcs, a, b, false)) {
      mismatches++;
      if (mismatches <= 3) {
        console.error(`  ✗ 随机用例不一致: a=${JSON.stringify(a)} b=${JSON.stringify(b)} 实际=${r.lcs.length} 期望=${expected}`);
      }
    }
  }
  ok(mismatches === 0, `随机等价性：${checked} 例中应全部与朴素 DP 一致`, `不一致 ${mismatches} 例`);
}

// ---------- 3. 大小写不敏感模式 ----------
{
  const a = ['Hello', 'World', 'Foo'];
  const b = ['hello', 'world', 'bar'];
  const r = api.buildLCS(a, b, true);
  ok(r.lcs.length === 2, 'ignoreCase 下应匹配 Hello/hello 与 World/world', `实际 ${r.lcs.length}`);
}

// ---------- 4. 大输入性能（裁剪后中间部分很小）----------
{
  const base = Array.from({ length: 20000 }, (_, i) => `line-${i}`);
  const modified = base.slice();
  modified[10000] = 'line-10000-CHANGED';

  const t0 = Date.now();
  const r = api.buildLCS(base, modified, false);
  const elapsed = Date.now() - t0;

  ok(!r.tooLarge, '两万行、仅改一行的输入不应判定为超限');
  ok(r.lcs.length === base.length - 1, `应得到 ${base.length - 1} 条公共行`, `实际 ${r.lcs.length}`);
  ok(elapsed < 200, `应在 200ms 内完成（实际 ${elapsed}ms）`);
}

// ---------- 5. 超限保护 ----------
{
  const big1 = Array.from({ length: 5000 }, (_, i) => `a${i % 97}`);
  const big2 = Array.from({ length: 5000 }, (_, i) => `b${i % 89}`);
  const r = api.buildLCS(big1, big2, false);
  ok(r.tooLarge === true, '5000×5000 的完全不同的输入应触发超限保护');
  ok(r.lcs === null, '超限时 lcs 应为 null，由调用方给出提示');
}

console.log(`\n文本对比 LCS 测试：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
