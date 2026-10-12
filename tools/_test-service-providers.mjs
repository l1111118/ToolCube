/**
 * 外部服务注册表测试（开发期使用，非扩展运行时依赖）
 *
 * 覆盖 common/service-providers.js 的全部纯逻辑：
 *   1) 注册表完整性（每个 kind 都有默认服务商与 custom 服务商；provider 实现齐全；id 唯一）
 *   2) 参数校验与规范化（含注入防护：域名/IP/记录类型白名单）
 *   3) 配置规范化（脏数据、未知服务商、未知字段的处置）
 *   4) resolveEndpoint 的三条语义（用户默认 / 用户覆盖 / 显式指定）
 *   5) 地址模板展开与 URL 编码
 *   6) 各 provider 的 buildRequest 与 parse（用贴近真实响应的样本数据）
 *
 * 用法： node tools/_test-service-providers.mjs
 */
import {
  SERVICE_KINDS,
  PROVIDERS,
  getProvidersByKind,
  getProvider,
  getServiceKind,
  validateParams,
  expandTemplate,
  joinUrl,
  defaultServiceConfig,
  normalizeServiceConfig,
  resolveEndpoint,
  parseRdapObject,
  normalizeWhoisObject,
  collectSubdomainsFromCt,
  isClientTransport,
  buildClientRequestUrl
} from '../common/service-providers.js';

let pass = 0;
let fail = 0;
function ok(cond, label, extra = '') {
  if (cond) { pass++; return; }
  console.error(`✗ ${label}${extra ? '\n    ' + extra : ''}`);
  fail++;
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(a === e, label, `实际: ${a}\n    期望: ${e}`);
}
function throws(fn, keyword, label) {
  try {
    fn();
    ok(false, label, '期望抛出异常，但未抛出');
  } catch (e) {
    ok(!keyword || e.message.includes(keyword), label, `错误信息: ${e.message}`);
  }
}

// ==================== 1. 注册表完整性 ====================
ok(SERVICE_KINDS.length >= 8, `服务类别数量应 >= 8（实际 ${SERVICE_KINDS.length}）`);
ok(PROVIDERS.length >= 20, `服务商数量应 >= 20（实际 ${PROVIDERS.length}）`);

for (const kind of SERVICE_KINDS) {
  const list = getProvidersByKind(kind.id);
  ok(list.length >= 2, `类别 ${kind.id} 应至少有两个服务商`, `实际 ${list.length}`);
  ok(list.some(p => p.id === 'custom'), `类别 ${kind.id} 应提供 custom 服务商（自建入口）`);
  ok(!!getProvider(kind.id, kind.defaultProviderId), `类别 ${kind.id} 的 defaultProviderId 必须存在`);
  ok(typeof kind.resultSchema === 'string' && kind.resultSchema.length > 0, `类别 ${kind.id} 应有 resultSchema 文档`);
  for (const p of list) {
    ok(typeof p.buildRequest === 'function', `${kind.id}/${p.id} 缺少 buildRequest`);
    ok(typeof p.parse === 'function', `${kind.id}/${p.id} 缺少 parse`);
    ok(typeof p.label === 'string' && p.label.length > 0, `${kind.id}/${p.id} 缺少 label`);
  }
  // 同一类别内 id 不得重复（否则 getProvider 会取到错误实现）
  const ids = list.map(p => p.id);
  eq(ids.length, new Set(ids).size, `类别 ${kind.id} 的服务商 id 应唯一`);
}

// ==================== 2. 参数校验 ====================
eq(validateParams('dns', { name: 'Example.COM.', type: 'a' }), { name: 'example.com', type: 'A', dnssec: false }, 'dns 参数应小写域名并大写类型');
throws(() => validateParams('dns', { name: 'bad_domain', type: 'A' }), '域名格式', 'dns 应拒绝非法域名');
throws(() => validateParams('dns', { name: 'a.com', type: 'EVIL' }), '记录类型', 'dns 应拒绝白名单外的记录类型');
throws(() => validateParams('dns', { name: 'a.com', type: 'A"; DROP' }), '记录类型', 'dns 应拒绝把注入串当作记录类型');

eq(validateParams('ipGeo', { ip: '1.1.1.1' }), { ip: '1.1.1.1' }, 'ipGeo 接受合法 IPv4');
eq(validateParams('ipGeo', {}), { ip: '' }, 'ipGeo 允许留空（查询本机）');
throws(() => validateParams('ipGeo', { ip: '999.1.1.1' }), 'IP 地址格式', 'ipGeo 应拒绝越界 IPv4');
throws(() => validateParams('ipGeo', { ip: 'a.com' }), 'IP 地址格式', 'ipGeo 应拒绝非 IP 字符串');

eq(validateParams('currency', { base: 'usd' }), { base: 'USD' }, 'currency 应大写货币代码');
throws(() => validateParams('currency', { base: 'US' }), '3 位字母', 'currency 应拒绝非法货币代码');

