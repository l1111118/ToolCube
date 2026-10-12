/**
 * 工具注册表一致性测试
 *
 * 注册表（common/tool-registry.js）是工具清单的**单一数据源**，但它与磁盘目录、
 * 分类表、拼音表之间存在多处隐式耦合。这类不一致不会报错，只会表现为
 * "侧边栏点进去是空白页"或"搜索搜到空结果"，因此用测试固化下来。
 *
 * 覆盖：
 *   1) 工具目录 ↔ TOOLS_CONFIG 一一对应（无孤儿、无缺失）
 *   2) 每个工具三件套齐全（tool.html / tool.js / tool.css）
 *   3) id 唯一、必填字段非空
 *   4) category 必须在 CATEGORIES 中
 *   5) PINYIN_MAP 无悬挂键（键必须是某个工具 id 的前缀段，用推导而非白名单）
 *
 * 用法： node tools/_test-registry.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const { TOOLS_CONFIG, CATEGORIES, PINYIN_MAP } = await import(
  new URL('../common/tool-registry.js', import.meta.url).href
);

let pass = 0;
let fail = 0;
function ok(cond, label, extra = '') {
  if (cond) { pass++; return; }
  console.error(`✗ ${label}${extra ? '\n    ' + extra : ''}`);
  fail++;
}

// ---------- 1. 目录 ↔ 注册表 ----------
const dirs = readdirSync(resolve(root, 'tools')).filter((d) =>
  existsSync(resolve(root, 'tools', d, 'tool.html'))
);
const ids = TOOLS_CONFIG.map((t) => t.id);

const orphanDirs = dirs.filter((d) => !ids.includes(d));
const missingDirs = ids.filter((id) => !dirs.includes(id));
ok(orphanDirs.length === 0, '不应存在未登记的工具目录',
  orphanDirs.length ? orphanDirs.join(', ') : '');
ok(missingDirs.length === 0, '注册表中的每个工具都应有对应目录',
  missingDirs.length ? missingDirs.join(', ') : '');

// ---------- 2. 三件套齐全 ----------
const incomplete = [];
for (const id of ids) {
  for (const f of ['tool.html', 'tool.js', 'tool.css']) {
    if (!existsSync(resolve(root, 'tools', id, f))) incomplete.push(`${id}/${f}`);
  }
}
ok(incomplete.length === 0, '每个工具都应有 tool.html / tool.js / tool.css',
  incomplete.length ? incomplete.slice(0, 8).join(', ') : '');

// ---------- 3. 唯一性与必填字段 ----------
const seen = new Set();
const dups = [];
for (const id of ids) {
  if (seen.has(id)) dups.push(id);
  seen.add(id);
}
ok(dups.length === 0, '工具 id 不得重复', dups.join(', '));

const badFields = [];
for (const t of TOOLS_CONFIG) {
  for (const f of ['id', 'name', 'nameEn', 'category', 'icon', 'desc']) {
    if (typeof t[f] !== 'string' || t[f].trim() === '') badFields.push(`${t.id || '?'}.${f}`);
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.id)) badFields.push(`${t.id} 的 id 命名不规范`);
}
ok(badFields.length === 0, '工具的必填字段应完整、id 命名应规范',
  badFields.slice(0, 8).join(', '));

// ---------- 4. 分类合法性 ----------
const catIds = new Set(CATEGORIES.map((c) => c.id));
const badCat = TOOLS_CONFIG.filter((t) => !catIds.has(t.category)).map((t) => t.id);
ok(badCat.length === 0, '每个工具的 category 都必须存在于 CATEGORIES',
  badCat.join(', '));

// 分类表里不应有「一个工具都没有」的空分类（否则侧边栏会出现空分组）
const emptyCats = CATEGORIES.filter((c) => !TOOLS_CONFIG.some((t) => t.category === c.id)).map((c) => c.id);
ok(emptyCats.length === 0, '不应存在没有任何工具的分类', emptyCats.join(', '));

// ---------- 5. PINYIN_MAP 无悬挂键（推导式，不用白名单） ----------
// 判定：键 K 合法 ⇔ 存在某工具 id 满足 `id === K` 或 `id` 以 `K + '-'` 开头。
// 这样既不会误删共享前缀键（image / color / text），也能揪出已删工具遗留的键。
const dangling = Object.keys(PINYIN_MAP).filter((key) =>
  !TOOLS_CONFIG.some((t) => t.id === key || t.id.startsWith(key + '-'))
);
ok(dangling.length === 0, 'PINYIN_MAP 不应存在悬挂键（对应工具已删除？）',
  dangling.length ? dangling.join(', ') : '');

// 每个工具都应能通过「id 首段」或「id 全名」命中拼音表，否则中文拼音搜索会漏
const noPinyin = TOOLS_CONFIG.filter((t) => {
  const parts = t.id.split('-');
  return !(PINYIN_MAP[parts[0]] || PINYIN_MAP[parts.slice(0, 2).join('-')] || PINYIN_MAP[t.id]);
}).map((t) => t.id);
ok(noPinyin.length === 0, '每个工具都应能命中拼音映射（否则拼音搜索无效）',
  noPinyin.length ? noPinyin.slice(0, 10).join(', ') : '');

console.log(`\n工具注册表一致性测试：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
