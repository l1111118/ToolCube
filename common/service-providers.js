/**
 * ToolCube - Service Providers
 *
 * 「外部服务端点」的可插拔注册表。
 *
 * ## 为什么需要这一层
 * 本扩展里有一批功能本质上要访问**第三方在线服务**：DNS over HTTPS、WHOIS/RDAP、
 * IP 归属地、证书透明度日志、子域名枚举、汇率、密码泄露查询等。这些服务原先以
 * 硬编码 URL 的形式散落在各工具里，带来三个问题：
 *   1. 想换成自建/自托管的服务（例如自建 DoH、自建 WHOIS 网关）必须改源码；
 *   2. 各家服务返回的数据结构不同，工具里到处是格式适配代码；
 *   3. 新增一家服务商要改动多处。
 *
 * 本模块把「访问哪个服务」与「如何使用结果」彻底解耦：
 *   - **Provider**（服务商）= 一组纯函数 `buildRequest` + `parse`，负责协议细节；
 *   - **Kind**（服务类别）= 一组能力，例如 `dns`、`whois`，有稳定的归一化数据结构；
 *   - **归一化结果** = 调用方唯一需要理解的东西，与服务商无关。
 *
 * 于是「接入自己的服务器」只需要在设置里为某个 kind 选择 `custom` 服务商并填写地址，
 * 或按文档实现一个返回归一化 JSON 的薄适配层 —— **无需修改任何源码**。
 *
 * ## 契约（对外承诺，保持稳定）
 * - `buildRequest(params, cfg) => { url, options }`
 * - `parse(response, params, cfg) => normalized`
 *   - `response = { status, ok, text, headers }`（`headers` 为普通对象）
 *   - 归一化结构见各类别的 `resultSchema` 字段，也见 `docs/SELF-HOSTING.md`
 * - 抛错即视为失败，由调用方统一处理；不得返回 `undefined`
 *
 * 本模块**不依赖任何 chrome API**，可在 Node 中直接单测。
 *
 * @version 1.3.0
 */

// ==================== 通用工具 ====================

/** 允许出现在自定义地址模板中的占位符 */
const TEMPLATE_PLACEHOLDER_RE = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

/**
 * 用参数展开地址模板，例如 `https://dns.example.com/dns-query?name={name}&type={type}`
 * 所有占位值都会被 URL 编码，避免参数注入到 URL 结构里。
 * @param {string} template
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
export function expandTemplate(template, params) {
  return String(template).replace(TEMPLATE_PLACEHOLDER_RE, (match, key) => {
    const value = params[key];
    if (value === undefined || value === null) return '';
    return encodeURIComponent(String(value));
  });
}

/**
 * 安全解析 JSON：失败时返回 null，并附带原始文本供诊断
 * @param {string} text
 * @returns {any|null}
 */
export function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

/**
 * 拼接 baseUrl 与路径，避免出现重复或缺失的斜杠
 * @param {string} baseUrl
 * @param {string} path
 * @returns {string}
 */
export function joinUrl(baseUrl, path) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const suffix = String(path || '').replace(/^\/+/, '');
  return suffix ? base + '/' + suffix : base;
}

/** 从 RDAP/WHOIS 结果里取第一个可用值 */
function firstOf(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}

// ==================== 参数校验 ====================

const DOMAIN_RE = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;
/** DNS 记录类型白名单：防止把任意字符串拼进请求参数 */
const DNS_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'SRV', 'CAA', 'PTR', 'ANY'];

/**
 * 校验并规范化调用参数
 *
 * 参数会被拼进请求 URL，因此必须在此做严格校验 —— 这是把「用户可控字符串」
 * 变成「可安全使用的查询参数」的唯一入口。
 *
 * @param {string} kind
 * @param {object} params
 * @returns {object} 规范化后的参数
 * @throws {Error} 参数非法时抛出可读错误
 */