const PWD_SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';
eq(validateParams('breach', { mode: 'password', prefix: '5baa6', suffix: PWD_SUFFIX.toLowerCase() }),
   { mode: 'password', prefix: '5BAA6', suffix: PWD_SUFFIX }, 'breach 接受 prefix/suffix 并统一大写');
eq(validateParams('breach', { mode: 'password', value: '5BAA6', suffix: PWD_SUFFIX }),
   { mode: 'password', prefix: '5BAA6', suffix: PWD_SUFFIX }, 'breach 接受 value 写法');
throws(() => validateParams('breach', { mode: 'password', prefix: '5BAA6' }), '35 位 SHA-1 后缀', '缺后缀必须报错（否则无法定位具体密码）');
eq(validateParams('breach', { mode: 'email', email: 'a@b.com' }), { mode: 'email', email: 'a@b.com' }, 'breach 接受 email 写法');
throws(() => validateParams('breach', { mode: 'password', prefix: 'ABC' }), '5 位 SHA-1 前缀', 'breach 应拒绝过短前缀');
throws(() => validateParams('breach', { mode: 'email', email: 'nope' }), '邮箱格式', 'breach 应拒绝非法邮箱');

for (const kind of ['whois', 'ct', 'subdomain']) {
  eq(validateParams(kind, { domain: 'Example.com' }), { domain: 'example.com' }, `${kind} 应规范化域名`);
}
throws(() => validateParams('unknown-kind', {}), '未知的服务类别', '未知类别应报错');
throws(() => validateParams('whois', {}), '缺少域名', 'whois 缺参数应报错');

// ==================== 3. 地址模板 ====================
eq(expandTemplate('https://x/y?name={name}&type={type}', { name: 'a.com', type: 'A' }), 'https://x/y?name=a.com&type=A', '模板应替换占位符');
eq(expandTemplate('https://x/{q}', { q: 'a&b=c/d' }), 'https://x/a%26b%3Dc%2Fd', '占位值必须 URL 编码，防止参数注入 URL 结构');
eq(expandTemplate('https://x/{missing}', {}), 'https://x/', '缺失占位符应展开为空');
eq(joinUrl('https://a.com/', '/p'), 'https://a.com/p', 'joinUrl 应避免重复斜杠');
eq(joinUrl('https://a.com', 'p'), 'https://a.com/p', 'joinUrl 应补上缺失斜杠');

// ==================== 4. 配置规范化 ====================
{
  const cfg = defaultServiceConfig();
  ok(SERVICE_KINDS.every(k => cfg[k.id] && typeof cfg[k.id].providerId === 'string'), '默认配置应覆盖所有类别');

  const dirty = normalizeServiceConfig({
    dns: { providerId: 'not-exist', baseUrl: '  https://my.local/q  ', headers: { 'X-A': '1', bad: 5 } },
    whois: 'not-an-object',
    ipGeo: { apiKey: 'k' }
  });
  eq(dirty.dns.providerId, getServiceKind('dns').defaultProviderId, '未知服务商应回退为默认，避免脏配置导致功能不可用');
  eq(dirty.dns.baseUrl, 'https://my.local/q', 'baseUrl 应 trim');
  eq(dirty.dns.headers, { 'X-A': '1' }, 'headers 应丢弃非字符串值');
  eq(dirty.whois.providerId, getServiceKind('whois').defaultProviderId, '非对象条目应回退为默认');
  eq(dirty.ipGeo.apiKey, 'k', 'apiKey 应保留');

  eq(normalizeServiceConfig(null), defaultServiceConfig(), 'null 配置应返回完整默认值');
  eq(normalizeServiceConfig('garbage'), defaultServiceConfig(), '非对象配置应返回完整默认值');
}

// ==================== 5. resolveEndpoint 语义 ====================
{
  const cfg = normalizeServiceConfig({ dns: { providerId: 'cloudflare', baseUrl: 'https://my-doh.local/q' } });

  const def = resolveEndpoint('dns', cfg);
  eq(def.provider.id, 'cloudflare', '默认应使用用户配置的服务商');
  eq(def.cfg.baseUrl, 'https://my-doh.local/q', '用户填写的 baseUrl 应生效（自建服务入口）');

  const other = resolveEndpoint('dns', cfg, 'google');
  eq(other.provider.id, 'google', '显式指定应切换到该服务商');
  eq(other.cfg.baseUrl, 'https://dns.google/resolve', '显式指定其他服务商时不应套用用户的自定义地址');

  const same = resolveEndpoint('dns', cfg, 'cloudflare');
  eq(same.cfg.baseUrl, 'https://my-doh.local/q', '显式指定为当前配置的服务商时应沿用自定义地址');

  throws(() => resolveEndpoint('subdomain', cfg, 'not-exist'), '不存在服务商', '未知服务商必须报错，不能静默回退到别的实现');

  const fallback = resolveEndpoint('dns', normalizeServiceConfig({}));
  eq(fallback.provider.id, getServiceKind('dns').defaultProviderId, '无用户配置时应使用类别默认服务商');
  eq(fallback.cfg.baseUrl, fallback.provider.defaultBaseUrl, '无自定义地址时应使用服务商默认地址');
}

