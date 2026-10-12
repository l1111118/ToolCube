/**
 * Cron 解析器测试（开发期使用，非扩展运行时依赖）
 *
 * 做法：用 acorn 解析 tools/cron-parser/tool.js，按名称提取其中的纯函数源码
 * （它们位于 DOMContentLoaded 回调内，无法直接 import），拼装后求值再断言。
 * 这样既能验证重写后的"按字段跳进"算法与 cron 语义，又不需要浏览器环境。
 *
 * 用法： node tools/_test-cron-parser.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const acorn = require('../libs/acorn.js');

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../tools/cron-parser/tool.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });

const WANTED_FUNCS = new Set(['parseField', 'getNextRuns', 'valMatch', 'validateCron', 'getDescription', 'inRange', 'esc']);
const WANTED_VARS = new Set(['FIELD_NAMES']);
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

if (pieces.length < 6) {
  console.error(`仅提取到 ${pieces.length} 段源码，提取逻辑可能失效，测试中止`);
  process.exit(1);
}

const api = new Function(`${pieces.join('\n')}
  return { getNextRuns, validateCron, valMatch, parseField, getDescription };`)();

let pass = 0;
let fail = 0;

function ok(cond, label) {
  if (cond) { pass++; return; }
  console.error(`✗ ${label}`);
  fail++;
}

/** 断言两次执行时间之差（分钟） */
function expectGapMinutes(expr, count, gapMinutes, label) {
  const runs = api.getNextRuns(expr, count);
  if (runs.length !== count) {
    console.error(`✗ ${label}：期望 ${count} 个结果，实际 ${runs.length}`);
    fail++;
    return;
  }
  const allGapOk = runs.every((d, i) => {
    if (i === 0) return true;
    return (d.getTime() - runs[i - 1].getTime()) / 60000 === gapMinutes;
  });
  ok(allGapOk, `${label}：相邻间隔应为 ${gapMinutes} 分钟`);
}

// ── 基本步进与字段 ──
expectGapMinutes('*/15 * * * *', 4, 15, '每15分钟');
expectGapMinutes('0 * * * *', 3, 60, '每小时整点');
expectGapMinutes('30 2 * * *', 3, 1440, '每天 02:30');

// ── 工作日（1-5）应落在周一至周五的 09:00 ──
{
  const runs = api.getNextRuns('0 9 * * 1-5', 3);
  const allWeekday = runs.length === 3 && runs.every(d => d.getDay() >= 1 && d.getDay() <= 5 && d.getHours() === 9 && d.getMinutes() === 0);
  ok(allWeekday, '工作日 09:00：应仅落在周一至周五且时间正确');
}

// ── 跨年边界：0 0 1 1 * 需要跨到明年 1 月 1 日，旧实现在此会做数十万次迭代 ──
{
  const t0 = Date.now();
  const runs = api.getNextRuns('0 0 1 1 *', 2);
  const elapsed = Date.now() - t0;
  ok(runs.length === 2 && runs.every(d => d.getMonth() === 0 && d.getDate() === 1 && d.getHours() === 0), '每年 1 月 1 日：结果正确');
  ok(elapsed < 200, `跨年搜索应在 200ms 内完成（实际 ${elapsed}ms）`);
}

// ── 闰日：下一个 2 月 29 日（可能需跨 4 年，验证 5 年上限内的正确性）──
{
  const runs = api.getNextRuns('0 0 29 2 *', 1);
  const isValidLeapDay = runs.length === 1 && runs[0].getMonth() === 1 && runs[0].getDate() === 29;
  ok(isValidLeapDay, '闰日 2 月 29 日：应找到下一个闰日');
}

// ── 不存在的日期必须快速终止，且不能卡死 ──
{
  const t0 = Date.now();
  const runs = api.getNextRuns('0 0 30 2 *', 5);
  const elapsed = Date.now() - t0;
  ok(runs.length === 0, '不存在的日期（2月30日）：应返回空数组');
  ok(elapsed < 500, `不可能表达式应在 500ms 内终止（实际 ${elapsed}ms）`);
}

// ── Vixie cron 语义：日与星期同时受限时取"或" ──
{
  const runs = api.getNextRuns('0 0 13 * 5', 6);
  const matchesOr = runs.length === 6 && runs.every(d => d.getDate() === 13 || d.getDay() === 5);
  ok(matchesOr, '日与星期同时受限：应满足"13 号 或 星期五"（Vixie/POSIX 语义）');
}

// ── 星期 7 等价于星期日 ──
{
  ok(api.valMatch(0, '7', 0, 6) === true, 'valMatch：星期字段 7 应等价于星期日(0)');
  const runs = api.getNextRuns('0 0 * * 7', 2);
  ok(runs.length === 2 && runs.every(d => d.getDay() === 0), '0 0 * * 7：应落在星期日');
}

// ── 表达式校验 ──
ok(api.validateCron('* * * * *').ok === true, 'validateCron：* * * * * 合法');
ok(api.validateCron('0 9 * * 1-5').ok === true, 'validateCron：0 9 * * 1-5 合法');
ok(api.validateCron('0 0 * * 7').ok === true, 'validateCron：星期 7 合法');
ok(api.validateCron('*/15 2 * * *').ok === true, 'validateCron：*/15 合法');
ok(api.validateCron('60 * * * *').ok === false, 'validateCron：分钟 60 越界应判非法');
ok(api.validateCron('0 24 * * *').ok === false, 'validateCron：小时 24 越界应判非法');
ok(api.validateCron('0 0 0 * *').ok === false, 'validateCron：日期 0 越界应判非法');
ok(api.validateCron('0 0 * 13 *').ok === false, 'validateCron：月份 13 越界应判非法');
ok(api.validateCron('0 0 * * 8').ok === false, 'validateCron：星期 8 越界应判非法');
ok(api.validateCron('*/0 * * * *').ok === false, 'validateCron：步长 0 应判非法');
ok(api.validateCron('* * * *').ok === false, 'validateCron：4 字段应判非法');
ok(api.validateCron('a b c d e').ok === false, 'validateCron：非数字应判非法');

// ── 字段解析文案（同时验证输出不含未转义字符）──
ok(typeof api.parseField('*', 0, 59) === 'string', 'parseField：返回字符串');
ok(api.getDescription('0 9 * * 1-5').length > 0, 'getDescription：应返回非空描述');

console.log(`\nCron 解析器测试：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
