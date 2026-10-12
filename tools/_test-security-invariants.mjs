/**
 * 安全不变量测试（开发期使用，非扩展运行时依赖）
 *
 * 这些约束一旦被破坏，不会立刻报错，而是**静默地**打开一个攻击面
 * （CSP 失效、跨上下文提权、XSS 入口）。因此用自动化测试把它们固定下来，
 * 避免后续重构时无意间回退。
 *
 * 覆盖：
 *   1) 扩展页 CSP 约束：无 eval / new Function / 内联 script / 内联事件处理器
 *   2) 工具页消息来源校验：每个工具的 message 监听器都必须拒绝非本扩展来源
 *   3) 侧边栏特权代理：callBackground / sendToContent 只允许来自工具 iframe
 *   4) 后台消息来源校验：只接受本扩展自身的 sender
 *   5) 外部服务出口唯一：工具不得硬编码第三方服务地址
 *
 * 用法： node tools/_test-security-invariants.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const acorn = require('../libs/acorn.js');

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');

let pass = 0;
let fail = 0;
function ok(cond, label, extra = '') {
  if (cond) { pass++; return; }
  console.error(`✗ ${label}${extra ? '\n    ' + extra : ''}`);
  fail++;
}

function read(p) { return readFileSync(join(ROOT, p), 'utf8'); }
function listDirs(p) {
  return readdirSync(join(ROOT, p)).filter(d => {
    try { return statSync(join(ROOT, p, d)).isDirectory(); } catch { return false; }
  });
}

// ==================== 1. CSP 约束 ====================
{
  const jsFiles = [
    ...listDirs('tools').map(d => `tools/${d}/tool.js`),
    ...readdirSync(join(ROOT, 'content')).filter(f => f.endsWith('.js')).map(f => `content/${f}`),
    ...readdirSync(join(ROOT, 'common')).filter(f => f.endsWith('.js')).map(f => `common/${f}`),
    'background.js',
    'options/options.js',
    'popup/popup.js'
  ].filter((v, i, a) => a.indexOf(v) === i);

  /**
   * 用 AST 判定是否存在真正的动态代码求值。
   * 不能用文本匹配：注释、说明文案（如 "'unsafe-eval' 允许 eval()"）以及
   * XSS 测试载荷字符串里都会出现 "eval(" 字样，但它们并不执行任何代码。
   */
  function findDynamicEval(src) {
    const hits = [];
    let ast;
    for (const st of ['script', 'module']) {
      try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: st }); break; } catch { /* 换下一种 */ }
    }
    if (!ast) return hits;
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier' &&
          (n.callee.name === 'eval' || n.callee.name === 'Function')) {
        hits.push(`eval/Function() @${n.loc ? n.loc.start.line : '?'}`);
      }
      if (n.type === 'NewExpression' && n.callee.type === 'Identifier' && n.callee.name === 'Function') {
        hits.push(`new Function() @${n.loc ? n.loc.start.line : '?'}`);
      }
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier' &&
          (n.callee.name === 'setTimeout' || n.callee.name === 'setInterval') &&
          n.arguments[0] && n.arguments[0].type === 'Literal' && typeof n.arguments[0].value === 'string') {
        hits.push(`${n.callee.name}(字符串) @${n.loc ? n.loc.start.line : '?'}`);
      }
      for (const k of Object.keys(n)) {
        if (['start', 'end', 'loc', 'range'].includes(k)) continue;
        const v = n[k];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v.type === 'string') walk(v);
      }
    })(ast);
    return hits;
  }

  const violations = [];
  for (const f of jsFiles) {
    let src;
    try { src = read(f); } catch { continue; }
    const hits = findDynamicEval(src);
    if (hits.length) violations.push(`${f}: ${hits.join(', ')}`);
  }
  ok(violations.length === 0, '不得使用 eval / new Function / 字符串定时器（CSP 会拦截）',
    violations.slice(0, 8).join('\n    '));
}

// ==================== 2. HTML 内联脚本与事件处理器 ====================
{
  const htmlFiles = [
    ...listDirs('tools').map(d => `tools/${d}/tool.html`),
    'content/sidebar.html', 'options/options.html', 'popup/popup.html'
  ];
  const violations = [];
  for (const f of htmlFiles) {
    let src;
    try { src = read(f); } catch { continue; }
    // 先剔除「非可执行区域」，否则示例代码会被误判：
    //  - HTML 注释
    //  - <textarea> 内的默认文本（用户可编辑的示例）
    //  - <pre> / <code> 中的展示性片段
    const cleaned = src
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi, '<textarea></textarea>')
      .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, '<pre></pre>')
      .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, '<code></code>');
    if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(cleaned)) violations.push(`${f}: 内联 <script>`);
    if (/\son[a-z]+\s*=\s*["']/i.test(cleaned)) violations.push(`${f}: 内联事件处理器`);
  }
  ok(violations.length === 0, 'HTML 不得包含内联 <script> 或内联事件处理器（注释/示例区除外）',
    violations.slice(0, 8).join('\n    '));
}