// ==================== 6. 各 provider 的请求构造与解析 ====================
const customCfg = { baseUrl: '', apiKey: '', emailBaseUrl: '', headers: {} };

/**
 * 按生产路径构造请求：先经 resolveEndpoint 得到「生效配置」，再调用 provider.buildRequest。
 * 直接传空 baseUrl 会得到相对 URL，那是调用方漏走解析步骤的错误用法，测试不应模拟它。
 * @param {string} kind
 * @param {string} providerId
 * @param {object} params
 * @param {string} [baseUrlOverride] 模拟用户填写自建地址
 */
function buildViaResolve(kind, providerId, params, baseUrlOverride) {
  const userConfig = normalizeServiceConfig({
    [kind]: baseUrlOverride ? { providerId, baseUrl: baseUrlOverride } : { providerId }
  });
  const resolved = resolveEndpoint(kind, userConfig, providerId);
  return {
    provider: resolved.provider,
    cfg: resolved.cfg,
    req: resolved.provider.buildRequest(validateParams(kind, params), resolved.cfg)
  };
}

/** 断言 buildRequest 产出合法 http(s) URL，且不包含未替换的占位符 */
function expectValidRequest(kind, providerId, params, baseUrlOverride) {
  const { req } = buildViaResolve(kind, providerId, params, baseUrlOverride);
  ok(!!req && typeof req.url === 'string', `${kind}/${providerId} 应生成 url`);
  ok(!/\{[a-zA-Z_]+\}/.test(req.url), `${kind}/${providerId} 的 url 不应残留未替换占位符`, req.url);
  let parsed = null;
  try { parsed = new URL(req.url); } catch (e) { /* 下面断言会报出 */ }
  ok(parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:'), `${kind}/${providerId} 的 url 必须是 http(s)`, req.url);
  return { req, parsed };
}

// --- DNS ---
{
  const { req, parsed } = expectValidRequest('dns', 'cloudflare', { name: 'example.com', type: 'MX' });
  eq(parsed.searchParams.get('name'), 'example.com', 'DNS 请求应带 name 参数');
  eq(parsed.searchParams.get('type'), 'MX', 'DNS 请求应带 type 参数');
  ok(req.options.headers && req.options.headers.Accept === 'application/dns-json', 'Cloudflare DoH 应带 JSON Accept 头');

  const withDnssec = buildViaResolve('dns', 'cloudflare', { name: 'a.com', type: 'A', dnssec: true });
  ok(withDnssec.req.url.includes('do=1'), '开启 DNSSEC 时应带 do=1');

  const parsed2 = getProvider('dns', 'google').parse({
    text: JSON.stringify({
      Status: 0, AD: true,
      Answer: [{ name: 'example.com.', type: 1, TTL: 300, data: '93.184.216.34' }]
    })
  }, { name: 'example.com', type: 'A' }, customCfg);
  eq(parsed2, { status: 0, ad: true, answers: [{ name: 'example.com.', type: 1, ttl: 300, data: '93.184.216.34' }] }, 'DoH JSON 应被归一化');
  throws(() => getProvider('dns', 'google').parse({ text: 'not json' }, {}, customCfg), '不是合法 JSON', '非 JSON 响应应报可读错误');
}

// --- WHOIS ---
{
  expectValidRequest('whois', 'rdap', { domain: 'example.com' });
  expectValidRequest('whois', 'whoisjs', { domain: 'example.com' });

  const rdap = {
    status: ['client transfer prohibited'],
    port43: 'whois.example',
    handle: 'D123',
    events: [
      { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
      { eventAction: 'expiration', eventDate: '2030-08-13T04:00:00Z' },
      { eventAction: 'last changed', eventDate: '2024-08-14T07:01:39Z' }
    ],
    entities: [
      { roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'RESERVED-Internet Assigned Numbers Authority'], ['url', {}, 'uri', 'https://iana.org']]] },
      { roles: ['registrant'], vcardArray: ['vcard', [['org', {}, 'text', 'Example Org'], ['country', {}, 'text', 'US'], ['email', {}, 'text', 'admin@example.com']]] }
    ],
    nameservers: [{ ldhName: 'a.iana-servers.net' }, { ldhName: 'b.iana-servers.net' }]
  };
  const parsed = parseRdapObject(rdap, 'example.com', 'RAW');
  eq(parsed.registrar, 'RESERVED-Internet Assigned Numbers Authority', 'RDAP 注册商应被解析');
  eq(parsed.registrarUrl, 'https://iana.org', 'RDAP 注册商 URL 应被解析');
  eq(parsed.whoisServer, 'whois.example', 'RDAP port43 应映射为 whoisServer');
  eq(parsed.creationDate, '1995-08-14T04:00:00Z', 'RDAP 注册时间应被解析');
  eq(parsed.expirationDate, '2030-08-13T04:00:00Z', 'RDAP 到期时间应被解析');
  eq(parsed.updatedDate, '2024-08-14T07:01:39Z', 'RDAP 更新时间应被解析');
  eq(parsed.nameServers, ['a.iana-servers.net', 'b.iana-servers.net'], 'RDAP 域名服务器应被解析');
  eq(parsed.registrantOrganization, 'Example Org', 'RDAP 注册人组织应被解析');
  eq(parsed.registrantCountry, 'US', 'RDAP 注册人国家应被解析');
  eq(parsed.registrantEmail, 'admin@example.com', 'RDAP 注册人邮箱应被解析');
  eq(parsed.registryDomainId, 'D123', 'RDAP handle 应映射为 registryDomainId');

  // 非标准 WHOIS 服务的字段别名容错
  const normalized = normalizeWhoisObject({ registrar_name: 'X Inc', created_date: '2000-01-01', name_servers: 'ns1.a.com\nns2.a.com', domain_status: ['ok'] }, 'a.com', 'RAW2');
  eq(normalized.registrar, 'X Inc', '别名 registrar_name 应被识别');
  eq(normalized.creationDate, '2000-01-01', '别名 created_date 应被识别');
  eq(normalized.nameServers, ['ns1.a.com', 'ns2.a.com'], '多行 name_servers 应拆为数组');
  eq(normalized.status, ['ok'], '字符串数组状态应保留');
  eq(normalizeWhoisObject({}, 'b.com', '').domain, 'b.com', '缺失 domain 时应回填入参域名');
}

