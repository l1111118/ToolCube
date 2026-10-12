/**
 * 设置页「服务端点」渲染测试（开发期使用，非扩展运行时依赖）
 *
 * 该界面完全由注册表元数据驱动渲染（renderServiceCard），是一处新增且无 UI 测试覆盖的表面。
 * 这里在 Node 中直接调用渲染函数，重点验证：
 *   1) 各类别都能正常渲染，不抛异常、不产生未替换的占位
 *   2) 服务商名称、地址等**外部/可配置内容经过 HTML 转义**（防止配置被写入注入内容后执行脚本）
 *   3) 每个服务商声明的字段都会出现在表单中
 *   4) 当前选中的服务商被正确标记为 selected
 *
 * 用法： node tools/_test-service-endpoints-ui.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const acorn = require('../libs/acorn.js');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = readFileSync(resolve(root, 'options/options.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });

const WANTED = new Set(['renderServiceCard', 'kindLabel', 'kindDesc', 'fieldLabel', 'providerLabel']);
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

// options.js 通过 import 引入 escapeHtml（来自 common/utils.js），
// 这里提取**真实实现**而不是在测试里另写一份，避免测试与产品行为不一致。
const utilsSource = readFileSync(resolve(root, 'common/utils.js'), 'utf8');
const utilsAst = acorn.parse(utilsSource, { ecmaVersion: 'latest', sourceType: 'module' });
let escapeHtmlSource = '';
for (const node of utilsAst.body) {
  // common/utils.js 中是 `export function escapeHTML`，因此需要同时处理导出声明包装
  const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
  if (decl && decl.type === 'FunctionDeclaration' && decl.id && decl.id.name === 'escapeHTML') {
    escapeHtmlSource = utilsSource.slice(decl.start, decl.end);
  }
}
if (!escapeHtmlSource) {
  console.error('未能从 common/utils.js 提取 escapeHTML');
  process.exit(1);
}

// renderServiceCard 依赖模块级变量 serviceMeta / serviceConfig，这里以参数形式注入。
// 界面文案通过 i18nT(key, fallback) 取翻译，测试中以「返回 fallback」的桩替代，
// 这样断言针对的仍是注册表原始值，不受翻译表变化影响。
const renderCard = new Function('serviceMeta', 'serviceConfig',
  `${escapeHtmlSource}\n const escapeHtml = escapeHTML;\n`
  + ` const i18nT = (key, fallback) => (fallback !== undefined ? fallback : key);\n`
  + ` ${pieces.join('\n')}\n return renderServiceCard;`);

let pass = 0;
let fail = 0;
function ok(cond, label, extra = '') {
  if (cond) { pass++; return; }
  console.error(`✗ ${label}${extra ? '\n    ' + extra : ''}`);
  fail++;
}

// ---------- 构造与真实注册表同形的元数据 ----------
const meta = {
  kinds: [
    { id: 'dns', label: 'DNS 查询（DoH）', description: '通过 DoH 查询记录。', resultSchema: '{ status, ad, answers[] }' },
    { id: 'breach', label: '密码 / 邮箱泄露查询', description: 'k-匿名查询。', resultSchema: '{ count }' }
  ],
  providers: [
    { id: 'cloudflare', kind: 'dns', label: 'Cloudflare DNS (1.1.1.1)', homepage: 'https://developers.cloudflare.com/1.1.1.1/', defaultBaseUrl: 'https://cloudflare-dns.com/dns-query', fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }] },
    { id: 'custom', kind: 'dns', label: '自定义服务（自建 / 自托管）', description: '指向你自己的服务。', homepage: '', defaultBaseUrl: '', fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }, { key: 'apiKey', label: 'API Key（可选）', type: 'password', required: false }] },
    { id: 'hibp', kind: 'breach', label: 'Have I Been Pwned', homepage: 'https://haveibeenpwned.com/API/v3', defaultBaseUrl: 'https://api.pwnedpasswords.com/range', fields: [{ key: 'baseUrl', label: '密码范围查询地址', type: 'text', required: true }, { key: 'emailBaseUrl', label: '邮箱查询地址', type: 'text', required: false }, { key: 'apiKey', label: 'HIBP API Key', type: 'password', required: false }] }
  ]
};

const config = {
  dns: { providerId: 'custom', baseUrl: 'https://my-doh.local/q', apiKey: 'secret-token', emailBaseUrl: '', headers: {} },
  breach: { providerId: 'hibp', baseUrl: '', apiKey: '', emailBaseUrl: '', headers: {} }
};

// ---------- 1. 正常渲染 ----------
let dnsHtml = '';
try {
  dnsHtml = renderCard(meta, config)(meta.kinds[0]);
} catch (e) {
  console.error('✗ 渲染 DNS 卡片抛错: ' + e.message);
  fail++;
}
ok(dnsHtml.length > 0, 'DNS 卡片应产出 HTML');
ok(!dnsHtml.includes('undefined'), '渲染结果不应包含 undefined', dnsHtml.slice(0, 200));
ok(!/\$\{/.test(dnsHtml), '渲染结果不应残留未替换的模板占位');

// ---------- 2. 当前选中的服务商与字段 ----------
ok(dnsHtml.includes('value="custom" selected'), '应把当前配置的服务商标记为 selected');
ok(dnsHtml.includes('data-field="baseUrl"'), '应渲染 baseUrl 字段');
ok(dnsHtml.includes('data-field="apiKey"'), '应渲染 apiKey 字段');
ok(dnsHtml.includes('https://my-doh.local/q'), '应回填已保存的服务地址');
ok(dnsHtml.includes('type="password"'), 'API Key 字段应为密码类型');

// 切换到 cloudflare 时不应出现 apiKey 字段（该服务商未声明）
const cloudflareHtml = renderCard(meta, { ...config, dns: { providerId: 'cloudflare', baseUrl: '', apiKey: '', emailBaseUrl: '', headers: {} } })(meta.kinds[0]);
ok(!cloudflareHtml.includes('data-field="apiKey"'), '未声明 apiKey 的服务商不应渲染该字段');
ok(cloudflareHtml.includes('https://cloudflare-dns.com/dns-query'), '未填自定义地址时应以默认地址作为 placeholder');

// ---------- 3. 三个字段的服务商 ----------
const breachHtml = renderCard(meta, config)(meta.kinds[1]);
ok(breachHtml.includes('data-field="baseUrl"') && breachHtml.includes('data-field="emailBaseUrl"') && breachHtml.includes('data-field="apiKey"'),
   'breach 类别应渲染全部三个字段');
ok(breachHtml.includes('{ count }'), '应展示该类别的返回结构说明');

// ---------- 4. 转义（安全） ----------
{
  const evilMeta = {
    kinds: [{ id: 'dns', label: '<img src=x onerror=alert(1)>', description: '" onmouseover="alert(2)', resultSchema: '<script>bad()</script>' }],
    providers: [{
      id: 'evil', kind: 'dns',
      label: '"><script>alert(3)</script>',
      homepage: 'https://x.test/" onmouseover="alert(4)',
      defaultBaseUrl: 'https://x.test/q?a="><script>alert(5)</script>',
      fields: [{ key: 'baseUrl', label: '地址"><b>x</b>', type: 'text', required: true }]
    }]
  };
  const evilConfig = { dns: { providerId: 'evil', baseUrl: '" onfocus="alert(6)" autofocus x="', apiKey: '', emailBaseUrl: '', headers: {} } };
  const html = renderCard(evilMeta, evilConfig)(evilMeta.kinds[0]);

  // 关键：断言"危险内容以**未转义标签**的形式出现"。
  // 不能简单地检测 onerror= 之类的子串 —— 转义后的文本里仍然包含这些字样，
  // 真正要防的是它们被解析为标签或属性。
  ok(!/<script/i.test(html), '不应出现可执行的 <script> 标签', html.slice(0, 300));
  ok(!/<img\s/i.test(html), '类别名称中的 <img 必须被转义为文本');
  ok(!/<b>/i.test(html), '字段标签中的 <b> 必须被转义为文本');
  ok(!html.includes('" onfocus="'), '属性值中的引号必须被转义，不能闭合属性');
  ok(!html.includes('" onmouseover="'), '主页地址中的引号必须被转义');
  // href 后不得被追加事件处理器：转义正确时 href 属性会正常闭合，不会多出属性
  ok(!/href="[^"]*"\s+on[a-z]+\s*=/i.test(html), 'href 属性不得被追加事件处理器');
  ok(html.includes('&quot;'), '被转义的引号应以实体形式出现');
  ok(html.includes('&lt;'), '被转义的尖括号应以实体形式出现');
  // 同时确认危险内容确实以"文本形式"保留下来（说明是转义而非被丢弃）
  ok(html.includes('&lt;script&gt;'), '被转义的内容应保留为可见文本');
}

// ---------- 5. 边界：缺少字段 / 未知 providerId ----------
{
  const noFields = { kinds: [{ id: 'x', label: 'X', description: '', resultSchema: '' }], providers: [{ id: 'p', kind: 'x', label: 'P', defaultBaseUrl: '' }] };
  let html = '';
  try {
    html = renderCard(noFields, { x: { providerId: 'p', baseUrl: '', apiKey: '', emailBaseUrl: '', headers: {} } })(noFields.kinds[0]);
    ok(html.includes('svc-card'), '服务商未声明 fields 时应仍能渲染卡片');
  } catch (e) {
    ok(false, '服务商未声明 fields 时不应抛错', e.message);
  }
  try {
    html = renderCard(noFields, { x: { providerId: 'no-such', baseUrl: '', apiKey: '', emailBaseUrl: '', headers: {} } })(noFields.kinds[0]);
    ok(html.includes('svc-card'), 'providerId 未知时应回退到该类别第一个服务商而不是崩溃');
  } catch (e) {
    ok(false, 'providerId 未知时不应抛错', e.message);
  }
}

console.log(`\n服务端点界面渲染测试：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
