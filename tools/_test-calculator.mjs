/**
 * 计算器解析器测试（开发期使用，非扩展运行时依赖）
 *
 * 做法：截取 tool.js 中 DOMContentLoaded 之前的纯逻辑部分（常量/函数表/词法/语法/求值），
 * 在 Node 中求值后导出 evaluate，再对一批用例做断言。
 * 这样无需浏览器即可回归验证解析器的正确性与边界处理。
 *
 * 用法： node tools/_test-calculator.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../tools/calculator/tool.js'), 'utf8');

const cutIndex = source.indexOf("document.addEventListener('DOMContentLoaded'");
if (cutIndex === -1) {
  console.error('无法定位 DOMContentLoaded 分界点，测试中止');
  process.exit(1);
}
const pureLogic = source.slice(0, cutIndex);

const factory = new Function(`${pureLogic}\nreturn { evaluate, tokenize, parse, factorial };`);
const { evaluate } = factory();

let pass = 0;
let fail = 0;

/** 断言求值结果等于期望值（按 1e-9 容差比较） */
function expectValue(expr, expected) {
  const r = evaluate(expr);
  if (!r.ok) {
    console.error(`✗ ${expr}  →  期望 ${expected}，实际报错: ${r.error}`);
    fail++;
    return;
  }
  if (Math.abs(r.value - expected) > 1e-9) {
    console.error(`✗ ${expr}  →  期望 ${expected}，实际 ${r.value}`);
    fail++;
    return;
  }
  pass++;
}

/** 断言表达式求值失败，且错误信息包含关键字 */
function expectError(expr, keyword) {
  const r = evaluate(expr);
  if (r.ok) {
    console.error(`✗ ${expr}  →  期望报错，实际得到 ${r.value}`);
    fail++;
    return;
  }
  if (keyword && !r.error.includes(keyword)) {
    console.error(`✗ ${expr}  →  期望错误包含 "${keyword}"，实际 "${r.error}"`);
    fail++;
    return;
  }
  pass++;
}

// ── 四则运算与优先级 ──
expectValue('1+2*3', 7);
expectValue('(1+2)*3', 9);
expectValue('10-2-3', 5);
expectValue('100/4/5', 5);
expectValue('2+3*4-6/3', 12);

// ── 浮点噪声消除 ──
expectValue('0.1+0.2', 0.3);
expectValue('1.1*3', 3.3);

// ── 一元负号 ──
expectValue('-5', -5);
expectValue('3*-2', -6);
expectValue('-(2+3)', -5);
expectValue('2--3', 5);

// ── 幂运算（右结合） ──
expectValue('2^10', 1024);
expectValue('2^3^2', 512);
expectValue('-2^2', -4);
expectValue('2^-1', 0.5);

// ── 科学函数与常量 ──
expectValue('sin(0)', 0);
expectValue('cos(0)', 1);
expectValue('sqrt(16)', 4);
expectValue('√(16)', 4);
expectValue('ln(e)', 1);
expectValue('log(1000)', 3);
expectValue('log2(8)', 3);
expectValue('abs(-7)', 7);
expectValue('exp(0)', 1);
expectValue('π', Math.PI);
expectValue('cbrt(27)', 3);

// ── 隐式乘法 ──
expectValue('2π', 2 * Math.PI);
expectValue('3(4+5)', 27);
expectValue('(1+1)(2+2)', 8);

// ── 后缀阶乘与百分号 ──
expectValue('5!', 120);
expectValue('0!', 1);
expectValue('50%', 0.5);
expectValue('200*10%', 20);

// ── 中文/全角符号与显示符号 ──
expectValue('2×3', 6);
expectValue('6÷2', 3);
expectValue('5−2', 3);
expectValue('（1+2）×3', 9);

// ── 定义域与错误处理 ──
expectError('1/0', '除数');
expectError('sqrt(-1)', '负数');
expectError('ln(0)', '定义域');
expectError('asin(2)', '定义域');
expectError('2.5!', '非负整数');
expectError('sin 2', '需要括号');
// 标识符按 JS 规则贪婪匹配，sin2 会被识别为未知标识符（而非 sin + 2），这是预期行为
expectError('sin2', '未知');
expectError('1+', '不完整');
expectError('(1+2', '缺少');
expectError('1+2)', '多余');
expectError('foo(1)', '未知');
expectError('1 @ 2', '无法识别');
expectError('', '');
expectError('999^999', '超出');

console.log(`\n计算器解析器测试：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