// --- ipGeo ---
{
  expectValidRequest('ipGeo', 'ip-api', { ip: '8.8.8.8' });
  expectValidRequest('ipGeo', 'ip-api', { ip: '' });
  const parsed = getProvider('ipGeo', 'ip-api').parse({
    text: JSON.stringify({ status: 'success', query: '8.8.8.8', country: 'United States', regionName: 'California', city: 'Mountain View', zip: '94043', isp: 'Google LLC', org: 'Google Public DNS', as: 'AS15169 Google LLC', lat: 37.4, lon: -122.07, timezone: 'America/Los_Angeles', hosting: true })
  }, { ip: '8.8.8.8' }, customCfg);
  eq(parsed.ip, '8.8.8.8', 'ipGeo 应归一化 ip');
  eq(parsed.region, 'California', 'ipGeo 应把 regionName 归一化为 region');
  eq(parsed.hosting, true, 'ipGeo 应保留 hosting 标志');
  throws(() => getProvider('ipGeo', 'ip-api').parse({ text: JSON.stringify({ status: 'fail', message: 'invalid query' }) }, {}, customCfg), 'invalid query', '失败状态应抛出服务端消息');
}

// --- CT ---
{
  expectValidRequest('ct', 'crt-sh', { domain: 'example.com' });
  const parsed = getProvider('ct', 'crt-sh').parse({
    text: JSON.stringify([{ id: 1, serial_number: 'AB', common_name: 'example.com', name_value: 'example.com\nwww.example.com', issuer_name: "Let's Encrypt", not_before: '2024-01-01T00:00:00', not_after: '2024-04-01T00:00:00' }])
  }, {}, customCfg);
  eq(parsed.certificates[0].serialNumber, 'AB', 'CT 应归一化 serialNumber');
  eq(parsed.certificates[0].issuer, "Let's Encrypt", 'CT 应归一化 issuer');
  throws(() => getProvider('ct', 'crt-sh').parse({ text: '{}' }, {}, customCfg), 'JSON 数组', '非数组响应应报错');
}

// --- subdomain ---
{
  const ctList = [{ name_value: 'example.com\nwww.example.com\nnotexample.com\n*.api.example.com', not_before: '2024-01-01' }];
  const subs = collectSubdomainsFromCt(ctList, 'example.com', 'crt.sh');
  eq(subs.map(s => s.name), ['example.com', 'www.example.com', 'api.example.com'], 'CT 应包含 apex、剥离通配符，并排除同后缀的无关域名');
  eq(subs[0].source, 'crt.sh', '来源标识应透传');

  const ht = getProvider('subdomain', 'hackertarget').parse({
    text: 'www.example.com,1.2.3.4\napi.example.com,5.6.7.8\nother.com,9.9.9.9\nwww.example.com,1.2.3.4\n'
  }, { domain: 'example.com' }, customCfg);
  eq(ht.subdomains.map(s => s.name), ['www.example.com', 'api.example.com'], 'HackerTarget 文本应被解析并去重');
  eq(ht.subdomains[0].ip, '1.2.3.4', 'HackerTarget 的 IP 列应被保留');

  const cs = getProvider('subdomain', 'certspotter').parse({
    text: JSON.stringify([{ id: 'x', dns_names: ['example.com', 'a.example.com'], not_before: '2024-02-02' }])
  }, { domain: 'example.com' }, customCfg);
  eq(cs.subdomains.map(s => s.name), ['example.com', 'a.example.com'], 'Cert Spotter 的 dns_names 应被展开');
}