export function validateParams(kind, params) {
  const p = params || {};

  const needDomain = () => {
    const domain = String(p.domain || p.name || '').trim().toLowerCase().replace(/\.$/, '');
    if (!domain) throw new Error('缺少域名参数');
    if (!DOMAIN_RE.test(domain)) throw new Error('域名格式不正确: ' + domain);
    return domain;
  };

  /** 校验并规范化一个 http/https 链接（会去掉 fragment，避免把锚点传给外部服务） */
  const needUrl = () => {
    const raw = String(p.url || '').trim();
    if (!raw) throw new Error('缺少 URL 参数');
    let parsed;
    try {
      parsed = new URL(raw);
    } catch (e) {
      throw new Error('URL 格式不正确: ' + raw);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('仅支持 http/https 链接');
    }
    parsed.hash = '';
    return parsed.href;
  };

  /** 校验主机（域名或 IP 均可，用于端口扫描等场景） */
  const needHost = () => {
    const host = String(p.host || p.domain || '').trim().toLowerCase().replace(/\.$/, '');
    if (!host) throw new Error('缺少主机参数');
    if (!DOMAIN_RE.test(host) && !IPV4_RE.test(host) && !IPV6_RE.test(host)) {
      throw new Error('主机格式不正确: ' + host);
    }
    return host;
  };

  switch (kind) {
    case 'dns': {
      const type = String(p.type || 'A').toUpperCase();
      if (!DNS_TYPES.includes(type)) throw new Error('不支持的记录类型: ' + type);
      return { name: needDomain(), type, dnssec: p.dnssec === true };
    }
    case 'whois':
    case 'ct':
    case 'subdomain':
      return { domain: needDomain() };

    case 'ssl':
      return { domain: needDomain() };

    case 'portScan':
      return { host: needHost() };

    case 'proxy':
    case 'readability':
      return { url: needUrl() };

    case 'screenshot': {
      const width = Math.min(2000, Math.max(320, Math.round(Number(p.width) || 1200)));
      return { url: needUrl(), width };
    }

    case 'urlScan':
      return { url: needUrl() };

    case 'webArchive':
      return { url: needUrl() };

    case 'ipReputation': {
      const ip = String(p.ip || '').trim();
      if (!ip) throw new Error('缺少 IP 参数');
      if (!IPV4_RE.test(ip) && !IPV6_RE.test(ip)) throw new Error('IP 地址格式不正确: ' + ip);
      // 逐段校验范围：IPV4_RE 只限制"1-3 位数字"，不限制 ≤255，
      // 不补这一步会把 999.1.1.1 这类越界值拼进请求地址。
      if (IPV4_RE.test(ip) && ip.split('.').some(n => Number(n) > 255)) {
        throw new Error('IP 地址格式不正确: ' + ip);
      }
      return { ip };
    }

    case 'stun':
      return {};

    case 'ipGeo': {
      const ip = String(p.ip || '').trim();
      if (!ip) return { ip: '' }; // 留空表示查询本机
      if (!IPV4_RE.test(ip) && !IPV6_RE.test(ip)) throw new Error('IP 地址格式不正确: ' + ip);
      if (IPV4_RE.test(ip) && ip.split('.').some(n => Number(n) > 255)) {
        throw new Error('IP 地址格式不正确: ' + ip);
      }
      return { ip };
    }

    case 'currency': {
      const base = String(p.base || 'USD').toUpperCase();
      if (!/^[A-Z]{3}$/.test(base)) throw new Error('基准货币必须是 3 位字母代码: ' + base);
      return { base };
    }

    case 'breach': {
      const mode = p.mode === 'email' ? 'email' : 'password';
      // 参数名兼容：统一用 value，同时接受语义化的 prefix / email 写法，
      // 避免调用方因命名差异拿到"缺少查询内容"这种误导性报错。
      const raw = (p.value !== undefined && p.value !== '')
        ? p.value
        : (mode === 'email' ? p.email : p.prefix);
      const value = String(raw || '');
      if (!value) throw new Error('缺少查询内容');
      if (mode === 'password') {
        // k-匿名模型：只上传 SHA-1 的前 5 位（前缀），服务端返回该前缀下所有后缀的计数。
        // 因此除了前缀，还必须带上剩余 35 位后缀，否则无法在返回结果中定位到目标密码。
        const prefix = value.toUpperCase();
        if (!/^[0-9A-F]{5}$/.test(prefix)) throw new Error('密码查询需要 5 位 SHA-1 前缀');
        const suffix = String(p.suffix || '').toUpperCase();
        if (!/^[0-9A-F]{35}$/.test(suffix)) throw new Error('密码查询需要 35 位 SHA-1 后缀');
        return { mode, prefix, suffix };
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('邮箱格式不正确');
      return { mode, email: value };
    }

    case 'publicIp':
      return {};

    default:
      throw new Error('未知的服务类别: ' + kind);
  }
}

// ==================== 服务类别定义 ====================

/**
 * 服务类别（能力）定义
 *
 * `resultSchema` 既是文档也是契约：自建服务只要按此结构返回 JSON 即可接入。
 * `params` 说明该类别接受的参数名（会在拼 URL 时做占位符替换）。
 */
export const SERVICE_KINDS = [
  {
    id: 'dns',
    label: 'DNS 查询（DoH）',
    description: '通过 DNS over HTTPS 查询 A/AAAA/MX/TXT 等记录，并可用于 DNS 传播与 DNSSEC 检测。',
    params: ['name', 'type'],
    resultSchema: '{ status: number, ad: boolean, answers: [{ name, type, ttl, data }] }',
    usedBy: ['dns-lookup', 'subdomain-finder'],
    defaultProviderId: 'cloudflare'
  },
  {
    id: 'whois',
    label: 'WHOIS / RDAP 查询',
    description: '查询域名注册信息（注册商、注册/到期时间、域名服务器、状态）。',
    params: ['domain'],
    resultSchema: '{ domain, registrar, registrarUrl, whoisServer, creationDate, expirationDate, updatedDate, nameServers: string[], status: string[], registrantOrganization, registrantCountry, registrantEmail, registryDomainId, raw }',
    usedBy: ['whois-lookup'],
    defaultProviderId: 'rdap'
  },
  {
    id: 'ipGeo',
    label: 'IP 归属地',
    description: '查询 IP 的地理位置与运营商信息；不传 IP 时查询本机公网 IP。',
    params: ['ip'],
    resultSchema: '{ ip, country, region, city, zip, isp, org, as, lat, lon, timezone, hosting }',
    usedBy: ['ip-lookup'],
    defaultProviderId: 'ip-api'
  },
  {
    id: 'ct',
    label: '证书透明度日志（CT）',
    description: '查询证书透明度日志，用于了解某个域名签发过哪些证书。',
    params: ['domain'],
    resultSchema: '{ certificates: [{ id, serialNumber, commonName, nameValue, issuer, notBefore, notAfter }] }',
    usedBy: ['ssl-checker'],
    defaultProviderId: 'crt-sh'
  },
  {
    id: 'subdomain',
    label: '子域名枚举',
    description: '通过证书透明度日志等公开数据源枚举子域名。',
    params: ['domain'],
    resultSchema: '{ subdomains: [{ name, source, firstSeen, ip? }] }',
    usedBy: ['subdomain-finder'],
    defaultProviderId: 'crt-sh'
  },
  {
    id: 'currency',
    label: '汇率',
    description: '获取以某个基准货币计价的汇率表。',
    params: ['base'],
    resultSchema: '{ base, date, rates: { [code: string]: number } }',
    usedBy: ['currency-converter'],
    defaultProviderId: 'er-api'
  },
  {
    id: 'breach',
    label: '密码 / 邮箱泄露查询',
    description: '密码采用 k-匿名模型（仅上传 SHA-1 前 5 位）；邮箱查询需要 API Key。',
    params: ['prefix', 'suffix', 'email'],
    resultSchema: '密码: { count: number }（需提供 prefix 与 suffix）；邮箱: { breaches: [{ name, title, domain, breachDate, description, isVerified, dataClasses }] }',
    usedBy: ['password-leak-check'],
    defaultProviderId: 'hibp'
  },
  {
    id: 'publicIp',
    label: '公网 IP 查询',
    description: '获取本机出口公网 IP。',
    params: [],
    resultSchema: '{ ip }',
    usedBy: ['ip-lookup'],
    defaultProviderId: 'ipify'
  },
  {
    id: 'ssl',
    label: 'SSL/TLS 深度评级',
    description: '由外部服务对目标域名做完整 TLS 握手与配置评分（协议版本、加密套件、证书链、已知漏洞）。'
      + '浏览器出于安全限制无法自行探测这些信息，因此这一项必须依赖外部服务。',
    params: ['domain'],
    resultSchema: '{ status, grade, endpoints: [{ ipAddress, serverName, grade, hasWarnings, protocols: [{ name, version }] }] }',
    usedBy: ['ssl-checker'],
    defaultProviderId: 'ssllabs'
  },
  {
    id: 'portScan',
    label: '端口扫描（服务端视角）',
    description: '由外部服务从公网视角扫描目标主机的开放端口，用于浏览器无法直连的场景。',
    params: ['host'],
    resultSchema: '{ host, ports: [{ port, protocol, state, service }] }',
    usedBy: ['port-scanner'],
    defaultProviderId: 'hackertarget'
  },
  {
    id: 'proxy',
    label: 'HTTP 转发代理',
    description: '把完整的目标 URL 交给代理服务转发，用于绕过页面 CORS 限制，或让请求从你自己的出口 IP 发出。',
    params: ['url'],
    resultSchema: '{ status, body, headers, finalUrl }',
    usedBy: ['http-tester'],
    defaultProviderId: 'allorigins'
  },
  {
    id: 'readability',
    label: '正文提取（服务端）',
    description: '由外部服务抓取页面并抽取正文，用于把文章保存为 Markdown；比浏览器端的启发式提取更稳定。',
    params: ['url'],
    resultSchema: '{ title, content, textContent, byline, siteName }',
    usedBy: ['web-clipper'],
    defaultProviderId: 'jina'
  },
  {
    id: 'screenshot',
    label: '网页截图（服务端渲染）',
    description: '由外部服务渲染并截图任意 URL（可整页）。用于截取非当前标签页，或需要完整页面高度的场景。',
    params: ['url', 'width'],
    transport: 'client',
    resultSchema: '（客户端直连：由工具直接把生成的图片地址作为 <img> 使用，不经过 HTTP 解析）',
    usedBy: ['screenshot-tool'],
    defaultProviderId: 'thumio'
  },
  {
    id: 'stun',
    label: 'STUN 服务器（WebRTC 检测）',
    description: '用于探测 WebRTC 是否会泄露真实 IP。这是客户端直连的 UDP 服务，不通过 HTTP 请求；'
      + '可指向自建 coturn / STUN 服务。',
    params: [],
    transport: 'client',
    resultSchema: '（客户端直连，无 HTTP 响应体）',
    usedBy: ['fingerprint-detector', 'privacy-checker'],
    defaultProviderId: 'google'
  },
  {
    id: 'urlScan',
    label: 'URL 安全检测',
    description: '查询某个 URL 是否被安全社区举报过（钓鱼、恶意软件分发等）。用于短链展开后判断目标是否可信。',
    params: ['url'],
    resultSchema: '{ malicious: boolean, score: number, reports: number, categories: string[], source: string }',
    usedBy: ['url-expander'],
    defaultProviderId: 'urlscan'
  },
  {
    id: 'webArchive',
    label: '网页归档快照',
    description: '查询网页在互联网档案馆（Wayback Machine）中的历史快照，用于判断站点存在时长或获取历史版本。',
    params: ['url'],
    resultSchema: '{ available: boolean, snapshotUrl: string, timestamp: string, total: number }',
    usedBy: ['url-expander', 'web-clipper'],
    defaultProviderId: 'wayback'
  },
  {
    id: 'ipReputation',
    label: 'IP 信誉查询',
    description: '查询 IP 是否被观测到扫描、暴力破解等恶意活动，辅助判断访问来源风险。',
    params: ['ip'],
    resultSchema: '{ ip: string, noise: boolean, riot: boolean, classification: string, name: string, lastSeen: string }',
    usedBy: ['ip-lookup'],
    defaultProviderId: 'greynoise'
  }
];

/** 按 id 取服务类别 */
export function getServiceKind(kindId) {
  return SERVICE_KINDS.find(k => k.id === kindId) || null;
}

// ==================== 服务商定义 ====================

/** 每个 kind 都提供的通用「自定义服务」服务商，用于指向自建/自托管服务 */
function customProvider(kind, extraFields = []) {
  const kindMeta = SERVICE_KINDS.find(k => k.id === kind);
  const isClient = !!(kindMeta && kindMeta.transport === 'client');
  const placeholders = ((kindMeta && kindMeta.params) || []).map(p => '{' + p + '}').join('、');
  return {
    id: 'custom',
    kind,
    label: '自定义服务（自建 / 自托管）',
    selfHostable: true,
    description: (isClient
      ? '把地址指向你自己的服务。'
      : '把地址指向你自己的服务，响应需符合该类别的归一化结构（见文档）。')
      + (placeholders ? ' 地址中可用占位符：' + placeholders + '。' : ''),
    defaultBaseUrl: '',
    fields: [
      { key: 'baseUrl', label: '服务地址', type: 'text', required: true, placeholder: 'https://your-server.example.com/path' },
      { key: 'apiKey', label: 'API Key（可选）', type: 'password', required: false, placeholder: '如你的服务需要鉴权' },
      ...extraFields
    ],
    buildRequest(params, cfg) {
      if (!cfg.baseUrl) throw new Error('尚未配置自定义服务地址，请到「设置 → 服务端点」填写');
      return {
        url: expandTemplate(cfg.baseUrl, params),
        options: { headers: cfg.headers }
      };
    },
    parse(response) {
      if (isClient) throw new Error('该服务为客户端直连，不通过 HTTP 解析响应');
      const data = tryParseJson(response.text);
      if (data === null) throw new Error('自定义服务返回的不是合法 JSON');
      return data;
    }
  };
}

/**
 * 全部内置服务商
 *
 * 每个 provider 必须实现：
 *  - `buildRequest(params, cfg)` → `{ url, options }`
 *  - `parse(response, params, cfg)` → 归一化结果
 * 并且应当**优先使用 `cfg.baseUrl`**，这样用户只要改地址就能切到自建服务。
 */
export const PROVIDERS = [
  // ---------------- DNS over HTTPS ----------------
  {
    id: 'cloudflare',
    kind: 'dns',
    label: 'Cloudflare DNS (1.1.1.1)',
    homepage: 'https://developers.cloudflare.com/1.1.1.1/',
    selfHostable: true,
    defaultBaseUrl: 'https://cloudflare-dns.com/dns-query',
    fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }],
    buildRequest(params, cfg) {
      const url = joinUrl(cfg.baseUrl, '') + '?name=' + encodeURIComponent(params.name)
        + '&type=' + encodeURIComponent(params.type)
        + (params.dnssec ? '&do=1' : '');
      return { url, options: { headers: Object.assign({ Accept: 'application/dns-json' }, cfg.headers) } };
    },
    parse: parseDohJson
  },
  {
    id: 'google',
    kind: 'dns',
    label: 'Google Public DNS',
    homepage: 'https://developers.google.com/speed/public-dns/docs/doh/json',
    selfHostable: true,
    defaultBaseUrl: 'https://dns.google/resolve',
    fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }],
    buildRequest(params, cfg) {
      const url = joinUrl(cfg.baseUrl, '') + '?name=' + encodeURIComponent(params.name)
        + '&type=' + encodeURIComponent(params.type)
        + (params.dnssec ? '&do=1' : '');
      return { url, options: { headers: cfg.headers } };
    },
    parse: parseDohJson
  },
  {
    id: 'alibaba',
    kind: 'dns',
    label: '阿里公共 DNS',
    homepage: 'https://www.alidns.com/',
    selfHostable: true,
    defaultBaseUrl: 'https://dns.alidns.com/resolve',
    fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }],
    buildRequest(params, cfg) {
      const url = joinUrl(cfg.baseUrl, '') + '?name=' + encodeURIComponent(params.name)
        + '&type=' + encodeURIComponent(params.type)
        + (params.dnssec ? '&do=1' : '');
      return { url, options: { headers: cfg.headers } };
    },
    parse: parseDohJson
  },
  {
    id: 'quad9',
    kind: 'dns',
    label: 'Quad9 DNS',
    homepage: 'https://www.quad9.net/',
    selfHostable: true,
    defaultBaseUrl: 'https://dns.quad9.net:5053/dns-query',
    fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }],
    buildRequest(params, cfg) {
      const url = joinUrl(cfg.baseUrl, '') + '?name=' + encodeURIComponent(params.name)
        + '&type=' + encodeURIComponent(params.type)
        + (params.dnssec ? '&do=1' : '');
      return { url, options: { headers: Object.assign({ Accept: 'application/dns-json' }, cfg.headers) } };
    },
    parse: parseDohJson
  },

  // ---------------- WHOIS / RDAP ----------------
  {
    id: 'rdap',
    kind: 'whois',
    label: 'RDAP.org（标准 RDAP）',
    homepage: 'https://rdap.org/',
    selfHostable: true,
    defaultBaseUrl: 'https://rdap.org/domain',
    fields: [{ key: 'baseUrl', label: '服务地址（不含域名）', type: 'text', required: true }],
    buildRequest(params, cfg) {
      return {
        url: joinUrl(cfg.baseUrl, encodeURIComponent(params.domain)),
        options: { headers: Object.assign({ Accept: 'application/rdap+json' }, cfg.headers) }
      };
    },
    parse(response, params) {
      const rdap = tryParseJson(response.text);
      if (!rdap) throw new Error('RDAP 返回的不是合法 JSON');
      return parseRdapObject(rdap, params.domain, response.text);
    }
  },
  {
    id: 'whoisjs',
    kind: 'whois',
    label: 'whoisjs.com',
    homepage: 'https://whoisjs.com/',
    selfHostable: true,
    defaultBaseUrl: 'https://whoisjs.com/api/v1',
    fields: [{ key: 'baseUrl', label: '服务地址（不含域名）', type: 'text', required: true }],
    buildRequest(params, cfg) {
      return {
        url: joinUrl(cfg.baseUrl, encodeURIComponent(params.domain)),
        options: { headers: cfg.headers }
      };
    },
    parse(response, params) {
      const data = tryParseJson(response.text);
      if (!data) throw new Error('WHOIS 服务返回的不是合法 JSON');
      return normalizeWhoisObject(data, params.domain, response.text);
    }
  },

  // ---------------- IP 归属地 ----------------
  {
    id: 'ip-api',
    kind: 'ipGeo',
    label: 'ip-api.com',
    homepage: 'https://ip-api.com/docs',
    selfHostable: true,
    defaultBaseUrl: 'https://ip-api.com/json',
    fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }],
    buildRequest(params, cfg) {
      const fields = 'status,message,country,regionName,city,zip,isp,org,as,query,lat,lon,timezone,hosting';
      const target = params.ip
        ? joinUrl(cfg.baseUrl, encodeURIComponent(params.ip))
        : joinUrl(cfg.baseUrl, '');
      return {
        url: target + '?lang=zh-CN&fields=' + fields,
        options: { headers: cfg.headers }
      };
    },
    parse(response, params) {
      const data = tryParseJson(response.text);
      if (!data) throw new Error('IP 归属地服务返回的不是合法 JSON');
      if (data.status && data.status !== 'success') {
        throw new Error(data.message || '查询失败');
      }
      return {
        ip: firstOf(data.query, params.ip),
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
    }
  },

  // ---------------- 证书透明度 ----------------
  {
    id: 'crt-sh',
    kind: 'ct',
    label: 'crt.sh',
    homepage: 'https://crt.sh/',
    selfHostable: true,
    defaultBaseUrl: 'https://crt.sh/',
    fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }],
    buildRequest(params, cfg) {
      const url = joinUrl(cfg.baseUrl, '') + '?q=' + encodeURIComponent(params.domain) + '&output=json';
      return { url, options: { headers: cfg.headers } };
    },
    parse(response) {
      const list = tryParseJson(response.text);
      if (!Array.isArray(list)) throw new Error('crt.sh 返回的不是 JSON 数组');
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
    }
  },
  {
    id: 'certspotter',
    kind: 'ct',
    label: 'Cert Spotter (SSLMate)',
    homepage: 'https://sslmate.com/certspotter/',
    selfHostable: true,
    defaultBaseUrl: 'https://api.certspotter.com/v1/issuances',
    fields: [
      { key: 'baseUrl', label: '服务地址', type: 'text', required: true },
      { key: 'apiKey', label: 'API Token（可选）', type: 'password', required: false }
    ],
    buildRequest(params, cfg) {
      const url = joinUrl(cfg.baseUrl, '') + '?domain=' + encodeURIComponent(params.domain)
        + '&include_subdomains=true&expand=dns_names';
      const headers = Object.assign({ Accept: 'application/json' }, cfg.headers);
      if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
      return { url, options: { headers } };
    },
    parse(response) {
      const list = tryParseJson(response.text);
      if (!Array.isArray(list)) throw new Error('Cert Spotter 返回的不是 JSON 数组');
      return {
        certificates: list.map(e => ({
          id: e.id,
          serialNumber: firstOf(e.serial_number),
          commonName: (e.dns_names && e.dns_names[0]) || '',
          nameValue: (e.dns_names || []).join('\n'),
          issuer: (e.issuer && e.issuer.name) || '',
          notBefore: firstOf(e.not_before),
          notAfter: firstOf(e.not_after)
        }))
      };
    }
  },

  // ---------------- 子域名枚举 ----------------
  {
    id: 'crt-sh',
    kind: 'subdomain',
    label: 'crt.sh（证书透明度日志）',
    homepage: 'https://crt.sh/',
    selfHostable: true,
    defaultBaseUrl: 'https://crt.sh/',
    fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }],
    buildRequest(params, cfg) {
      const url = joinUrl(cfg.baseUrl, '') + '?q=' + encodeURIComponent(params.domain) + '&output=json';
      return { url, options: { headers: cfg.headers } };
    },
    parse(response, params) {
      const list = tryParseJson(response.text);
      if (!Array.isArray(list)) throw new Error('crt.sh 返回的不是 JSON 数组');
      return { subdomains: collectSubdomainsFromCt(list, params.domain, 'crt.sh') };
    }
  },
  {
    id: 'certspotter',
    kind: 'subdomain',
    label: 'Cert Spotter (SSLMate)',
    homepage: 'https://sslmate.com/certspotter/',
    selfHostable: true,
    defaultBaseUrl: 'https://api.certspotter.com/v1/issuances',
    fields: [
      { key: 'baseUrl', label: '服务地址', type: 'text', required: true },
      { key: 'apiKey', label: 'API Token（可选）', type: 'password', required: false }
    ],
    buildRequest(params, cfg) {
      const url = joinUrl(cfg.baseUrl, '') + '?domain=' + encodeURIComponent(params.domain)
        + '&include_subdomains=true&expand=dns_names';
      const headers = Object.assign({ Accept: 'application/json' }, cfg.headers);
      if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
      return { url, options: { headers } };
    },
    parse(response, params) {
      const list = tryParseJson(response.text);
      if (!Array.isArray(list)) throw new Error('Cert Spotter 返回的不是 JSON 数组');
      const suffix = '.' + String(params.domain).toLowerCase();
      const apex = String(params.domain).toLowerCase();
      const seen = new Set();
      const subdomains = [];
      for (const entry of list) {
        for (const raw of entry.dns_names || []) {
          const name = String(raw).replace(/^\*\./, '').trim().toLowerCase();
          if (!name || seen.has(name)) continue;
          if (name !== apex && !name.endsWith(suffix)) continue;
          seen.add(name);
          subdomains.push({ name, source: 'certspotter', firstSeen: firstOf(entry.not_before) });
        }
      }
      return { subdomains };
    }
  },
  {
    id: 'hackertarget',
    kind: 'subdomain',
    label: 'HackerTarget Host Search',
    homepage: 'https://hackertarget.com/hostsearch-faq/',
    selfHostable: true,
    defaultBaseUrl: 'https://api.hackertarget.com/hostsearch',
    fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }],
    buildRequest(params, cfg) {
      return {
        url: joinUrl(cfg.baseUrl, '') + '?q=' + encodeURIComponent(params.domain),
        options: { headers: cfg.headers }
      };
    },
    parse(response, params) {
      // 返回纯文本，每行形如 `sub.example.com,1.2.3.4`
      const suffix = '.' + params.domain;
      const seen = new Set();
      const subdomains = [];
      for (const line of String(response.text).split('\n')) {
        const parts = line.split(',');
        const host = (parts[0] || '').trim().toLowerCase();
        if (!host || seen.has(host)) continue;
        if (host !== params.domain.toLowerCase() && !host.endsWith(suffix)) continue;
        seen.add(host);
        // 该服务会一并返回解析到的 IP，保留下来便于判断是否存活
        subdomains.push({ name: host, source: 'hackertarget', firstSeen: '', ip: (parts[1] || '').trim() });
      }
      return { subdomains };
    }
  },

  // ---------------- 汇率 ----------------
  {
    id: 'er-api',
    kind: 'currency',
    label: 'open.er-api.com',
    homepage: 'https://www.exchangerate-api.com/docs/free',
    selfHostable: true,
    defaultBaseUrl: 'https://open.er-api.com/v6/latest',
    fields: [{ key: 'baseUrl', label: '服务地址（不含货币代码）', type: 'text', required: true }],
    buildRequest(params, cfg) {
      return { url: joinUrl(cfg.baseUrl, params.base), options: { headers: cfg.headers } };
    },
    parse(response, params) {
      const data = tryParseJson(response.text);
      if (!data || !data.rates) throw new Error('汇率服务返回的数据缺少 rates 字段');
      return {
        base: firstOf(data.base_code, params.base),
        date: firstOf(data.time_last_update_utc, data.time_last_update_unix),
        rates: data.rates
      };
    }
  },
  {
    id: 'frankfurter',
    kind: 'currency',
    label: 'Frankfurter (ECB 数据)',
    homepage: 'https://www.frankfurter.app/docs/',
    selfHostable: true,
    defaultBaseUrl: 'https://api.frankfurter.app/latest',
    fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }],
    buildRequest(params, cfg) {
      return { url: joinUrl(cfg.baseUrl, '') + '?from=' + encodeURIComponent(params.base), options: { headers: cfg.headers } };
    },
    parse(response, params) {
      const data = tryParseJson(response.text);
      if (!data || !data.rates) throw new Error('汇率服务返回的数据缺少 rates 字段');
      // Frankfurter 不返回基准货币自身，需补上
      const rates = Object.assign({ [params.base]: 1 }, data.rates);
      return { base: firstOf(data.base, params.base), date: firstOf(data.date), rates };
    }
  },

  // ---------------- 密码 / 邮箱泄露 ----------------
  {
    id: 'hibp',
    kind: 'breach',
    label: 'Have I Been Pwned',
    homepage: 'https://haveibeenpwned.com/API/v3',
    selfHostable: true,
    defaultBaseUrl: 'https://api.pwnedpasswords.com/range',
    fields: [
      { key: 'baseUrl', label: '密码范围查询地址', type: 'text', required: true },
      { key: 'emailBaseUrl', label: '邮箱查询地址', type: 'text', required: false, placeholder: 'https://haveibeenpwned.com/api/v3/breachedaccount' },
      { key: 'apiKey', label: 'HIBP API Key（邮箱查询需要）', type: 'password', required: false }
    ],
    buildRequest(params, cfg) {
      const headers = Object.assign({}, cfg.headers);
      if (params.mode === 'password') {
        return { url: joinUrl(cfg.baseUrl, params.prefix), options: { headers } };
      }
      // 邮箱查询：HIBP 要求携带 API Key
      if (!cfg.apiKey) throw new Error('邮箱泄露查询需要 HIBP API Key，请到「设置 → 服务端点」填写');
      headers['hibp-api-key'] = cfg.apiKey;
      headers['user-agent'] = 'ToolCube-Extension';
      const base = cfg.emailBaseUrl || 'https://haveibeenpwned.com/api/v3/breachedaccount';
      return {
        url: joinUrl(base, encodeURIComponent(params.email)) + '?truncateResponse=false',
        options: { headers }
      };
    },
    parse(response, params) {
      if (params.mode === 'password') {
        // 响应为纯文本，每行形如 `SUFFIX:COUNT`（SUFFIX 为 SHA-1 去掉前 5 位后的 35 位）
        const target = String(params.suffix || '').toUpperCase();
        let count = 0;
        for (const line of String(response.text).split('\n')) {
          const parts = line.trim().split(':');
          if (parts.length === 2 && parts[0].toUpperCase() === target) {
            count = parseInt(parts[1], 10) || 0;
            break;
          }
        }
        return { count };
      }
      // 邮箱模式：404 表示未发现泄露
      if (response.status === 404) return { breaches: [] };
      const list = tryParseJson(response.text);
      if (!Array.isArray(list)) throw new Error('邮箱泄露服务返回的不是 JSON 数组');
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
    }
  },

  // ---------------- 公网 IP ----------------
  {
    id: 'ipify',
    kind: 'publicIp',
    label: 'api.ipify.org',
    homepage: 'https://www.ipify.org/',
    selfHostable: true,
    defaultBaseUrl: 'https://api.ipify.org',
    fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }],
    buildRequest(params, cfg) {
      return { url: joinUrl(cfg.baseUrl, '') + '?format=json', options: { headers: cfg.headers } };
    },
    parse(response) {
      const data = tryParseJson(response.text);
      if (!data || !data.ip) throw new Error('公网 IP 服务返回的数据缺少 ip 字段');
      return { ip: data.ip };
    }
  },

  // ---------------- SSL/TLS 深度评级 ----------------
  {
    id: 'ssllabs',
    kind: 'ssl',
    label: 'Qualys SSL Labs',
    homepage: 'https://www.ssllabs.com/ssltest/',
    selfHostable: true,
    defaultBaseUrl: 'https://api.ssllabs.com/api/v3/analyze',
    fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }],
    buildRequest(params, cfg) {
      const url = joinUrl(cfg.baseUrl, '') + '?host=' + encodeURIComponent(params.domain)
        + '&all=done&maxAge=24';
      return { url, options: { headers: Object.assign({ Accept: 'application/json' }, cfg.headers) } };
    },
    parse(response, params) {
      const data = tryParseJson(response.text);
      if (!data) throw new Error('SSL Labs 返回的不是合法 JSON');
      if (Array.isArray(data.errors) && data.errors.length) {
        throw new Error('SSL Labs: ' + firstOf(data.errors[0] && data.errors[0].message, '分析失败'));
      }
      const endpoints = (data.endpoints || []).map(e => ({
        ipAddress: firstOf(e.ipAddress),
        serverName: firstOf(e.serverName),
        grade: firstOf(e.grade),
        hasWarnings: e.hasWarnings === true,
        statusMessage: firstOf(e.statusMessage),
        protocols: ((e.details && e.details.protocols) || []).map(pr => ({
          name: firstOf(pr.name),
          version: firstOf(pr.version)
        }))
      }));
      return {
        status: firstOf(data.status, 'Unknown'),
        grade: endpoints.length ? firstOf(endpoints[0].grade) : '',
        endpoints,
        domain: params.domain
      };
    }
  },

  // ---------------- 端口扫描（服务端） ----------------
  {
    id: 'hackertarget',
    kind: 'portScan',
    label: 'HackerTarget Nmap API',
    homepage: 'https://hackertarget.com/nmap-online-port-scanner/',
    selfHostable: true,
    defaultBaseUrl: 'https://api.hackertarget.com/nmap/',
    fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }],
    buildRequest(params, cfg) {
      return {
        url: joinUrl(cfg.baseUrl, '') + '?q=' + encodeURIComponent(params.host),
        options: { headers: cfg.headers }
      };
    },
    parse(response, params) {
      const text = String(response.text || '').trim();
      // 该服务在限流/出错时返回纯文本说明而不是 JSON，需要与正常结果区分
      if (!text || /error|exceeded|not found|no records/i.test(text)) {
        throw new Error('扫描服务返回: ' + (text || '空响应').slice(0, 160));
      }
      const ports = [];
      for (const line of text.split('\n')) {
        const m = line.match(/^(\d+)\/(\w+)\s+(\w+)\s*(.*)$/);
        if (m) {
          ports.push({
            port: Number(m[1]),
            protocol: m[2],
            state: m[3].toLowerCase(),
            service: (m[4] || '').trim()
          });
        }
      }
      return { host: params.host, ports };
    }
  },

  // ---------------- HTTP 转发代理 ----------------
  {
    id: 'allorigins',
    kind: 'proxy',
    label: 'AllOrigins',
    homepage: 'https://allorigins.win/',
    selfHostable: true,
    defaultBaseUrl: 'https://api.allorigins.win/raw',
    fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }],
    buildRequest(params, cfg) {
      return {
        url: joinUrl(cfg.baseUrl, '') + '?url=' + encodeURIComponent(params.url),
        options: { headers: cfg.headers }
      };
    },
    parse(response, params) {
      return {
        status: response.status,
        body: String(response.text || ''),
        headers: response.headers || {},
        finalUrl: params.url
      };
    }
  },
  {
    id: 'codetabs',
    kind: 'proxy',
    label: 'CodeTabs CORS Proxy',
    homepage: 'https://codetabs.com/cors-proxy/cors-proxy.html',
    selfHostable: true,
    defaultBaseUrl: 'https://api.codetabs.com/v1/proxy',
    fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }],
    buildRequest(params, cfg) {
      return {
        url: joinUrl(cfg.baseUrl, '') + '?quest=' + encodeURIComponent(params.url),
        options: { headers: cfg.headers }
      };
    },
    parse(response, params) {
      return {
        status: response.status,
        body: String(response.text || ''),
        headers: response.headers || {},
        finalUrl: params.url
      };
    }
  },

  // ---------------- 正文提取（服务端） ----------------
  {
    id: 'jina',
    kind: 'readability',
    label: 'Jina Reader',
    homepage: 'https://jina.ai/reader/',
    selfHostable: true,
    defaultBaseUrl: 'https://r.jina.ai/',
    fields: [
      { key: 'baseUrl', label: '服务地址（在其后直接拼接目标 URL）', type: 'text', required: true },
      { key: 'apiKey', label: 'API Key（可选，用于提高配额）', type: 'password', required: false }
    ],
    buildRequest(params, cfg) {
      const headers = Object.assign({ Accept: 'application/json' }, cfg.headers);
      if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
      // Jina Reader 的用法是 https://r.jina.ai/<完整目标 URL>
      return { url: joinUrl(cfg.baseUrl, '') + '/' + params.url, options: { headers } };
    },
    parse(response, params) {
      const data = tryParseJson(response.text);
      if (!data) throw new Error('正文提取服务返回的不是合法 JSON');
      const payload = data.data || data;
      const content = firstOf(payload.content, payload.text);
      if (!content) throw new Error('正文提取服务未返回正文内容');
      return {
        title: firstOf(payload.title),
        content,
        textContent: firstOf(payload.text, content),
        byline: firstOf(payload.author),
        siteName: firstOf(payload.siteName, payload.hostname),
        url: firstOf(payload.url, params.url)
      };
    }
  },

  // ---------------- 服务端截图（客户端直连） ----------------
  {
    id: 'thumio',
    kind: 'screenshot',
    label: 'thum.io',
    homepage: 'https://www.thum.io/',
    selfHostable: true,
    defaultBaseUrl: 'https://image.thum.io/get/width',
    fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }],
    // 返回的是可直接用于 <img src> 的图片地址，因此不经过 HTTP 响应解析
    buildRequest(params, cfg) {
      const width = Math.min(2000, Math.max(320, Number(params.width) || 1200));
      return { url: joinUrl(cfg.baseUrl, String(width)) + '/' + params.url, options: {} };
    },
    parse() {
      throw new Error('服务端截图为客户端直连：请直接使用生成的图片地址，不要解析 HTTP 响应');
    }
  },
  {
    id: 'custom',
    kind: 'screenshot',
    label: '自定义服务（自建 / 自托管）',
    selfHostable: true,
    description: '把地址指向你自己的截图服务。地址中可用占位符：{url}、{width}。',
    defaultBaseUrl: '',
    fields: [
      { key: 'baseUrl', label: '服务地址', type: 'text', required: true, placeholder: 'https://shot.example.com/?url={url}&w={width}' },
      { key: 'apiKey', label: 'API Key（可选）', type: 'password', required: false }
    ],
    buildRequest(params, cfg) {
      if (!cfg.baseUrl) throw new Error('尚未配置自定义服务地址，请到「设置 → 服务端点」填写');
      return { url: expandTemplate(cfg.baseUrl, { url: params.url, width: params.width }), options: {} };
    },
    parse() {
      throw new Error('服务端截图为客户端直连：请直接使用生成的图片地址，不要解析 HTTP 响应');
    }
  },

  // ---------------- STUN（客户端直连） ----------------
  {
    id: 'google',
    kind: 'stun',
    label: 'Google 公共 STUN',
    homepage: 'https://developers.google.com/talk/',
    selfHostable: true,
    defaultBaseUrl: 'stun:stun.l.google.com:19302',
    fields: [{ key: 'baseUrl', label: 'STUN 地址', type: 'text', required: true, placeholder: 'stun:host:port' }],
    buildRequest(params, cfg) {
      if (!cfg.baseUrl) throw new Error('尚未配置 STUN 地址');
      return { url: cfg.baseUrl, options: {} };
    },
    parse() {
      throw new Error('STUN 为客户端直连服务，不通过 HTTP 解析响应');
    }
  },
  {
    id: 'cloudflare',
    kind: 'stun',
    label: 'Cloudflare STUN',
    homepage: 'https://developers.cloudflare.com/calls/',
    selfHostable: true,
    defaultBaseUrl: 'stun:stun.cloudflare.com:3478',
    fields: [{ key: 'baseUrl', label: 'STUN 地址', type: 'text', required: true, placeholder: 'stun:host:port' }],
    buildRequest(params, cfg) {
      if (!cfg.baseUrl) throw new Error('尚未配置 STUN 地址');
      return { url: cfg.baseUrl, options: {} };
    },
    parse() {
      throw new Error('STUN 为客户端直连服务，不通过 HTTP 解析响应');
    }
  },

  // ---------------- URL 安全检测 ----------------
  {
    id: 'urlscan',
    kind: 'urlScan',
    label: 'urlscan.io',
    homepage: 'https://urlscan.io/',
    selfHostable: true,
    defaultBaseUrl: 'https://urlscan.io/api/v1/search/',
    fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }],
    buildRequest(params, cfg) {
      // 搜索端点免费可用、无需 API Key；按完整 URL 精确匹配
      return {
        url: joinUrl(cfg.baseUrl, '') + '?q=' + encodeURIComponent('page.url:"' + params.url + '"'),
        options: { headers: cfg.headers }
      };
    },
    parse(response, params) {
      const data = tryParseJson(response.text);
      if (!data) throw new Error('URL 安全检测服务返回的不是合法 JSON');
      const results = Array.isArray(data.results) ? data.results : [];
      let malicious = false;
      let score = 0;
      const categories = [];
      for (const r of results) {
        const verdict = (r.verdicts && r.verdicts.overall) || {};
        if (verdict.malicious === true) malicious = true;
        if (typeof verdict.score === 'number' && verdict.score > score) score = verdict.score;
        for (const b of (r.verdicts && r.verdicts.engines && r.verdicts.engines.malicious) || []) {
          if (b && b.category && !categories.includes(b.category)) categories.push(b.category);
        }
      }
      return {
        malicious,
        score,
        reports: typeof data.total === 'number' ? data.total : results.length,
        categories,
        source: 'urlscan.io'
      };
    }
  },

  // ---------------- 网页归档快照 ----------------
  {
    id: 'wayback',
    kind: 'webArchive',
    label: 'Wayback Machine (available)',
    homepage: 'https://archive.org/wayback/available',
    selfHostable: true,
    defaultBaseUrl: 'https://archive.org/wayback/available',
    fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }],
    buildRequest(params, cfg) {
      return { url: joinUrl(cfg.baseUrl, '') + '?url=' + encodeURIComponent(params.url), options: { headers: cfg.headers } };
    },
    parse(response, params) {
      const data = tryParseJson(response.text);
      if (!data) throw new Error('归档服务返回的不是合法 JSON');
      const snap = (data.archived_snapshots && data.archived_snapshots.closest) || null;
      return {
        available: !!(snap && snap.available),
        snapshotUrl: snap ? firstOf(snap.url) : '',
        timestamp: snap ? firstOf(snap.timestamp) : '',
        total: snap && snap.available ? 1 : 0
      };
    }
  },
  {
    id: 'cdx',
    kind: 'webArchive',
    label: 'Wayback Machine (CDX 列表)',
    homepage: 'https://web.archive.org/cdx/',
    selfHostable: true,
    defaultBaseUrl: 'http://web.archive.org/cdx/search/cdx',
    fields: [{ key: 'baseUrl', label: '服务地址', type: 'text', required: true }],
    buildRequest(params, cfg) {
      return {
        url: joinUrl(cfg.baseUrl, '') + '?url=' + encodeURIComponent(params.url)
          + '&output=json&limit=20&filter=statuscode:200',
        options: { headers: cfg.headers }
      };
    },
    parse(response, params) {
      const data = tryParseJson(response.text);
      if (!Array.isArray(data) || data.length < 2) {
        // 只有表头或空数组 = 没有快照
        return { available: false, snapshotUrl: '', timestamp: '', total: 0 };
      }
      // 首行是表头，其余是 [urlkey, timestamp, original, mimetype, statuscode, digest, length]
      const rows = data.slice(1).filter(r => Array.isArray(r) && r.length >= 3);
      if (!rows.length) return { available: false, snapshotUrl: '', timestamp: '', total: 0 };
      const latest = rows[rows.length - 1];
      const ts = String(latest[1] || '');
      return {
        available: true,
        snapshotUrl: 'https://web.archive.org/web/' + ts + '/' + String(latest[2] || params.url),
        timestamp: ts,
        total: rows.length
      };
    }
  },

  // ---------------- IP 信誉 ----------------
  {
    id: 'greynoise',
    kind: 'ipReputation',
    label: 'GreyNoise Community',
    homepage: 'https://docs.greynoise.io/',
    selfHostable: true,
    defaultBaseUrl: 'https://api.greynoise.io/v3/community',
    fields: [{ key: 'baseUrl', label: '服务地址（不含 IP）', type: 'text', required: true }],
    buildRequest(params, cfg) {
      return {
        url: joinUrl(cfg.baseUrl, '') + '/' + encodeURIComponent(params.ip),
        options: { headers: Object.assign({ Accept: 'application/json' }, cfg.headers) }
      };
    },
    parse(response, params) {
      const data = tryParseJson(response.text);
      if (!data) throw new Error('IP 信誉服务返回的不是合法 JSON');
      return {
        ip: firstOf(data.ip, params.ip),
        noise: data.noise === true,
        riot: data.riot === true,
        classification: firstOf(data.classification, 'unknown'),
        name: firstOf(data.name),
        lastSeen: firstOf(data.last_seen, data.last_seen_utc)
      };
    }
  }
];

