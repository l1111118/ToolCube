/**
 * 维护脚本：由 en 段的键生成 zh-TW 段。
 *
 * 工具页的 zh-CN 文案即源语言（无需字典），zh-TW 可直接由简繁对照表从键推导，
 * 因此不手写、只生成。对照表复用 common/i18n.js 中已有的 SIMP_TO_TRAD，
 * 避免维护两份。
 *
 * 用法：node tools/_gen-tool-i18n-tw.mjs [--check]
 *   --check  只校验 tw 段是否与当前 en 键同步，不写文件（供测试调用）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DICT = resolve(ROOT, 'common/tool-i18n-dict.js');
const I18N = resolve(ROOT, 'common/i18n.js');
const CHECK = process.argv.includes('--check');

/** 从 common/i18n.js 中取出 SIMP_TO_TRAD 表 */
function loadSimpTradTable() {
  const src = readFileSync(I18N, 'utf8');
  const m = src.match(/const SIMP_TO_TRAD = \{([\s\S]*?)\n\};/);
  if (!m) throw new Error('未能从 common/i18n.js 中提取 SIMP_TO_TRAD');
  const body = m[1];
  const table = {};
  for (const mm of body.matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)) table[mm[1]] = mm[2];
  if (Object.keys(table).length === 0) throw new Error('SIMP_TO_TRAD 解析为空');
  return table;
}

/** 单引号字符串字面量的转义（键里可能出现 'unsafe-inline' 这类内容） */
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** 逐字转换（与 i18n.js 的 simplifiedToTraditional 保持一致） */
function toTraditional(text, table) {
  return text.replace(/[\u4e00-\u9fff]/g, (ch) => table[ch] || ch);
}

/** 取出词典文件的 en 段（用沙箱求值，避免手工解析） */
function loadEn() {
  const src = readFileSync(DICT, 'utf8');
  const sandbox = { window: {} };
  // 词典是纯数据脚本，这里只取 en 段，不执行任何副作用
  new Function('window', src)(sandbox.window);
  const en = sandbox.window.TOOL_I18N && sandbox.window.TOOL_I18N.en;
  if (!en) throw new Error('未能从词典中读到 en 段');
  return en;
}

const table = loadSimpTradTable();
const en = loadEn();

// 只保留与简体不同的条目，减少体积
const tw = {};
let changed = 0;
for (const key of Object.keys(en)) {
  const converted = toTraditional(key, table);
  if (converted !== key) { tw[converted] = converted; changed++; }
}

const lines = Object.keys(tw).sort().map((k) => `    '${esc(k)}': '${esc(tw[k])}'`);
const twBlock = `\n\n  // zh-TW：由 en 段的键经简繁对照表自动生成，请勿手工编辑（运行 tools/_gen-tool-i18n-tw.mjs 重建）\n  tw: {\n${lines.join(',\n')}\n  }`;

let src = readFileSync(DICT, 'utf8');
// 已生成过：连同前面的逗号一起替换，保证 en / tw 两段之间始终有分隔符
const marker = /,\n\n  \/\/ zh-TW：[\s\S]*?\n  \}\n\};/;
if (marker.test(src)) {
  src = src.replace(marker, ',' + twBlock + '\n};');
} else {
  // 首次生成：在 en 段的收尾大括号后补一个逗号
  src = src.replace(/\n  \}\n\};\s*$/, '\n  },' + twBlock + '\n};\n');
}

if (CHECK) {
  const current = readFileSync(DICT, 'utf8');
  if (current !== src) {
    console.error('✗ zh-TW 段与 en 键不同步，请运行 node tools/_gen-tool-i18n-tw.mjs');
    process.exit(1);
  }
  console.log(`✓ zh-TW 段已同步（en ${Object.keys(en).length} 条，其中需转换 ${changed} 条）`);
} else {
  writeFileSync(DICT, src);
  console.log(`已重建 zh-TW 段：en ${Object.keys(en).length} 条，需转换 ${changed} 条`);
}