// --- currency ---
{
  const er = getProvider('currency', 'er-api').parse({ text: JSON.stringify({ base_code: 'USD', time_last_update_utc: 'Mon, 01 Jan 2024', rates: { USD: 1, CNY: 7.2 } }) }, { base: 'USD' }, customCfg);
  eq(er.base, 'USD', 'er-api 基准货币应归一化');
  eq(er.rates.CNY, 7.2, 'er-api 汇率应保留');
  const fr = getProvider('currency', 'frankfurter').parse({ text: JSON.stringify({ base: 'USD', date: '2024-01-01', rates: { CNY: 7.1 } }) }, { base: 'USD' }, customCfg);
  eq(fr.rates.USD, 1, 'Frankfurter 不返回基准货币，应补齐为 1');
  throws(() => getProvider('currency', 'er-api').parse({ text: '{}' }, {}, customCfg), 'rates', '缺少 rates 应报错');
}

// --- breach ---
{
  // 真实响应格式：每行是「SHA-1 去掉前 5 位后的 35 位后缀:出现次数」
  const text = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:2\n' + PWD_SUFFIX + ':1000\nZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ:7\n';
  const hit = getProvider('breach', 'hibp').parse({ status: 200, text }, { mode: 'password', prefix: '5BAA6', suffix: PWD_SUFFIX }, customCfg);
  eq(hit, { count: 1000 }, '密码查询应匹配到后缀并返回次数');
  const miss = getProvider('breach', 'hibp').parse({ status: 200, text }, { mode: 'password', prefix: 'FFFFF', suffix: '0'.repeat(35) }, customCfg);
  eq(miss, { count: 0 }, '未命中应返回 0');

  const emailCfg = { baseUrl: 'https://x', apiKey: 'KEY', emailBaseUrl: '', headers: {} };
  const req = getProvider('breach', 'hibp').buildRequest(validateParams('breach', { mode: 'email', email: 'a@b.com' }), emailCfg);
  eq(req.options.headers['hibp-api-key'], 'KEY', '邮箱查询应带上 API Key 头');
  throws(() => getProvider('breach', 'hibp').buildRequest(validateParams('breach', { mode: 'email', email: 'a@b.com' }), { ...emailCfg, apiKey: '' }), 'API Key', '缺 Key 时应给出可读错误');
  eq(getProvider('breach', 'hibp').parse({ status: 404, text: '' }, { mode: 'email', email: 'a@b.com' }, emailCfg), { breaches: [] }, '404 应归一化为空数组而非错误');
  const list = getProvider('breach', 'hibp').parse({ status: 200, text: JSON.stringify([{ Name: 'X', Title: 'X Breach', Domain: 'x.com', BreachDate: '2020-01-01', Description: 'd', IsVerified: true, DataClasses: ['Emails'] }]) }, { mode: 'email', email: 'a@b.com' }, emailCfg);
  eq(list.breaches[0], { name: 'X', title: 'X Breach', domain: 'x.com', breachDate: '2020-01-01', description: 'd', isVerified: true, dataClasses: ['Emails'] }, '邮箱泄露结果应被归一化');
}

// --- publicIp ---
{
  const req = buildViaResolve('publicIp', 'ipify', {}).req;
  ok(req.url.includes('format=json'), '公网 IP 请求应要求 JSON 格式');
  eq(getProvider('publicIp', 'ipify').parse({ text: JSON.stringify({ ip: '1.2.3.4' }) }, {}, customCfg), { ip: '1.2.3.4' }, '公网 IP 应被解析');
  throws(() => getProvider('publicIp', 'ipify').parse({ text: '{}' }, {}, customCfg), 'ip 字段', '缺少 ip 应报错');
}

// ==================== 新增类别：ssl / portScan / proxy / readability ====================

// --- ssl（外部 TLS 评级）---
{
  eq(validateParams('ssl', { domain: 'Example.COM' }), { domain: 'example.com' }, 'ssl 参数应规范化域名');
  throws(() => validateParams('ssl', { domain: 'bad_domain' }), '域名格式', 'ssl 应拒绝非法域名');
  const { req } = expectValidRequest('ssl', 'ssllabs', { domain: 'example.com' });
  ok(req.url.includes('host=example.com'), 'SSL Labs 请求应带上 host');
  const parsed = getProvider('ssl', 'ssllabs').parse({
    text: JSON.stringify({
      status: 'READY',
      endpoints: [{ ipAddress: '1.2.3.4', grade: 'A+', hasWarnings: false, details: { protocols: [{ name: 'TLS', version: '1.3' }] } }]
    })
  }, { domain: 'example.com' }, customCfg);
  eq(parsed.status, 'READY', 'ssl 应解析 status');
  eq(parsed.grade, 'A+', 'ssl 应解析首个端点的评级');
  eq(parsed.endpoints[0].protocols[0].version, '1.3', 'ssl 应解析协议版本');
  throws(() => getProvider('ssl', 'ssllabs').parse({ text: JSON.stringify({ errors: [{ message: 'boom' }] }) }, { domain: 'a.com' }, customCfg), 'boom', 'ssl 服务返回错误时应抛出可读信息');
}