// 为每个 kind 追加「自定义服务」服务商（已自带 custom 的类别不重复追加）
for (const kind of SERVICE_KINDS) {
  if (PROVIDERS.some(p => p.kind === kind.id && p.id === 'custom')) continue;
  PROVIDERS.push(customProvider(kind.id));
}

/** 按 kind 列出可用服务商 */
export function getProvidersByKind(kind) {
  return PROVIDERS.filter(p => p.kind === kind);
}

/** 按 (kind, providerId) 取服务商 */
export function getProvider(kind, providerId) {
  return PROVIDERS.find(p => p.kind === kind && p.id === providerId) || null;
}

// ==================== 响应解析辅助（供各 provider 复用）====================

/**
 * 解析 DoH JSON（RFC 8484 的 JSON 表示，Cloudflare/Google/阿里/Quad9 通用）
 * @param {{text:string}} response
 * @returns {{status:number, ad:boolean, answers:Array<{name:string,type:number,ttl:number,data:string}>}}
 */
function parseDohJson(response) {
  const data = tryParseJson(response.text);
  if (!data) throw new Error('DNS 服务返回的不是合法 JSON');
  const answers = (data.Answer || []).map(a => ({
    name: firstOf(a.name),
    type: a.type,
    ttl: typeof a.TTL === 'number' ? a.TTL : null,
    data: firstOf(a.data)
  }));
  return {
    status: typeof data.Status === 'number' ? data.Status : 0,
    ad: data.AD === true,
    answers
  };
}

