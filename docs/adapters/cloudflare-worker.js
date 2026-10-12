/**
 * ToolCube — 自建服务适配器示例（Cloudflare Workers）
 * ============================================================================
 *
 * 作用
 * ----
 * 把上游公共 API 转换成「ToolCube」要求的**归一化 JSON 结构**，
 * 使扩展可以把 8 类 HTTP 联网能力（dns/whois/ipGeo/ct/subdomain/currency/breach/publicIp）
 * 指向你自己的服务器。后新增的 ssl/portScan/proxy/readability 可按同样方式在 ROUTES 中扩展。
 *
 * 为什么需要中间层
 * ----------------
 * 直接让扩展指向公共 API 有三个问题：内网不可达、有速率限制、查询会经过第三方。
 * 部署这个 Worker 后，出口统一在你的账号下，可以加缓存、审计、鉴权与限流。
 *
 * 部署
 * ----
 *   1) 安装 wrangler：  npm i -g wrangler
 *   2) 登录：          wrangler login
 *   3) 部署：          wrangler deploy cloudflare-worker.js --name toolbox-adapter
 *   4) （可选）设置令牌： wrangler secret put ADAPTER_TOKEN
 *      设置后，请求必须带 `?token=xxx` 或 `X-Adapter-Token` 头，否则返回 401。
 *
 * 在扩展中配置（设置 → 服务端点，服务商选择「自定义服务」）
 * --------------------------------------------------------
 *   DNS        https://<worker>/dns?name={name}&type={type}&token=xxx
 *   WHOIS      https://<worker>/whois?domain={domain}&token=xxx
 *   IP 归属地   https://<worker>/ipGeo?ip={ip}&token=xxx
 *   CT 日志     https://<worker>/ct?domain={domain}&token=xxx
 *   子域名      https://<worker>/subdomain?domain={domain}&token=xxx
 *   汇率        https://<worker>/currency?base={base}&token=xxx
 *   泄露查询    https://<worker>/breach?prefix={prefix}&suffix={suffix}&token=xxx
 *   公网 IP     https://<worker>/publicIp?token=xxx
 *
 * 契约详见 docs/SELF-HOSTING.md
 */

// ============================================================================
// 常量
// ============================================================================

/** 上游地址（可按需替换为你的内网服务） */
const UPSTREAM = {
  doh: 'https://cloudflare-dns.com/dns-query',
  rdap: 'https://rdap.org/domain',
  ipApi: 'https://ip-api.com/json',
  crtSh: 'https://crt.sh/',
  currency: 'https://open.er-api.com/v6/latest',
  hibpRange: 'https://api.pwnedpasswords.com/range',
  hibpAccount: 'https://haveibeenpwned.com/api/v3/breachedaccount',
  ipify: 'https://api.ipify.org'
};

/** 单次上游请求超时（毫秒） */
const UPSTREAM_TIMEOUT_MS = 15000;

/** 各响应结构的缓存时长（秒），按数据变化频率设置 */
const CACHE_TTL = {
  dns: 60,
  whois: 3600,
  ipGeo: 3600,
  ct: 1800,
  subdomain: 1800,
  currency: 900,
  breach: 86400,
  publicIp: 0 // 公网 IP 因人而异，不缓存
};

/** DNS 记录类型：字符串 → 数字（扩展要求 answers[].type 为数字） */
const DNS_TYPE_NUM = {
  A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16,
  AAAA: 28, SRV: 33, CAA: 257
};

/** 允许的 DNS 记录类型（与扩展侧白名单保持一致） */
const ALLOWED_DNS_TYPES = new Set(Object.keys(DNS_TYPE_NUM).concat(['ANY']));

const DOMAIN_RE = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

// ============================================================================
// 通用工具
// ============================================================================

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // 便于排查问题，同时避免被浏览器缓存
      'cache-control': 'no-store'
    }
  });
}