// --- portScan（服务端端口扫描）---
{
  eq(validateParams('portScan', { host: 'Example.COM' }), { host: 'example.com' }, 'portScan 应接受域名');
  eq(validateParams('portScan', { host: '1.2.3.4' }), { host: '1.2.3.4' }, 'portScan 应接受 IPv4');
  throws(() => validateParams('portScan', { host: 'not a host' }), '主机格式', 'portScan 应拒绝非法主机');
  const parsed = getProvider('portScan', 'hackertarget').parse({
    text: 'Starting Nmap\n80/tcp   open  http\n443/tcp  open  https\n'
  }, { host: 'example.com' }, customCfg);
  eq(parsed.ports.length, 2, 'portScan 应解析出两行端口');
  eq(parsed.ports[0], { port: 80, protocol: 'tcp', state: 'open', service: 'http' }, 'portScan 端口结构应正确');
  throws(() => getProvider('portScan', 'hackertarget').parse({ text: 'API count exceeded' }, { host: 'a.com' }, customCfg), '扫描服务返回', 'portScan 应把错误文本识别为失败');
}

// --- proxy（HTTP 转发代理）---
{
  eq(validateParams('proxy', { url: 'https://a.com/x#frag' }), { url: 'https://a.com/x' }, 'proxy 应规范化 URL 并去掉锚点');
  throws(() => validateParams('proxy', { url: 'file:///etc/passwd' }), 'http/https', 'proxy 应拒绝非 http(s) 链接');
  const { req } = expectValidRequest('proxy', 'allorigins', { url: 'https://a.com/x' });
  ok(req.url.includes('url=https%3A%2F%2Fa.com%2Fx'), 'proxy 应把目标 URL 作为参数传递');
  eq(getProvider('proxy', 'allorigins').parse({ status: 200, text: 'hello', headers: { 'content-type': 'text/plain' } }, { url: 'https://a.com/x' }, customCfg),
    { status: 200, body: 'hello', headers: { 'content-type': 'text/plain' }, finalUrl: 'https://a.com/x' },
    'proxy 应归一化为 { status, body, headers, finalUrl }');
}

// --- readability（服务端正文提取）---
{
  const { req } = expectValidRequest('readability', 'jina', { url: 'https://a.com/post' });
  ok(req.url.startsWith('https://r.jina.ai/https://a.com/post'), 'Jina Reader 应把目标 URL 拼在地址之后');
  const parsed = getProvider('readability', 'jina').parse({
    text: JSON.stringify({ data: { title: 'T', content: '# Body', author: 'A', siteName: 'S' } })
  }, { url: 'https://a.com/post' }, customCfg);
  eq(parsed.title, 'T', 'readability 应解析标题');
  eq(parsed.content, '# Body', 'readability 应解析正文');
  throws(() => getProvider('readability', 'jina').parse({ text: JSON.stringify({ data: {} }) }, { url: 'https://a.com' }, customCfg), '未返回正文', 'readability 缺少正文时应报错');
}

// ==================== 客户端直连类别：stun / screenshot ====================
{
  ok(isClientTransport('stun'), 'stun 应标记为客户端直连');
  ok(isClientTransport('screenshot'), 'screenshot 应标记为客户端直连');
  ok(!isClientTransport('dns'), 'dns 不应被标记为客户端直连');

  // STUN：只构造地址，不发请求
  const stun = buildClientRequestUrl('stun', {}, defaultServiceConfig());
  eq(stun.url, 'stun:stun.l.google.com:19302', 'STUN 应解析出默认地址');
  eq(stun.provider.id, 'google', 'STUN 默认服务商应为 google');
  // 用户改地址后应生效（可指向自建 coturn）
  const customStun = buildClientRequestUrl('stun', {}, {
    ...defaultServiceConfig(),
    stun: { providerId: 'custom', baseUrl: 'stun:coturn.example.com:3478', apiKey: '', emailBaseUrl: '', headers: {} }
  });
  eq(customStun.url, 'stun:coturn.example.com:3478', 'STUN 应支持指向自建服务');
  throws(() => buildClientRequestUrl('stun', {}, {
    ...defaultServiceConfig(),
    stun: { providerId: 'custom', baseUrl: '', apiKey: '', emailBaseUrl: '', headers: {} }
  }), '尚未配置', '未填自定义 STUN 地址时应报错');

  // 截图：地址中带上宽度与目标 URL
  const shot = buildClientRequestUrl('screenshot', { url: 'https://a.com/x', width: 800 }, defaultServiceConfig());
  ok(shot.url.includes('/800/https://a.com/x'), '服务端截图地址应包含宽度与目标 URL');
  // 宽度应被限制在合理区间
  const wide = buildClientRequestUrl('screenshot', { url: 'https://a.com/', width: 99999 }, defaultServiceConfig());
  ok(wide.url.includes('/2000/'), '过大的宽度应被钳制到 2000');

  // 客户端直连类别的 provider.parse 必须明确拒绝（它们不解析 HTTP 响应）
  throws(() => getProvider('stun', 'google').parse({ text: '' }, {}, customCfg), '客户端直连', 'STUN provider 不应解析 HTTP 响应');
  throws(() => getProvider('screenshot', 'thumio').parse({ text: '' }, {}, customCfg), '客户端直连', '截图 provider 不应解析 HTTP 响应');

  // 反向：非客户端直连类别不得走 buildClientRequestUrl
  throws(() => buildClientRequestUrl('dns', { name: 'a.com', type: 'A' }, defaultServiceConfig()), '不是客户端直连', 'dns 不应允许走客户端直连路径');
}