/**
 * 把 RDAP 对象规范化为统一 WHOIS 结构
 * @param {object} rdap
 * @param {string} domain
 * @param {string} rawText
 */
export function parseRdapObject(rdap, domain, rawText) {
  const result = {
    domain,
    registrar: '',
    registrarUrl: '',
    whoisServer: firstOf(rdap.port43),
    creationDate: '',
    expirationDate: '',
    updatedDate: '',
    nameServers: [],
    status: [],
    registrantOrganization: '',
    registrantCountry: '',
    registrantEmail: '',
    registryDomainId: '',
    raw: rawText || ''
  };
  if (Array.isArray(rdap.status)) result.status = rdap.status.slice();
  for (const ev of rdap.events || []) {
    if (ev.eventAction === 'registration') result.creationDate = firstOf(ev.eventDate);
    else if (ev.eventAction === 'expiration') result.expirationDate = firstOf(ev.eventDate);
    else if (ev.eventAction === 'last changed') result.updatedDate = firstOf(ev.eventDate);
  }
  for (const ent of rdap.entities || []) {
    const roles = ent.roles || [];
    const vcard = (ent.vcardArray && ent.vcardArray[1]) || [];
    const findVcard = (key) => {
      const item = vcard.find(v => v[0] === key);
      return item ? firstOf(item[3]) : '';
    };
    if (roles.includes('registrar') && !result.registrar) {
      result.registrar = findVcard('fn');
      const url = findVcard('url');
      if (url) result.registrarUrl = url;
    }
    if (roles.includes('registrant')) {
      if (!result.registrantOrganization) result.registrantOrganization = findVcard('org');
      if (!result.registrantCountry) result.registrantCountry = findVcard('country');
      if (!result.registrantEmail) result.registrantEmail = findVcard('email');
    }
  }
  for (const ns of rdap.nameservers || []) {
    const name = firstOf(ns.ldhName, ns.unicodeName);
    if (name) result.nameServers.push(name);
  }
  result.registryDomainId = firstOf(rdap.handle);
  return result;
}

