/**
 * 工具页共享运行时（common/tool-runtime.js）测试
 *
 * 覆盖三件容易在维护中悄悄失效的事：
 *   1) 所有工具页都按正确顺序引入了运行时（词典 → i18n → 运行时 → tool.js）
 *   2) 运行时的安全与保守性约束：校验同源、绝不覆盖非空输入、跳过被排除区域
 *   3) `extractText` 的载荷兼容性（裸字符串 / {text|value|input|content} / 动作对象）
 *
 * 为什么值得单独立测：该运行时是「自动保存」与「外部数据注入」两条链路的唯一实现，
 * 一旦它静默失效（例如漏了回包、或改成无条件覆盖），表现是"功能没反应"而不是报错。
 *
 * 用法： node tools/_test-tool-runtime.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const acorn = require('../libs/acorn.js');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let pass = 0;
let fail = 0;
function ok(cond, label, extra = '') {
  if (cond) { pass++; return; }
  console.error(`✗ ${label}${extra ? '\n    ' + extra : ''}`);
  fail++;
}

const RUNTIME_PATH = 'common/tool-runtime.js';
const runtimeSrc = readFileSync(resolve(root, RUNTIME_PATH), 'utf8');

// ---------- 1. 运行时的安全与保守性约束（静态） ----------
{
  ok(/\.origin\s*!==\s*location\.origin/.test(runtimeSrc),
    '运行时必须校验 event.origin（工具页可能被第三方站点嵌入后驱动）');
  ok(/__getToolInput/.test(runtimeSrc) && /__getToolInputResult/.test(runtimeSrc),
    '运行时必须应答 __getToolInput（否则宿主的自动保存只能超时）');
  ok(/['"]setData['"]/.test(runtimeSrc), '运行时必须处理 setData');
  // 绝不覆盖：写入前必须检查目标输入为空（hasContent 为真则提前返回）
  ok(/hasContent\(/.test(runtimeSrc) && /hasContent\(target\)\)\s*return/.test(runtimeSrc),
    '运行时只能在目标输入为空时写入，避免覆盖工具自身已填充的内容');
  ok(/data-tool-runtime-skip/.test(runtimeSrc),
    '运行时应支持 [data-tool-runtime-skip] 显式排除（如搜索框）');
  ok(/getClientRects\(\)\.length/.test(runtimeSrc),
    '运行时应跳过不可见输入（折叠面板 / 隐藏 tab）');
  ok(/dispatchEvent\(new Event\(['"]input['"]/.test(runtimeSrc),
    '写入后应派发 input 事件，让工具的实时预览/统计同步更新');

  // CSP：不得出现动态代码求值
  const ast = acorn.parse(runtimeSrc, { ecmaVersion: 'latest', sourceType: 'script' });
  let dyn = 0;
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' &&
        (n.callee.name === 'eval' || n.callee.name === 'Function')) dyn++;
    if (n.type === 'NewExpression' && n.callee.type === 'Identifier' && n.callee.name === 'Function') dyn++;
    for (const k of Object.keys(n)) {
      if (['start', 'end', 'loc', 'range'].includes(k)) continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
  })(ast);
  ok(dyn === 0, '运行时不得使用 eval / new Function（扩展页 CSP 会拦截）');
}

// ---------- 2. 88 个工具页的引入与顺序 ----------
{
  const dirs = readdirSync(resolve(root, 'tools'))
    .filter((d) => existsSync(resolve(root, 'tools', d, 'tool.html')));
  ok(dirs.length > 0, '应能找到工具页');

  const missing = [];
  const wrongOrder = [];
  for (const d of dirs) {
    const html = readFileSync(resolve(root, 'tools', d, 'tool.html'), 'utf8');
    const iDict = html.indexOf('common/tool-i18n-dict.js');
    const i18n = html.indexOf('common/tool-i18n.js');
    const iRuntime = html.indexOf('common/tool-runtime.js');
    const iTool = html.indexOf('src="tool.js"');
    if (iRuntime < 0) { missing.push(d); continue; }
    if (!(iDict < i18n && i18n < iRuntime && iRuntime < iTool)) {
      wrongOrder.push(d);
    }
  }
  ok(missing.length === 0, '所有工具页都应引入共享运行时',
    missing.length ? `${missing.length} 个：` + missing.slice(0, 8).join(', ') : '');
  ok(wrongOrder.length === 0, '引入顺序应为 词典 → i18n → 运行时 → tool.js',
    wrongOrder.length ? `${wrongOrder.length} 个：` + wrongOrder.slice(0, 8).join(', ') : '');
}

// ---------- 3. extractText 的载荷兼容性（从真实实现中提取） ----------
{
  const ast = acorn.parse(runtimeSrc, { ecmaVersion: 'latest', sourceType: 'script' });
  let src = '';
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'FunctionDeclaration' && n.id && n.id.name === 'extractText') {
      src = runtimeSrc.slice(n.start, n.end);
    }
    for (const k of Object.keys(n)) {
      if (['start', 'end', 'loc', 'range'].includes(k)) continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
  })(ast);
  ok(!!src, '应能从运行时中提取 extractText');
  if (src) {
    const extractText = new Function(`${src}; return extractText;`)();
    ok(extractText('hello') === 'hello', '裸字符串应原样返回');
    ok(extractText({ text: 'a' }) === 'a', '应识别 {text}');
    ok(extractText({ value: 'b' }) === 'b', '应识别 {value}');
    ok(extractText({ input: 'c' }) === 'c', '应识别 {input}');
    ok(extractText({ content: 'd' }) === 'd', '应识别 {content}');
    ok(extractText({ action: 'encode', text: 'e' }) === 'e', '应从「动作 + 内容」对象中取出文本');
    ok(extractText(null) === '' && extractText(undefined) === '' && extractText(42) === '',
      '非文本载荷应返回空串（调用方据此跳过写入）');
    ok(extractText({}) === '', '无可用文本字段时返回空串');
  }
}

console.log(`\n工具页共享运行时测试：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
