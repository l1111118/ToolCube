# 自建服务接入指南

本扩展中所有需要联网的能力，都通过一层「服务端点」注册表访问外部服务。
**你可以把任意一类指向自己的服务器，无需修改任何源码。**

本文档是这份"接口契约"的完整说明：

- [1. 两种接入方式](#1-两种接入方式)
- [2. 请求如何被构造](#2-请求如何被构造)
- [3. 服务类别的契约](#3-服务类别的契约)
- [4. 完整示例适配器](#4-完整示例适配器)
- [5. 在代码中新增服务商](#5-在代码中新增服务商)
- [6. 新增一个服务类别](#6-新增一个服务类别)
- [7. 安全与限制](#7-安全与限制)
- [8. 调试与排错](#8-调试与排错)

---

## 1. 两种接入方式

### 方式一：复用内置协议，只改地址

如果你的服务遵循与内置服务商相同的协议，只需改地址。例如自建 DoH（AdGuard Home、
Pi-hole、dnsdist、Cloudflare Gateway 等）、自建 RDAP 网关。

**设置 → 服务端点 → DNS 查询（DoH）**：

| 字段 | 填写 |
| --- | --- |
| 服务商 | `Cloudflare DNS (1.1.1.1)`（或其他，仅决定协议形态） |
| 服务地址 | `https://dns.your-company.com/dns-query` |

工具发出的请求就会打到你的服务器，参数与响应解析沿用该服务商的实现。

### 方式二：选择「自定义服务」，返回归一化 JSON

如果你的服务协议与内置服务商都不同，选择 **自定义服务（自建 / 自托管）**，
你的服务只需返回本文档定义的**归一化 JSON 结构**。

**设置 → 服务端点 → DNS 查询（DoH）**：

| 字段 | 填写 |
| --- | --- |
| 服务商 | `自定义服务（自建 / 自托管）` |
| 服务地址 | `https://api.your-company.com/dns?name={name}&type={type}` |

地址中的占位符会被自动替换（见 [第 2 节](#2-请求如何被构造)）。

> **一句话总结**：方式一改地址，方式二改协议。二者都不需要重新打包扩展。

---

## 2. 请求如何被构造

### 2.1 占位符

自定义服务地址中可使用该服务类别声明的参数名作为占位符，写作 `{参数名}`：

```
https://api.example.com/lookup?host={name}&type={type}
```

**所有占位值都会被 URL 编码**，因此参数不会破坏 URL 结构（例如域名中的特殊字符、
记录类型中的引号都无法注入到 query 或 path 之外）。

缺失的参数会被替换为空字符串。

### 2.2 固定的请求行为

无论使用哪种服务商，扩展侧统一施加以下约束：

| 项目 | 值 | 说明 |
| --- | --- | --- |
| 协议 | 仅 `http:` / `https:` | 防止自定义地址被写成 `file:`、`data:` 等 |
| 超时 | 20 秒 | 超时返回可读错误，不会挂起界面 |
| 响应体上限 | 8 MB | 超出即中止读取，避免异常响应耗尽内存 |
| 请求凭据 | `credentials: 'omit'` | 不携带你的 Cookie |
| 缓存 | `cache: 'no-store'` | 始终取最新结果 |
| 自定义请求头 | 支持 | 在服务商的 `fields` 中声明 `headers` 时可用（当前通过配置文件写入） |
| API Key | 支持 | 按服务商声明的方式注入（如 `hibp-api-key`、`Authorization: Bearer`） |

### 2.3 参数校验

扩展会在发起请求**之前**校验参数，非法参数直接返回错误、不会发出请求：

| 类别 | 校验规则 |
| --- | --- |
| `dns` | 域名为合法 FQDN（≤253 字符）；记录类型必须属于白名单 |
| `whois` / `ct` / `subdomain` / `ssl` | 域名为合法 FQDN |
| `portScan` | 主机为合法 FQDN、IPv4 或 IPv6 |
| `proxy` / `readability` / `urlScan` / `webArchive` | 目标为合法 `http(s)` URL（锚点会被移除） |
| `screenshot` | 目标为合法 `http(s)` URL；宽度被钳制在 320–2000 |
| `ipGeo` | 必须是合法 IPv4 / IPv6，或留空 |
| `ipReputation` | 必须是合法 IPv4 / IPv6，且每一段 ≤ 255 |
| `currency` | 基准货币为 3 位大写字母代码 |
| `breach` | 密码模式：前缀 5 位 + 后缀 35 位十六进制；邮箱模式：合法邮箱 |
| `stun` | 无参数 |

---

## 3. 服务类别的契约

> 约定：以下所有字段**都必须存在**（可以是空字符串或空数组），
> 缺失字段不会导致扩展崩溃，但界面上会显示为空。
>
> 类别分两种**传输方式**（注册表中的 `transport` 字段）：
>
> | 传输 | 含义 | 类别 |
> | --- | --- | --- |
> | `http`（默认） | 扩展发起 HTTP 请求并解析响应 | `dns`、`whois`、`ipGeo`、`ct`、`subdomain`、`currency`、`breach`、`publicIp`、`ssl`、`portScan`、`proxy`、`readability`、`urlScan`、`webArchive`、`ipReputation` |
> | `client` | 只由扩展**构造一个地址**，不经过 HTTP 请求/解析 | `screenshot`、`stun` |
>
> `client` 类别的服务商其 `parse` 一律抛错（它们没有 HTTP 响应可解析），
> 扩展侧通过后台的 `clientRequestUrl` 消息取回地址；对这类类别调用
> `serviceRequest` 会被直接拒绝。

### 3.1 `dns` — DNS 查询（DoH）

| 项 | 内容 |
| --- | --- |
| 参数 | `name`（域名）、`type`（记录类型）、`dnssec`（布尔，是否请求 DNSSEC） |
| 使用工具 | DNS 查询、子域名发现 |

**返回结构**

```json
{
  "status": 0,
  "ad": false,
  "answers": [
    { "name": "example.com.", "type": 1, "ttl": 300, "data": "93.184.216.34" }
  ]
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | number | DNS RCODE。`0`=成功，`2`=SERVFAIL，`3`=NXDOMAIN |
| `ad` | boolean | Authenticated Data 标志，`true` 表示 DNSSEC 验证通过 |
| `answers[].name` | string | 记录名（通常带结尾点） |
| `answers[].type` | number | **数字**记录类型：`1`=A、`28`=AAAA、`5`=CNAME、`15`=MX、`2`=NS、`16`=TXT、`6`=SOA、`33`=SRV、`12`=PTR、`257`=CAA |
| `answers[].ttl` | number \| null | 生存时间（秒） |
| `answers[].data` | string | 记录值 |

> 若你的服务只支持字符串形式的记录类型，请在适配器里转换为数字。

**参考实现**（Cloudflare Worker 片段）

```js
const TYPE_NUM = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, CAA: 257 };

async function dns({ name, type }) {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { Accept: 'application/dns-json' }
  });
  const d = await res.json();
  return {
    status: d.Status ?? 0,
    ad: d.AD === true,
    answers: (d.Answer || []).map(a => ({
      name: a.name,
      type: typeof a.type === 'number' ? a.type : (TYPE_NUM[a.type] ?? 0),
      ttl: typeof a.TTL === 'number' ? a.TTL : null,
      data: a.data
    }))
  };
}
```

---

### 3.2 `whois` — WHOIS / RDAP 查询

| 项 | 内容 |
| --- | --- |
| 参数 | `domain` |
| 使用工具 | WHOIS 查询 |

**返回结构**

```json
{
  "domain": "example.com",
  "registrar": "RESERVED-Internet Assigned Numbers Authority",
  "registrarUrl": "https://iana.org",
  "whoisServer": "whois.iana.org",
  "creationDate": "1995-08-14T04:00:00Z",
  "expirationDate": "2030-08-13T04:00:00Z",
  "updatedDate": "2024-08-14T07:01:39Z",
  "nameServers": ["a.iana-servers.net", "b.iana-servers.net"],
  "status": ["client transfer prohibited"],
  "registrantOrganization": "Example Org",
  "registrantCountry": "US",
  "registrantEmail": "admin@example.com",
  "registryDomainId": "2336799_DOMAIN_COM-VRSN",
  "raw": "原始文本（可选，用于界面上的"原始数据"面板）"
}
```

> `raw` 若留空，界面会退化为展示该对象的 JSON。

---

### 3.3 `ipGeo` — IP 归属地

| 项 | 内容 |
| --- | --- |
| 参数 | `ip`（留空表示查询**调用方自己**的公网 IP） |
| 使用工具 | IP 查询 |

**返回结构**

```json
{
  "ip": "8.8.8.8",
  "country": "United States",
  "region": "California",
  "city": "Mountain View",
  "zip": "94043",
  "isp": "Google LLC",
  "org": "Google Public DNS",
  "as": "AS15169 Google LLC",
  "lat": 37.4,
  "lon": -122.07,
  "timezone": "America/Los_Angeles",
  "hosting": true
}
```

| 字段 | 说明 |
| --- | --- |
| `region` | 省/州名（不是行政区划代码） |
| `lat` / `lon` | 数字；无法获取时用 `null` |
| `hosting` | 是否数据中心/托管 IP，用于风险评估 |

> **留空 `ip` 的语义很重要**：工具在"查询本机 IP"时会传空 `ip`，
> 你的服务需要据此返回调用方自身的 IP 与归属地。

---

### 3.4 `ct` — 证书透明度日志

| 项 | 内容 |
| --- | --- |
| 参数 | `domain` |
| 使用工具 | SSL 证书检查 |

**返回结构**

```json
{
  "certificates": [
    {
      "id": 123456789,
      "serialNumber": "0A1B2C3D...",
      "commonName": "example.com",
      "nameValue": "example.com\nwww.example.com",
      "issuer": "C=US, O=Let's Encrypt, CN=R3",
      "notBefore": "2024-01-01T00:00:00",
      "notAfter": "2024-04-01T00:00:00"
    }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `nameValue` | 多域名用 `\n` 分隔 |
| `notBefore` / `notAfter` | 可被 `Date.parse()` 解析的字符串 |
| `serialNumber` | 十六进制字符串，可留空 |

---

### 3.5 `subdomain` — 子域名枚举

| 项 | 内容 |
| --- | --- |
| 参数 | `domain` |
| 使用工具 | 子域名发现 |

**返回结构**

```json
{
  "subdomains": [
    { "name": "www.example.com", "source": "my-source", "firstSeen": "2024-01-01", "ip": "1.2.3.4" }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `name` | 完整子域名（小写，不含通配符 `*.`） |
| `source` | 数据源标识，显示在结果表格的"来源"列 |
| `firstSeen` | 首次出现时间，可留空 |
| `ip` | 可选，解析到的 IP；无则界面显示 `--` |

> 扩展侧**不会**对你的返回做域名过滤，请自行确保只返回目标域名的子域。

---

### 3.6 `currency` — 汇率

| 项 | 内容 |
| --- | --- |
| 参数 | `base`（基准货币，如 `USD`） |
| 使用工具 | 汇率换算 |

**返回结构**

```json
{
  "base": "USD",
  "date": "2024-01-01",
  "rates": { "USD": 1, "CNY": 7.25, "EUR": 0.92, "JPY": 151.04 }
}
```

| 字段 | 说明 |
| --- | --- |
| `rates` | **必须**包含基准货币自身（值为 `1`） |
| `rates[code]` | 语义：1 单位 `base` 等于多少 `code` |
| `date` | 汇率日期，可被 `Date.parse()` 解析 |

> 这是最容易搞反的地方：`rates` 表示「**1 个基准货币 = 多少个目标货币**」，
> 不是「1 个目标货币 = 多少个基准货币」。

---

### 3.7 `breach` — 密码 / 邮箱泄露查询

| 项 | 内容 |
| --- | --- |
| 参数（密码） | `prefix`（SHA-1 前 5 位十六进制）、`suffix`（剩余 35 位） |
| 参数（邮箱） | `email` |
| 使用工具 | 密码泄露检测 |

#### 密码模式（k-匿名）

客户端只上传 SHA-1 的**前 5 位**，服务端返回该前缀下所有后缀的计数。
扩展会在本地比对后缀，因此**你的服务不应要求完整哈希**。

**返回结构**

```json
{ "count": 12345 }
```

`count` 为该密码在泄露库中出现的次数，未命中返回 `0`。

#### 邮箱模式

**返回结构**

```json
{
  "breaches": [
    {
      "name": "ExampleBreach",
      "title": "Example 数据泄露",
      "domain": "example.com",
      "breachDate": "2020-01-01",
      "description": "泄露描述",
      "isVerified": true,
      "dataClasses": ["Email addresses", "Passwords"]
    }
  ]
}
```

未发现泄露时返回 `{ "breaches": [] }`。

> 邮箱模式通常需要 API Key。扩展会把「设置 → 服务端点」中该类别填写的 API Key
> 以 `hibp-api-key` 请求头发送。若你的服务用别的头，请在 provider 中调整。

---

### 3.8 `publicIp` — 公网 IP 查询

| 项 | 内容 |
| --- | --- |
| 参数 | 无 |
| 使用工具 | IP 查询（`ipGeo` 不支持自查询时的降级路径） |

**返回结构**

```json
{ "ip": "203.0.113.7" }
```

---

### 3.9 `ssl` — SSL/TLS 深度评级

| 项 | 内容 |
| --- | --- |
| 参数 | `domain` |
| 使用工具 | SSL 证书检查 |

**为什么必须依赖外部服务**：浏览器不会把 TLS 握手细节（协议版本、加密套件、证书链）暴露给页面，
页面能观测到的只有"能否建立 HTTPS 连接"。因此协议版本与漏洞结论只能由完成完整握手的服务给出。

**返回结构**

```json
{
  "status": "READY",
  "grade": "A+",
  "endpoints": [
    {
      "ipAddress": "93.184.216.34",
      "serverName": "example.com",
      "grade": "A+",
      "hasWarnings": false,
      "protocols": [{ "name": "TLS", "version": "1.3" }]
    }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `status` | 分析状态；非 `READY` 时界面会提示"稍后重试" |
| `grade` | 综合评级（通常为 `A+`…`F`）；无结果时留空 |
| `endpoints[].protocols` | 支持的协议列表；`version` 为 `"0"` 的条目会被界面忽略 |

> 参考实现：Qualys SSL Labs 的 `api/v3/analyze?host=`（首次请求通常返回 `IN_PROGRESS`，
> 需要再次请求；这也是 `status` 字段存在的原因）。

---

### 3.10 `portScan` — 端口扫描（服务端视角）

| 项 | 内容 |
| --- | --- |
| 参数 | `host`（域名或 IP） |
| 使用工具 | 端口扫描（勾选"服务端扫描"时） |

**返回结构**

```json
{
  "host": "example.com",
  "ports": [{ "port": 443, "protocol": "tcp", "state": "open", "service": "https" }]
}
```

| 字段 | 说明 |
| --- | --- |
| `state` | `open` / `closed` / `filtered` / `unknown` |
| `service` | 可选，服务名；留空时界面回退到内置端口→服务名映射 |

> 注意：浏览器端的端口扫描无法覆盖内网地址与被网络策略限制的端口，
> 这正是该类别存在的意义。

---

### 3.11 `proxy` — HTTP 转发代理

| 项 | 内容 |
| --- | --- |
| 参数 | `url`（完整目标 URL） |
| 使用工具 | HTTP 测试（勾选"通过转发代理发送"） |

**返回结构**

```json
{
  "status": 200,
  "body": "响应正文（字符串）",
  "headers": { "content-type": "text/plain" },
  "finalUrl": "https://example.com/x"
}
```

> 该类别**只转发 GET**：扩展侧在非 GET 方法时会直接拒绝，因为通用 CORS 代理普遍不支持其他方法。

---

### 3.12 `readability` — 正文提取（服务端）

| 项 | 内容 |
| --- | --- |
| 参数 | `url` |
| 使用工具 | 网页剪报（"服务端提取正文"） |

**返回结构**

```json
{
  "title": "文章标题",
  "content": "# Markdown 正文",
  "textContent": "纯文本正文",
  "byline": "作者",
  "siteName": "站点名",
  "url": "https://example.com/article"
}
```

> `content` 为空会被视为失败（界面提示"未返回正文内容"）。

---

### 3.13 `screenshot` — 网页截图（服务端渲染）· 客户端直连

| 项 | 内容 |
| --- | --- |
| 参数 | `url`、`width`（会被钳制到 320–2000） |
| 使用工具 | 网页截图（"服务端截图 → 渲染"） |

该类别**不经过 HTTP 响应解析**：扩展只取回一个图片地址，直接作为 `<img src>` 使用。
因此你的服务地址应当**直接返回图片**（PNG/JPEG）。

自定义服务地址中可用占位符：`{url}`、`{width}`，例如：

```
https://shot.example.com/render?url={url}&w={width}
```

---

### 3.14 `stun` — STUN 服务器（WebRTC 检测）· 客户端直连

| 项 | 内容 |
| --- | --- |
| 参数 | 无 |
| 使用工具 | 浏览器指纹检测、隐私追踪检测 |

该类别同样**不经过 HTTP**：扩展取回 `stun:` 形式的地址后交给 `RTCPeerConnection`。
默认提供 Google 与 Cloudflare 的公共 STUN，也可指向自建 coturn：

```
stun:coturn.example.com:3478
```

> 若地址无法解析，工具会退化为"不配置 STUN"，此时 ICE 无法收集 srflx 候选，
> WebRTC 泄露检测结果会如实显示为"未发现泄露"，而不会伪造结论。

---

### 3.15 `urlScan` — URL 安全检测

| 项 | 内容 |
| --- | --- |
| 参数 | `url` |
| 使用工具 | 短链还原（「检测目标安全性」） |

**返回结构**

```json
{
  "malicious": false,
  "score": 0,
  "reports": 0,
  "categories": ["phishing"],
  "source": "urlscan.io"
}
```

| 字段 | 说明 |
| --- | --- |
| `malicious` | 是否被判定为恶意 |
| `score` | 风险分（取所有记录中的最高值） |
| `reports` | 相关扫描记录数 |
| `categories` | 恶意分类（如 `phishing`） |

> 典型用法：短链展开得到最终 URL 后，用本类别判断该 URL 是否被安全社区举报过。

---

### 3.16 `webArchive` — 网页归档快照

| 项 | 内容 |
| --- | --- |
| 参数 | `url` |
| 使用工具 | 短链还原、网页剪报 |

**返回结构**

```json
{
  "available": true,
  "snapshotUrl": "https://web.archive.org/web/20200101000000/https://example.com/",
  "timestamp": "20200101000000",
  "total": 1
}
```

| 字段 | 说明 |
| --- | --- |
| `available` | 是否存在快照 |
| `snapshotUrl` | 快照地址（可直接打开） |
| `timestamp` | 快照时间戳 |
| `total` | 快照数量（`cdx` 服务商返回实际条数，`wayback` 返回 0 或 1） |

> `wayback` 服务商只返回**最近一个**快照；`cdx` 服务商返回快照列表与总数。

---

### 3.17 `ipReputation` — IP 信誉查询

| 项 | 内容 |
| --- | --- |
| 参数 | `ip` |
| 使用工具 | IP 查询（「查询 IP 信誉」） |

**返回结构**

```json
{
  "ip": "1.2.3.4",
  "noise": true,
  "riot": false,
  "classification": "malicious",
  "name": "Known Scanner",
  "lastSeen": "2024-01-01"
}
```

| 字段 | 说明 |
| --- | --- |
| `noise` | 是否被观测到扫描 / 恶意活动 |
| `riot` | 是否属于常见 benign 服务白名单 |
| `classification` | 分类（`benign` / `malicious` / `unknown`） |
| `name` | 可选，行为描述名 |

---

## 4. 完整示例适配器

[`docs/adapters/cloudflare-worker.js`](adapters/cloudflare-worker.js) 是一份可直接部署的
Cloudflare Workers 适配器，实现了最初的 8 个 HTTP 类别（`dns`、`whois`、`ipGeo`、`ct`、`subdomain`、`currency`、`breach`、`publicIp`）。
后新增的 `ssl`、`portScan`、`proxy`、`readability` 可按同一模式在 `ROUTES` 中追加处理器（`screenshot`、`stun` 为客户端直连类别，不适合放在这里）。核心结构如下：

```js
const routes = {
  dns:       (q) => handleDns(q),
  whois:     (q) => handleWhois(q),
  ipGeo:     (q) => handleIpGeo(q),
  ct:        (q) => handleCt(q),
  subdomain: (q) => handleSubdomain(q),
  currency:  (q) => handleCurrency(q),
  breach:    (q) => handleBreach(q),
  publicIp:  (q) => handlePublicIp(q)
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const kind = url.pathname.replace(/^\//, '');
    const handler = routes[kind];
    if (!handler) return json({ error: 'unknown kind: ' + kind }, 404);
    try {
      return json(await handler(Object.fromEntries(url.searchParams)));
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  }
};
```

部署后，把扩展的这 8 个类别分别指向：

```
https://<your-worker>.workers.dev/dns?name={name}&type={type}
https://<your-worker>.workers.dev/whois?domain={domain}
https://<your-worker>.workers.dev/ipGeo?ip={ip}
https://<your-worker>.workers.dev/ct?domain={domain}
https://<your-worker>.workers.dev/subdomain?domain={domain}
https://<your-worker>.workers.dev/currency?base={base}
https://<your-worker>.workers.dev/breach?prefix={prefix}&suffix={suffix}
https://<your-worker>.workers.dev/publicIp
```

> 用同样的思路可以写成 Nginx + PHP、Node/Express、Python/FastAPI、Go 等任何形态，
> 只要返回上述 JSON 结构即可。

---

## 5. 在代码中新增服务商

在 `common/service-providers.js` 的 `PROVIDERS` 数组中追加一个对象：

```js
{
  id: 'my-dns',                       // 唯一 id（同一 kind 内不得重复）
  kind: 'dns',                        // 所属服务类别
  label: '我的自建 DNS',               // 设置页显示名
  homepage: 'https://example.com',    // 可选，设置页会显示"服务说明"链接
  selfHostable: true,
  defaultBaseUrl: 'https://dns.example.com/dns-query',
  // 声明用户在设置页需要填写的字段，界面会据此自动渲染
  fields: [
    { key: 'baseUrl', label: '服务地址', type: 'text', required: true },
    { key: 'apiKey', label: 'API Key（可选）', type: 'password', required: false }
  ],
  /**
   * 构造请求。必须优先使用 cfg.baseUrl，这样用户改地址即可切换自建服务。
   * @param {object} params 已经过 validateParams 规范化
   * @param {object} cfg    { baseUrl, apiKey, emailBaseUrl, headers }
   * @returns {{url: string, options: RequestInit}}
   */
  buildRequest(params, cfg) {
    return {
      url: joinUrl(cfg.baseUrl, '') + '?name=' + encodeURIComponent(params.name) + '&type=' + params.type,
      options: { headers: Object.assign({ Accept: 'application/json' }, cfg.headers) }
    };
  },
  /**
   * 把服务返回的原始响应归一化为该类别的标准结构。
   * @param {{status:number, ok:boolean, text:string, headers:object}} response
   * @throws {Error} 解析失败时抛出可读中文错误
   */
  parse(response, params) {
    const data = tryParseJson(response.text);
    if (!data) throw new Error('返回的不是合法 JSON');
    return { status: data.status ?? 0, ad: data.ad === true, answers: data.answers || [] };
  }
}
```

**要点**

1. 必须实现 `buildRequest` 与 `parse` 两个**纯函数**（不依赖 DOM / chrome API），
   这样才能被单元测试直接覆盖。
2. 必须优先使用 `cfg.baseUrl`（而不是把地址写死在代码里），否则用户无法指向自建服务。
3. `parse` 抛出的错误信息会直接展示给用户，请写成可读的中文。
4. 追加后无需改动设置页 —— 界面由注册表驱动渲染，新服务商会自动出现。

**必须补测试**：在 `tools/_test-service-providers.mjs` 中为你的 provider 增加
`buildRequest` 与 `parse` 的用例（可参考已有的 DNS / WHOIS 段落）。

---

## 6. 新增一个服务类别

如果新增的能力不属于现有 8 类，需要在 `SERVICE_KINDS` 中登记：

```js
{
  id: 'threatIntel',
  label: '威胁情报查询',
  description: '查询域名/IP 的威胁情报评分',
  params: ['indicator'],                       // 决定可用的地址占位符
  resultSchema: '{ score: number, tags: string[] }',  // 会显示在设置页
  usedBy: ['your-tool-id'],
  defaultProviderId: 'my-provider'
}
```

然后在 `PROVIDERS` 中为该类别添加至少一个 provider。
`validateParams` 中也需要为它增加一条参数校验分支（在 `switch` 里加 `case`）。

**别忘了**：`tools/_test-service-providers.mjs` 会自动校验「每个 kind 都有默认服务商与
custom 服务商」，因此漏配会在 `npm test` 时立刻暴露。

---

## 7. 安全与限制

扩展侧对自定义服务施加了以下约束，接入时请了解：

| 约束 | 原因 |
| --- | --- |
| 仅允许 `http` / `https` | 防止 `file:`、`data:`、`javascript:` 等协议被滥用 |
| 参数经严格白名单校验后才拼入 URL | 防止参数注入到 URL 结构之外 |
| 占位值统一 URL 编码 | 同上 |
| 20 秒超时 + 8 MB 响应上限 | 避免慢/异常服务拖垮扩展 |
| 不发送 Cookie（`credentials: 'omit'`） | 你的服务不应依赖浏览器 Cookie 做鉴权，请用 API Key |
| 错误信息会展示给用户 | 不要在错误信息里回显密钥 |

**关于 API Key 的存放**：API Key 保存在 `chrome.storage.local` 中（明文，与浏览器
保存其他扩展数据的方式一致）。请使用**权限最小化**的 Key，不要使用主账号密钥。

**关于自定义请求头**：目前 `headers` 字段通过配置文件写入（`serviceConfigSet` 消息的
`config.<kind>.headers`）。设置页暂未提供逐条编辑 UI。

---

## 8. 调试与排错

### 8.1 用「保存并测试」快速验证

设置页每个服务类别右上角有 **保存并测试** 按钮：它会先保存当前输入，再用该类别的最小
代价参数发一次真实请求，并显示服务商、HTTP 状态与耗时。

失败时优先看错误信息：

| 错误信息 | 常见原因 |
| --- | --- |
| `服务地址非法` | 地址不是合法 URL，或协议不是 http/https |
| `请求超时（20s）` | 服务无响应或过慢 |
| `HTTP 4xx: ...` | 服务返回了错误状态码，通常是鉴权或参数问题 |
| `返回的不是合法 JSON` | 返回了 HTML 错误页（常见于路径写错） |
| `未找到服务商` | 配置里的服务商 id 在当前版本已不存在（升级后可能出现） |
| `该服务类别下不存在服务商 "xxx"` | 显式指定了一个不存在的服务商 |
| `响应体过大` | 响应超过 8 MB，考虑在服务端做过滤/分页 |

### 8.2 查看实际发出的请求

所有外部请求都由后台统一发出，因此可以在后台的开发者工具中观察：

- **Firefox**：`about:debugging#/runtime/this-firefox` → 本扩展 → 「检查」
- **Chrome**：`chrome://extensions` → 本扩展 → 「Service Worker」→ 「检查」

在 Network 面板可以看到完整 URL、请求头与响应体。

### 8.3 常见坑

1. **汇率方向搞反**：`rates[code]` 表示「1 个基准货币 = 多少个 code」。
2. **DNS 记录类型用了字符串**：`answers[].type` 必须是数字。
3. **`ipGeo` 忽略了空 `ip`**：空 `ip` 表示"查询调用方自己"，不能当作参数缺失。
4. **`rates` 里没有基准货币**：`base: "USD"` 时 `rates.USD` 必须为 `1`。
5. **`breach` 只返回前缀匹配**：密码模式需要用到 `suffix`，只按前缀返回全部结果无法定位具体密码。
6. **`whois` 的日期格式**：请返回可被 `Date.parse()` 解析的字符串，否则界面的到期倒计时会失效。

---

## 附：内置服务商一览

| 类别 | 内置服务商 |
| --- | --- |
| `dns` | Cloudflare DNS、Google Public DNS、阿里公共 DNS、Quad9 |
| `whois` | RDAP.org、whoisjs.com |
| `ipGeo` | ip-api.com |
| `ct` | crt.sh、Cert Spotter |
| `subdomain` | crt.sh、HackerTarget、Cert Spotter |
| `currency` | open.er-api.com、Frankfurter (ECB) |
| `breach` | Have I Been Pwned |
| `publicIp` | api.ipify.org |
| `ssl` | Qualys SSL Labs |
| `portScan` | HackerTarget Nmap API |
| `proxy` | AllOrigins、CodeTabs CORS Proxy |
| `readability` | Jina Reader |
| `screenshot` | thum.io（客户端直连） |
| `stun` | Google 公共 STUN、Cloudflare STUN（客户端直连） |
| `urlScan` | urlscan.io |
| `webArchive` | Wayback Machine (available)、Wayback Machine (CDX) |
| `ipReputation` | GreyNoise Community |

每个类别都额外提供 **自定义服务（自建 / 自托管）**。

> 完整且始终最新的清单请以 `common/service-providers.js` 中的 `PROVIDERS` 为准，
> 或在设置页直接查看下拉选项。
