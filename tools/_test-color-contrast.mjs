/**
 * 颜色对比度（WCAG 2.1）测试
 *
 * 直接从 `tools/color-contrast/tool.js` 提取**真实实现**求值，避免测试与产品行为不一致。
 * 断言使用 WCAG 规范中的已知边界值（#767676 与 #777777 是规范里著名的 4.5:1 分界）。
 *
 * 用法： node tools/_test-color-contrast.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const acorn = require('../libs/acorn.js');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const src = readFileSync(resolve(root, 'tools/color-contrast/tool.js'), 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });

const WANT_FUNCS = new Set(['hexToRgb', 'linearizeChannel', 'relativeLuminance', 'contrastRatio', 'wcagLevel']);
const WANT_CONSTS = new Set(['WCAG_THRESHOLDS', 'WCAG_FAIL']);

const pieces = [];
(function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration' && node.id && WANT_FUNCS.has(node.id.name)) {
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

const api = new Function(`${pieces.join('\n')}; return { hexToRgb, relativeLuminance, contrastRatio, wcagLevel };`)();

let pass = 0;
let fail = 0;
function ok(cond, label, extra = '') {
  if (cond) { pass++; return; }
  console.error(`✗ ${label}${extra ? '\n    ' + extra : ''}`);
  fail++;
}
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

// ---------- hexToRgb ----------
ok(JSON.stringify(api.hexToRgb('#ffffff')) === JSON.stringify({ r: 255, g: 255, b: 255 }), '#ffffff → 255,255,255');
ok(JSON.stringify(api.hexToRgb('000000')) === JSON.stringify({ r: 0, g: 0, b: 0 }), '无 # 前缀也能解析');
ok(JSON.stringify(api.hexToRgb('#fff')) === JSON.stringify({ r: 255, g: 255, b: 255 }), '3 位简写应展开');
ok(JSON.stringify(api.hexToRgb('#5b7fff')) === JSON.stringify({ r: 91, g: 127, b: 255 }), '#5b7fff 解析正确');

// ---------- 相对亮度 ----------
ok(near(api.relativeLuminance('#000000'), 0, 1e-9), '黑色相对亮度为 0');
ok(near(api.relativeLuminance('#ffffff'), 1, 1e-9), '白色相对亮度为 1');

// ---------- 对比度 ----------
ok(near(api.contrastRatio('#000000', '#ffffff'), 21, 0.005), '黑白对比度应为 21:1');
ok(near(api.contrastRatio('#ffffff', '#ffffff'), 1, 1e-9), '同色对比度应为 1:1');
ok(near(api.contrastRatio('#ffffff', '#000000'), api.contrastRatio('#000000', '#ffffff'), 1e-9), '对比度应与参数顺序无关');
ok(near(api.contrastRatio('#767676', '#ffffff'), 4.54, 0.02), '#767676/白 约为 4.54:1（WCAG 临界）');
ok(near(api.contrastRatio('#777777', '#ffffff'), 4.48, 0.02), '#777777/白 约为 4.48:1（WCAG 临界）');

// ---------- WCAG 等级 ----------
ok(api.wcagLevel(21).label.includes('AAA'), '21:1 应为 AAA');
ok(api.wcagLevel(7).label.includes('AAA'), '恰好 7:1 应为 AAA');
ok(api.wcagLevel(6.9).label.includes('AA'), '6.9:1 应降为 AA');
ok(api.wcagLevel(4.5).label.includes('AA'), '恰好 4.5:1 应为 AA');
ok(api.wcagLevel(4.4).label.includes('A级'), '4.4:1 应降为 A 级');
ok(api.wcagLevel(3).label.includes('A级'), '恰好 3:1 应为 A 级');
ok(api.wcagLevel(2.9).label.includes('不合格'), '2.9:1 应判为不合格');
ok(api.wcagLevel(4.54).className === 'cc-level rating-aa', '#767676 场景应命中 AA 样式');
ok(api.wcagLevel(4.48).className === 'cc-level rating-a', '#777777 场景应命中 A 级样式');

console.log(`\n颜色对比度测试：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
