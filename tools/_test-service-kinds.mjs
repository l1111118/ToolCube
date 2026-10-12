/**
 * 服务类别 ↔ 消费者闭环测试（开发期使用，非扩展运行时依赖）
 *
 * 为什么需要这个测试
 * ------------------
 * 「服务端点」是最重要的扩展点：设置页由注册表驱动渲染，新增一个类别就能让用户
 * 接入自己的服务。但如果只往 SERVICE_KINDS 里加一条、却不接入任何工具，
 * 就会出现"设置页里有一项配置，但没有任何功能用它"的空壳端点 —— 这正是本测试
 * 要拦住的退化。
 *
 * 校验内容
 * --------
 *   1) 每个 kind 的 usedBy 中声明的工具，必须在工具源码里真实发起调用
 *      （兼容三种形态：`kind: 'x'` 字面量、`kind:'x'` 无空格、
 *        HTML 里的 `data-kind="x"`，以及后台兼容适配层的旧 action 名）
 *   2) 反向：工具里调用了某个 kind，但该 kind 的 usedBy 没有声明它
 *      （避免声明失实，让文档与实现脱节）
 *
 * 用法： node tools/_test-service-kinds.mjs
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVICE_KINDS, PROVIDERS, getServiceKind } from '../common/service-providers.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
let fail = 0;
function ok(cond, label, extra = '') {
  if (cond) { pass++; return; }
  console.error(`✗ ${label}${extra ? '\n    ' + extra : ''}`);
  fail++;
}

// 读取全部工具页源码（js + html 一起判断，因为部分调用形态在 HTML 的 data-kind 上）
const toolSrc = {};
const toolsDir = resolve(root, 'tools');
for (const d of readdirSync(toolsDir)) {
  const p = resolve(toolsDir, d);
  if (!statSync(p).isDirectory()) continue;
  let text = '';
  try { text += readFileSync(resolve(p, 'tool.js'), 'utf8'); } catch (e) { /* 无 tool.js */ }
  try { text += '\n' + readFileSync(resolve(p, 'tool.html'), 'utf8'); } catch (e) { /* 无 tool.html */ }
  if (text) toolSrc[d] = text;
}

ok(Object.keys(toolSrc).length >= 80, `应能读取到全部工具源码（实际 ${Object.keys(toolSrc).length}）`);

// 后台兼容适配层：旧 action 名 → 内部委托的 kind
const LEGACY_ACTION_TO_KIND = { ipLookup: 'ipGeo', getMyIp: 'publicIp' };

/** 判断某工具是否真实调用了指定 kind */
function toolUsesKind(toolId, kindId) {
  const src = toolSrc[toolId];
  if (!src) return false;
  if (src.indexOf("kind: '" + kindId + "'") !== -1) return true;
  if (src.indexOf("kind:'" + kindId + "'") !== -1) return true;
  if (src.indexOf('data-kind="' + kindId + '"') !== -1) return true;
  for (const [action, kind] of Object.entries(LEGACY_ACTION_TO_KIND)) {
    if (kind === kindId && src.indexOf("'" + action + "'") !== -1) return true;
  }
  return false;
}

// ==================== 1. usedBy 必须真实存在消费者 ====================
for (const k of SERVICE_KINDS) {
  const declared = k.usedBy || [];
  ok(declared.length > 0, `类别 ${k.id} 的 usedBy 不应为空（没有消费者的类别属于空壳端点）`);
  for (const toolId of declared) {
    ok(toolUsesKind(toolId, k.id), `类别 ${k.id} 声明的使用方 ${toolId} 必须真实发起调用`);
  }
}

// ==================== 2. 反向：实际调用必须在 usedBy 中声明 ====================
for (const k of SERVICE_KINDS) {
  const declared = k.usedBy || [];
  for (const toolId of Object.keys(toolSrc)) {
    if (toolUsesKind(toolId, k.id) && !declared.includes(toolId)) {
      ok(false, `工具 ${toolId} 调用了类别 ${k.id}，但该类别 usedBy 未声明它`, `usedBy=[${declared.join(',')}]`);
    }
  }
}

// ==================== 3. 类别元数据完整性 ====================
for (const k of SERVICE_KINDS) {
  ok(typeof k.label === 'string' && k.label.length > 0, `类别 ${k.id} 应有 label`);
  ok(typeof k.description === 'string' && k.description.length > 0, `类别 ${k.id} 应有 description`);
  ok(typeof k.resultSchema === 'string' && k.resultSchema.length > 0, `类别 ${k.id} 应有 resultSchema`);
  ok(Array.isArray(k.params), `类别 ${k.id} 的 params 应为数组`);
  // transport 只能是 http / client
  const transport = k.transport || 'http';
  ok(transport === 'http' || transport === 'client', `类别 ${k.id} 的 transport 只能是 http 或 client`, `实际: ${transport}`);
  // client 类别不得声明 params 之外的 HTTP 语义（其 parse 必须抛错）
  if (transport === 'client') {
    for (const p of PROVIDERS.filter(pr => pr.kind === k.id)) {
      let threw = false;
      try { p.parse({ text: '' }, {}, {}); } catch (e) { threw = true; }
      ok(threw, `客户端直连类别 ${k.id} 的 provider ${p.id} 其 parse 必须抛错（不解析 HTTP 响应）`);
    }
  }
}

console.log(`\n服务类别闭环测试：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