/**
 * 把非标准 WHOIS 服务（whoisjs 等）返回的对象尽力规范化
 * 这些服务的字段命名并不统一，因此按常见别名逐一尝试。
 */
export function normalizeWhoisObject(data, domain, rawText) {
  const pick = (keys) => {
    for (const k of keys) {
      const v = data[k];
      if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) return v;
    }
    return '';
  };
  const asArray = (v) => {
    if (Array.isArray(v)) return v.filter(Boolean).map(String);
    if (typeof v === 'string' && v) return v.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    return [];
  };
  return {
    domain: firstOf(pick(['domain_name', 'domainName', 'domain', 'name']), domain),
    registrar: String(pick(['registrar', 'registrar_name', 'sponsoring_registrar']) || ''),
    registrarUrl: String(pick(['registrar_url', 'registrarUrl', 'registrar_website']) || ''),
    whoisServer: String(pick(['whois_server', 'whoisServer', 'port43']) || ''),
    creationDate: String(pick(['creation_date', 'created_date', 'created', 'createdDate', 'createdAt', 'registration_date']) || ''),
    expirationDate: String(pick(['expiration_date', 'expiry_date', 'expires', 'expiryDate', 'expirationDate']) || ''),
    updatedDate: String(pick(['updated_date', 'updated', 'updatedAt', 'lastUpdated', 'last_changed']) || ''),
    nameServers: asArray(pick(['name_servers', 'nameServers', 'nameservers', 'nserver'])),
    status: asArray(pick(['status', 'domain_status', 'eppStatus'])),
    registrantOrganization: String(pick(['registrant_organization', 'registrantOrganization', 'org']) || ''),
    registrantCountry: String(pick(['registrant_country', 'registrantCountry', 'country']) || ''),
    registrantEmail: String(pick(['registrant_email', 'registrantEmail', 'email']) || ''),
    registryDomainId: String(pick(['registry_domain_id', 'registryDomainId', 'handle']) || ''),
    raw: rawText || JSON.stringify(data, null, 2)
  };
}

