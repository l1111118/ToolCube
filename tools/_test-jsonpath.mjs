/**
 * JSONPath 查询测试（开发期使用，非扩展运行时依赖）
 *
 * 覆盖本轮修复的三处缺陷：
 *   1) 过滤器 [?(@.x > y)] 因未剥离外层括号而恒返回空
 *   2) 切片步长被 Array.prototype.slice 忽略（$[::2]、$[::-1] 失效）
 *   3) 点号访问用 `in` 判断命中原型链成员（$.toString）
 * 另验证新增的带引号键访问 $['a-b'] 与 @['k']。
 *
 * 用法： node tools/_test-jsonpath.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const acorn = require('../libs/acorn.js');

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../tools/jsonpath-query/tool.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });

const WANTED = new Set(['evalJSONPath', 'tokenize', 'parseBracket', 'evalExpr', 'evalValue',
  'splitTopLevel', 'splitTopLevelOp', 'stripOuterParens', 'sliceWithStep', 'evalDotPath']);
const pieces = [];
// 这些函数位于文件顶层的 IIFE 内，需要递归遍历 AST 才能取到
(function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration' && node.id && WANTED.has(node.id.name)) {
    pieces.push(source.slice(node.start, node.end));
    return;
  }
  for (const key of Object.keys(node)) {
    if (key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value.type === 'string') walk(value);
  }
})(ast);
if (pieces.length < 6) {
  console.error(`仅提取到 ${pieces.length} 段源码，提取逻辑可能失效`);
  process.exit(1);
}

const api = new Function(`${pieces.join('\n')}
  return { evalJSONPath, parseBracket, evalExpr, sliceWithStep, stripOuterParens };`)();

let pass = 0;
let fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  console.error(`✗ ${label}\n    实际: ${a}\n    期望: ${e}`);
  fail++;
}

const data = {
  store: {
    book: [
      { title: 'A', price: 8.95, tags: ['x', 'y'] },
      { title: 'B', price: 12.99, tags: ['y'] },
      { title: 'C', price: 22.99, tags: [] },
      { title: 'D', price: 8.99, tags: ['z'] }
    ],
    'a-b': { ok: 1 }
  },
  nums: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
};

// ── 过滤器：本轮修复的核心 ──
eq('过滤 ?(@.price>10)', api.evalJSONPath(data, '$.store.book[?(@.price>10)]').map(b => b.title), ['B', 'C']);
eq('过滤 ?@.price>10（不带括号）', api.evalJSONPath(data, '$.store.book[?@.price>10]').map(b => b.title), ['B', 'C']);
eq('过滤 ?( @.price>10 )（含空格）', api.evalJSONPath(data, '$.store.book[?( @.price>10 )]').map(b => b.title), ['B', 'C']);
eq('过滤 >=', api.evalJSONPath(data, '$.store.book[?(@.price>=12.99)]').map(b => b.title), ['B', 'C']);
eq('过滤 ==（字符串）', api.evalJSONPath(data, "$.store.book[?(@.title=='A')]").map(b => b.title), ['A']);
eq('过滤 !=', api.evalJSONPath(data, "$.store.book[?(@.title!='A')]").map(b => b.title), ['B', 'C', 'D']);
eq('过滤 && 组合', api.evalJSONPath(data, '$.store.book[?(@.price>10 && @.price<20)]').map(b => b.title), ['B']);
eq('过滤 || 组合', api.evalJSONPath(data, '$.store.book[?(@.price<9 || @.price>20)]').map(b => b.title), ['A', 'C', 'D']);
eq('过滤无匹配返回空', api.evalJSONPath(data, '$.store.book[?(@.price>999)]'), []);

// ── 切片步长：本轮修复 ──
eq('切片 [::2]', api.evalJSONPath(data, '$.nums[::2]'), [0, 2, 4, 6, 8]);
eq('切片 [::-1]（反转）', api.evalJSONPath(data, '$.nums[::-1]'), [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
eq('切片 [1:5]', api.evalJSONPath(data, '$.nums[1:5]'), [1, 2, 3, 4]);
eq('切片 [1:8:3]', api.evalJSONPath(data, '$.nums[1:8:3]'), [1, 4, 7]);
eq('切片 [-3:]', api.evalJSONPath(data, '$.nums[-3:]'), [7, 8, 9]);
eq('切片 [7:2:-2]', api.evalJSONPath(data, '$.nums[7:2:-2]'), [7, 5, 3]);
eq('切片越界安全', api.evalJSONPath(data, '$.nums[5:100]'), [5, 6, 7, 8, 9]);

// ── 原型链：本轮修复 ──
eq('$.toString 不应返回原型函数', api.evalJSONPath(data, '$.toString'), []);
eq('$.store.toString 不应返回原型函数', api.evalJSONPath(data, '$.store.toString'), []);
eq('$.constructor 不应返回原型函数', api.evalJSONPath(data, '$.constructor'), []);

// ── 带引号的键：本轮新增 ──
eq("$['a-b'] 带引号键", api.evalJSONPath(data, "$.store['a-b']"), [{ ok: 1 }]);
eq('$["a-b"] 双引号键', api.evalJSONPath(data, '$.store["a-b"]'), [{ ok: 1 }]);
eq("$['a]b'] 引号内含 ] 的键", api.evalJSONPath({ 'a]b': 7 }, "$['a]b']"), [7]);

// ── 基础能力回归 ──
eq('点号路径', api.evalJSONPath(data, '$.store.book[0].title'), ['A']);
eq('通配 [*]', api.evalJSONPath(data, '$.store.book[*].title'), ['A', 'B', 'C', 'D']);
eq('下标 [1]', api.evalJSONPath(data, '$.store.book[1].title'), ['B']);
eq('负下标 [-1]', api.evalJSONPath(data, '$.store.book[-1].title'), ['D']);
eq('递归搜索 ..price', api.evalJSONPath(data, '$..price').length, 4);

// ── 辅助函数 ──
eq('stripOuterParens 剥离整体括号', api.stripOuterParens('(@.a>1)'), '@.a>1');
eq('stripOuterParens 不剥离非整体括号', api.stripOuterParens('(a)+(b)'), '(a)+(b)');
eq('stripOuterParens 嵌套剥离', api.stripOuterParens('((@.a>1))'), '@.a>1');
eq('sliceWithStep 负步长', api.sliceWithStep([0, 1, 2, 3, 4], undefined, undefined, -1), [4, 3, 2, 1, 0]);
eq('sliceWithStep step=0 容错', api.sliceWithStep([0, 1, 2], 0, 3, 0), [0, 1, 2]);

// ── 错误处理 ──
{
  let threw = false;
  try { api.evalJSONPath(data, '$.store[?( )]'); } catch (e) { threw = true; }
  eq('空过滤器表达式应抛错', threw, true);
}

console.log(`\nJSONPath 测试：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
