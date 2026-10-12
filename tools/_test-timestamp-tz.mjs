/**
 * 时间戳转换器 · 时区逻辑测试（开发期使用，非扩展运行时依赖）
 *
 * 为什么单独测这三个函数
 * ----------------------
 * 「时区」下拉框此前是**装饰性控件**：选中的值只被存进 state.timezone，
 * 从未参与任何计算，因此选任何时区结果都一样。补上实现后，时区换算属于
 * 极易写错又不易肉眼发现的一类逻辑（跨日、半时区、DST 都会出错），
 * 因此这里直接对产品源码中的这三个函数做覆盖。
 *
 * 用法： node tools/_test-timestamp-tz.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const acorn = require('../libs/acorn.js');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const source = readFileSync(resolve(root, 'tools/timestamp-converter/tool.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });

const WANTED = new Set(['getTimezoneOffsetMinutes', 'parseWallClockInZone', 'formatDateTime']);
const pieces = [];
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

if (pieces.length !== WANTED.size) {
  console.error(`仅提取到 ${pieces.length}/${WANTED.size} 个函数，提取逻辑可能失效`);
  process.exit(1);
}

// 这三个函数依赖模块级 state.timezone，这里以参数形式注入
const api = new Function('state', pieces.join('\n') + '\n return { getTimezoneOffsetMinutes, parseWallClockInZone, formatDateTime };');

let pass = 0;
let fail = 0;
function ok(cond, label, extra = '') {
  if (cond) { pass++; return; }
  console.error(`✗ ${label}${extra ? '\n    ' + extra : ''}`);
  fail++;
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `实际: ${JSON.stringify(actual)} 期望: ${JSON.stringify(expected)}`);
}

// ==================== 1. 偏移解析 ====================
{
  eq(api({ timezone: 'UTC' }).getTimezoneOffsetMinutes(), 0, 'UTC 偏移应为 0');
  eq(api({ timezone: '+8' }).getTimezoneOffsetMinutes(), 480, '+8 应为 480 分钟');
  eq(api({ timezone: '-5' }).getTimezoneOffsetMinutes(), -300, '-5 应为 -300 分钟');
  eq(api({ timezone: '+5.5' }).getTimezoneOffsetMinutes(), 330, '+5.5（孟买）应为 330 分钟');
  eq(api({ timezone: '+0' }).getTimezoneOffsetMinutes(), 0, '+0 应为 0');
  // 非法值回退到本地偏移（不应抛错）
  const localOffset = api({ timezone: 'nonsense' }).getTimezoneOffsetMinutes();
  ok(Number.isFinite(localOffset), '非法时区应回退为本地偏移而不是 NaN');
}

// ==================== 2. 墙上时间 → 时间戳 ====================
{
  // 1970-01-01T00:00:00Z
  eq(api({ timezone: 'UTC' }).parseWallClockInZone('1970-01-01T00:00:00'), 0, 'UTC 下的纪元起点应为 0');
  eq(api({ timezone: '+8' }).parseWallClockInZone('1970-01-01T08:00:00'), 0, 'UTC+8 的 08:00 等于 UTC 00:00');
  eq(api({ timezone: '-5' }).parseWallClockInZone('1969-12-31T19:00:00'), 0, 'UTC-5 的 19:00（前一天）等于 UTC 00:00');
  // 秒可省略
  eq(api({ timezone: 'UTC' }).parseWallClockInZone('2024-01-01T00:00'), Date.UTC(2024, 0, 1), '省略秒应视为 0');
  // 非法输入
  ok(Number.isNaN(api({ timezone: 'UTC' }).parseWallClockInZone('not-a-date')), '非法输入应返回 NaN');
}

// ==================== 3. 时间戳 → 墙上时间 ====================
{
  const epoch = new Date(0);
  eq(api({ timezone: 'UTC' }).formatDateTime(epoch), '1970-01-01 00:00:00', 'UTC 下纪元起点应格式化为 00:00:00');
  eq(api({ timezone: '+8' }).formatDateTime(epoch), '1970-01-01 08:00:00', 'UTC+8 下纪元起点应为 08:00:00');
  eq(api({ timezone: '-5' }).formatDateTime(epoch), '1969-12-31 19:00:00', 'UTC-5 下纪元起点应回退到前一天 19:00');
  eq(api({ timezone: '+5.5' }).formatDateTime(epoch), '1970-01-01 05:30:00', '半时区（+5:30）应正确换算');

  // 往返一致性：不同时区下解析再格式化应还原原文
  for (const tz of ['UTC', '+8', '-5', '+5.5', '+10', '-8']) {
    const text = '2024-06-15T13:45:30';
    const ms = api({ timezone: tz }).parseWallClockInZone(text);
    const back = api({ timezone: tz }).formatDateTime(new Date(ms));
    eq(back, '2024-06-15 13:45:30', `时区 ${tz} 下往返应保持一致`);
  }

  // 跨日边界：UTC+8 的 00:30 在 UTC 下属于前一天
  const ms = api({ timezone: '+8' }).parseWallClockInZone('2024-03-01T00:30:00');
  eq(api({ timezone: 'UTC' }).formatDateTime(new Date(ms)), '2024-02-29 16:30:00', '跨日换算应正确（2024 为闰年）');
}

console.log(`\n时间戳时区测试：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