/**
 * 从 CT 日志条目中提取子域名
 *
 * 匹配规则：等于根域名本身，或以「.根域名」结尾。
 * 之所以要求点号分隔，是为了避免把 `notexample.com` 这类同后缀的无关域名也算进来
 * （原实现用裸 `endsWith(domain)` 判断，存在该误报）。根域名本身仍然保留。
 *
 * @param {Array} entries crt.sh 返回的数组
 * @param {string} domain 根域名
 * @param {string} source 数据源标识
 */
export function collectSubdomainsFromCt(entries, domain, source) {
  const apex = String(domain).toLowerCase();
  const suffix = '.' + apex;
  const seen = new Set();
  const subdomains = [];
  for (const entry of entries || []) {
    const names = String(entry.name_value || '').split('\n');
    for (const raw of names) {
      const name = raw.replace(/^\*\./, '').trim().toLowerCase();
      if (!name || seen.has(name)) continue;
      if (name !== apex && !name.endsWith(suffix)) continue;
      seen.add(name);
      subdomains.push({ name, source, firstSeen: firstOf(entry.not_before) });
    }
  }
  return subdomains;
}

// ==================== 配置解析 ====================

/** 服务端点配置在 chrome.storage.local 中的键名 */
export const SERVICE_CONFIG_KEY = 'toolbox_service_endpoints';

