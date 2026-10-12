/**
 * 工具页 i18n 机制测试
 *
 * 覆盖三件容易在后续维护中悄悄坏掉的事：
 *   1) 词典结构完好（en 非空、值均为非空字符串、无重复键冲突）
 *   2) zh-TW 段与 en 键保持同步（由简繁对照表推导，不同步即为漏译）
 *   3) 所有工具页都按正确顺序引入了词典与运行时（先词典、再运行时、最后 tool.js）
 *
 * 用法： node tools/_test-tool-i18n.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let pass = 0;
let fail = 0;
function ok(cond, label, extra = '') {
  if (cond) { pass++; return; }
  console.error(`✗ ${label}${extra ? '\n    ' + extra : ''}`);
  fail++;
}

// ---------- 1. 词典结构 ----------
const dictSrc = readFileSync(resolve(root, 'common/tool-i18n-dict.js'), 'utf8');
const sandbox = { window: {} };
new Function('window', dictSrc)(sandbox.window);
const DICT = sandbox.window.TOOL_I18N;

ok(!!DICT, '词典应挂载到 window.TOOL_I18N');
const en = DICT && DICT.en;
ok(en && typeof en === 'object', 'en 段应存在');
const enKeys = Object.keys(en || {});
ok(enKeys.length > 0, 'en 段不应为空', `当前 ${enKeys.length} 条`);

const badValues = enKeys.filter((k) => typeof en[k] !== 'string' || en[k].trim() === '');
ok(badValues.length === 0, 'en 段的值都应是非空字符串', badValues.slice(0, 5).join(', '));

const dupKeys = [];
{
  const seen = new Set();
  for (const m of dictSrc.matchAll(/^\s{4}'((?:[^'\\]|\\.)*)':/gm)) {
    const k = m[1];
    if (seen.has(k)) dupKeys.push(k);
    seen.add(k);
  }
}
ok(dupKeys.length === 0, '词典中不应出现重复键', dupKeys.slice(0, 5).join(', '));

// ---------- 2. zh-TW 段与 en 键同步 ----------
{
  const i18nSrc = readFileSync(resolve(root, 'common/i18n.js'), 'utf8');
  const m = i18nSrc.match(/const SIMP_TO_TRAD = \{([\s\S]*?)\n\};/);
  ok(!!m, '应能从 common/i18n.js 提取 SIMP_TO_TRAD');
  const table = {};
  for (const mm of (m ? m[1] : '').matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)) table[mm[1]] = mm[2];
  ok(Object.keys(table).length > 0, 'SIMP_TO_TRAD 不应为空');

  const expected = new Set();
  for (const k of enKeys) {
    const converted = k.replace(/[\u4e00-\u9fff]/g, (ch) => table[ch] || ch);
    if (converted !== k) expected.add(converted);
  }
  const actual = new Set(Object.keys(DICT.tw || {}));
  const missing = [...expected].filter((k) => !actual.has(k));
  const extra = [...actual].filter((k) => !expected.has(k));
  ok(missing.length === 0, 'zh-TW 段缺少应转换的条目', missing.slice(0, 5).join(', '));
  ok(extra.length === 0, 'zh-TW 段存在多余条目（en 键已删除？）', extra.slice(0, 5).join(', '));
}

// ---------- 3. 工具页引入 ----------
{
  const dirs = readdirSync(resolve(root, 'tools'))
    .filter((d) => existsSync(resolve(root, 'tools', d, 'tool.html')));
  ok(dirs.length > 0, '应能找到工具页');

  const missingDict = [];
  const missingRuntime = [];
  const wrongOrder = [];
  for (const d of dirs) {
    const html = readFileSync(resolve(root, 'tools', d, 'tool.html'), 'utf8');
    const iDict = html.indexOf('common/tool-i18n-dict.js');
    const iRuntime = html.indexOf('common/tool-i18n.js');
    const iTool = html.indexOf('src="tool.js"');
    if (iDict < 0) missingDict.push(d);
    if (iRuntime < 0) missingRuntime.push(d);
    if (iDict >= 0 && iRuntime >= 0 && iTool >= 0 && !(iDict < iRuntime && iRuntime < iTool)) {
      wrongOrder.push(d);
    }
  }
  ok(missingDict.length === 0, '所有工具页都应引入词典', missingDict.slice(0, 5).join(', '));
  ok(missingRuntime.length === 0, '所有工具页都应引入运行时', missingRuntime.slice(0, 5).join(', '));
  ok(wrongOrder.length === 0, '引入顺序应为 词典 → 运行时 → tool.js', wrongOrder.slice(0, 5).join(', '));
}

// ---------- 4. 运行时的安全边界（静态检查） ----------
{
  const runtime = readFileSync(resolve(root, 'common/tool-i18n.js'), 'utf8');
  ok(/window\.ToolI18n\s*=/.test(runtime), '运行时应暴露 window.ToolI18n');
  ok(/SKIP_TAGS/.test(runtime) && /TEXTAREA/.test(runtime) && /INPUT/.test(runtime),
    '运行时必须跳过 textarea / input，避免翻译用户输入');
  ok(/data-i18n-skip/.test(runtime), '运行时应支持 [data-i18n-skip] 显式排除');
  ok(/MutationObserver/.test(runtime), '运行时应用 MutationObserver 覆盖动态插入的文案');
}

console.log(`\n工具页 i18n 测试：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