// ==================== 3. 工具页消息来源校验 ====================
{
  const missing = [];
  for (const d of listDirs('tools')) {
    const f = `tools/${d}/tool.js`;
    let src;
    try { src = read(f); } catch { continue; }
    // 该工具是否注册了 message 监听器
    if (!/addEventListener\(\s*['"]message['"]/.test(src)) continue;
    // 必须校验 origin 为本扩展自身（工具页可能被第三方站点嵌入，
    // 仅比较 event.source === window.parent 无法区分侧边栏与恶意页面）
    if (!/\.origin\s*!==\s*location\.origin/.test(src)) missing.push(f);
  }
  ok(missing.length === 0,
    '所有注册了 message 监听器的工具都必须校验 event.origin（防止被第三方站点嵌入后驱动）',
    missing.length ? `缺失 ${missing.length} 个：\n    ` + missing.slice(0, 10).join('\n    ') : '');
}

// ==================== 4. 侧边栏特权代理的来源限制 ====================
{
  const src = read('content/sidebar.js');
  ok(/const TOOL_ONLY_ACTIONS\s*=\s*new Set\(\[[^\]]*'callBackground'/.test(src),
    '侧边栏必须把 callBackground 列为仅限工具 iframe 的特权动作');
  ok(/const TOOL_ONLY_ACTIONS\s*=\s*new Set\(\[[^\]]*'sendToContent'/.test(src),
    '侧边栏必须把 sendToContent 列为仅限工具 iframe 的特权动作');
  ok(/TOOL_ONLY_ACTIONS\.has\(action\)\s*&&\s*!isToolIframe/.test(src),
    '侧边栏必须在分发前对特权动作校验来源（isToolIframe）');
  // 该判定必须出现在 switch 之前，否则起不到拦截作用
  const gateIdx = src.indexOf('TOOL_ONLY_ACTIONS.has(action)');
  const switchIdx = src.indexOf('switch (action) {', src.indexOf('function handleMessage'));
  ok(gateIdx > 0 && switchIdx > 0 && gateIdx < switchIdx,
    '特权动作的来源校验必须位于 switch 分发之前');
}

// ==================== 5. 后台消息来源校验 ====================
{
  const src = read('background.js');
  ok(/sender\.id\s*!==\s*chrome\.runtime\.id/.test(src),
    '后台必须校验消息发送方为本扩展自身（sender.id）');
  const manifest = JSON.parse(read('manifest.json'));
  ok(!manifest.externally_connectable,
    '不应声明 externally_connectable（否则外部扩展/网页可直接向后台发消息）');
}

// ==================== 6. 外部服务出口唯一 ====================
{
  // 工具不得硬编码第三方服务地址；联网一律走 background 的 serviceRequest。
  // 判定要求该行同时出现「服务域名」与「URL 形态」，这样只把真正的请求地址算作违规；
  // 像 source 显示标签（'crt.sh'）或 providerId（'certspotter'）这类字面量不算。
  const DOMAINS = /(crt\.sh|certspotter\.com|hackertarget\.com|pwnedpasswords\.com|haveibeenpwned\.com|open\.er-api\.com|frankfurter\.app|ip-api\.com|ipify\.org|cloudflare-dns\.com|dns\.google|alidns\.com|quad9\.net|rdap\.org|whoisjs\.com|freeaitools\.ca)/;
  const URL_LIKE = /https?:\/\//;
  const violations = [];
  for (const d of listDirs('tools')) {
    const f = `tools/${d}/tool.js`;
    let src;
    try { src = read(f); } catch { continue; }
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 注释行允许说明历史来源
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      if (!DOMAINS.test(line) || !URL_LIKE.test(line)) continue;
      // 指向第三方官网的「帮助链接」允许存在（例如引导用户去申请 API Key）
      if (/href\s*=|<a\s|window\.open|homepage/.test(line)) continue;
      violations.push(`${f}:${i + 1}`);
    }
  }
  ok(violations.length === 0,
    '工具不得硬编码第三方服务地址（联网应走 background 的 serviceRequest）',
    violations.slice(0, 10).join('\n    '));
}

// ==================== 7. 注册表与服务商一致性 ====================
{
  const src = read('common/service-providers.js');
  // 每个 provider 的 parse 抛出的错误应为可读中文，避免把原始异常直接暴露给用户
  ok(!/throw new Error\(['"]\s*['"]\)/.test(src), '不应抛出空错误信息');
}

console.log(`\n安全不变量测试：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