/** 默认配置：全部使用内置默认服务商 */
export function defaultServiceConfig() {
  const config = {};
  for (const kind of SERVICE_KINDS) {
    config[kind.id] = { providerId: kind.defaultProviderId, baseUrl: '', apiKey: '', emailBaseUrl: '', headers: {} };
  }
  return config;
}

/**
 * 把任意（可能来自用户或旧版本的）配置对象规范化为完整结构
 * 未知字段被丢弃，缺失字段补默认值，避免脏数据扩散到运行时。
 * @param {object} raw
 * @returns {object}
 */
export function normalizeServiceConfig(raw) {
  const base = defaultServiceConfig();
  if (!raw || typeof raw !== 'object') return base;
  for (const kind of SERVICE_KINDS) {
    const incoming = raw[kind.id];
    if (!incoming || typeof incoming !== 'object') continue;
    const entry = base[kind.id];
    const providerId = String(incoming.providerId || '');
    // 只接受该 kind 下真实存在的服务商，防止配置被指向不存在的实现
    if (providerId && getProvider(kind.id, providerId)) entry.providerId = providerId;
    if (typeof incoming.baseUrl === 'string') entry.baseUrl = incoming.baseUrl.trim();
    if (typeof incoming.emailBaseUrl === 'string') entry.emailBaseUrl = incoming.emailBaseUrl.trim();
    if (typeof incoming.apiKey === 'string') entry.apiKey = incoming.apiKey.trim();
    if (incoming.headers && typeof incoming.headers === 'object' && !Array.isArray(incoming.headers)) {
      for (const [k, v] of Object.entries(incoming.headers)) {
        if (typeof k === 'string' && typeof v === 'string') entry.headers[k] = v;
      }
    }
  }
  return base;
}