// ==================== 第三批类别：urlScan / webArchive / ipReputation ====================

// --- urlScan（URL 安全检测）---
{
  eq(validateParams('urlScan', { url: 'https://a.com/x#frag' }), { url: 'https://a.com/x' }, 'urlScan 应规范化 URL 并去掉锚点');
  throws(() => validateParams('urlScan', { url: 'file:///etc/passwd' }), 'http/https', 'urlScan 应拒绝非 http(s) 链接');
  const { req } = expectValidRequest('urlScan', 'urlscan', { url: 'https://a.com/x' });
  ok(req.url.includes('page.url%3A'), 'urlScan 应按 page.url 精确匹配查询');
  ok(req.url.includes(encodeURIComponent('https://a.com/x')), 'urlScan 查询应包含目标 URL');
  const parsed = getProvider('urlScan', 'urlscan').parse({
    text: JSON.stringify({
      total: 2,
      results: [
        { verdicts: { overall: { malicious: false, score: 0 } } },
        { verdicts: { overall: { malicious: true, score: 75 }, engines: { malicious: [{ category: 'phishing' }] } } }
      ]
    })
  }, { url: 'https://a.com' }, customCfg);
  eq(parsed.malicious, true, 'urlScan 应识别恶意判定');
  eq(parsed.score, 75, 'urlScan 应取最高分');
  eq(parsed.reports, 2, 'urlScan 应返回记录数');
  eq(parsed.categories, ['phishing'], 'urlScan 应收集恶意分类');
  // 无结果时不得误报
  const clean = getProvider('urlScan', 'urlscan').parse({ text: JSON.stringify({ total: 0, results: [] }) }, { url: 'https://a.com' }, customCfg);
  eq(clean.malicious, false, 'urlScan 无记录时不应判为恶意');
}

// --- webArchive（网页归档快照）---
{
  eq(validateParams('webArchive', { url: 'https://a.com/post' }), { url: 'https://a.com/post' }, 'webArchive 应规范化 URL');
  const { req } = expectValidRequest('webArchive', 'wayback', { url: 'https://a.com/post' });
  ok(req.url.includes('url=https%3A%2F%2Fa.com%2Fpost'), 'wayback 请求应带上目标 URL');

  const hit = getProvider('webArchive', 'wayback').parse({
    text: JSON.stringify({ archived_snapshots: { closest: { available: true, url: 'https://web.archive.org/web/20200101000000/https://a.com/post', timestamp: '20200101000000' } } })
  }, { url: 'https://a.com/post' }, customCfg);
  eq(hit.available, true, 'wayback 命中时应标记 available');
  ok(hit.snapshotUrl.includes('web.archive.org'), 'wayback 应返回快照地址');

  const miss = getProvider('webArchive', 'wayback').parse({ text: JSON.stringify({ archived_snapshots: {} }) }, { url: 'https://a.com' }, customCfg);
  eq(miss.available, false, 'wayback 无快照时 available 应为 false');
  eq(miss.snapshotUrl, '', '无快照时快照地址应为空');

  // CDX：首行为表头，需要正确跳过并取最后一行作为最近快照
  const cdx = getProvider('webArchive', 'cdx').parse({
    text: JSON.stringify([
      ['urlkey', 'timestamp', 'original', 'mimetype', 'statuscode', 'digest', 'length'],
      ['com,a)/', '20190101000000', 'https://a.com/', 'text/html', '200', 'AAA', '100'],
      ['com,a)/', '20220615000000', 'https://a.com/', 'text/html', '200', 'BBB', '200']
    ])
  }, { url: 'https://a.com/' }, customCfg);
  eq(cdx.available, true, 'CDX 有数据行时应标记 available');
  eq(cdx.total, 2, 'CDX 应统计快照数量');
  ok(cdx.snapshotUrl.includes('20220615000000'), 'CDX 应取最近一次快照');

  const cdxEmpty = getProvider('webArchive', 'cdx').parse({ text: JSON.stringify([['urlkey', 'timestamp', 'original', 'mimetype', 'statuscode', 'digest', 'length']]) }, { url: 'https://a.com' }, customCfg);
  eq(cdxEmpty.available, false, 'CDX 只有表头时应视为无快照');
}