/** 带超时的 fetch，超时后主动中止 */
async function fetchWithTimeout(url, options = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 请求上游并解析 JSON；非 2xx 或非 JSON 时抛出可读错误 */
async function fetchJson(url, options) {
  const res = await fetchWithTimeout(url, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`上游返回 HTTP ${res.status}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('上游返回的不是合法 JSON');
  }
}

function requireParam(params, key) {
  const value = (params[key] || '').trim();
  if (!value) throw new Error(`缺少参数 ${key}`);
  return value;
}

function requireDomain(params, key = 'domain') {
  const domain = requireParam(params, key).toLowerCase().replace(/\.$/, '');
  if (!DOMAIN_RE.test(domain)) throw new Error(`域名格式不正确: ${domain}`);
  return domain;
}

/** 取第一个非空值 */
function firstOf(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}

/** 在 Worker 边缘缓存中读取，未命中则执行 loader 并写入 */
async function withCache(kind, key, loader) {
  const ttl = CACHE_TTL[kind] || 0;
  if (!ttl || typeof caches === 'undefined') return loader();
  const cacheKey = new Request(`https://cache.internal/${kind}/${encodeURIComponent(key)}`);
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit.json();
  const value = await loader();
  const response = new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ttl}` }
  });
  // 写缓存失败不应影响主流程
  await caches.default.put(cacheKey, response.clone()).catch(() => {});
  return value;
}

// ============================================================================
// 各类别实现
// ============================================================================

/** DNS 查询（DoH JSON） */
async function handleDns(params) {
  const name = requireDomain(params, 'name');
  const type = (params.type || 'A').toUpperCase();
  if (!ALLOWED_DNS_TYPES.has(type)) throw new Error(`不支持的记录类型: ${type}`);
  const dnssec = params.dnssec === 'true' || params.dnssec === '1';

  return withCache('dns', `${name}|${type}|${dnssec}`, async () => {
    const url = `${UPSTREAM.doh}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`
      + (dnssec ? '&do=1' : '');
    const data = await fetchJson(url, { headers: { Accept: 'application/dns-json' } });
    return {
      status: typeof data.Status === 'number' ? data.Status : 0,
      ad: data.AD === true,
      answers: (data.Answer || []).map(a => ({
        name: firstOf(a.name),
        type: typeof a.type === 'number' ? a.type : (DNS_TYPE_NUM[a.type] || 0),
        ttl: typeof a.TTL === 'number' ? a.TTL : null,
        data: firstOf(a.data)
      }))
    };
  });
}

/** WHOIS / RDAP 查询 */
async function handleWhois(params) {
  const domain = requireDomain(params);
  return withCache('whois', domain, async () => {
    const res = await fetchWithTimeout(`${UPSTREAM.rdap}/${encodeURIComponent(domain)}`, {
      headers: { Accept: 'application/rdap+json' }
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`上游返回 HTTP ${res.status}`);
    let rdap;
    try {
      rdap = JSON.parse(raw);
    } catch (e) {
      throw new Error('上游返回的不是合法 JSON');
    }
    return normalizeRdap(rdap, domain, raw);
  });
}

/** 把 RDAP 对象归一化为扩展要求的 WHOIS 结构 */
function normalizeRdap(rdap, domain, raw) {
  const result = {
    domain,
    registrar: '',
    registrarUrl: '',
    whoisServer: firstOf(rdap.port43),
    creationDate: '',
    expirationDate: '',
    updatedDate: '',
    nameServers: [],
    status: Array.isArray(rdap.status) ? rdap.status.slice() : [],
    registrantOrganization: '',
    registrantCountry: '',
    registrantEmail: '',
    registryDomainId: firstOf(rdap.handle),
    raw: raw || ''
  };

  for (const ev of rdap.events || []) {
    if (ev.eventAction === 'registration') result.creationDate = firstOf(ev.eventDate);
    else if (ev.eventAction === 'expiration') result.expirationDate = firstOf(ev.eventDate);
    else if (ev.eventAction === 'last changed') result.updatedDate = firstOf(ev.eventDate);
  }

  for (const entity of rdap.entities || []) {
    const roles = entity.roles || [];
    const vcard = (entity.vcardArray && entity.vcardArray[1]) || [];
    const field = (key) => {
      const item = vcard.find(v => v[0] === key);
      return item ? firstOf(item[3]) : '';
    };
    if (roles.includes('registrar') && !result.registrar) {
      result.registrar = field('fn');
      const url = field('url');
      if (url) result.registrarUrl = url;
    }
    if (roles.includes('registrant')) {
      if (!result.registrantOrganization) result.registrantOrganization = field('org');
      if (!result.registrantCountry) result.registrantCountry = field('country');
      if (!result.registrantEmail) result.registrantEmail = field('email');
    }
  }

  for (const ns of rdap.nameservers || []) {
    const name = firstOf(ns.ldhName, ns.unicodeName);
    if (name) result.nameServers.push(name);
  }

  return result;
}

/** IP 归属地（ip 为空时查询调用方自身） */
async function handleIpGeo(params) {
  const ip = (params.ip || '').trim();
  // 注意：空 ip 表示"查询调用方自己"，不能当作参数缺失处理
  const cacheKey = ip || 'self';
  return withCache('ipGeo', cacheKey, async () => {
    const fields = 'status,message,country,regionName,city,zip,isp,org,as,query,lat,lon,timezone,hosting';
    const target = ip
      ? `${UPSTREAM.ipApi}/${encodeURIComponent(ip)}`
      : `${UPSTREAM.ipApi}/`;
    const data = await fetchJson(`${target}?lang=zh-CN&fields=${fields}`);
    if (data.status && data.status !== 'success') {
      throw new Error(data.message || '查询失败');
    }
    return {
      ip: firstOf(data.query, ip),
      country: firstOf(data.country),
      region: firstOf(data.regionName, data.region),
      city: firstOf(data.city),
      zip: firstOf(data.zip),
      isp: firstOf(data.isp),
      org: firstOf(data.org),
      as: firstOf(data.as),
      lat: typeof data.lat === 'number' ? data.lat : null,
      lon: typeof data.lon === 'number' ? data.lon : null,
      timezone: firstOf(data.timezone),
      hosting: data.hosting === true
    };
  });
}

/** 证书透明度日志 */
async function handleCt(params) {
  const domain = requireDomain(params);
  return withCache('ct', domain, async () => {
    const list = await fetchJson(`${UPSTREAM.crtSh}?q=${encodeURIComponent(domain)}&output=json`);
    if (!Array.isArray(list)) throw new Error('上游返回的不是 JSON 数组');
    return {
      certificates: list.map(e => ({
        id: e.id,
        serialNumber: firstOf(e.serial_number),
        commonName: firstOf(e.common_name),
        nameValue: firstOf(e.name_value),
        issuer: firstOf(e.issuer_name),
        notBefore: firstOf(e.not_before),
        notAfter: firstOf(e.not_after)
      }))
    };
  });
}

/** 子域名枚举（基于证书透明度日志） */
async function handleSubdomain(params) {
  const domain = requireDomain(params);
  return withCache('subdomain', domain, async () => {
    const list = await fetchJson(`${UPSTREAM.crtSh}?q=${encodeURIComponent(domain)}&output=json`);
    if (!Array.isArray(list)) throw new Error('上游返回的不是 JSON 数组');

    const apex = domain.toLowerCase();
    const suffix = '.' + apex;
    const seen = new Set();
    const subdomains = [];

    for (const entry of list) {
      for (const rawName of String(entry.name_value || '').split('\n')) {
        const name = rawName.replace(/^\*\./, '').trim().toLowerCase();
        if (!name || seen.has(name)) continue;
        // 必须等于根域名或以「.根域名」结尾，避免把 notexample.com 这类无关域名算进来
        if (name !== apex && !name.endsWith(suffix)) continue;
        seen.add(name);
        subdomains.push({ name, source: 'ct', firstSeen: firstOf(entry.not_before) });
      }
    }
    return { subdomains };
  });
}

/** 汇率 */
async function handleCurrency(params) {
  const base = (params.base || 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(base)) throw new Error(`基准货币必须是 3 位字母代码: ${base}`);
  return withCache('currency', base, async () => {
    const data = await fetchJson(`${UPSTREAM.currency}/${encodeURIComponent(base)}`);
    if (!data || !data.rates) throw new Error('上游返回的数据缺少 rates 字段');
    return {
      base: firstOf(data.base_code, base),
      date: firstOf(data.time_last_update_utc, data.time_last_update_unix),
      // 约定：rates[code] 表示「1 个基准货币 = 多少个 code」
      rates: data.rates
    };
  });
}

/** 密码 / 邮箱泄露查询 */
async function handleBreach(params, request, env) {
  const prefix = (params.prefix || '').toUpperCase();
  const suffix = (params.suffix || '').toUpperCase();
  const email = (params.email || '').trim();

  if (prefix) {
    if (!/^[0-9A-F]{5}$/.test(prefix)) throw new Error('prefix 需为 5 位十六进制');
    if (!/^[0-9A-F]{35}$/.test(suffix)) throw new Error('suffix 需为 35 位十六进制');

    return withCache('breach', prefix, async () => {
      const res = await fetchWithTimeout(`${UPSTREAM.hibpRange}/${prefix}`);
      if (!res.ok) throw new Error(`上游返回 HTTP ${res.status}`);
      const text = await res.text();
      // 上游格式：每行 `后缀:次数`
      for (const line of text.split('\n')) {
        const parts = line.trim().split(':');
        if (parts.length === 2 && parts[0].toUpperCase() === suffix) {
          return { count: parseInt(parts[1], 10) || 0 };
        }
      }
      return { count: 0 };
    });
  }

  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('邮箱格式不正确');
    // 邮箱查询需要 HIBP API Key：由部署者通过 secret 注入（wrangler secret put HIBP_API_KEY），
    // Worker 中通过 env 读取，绝不能把密钥写进源码
    const apiKey = (env && env.HIBP_API_KEY) || '';
    if (!apiKey) throw new Error('服务端未配置 HIBP API Key（wrangler secret put HIBP_API_KEY）');

    return withCache('breach', 'email:' + email, async () => {
      const res = await fetchWithTimeout(`${UPSTREAM.hibpAccount}/${encodeURIComponent(email)}?truncateResponse=false`, {
        headers: { 'hibp-api-key': apiKey, 'user-agent': 'ToolCube-Adapter' }
      });
      if (res.status === 404) return { breaches: [] }; // 未发现泄露
      if (!res.ok) throw new Error(`上游返回 HTTP ${res.status}`);
      const list = JSON.parse(await res.text());
      if (!Array.isArray(list)) throw new Error('上游返回的不是 JSON 数组');
      return {
        breaches: list.map(b => ({
          name: firstOf(b.Name),
          title: firstOf(b.Title),
          domain: firstOf(b.Domain),
          breachDate: firstOf(b.BreachDate),
          description: firstOf(b.Description),
          isVerified: b.IsVerified === true,
          dataClasses: Array.isArray(b.DataClasses) ? b.DataClasses : []
        }))
      };
    });
  }

  throw new Error('缺少参数：需要 prefix+suffix（密码）或 email（邮箱）');
}

/** 公网 IP */
async function handlePublicIp() {
  // 不缓存：公网 IP 因调用方而异
  const data = await fetchJson(`${UPSTREAM.ipify}?format=json`);
  if (!data || !data.ip) throw new Error('上游返回的数据缺少 ip 字段');
  return { ip: data.ip };
}

// ============================================================================
// 路由
// ============================================================================

const ROUTES = {
  dns: handleDns,
  whois: handleWhois,
  ipGeo: handleIpGeo,
  ct: handleCt,
  subdomain: handleSubdomain,
  currency: handleCurrency,
  breach: handleBreach,
  publicIp: handlePublicIp
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const kind = url.pathname.replace(/^\/+|\/+$/g, '');

    if (!kind) {
      return json({
        service: 'toolbox-adapter',
        kinds: Object.keys(ROUTES),
        usage: 'GET /<kind>?<params>'
      });
    }

    const handler = ROUTES[kind];
    if (!handler) return json({ error: `未知的服务类别: ${kind}` }, 404);

    // 可选鉴权：配置了 ADAPTER_TOKEN 后必须携带匹配的令牌
    const expectedToken = (env && env.ADAPTER_TOKEN) || '';
    if (expectedToken) {
      const provided = url.searchParams.get('token') || request.headers.get('X-Adapter-Token') || '';
      if (provided !== expectedToken) return json({ error: '未授权' }, 401);
    }

    const params = Object.fromEntries(url.searchParams);
    delete params.token;

    try {
      return json(await handler(params, request, env));
    } catch (e) {
      // 统一兜底：把可读错误返回给扩展，扩展会直接展示给用户
      return json({ error: e && e.message ? e.message : '适配器内部错误' }, 502);
    }
  }
};