/**
 * 解析某个服务类别最终要使用的服务商与生效配置
 *
 * 生效规则：用户填写的 baseUrl 优先于服务商默认地址；未填写则用服务商默认地址。
 * 这样「换成自建服务」只需改一个地址，其余行为（解析逻辑）保持不变。
 *
 * @param {string} kind
 * @param {object} userConfig 已经过 normalizeServiceConfig 的配置
 * @param {string} [providerIdOverride] 显式指定服务商（用于「多服务商对比」场景，
 *        例如 DNS 传播检查需要同时查询 Cloudflare / Google / 阿里 / Quad9）。
 *        留空则使用用户配置中的服务商。
 * @returns {{provider: object, cfg: {baseUrl:string, apiKey:string, emailBaseUrl:string, headers:object}}}
 * @throws {Error} 服务商不存在时抛出
 */
export function resolveEndpoint(kind, userConfig, providerIdOverride) {
  const config = userConfig || defaultServiceConfig();
  const entry = config[kind] || {};
  const override = String(providerIdOverride || '');

  // 显式指定的服务商必须存在：这里**不做静默回退**。
  // 静默回退会让「勾选了 A 服务商却实际查询了 B」这种错误无声发生（结果看起来正常但来源不对），
  // 因此宁可报错，让问题立刻暴露。
  if (override && !getProvider(kind, override)) {
    throw new Error('该服务类别下不存在服务商 "' + override + '"（' + kind + '）');
  }

  const provider = getProvider(kind, override)
    || getProvider(kind, entry.providerId)
    || getProvider(kind, (getServiceKind(kind) || {}).defaultProviderId);
  if (!provider) throw new Error('未找到服务商: ' + kind + '/' + (override || entry.providerId));

  // 显式指定服务商时不套用用户为该类别配置的 baseUrl，
  // 否则「对比多家服务商」会全部打到同一个自定义地址上，失去对比意义。
  const useUserBaseUrl = !override || override === entry.providerId;
  return {
    provider,
    cfg: {
      baseUrl: (useUserBaseUrl && entry.baseUrl) || provider.defaultBaseUrl || '',
      apiKey: entry.apiKey || '',
      emailBaseUrl: entry.emailBaseUrl || '',
      headers: entry.headers || {}
    }
  };
}

/** 该服务类别是否为「客户端直连」（不经过 HTTP 请求 / 响应解析） */
export function isClientTransport(kind) {
  const meta = getServiceKind(kind);
  return !!(meta && meta.transport === 'client');
}

/**
 * 为一个「客户端直连」类别构造目标地址（**不发请求**）。
 *
 * 像 STUN 服务器、服务端截图这类能力，扩展需要的只是一个 URL：
 * 前者交给 RTCPeerConnection，后者作为 `<img src>`。它们不适合走 HTTP 响应解析
 * （STUN 根本不是 HTTP；截图返回的是图片二进制，用 response.text() 读取会被破坏）。
 * 因此这里只做「参数校验 → 解析服务商 → 构造地址」，把地址交回调用方。
 *
 * @param {string} kind
 * @param {object} params
 * @param {object} userConfig 已经过 normalizeServiceConfig 的配置
 * @param {string} [providerIdOverride]
 * @returns {{url:string, provider:object}}
 * @throws {Error} 类别不存在 / 非客户端直连 / 参数非法 / 服务商不存在时抛出
 */
export function buildClientRequestUrl(kind, params, userConfig, providerIdOverride) {
  if (!isClientTransport(kind)) {
    throw new Error('该服务类别不是客户端直连（' + kind + '），请改用 serviceRequest');
  }
  const normalized = validateParams(kind, params);
  const resolved = resolveEndpoint(kind, userConfig, providerIdOverride);
  const request = resolved.provider.buildRequest(normalized, resolved.cfg);
  if (!request || !request.url) throw new Error('服务商未生成有效的地址');
  return { url: request.url, provider: resolved.provider };
}