// --- ipReputation（IP 信誉）---
{
  eq(validateParams('ipReputation', { ip: '1.1.1.1' }), { ip: '1.1.1.1' }, 'ipReputation 应接受合法 IPv4');
  throws(() => validateParams('ipReputation', { ip: '999.1.1.1' }), 'IP 地址格式', 'ipReputation 应拒绝非法 IP');
  throws(() => validateParams('ipReputation', { ip: '' }), '缺少', 'ipReputation 应拒绝空 IP');
  const { req } = expectValidRequest('ipReputation', 'greynoise', { ip: '1.1.1.1' });
  ok(req.url.endsWith('/1.1.1.1'), 'IP 信誉请求应把 IP 拼在地址之后');
  const parsed = getProvider('ipReputation', 'greynoise').parse({
    text: JSON.stringify({ ip: '1.1.1.1', noise: true, riot: false, classification: 'malicious', name: 'Scanner', last_seen: '2024-01-01' })
  }, { ip: '1.1.1.1' }, customCfg);
  eq(parsed.noise, true, 'ipReputation 应解析 noise 标记');
  eq(parsed.classification, 'malicious', 'ipReputation 应解析分类');
  eq(parsed.name, 'Scanner', 'ipReputation 应解析名称');
  const benign = getProvider('ipReputation', 'greynoise').parse({
    text: JSON.stringify({ ip: '8.8.8.8', noise: false, riot: true, classification: 'benign' })
  }, { ip: '8.8.8.8' }, customCfg);
  eq(benign.noise, false, '良性 IP 的 noise 应为 false');
  eq(benign.riot, true, 'ipReputation 应解析 riot 标记');
}

// --- dns：其余三家服务商（与 cloudflare 同为 RFC 8484 JSON 形态，需逐一确认地址与参数）---
{
  const { req } = expectValidRequest('dns', 'alibaba', { name: 'a.com', type: 'A' });
  ok(req.url.startsWith('https://dns.alidns.com/resolve?'), '阿里 DNS 应使用默认地址');
  ok(req.url.includes('name=a.com') && req.url.includes('type=A'), '阿里 DNS 请求应带查询参数');
  const alibabaParsed = getProvider('dns', 'alibaba').parse({
    text: JSON.stringify({ Status: 0, AD: false, Answer: [{ name: 'a.com.', type: 1, TTL: 60, data: '1.2.3.4' }] })
  }, { name: 'a.com', type: 'A' }, customCfg);
  eq(alibabaParsed, { status: 0, ad: false, answers: [{ name: 'a.com.', type: 1, ttl: 60, data: '1.2.3.4' }] }, '阿里 DNS 归一化结果应与 cloudflare 一致');

  const quad9 = expectValidRequest('dns', 'quad9', { name: 'a.com', type: 'A' }).req;
  ok(quad9.url.startsWith('https://dns.quad9.net:5053/dns-query?'), 'Quad9 应使用默认地址');
  // Quad9 与 Cloudflare 会显式声明 Accept: application/dns-json
  ok(quad9.options.headers['Accept'] === 'application/dns-json', 'Quad9 应声明 DoH JSON Accept 头');
}

// --- proxy：codetabs（参数名与 allorigins 不同，用 quest=）---
{
  const { req } = expectValidRequest('proxy', 'codetabs', { url: 'https://a.com/x' });
  ok(req.url.startsWith('https://api.codetabs.com/v1/proxy?quest='), 'codetabs 应使用 quest 参数');
  ok(req.url.includes(encodeURIComponent('https://a.com/x')), 'codetabs 应把目标 URL 作为 quest 值');
  eq(getProvider('proxy', 'codetabs').parse({ status: 200, text: 'body', headers: {} }, { url: 'https://a.com/x' }, customCfg),
    { status: 200, body: 'body', headers: {}, finalUrl: 'https://a.com/x' },
    'codetabs 归一化结果应与 allorigins 一致');
}

// --- 自建地址覆盖：内置服务商也能被指向自建服务 ---
{
  const { req, parsed } = expectValidRequest('dns', 'cloudflare', { name: 'a.com', type: 'A' }, 'https://my-doh.local/dns-query');
  eq(parsed.host, 'my-doh.local', '填写自建地址后请求应打到该地址');
  ok(req.url.includes('name=a.com'), '自建地址仍应带上查询参数');
}

// --- custom（自建服务）---
{
  const custom = getProvider('dns', 'custom');
  throws(() => custom.buildRequest(validateParams('dns', { name: 'a.com', type: 'A' }), customCfg), '尚未配置', '未填地址时应提示去设置页配置');
  const req = custom.buildRequest(validateParams('dns', { name: 'a.com', type: 'A' }), { baseUrl: 'https://my.local/lookup?n={name}&t={type}', headers: { 'X-Token': 't' } });
  eq(req.url, 'https://my.local/lookup?n=a.com&t=A', '自定义地址应支持占位符');
  eq(req.options.headers, { 'X-Token': 't' }, '自定义请求头应透传');
  eq(custom.parse({ text: JSON.stringify({ status: 0, ad: false, answers: [] }) }, {}, customCfg), { status: 0, ad: false, answers: [] }, '自定义服务应直接返回归一化 JSON');
  throws(() => custom.parse({ text: 'nope' }, {}, customCfg), '合法 JSON', '自定义服务返回非 JSON 应报错');
}

console.log(`\n服务注册表测试：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
