# ToolCube

> 86 个纯本地工具 + 可插拔的外部服务端点。所有数据处理默认在浏览器内完成；
> 需要联网的功能（DNS、WHOIS、IP 归属地等）**可以指向你自己的服务器**，无需改代码。

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](#浏览器兼容性)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](#许可证)
[![Tests](https://img.shields.io/badge/tests-1005%20assertions-brightgreen)](#开发)

---

## 目录

- [它是什么](#它是什么)
- [核心特性](#核心特性)
- [安装](#安装)
- [快速上手](#快速上手)
- [接入你自己的服务器](#接入你自己的服务器)
- [项目结构](#项目结构)
- [开发](#开发)
- [扩展开发](#扩展开发)
- [浏览器兼容性](#浏览器兼容性)
- [隐私说明](#隐私说明)
- [文档索引](#文档索引)
- [许可证](#许可证)

---

## 它是什么

一款浏览器扩展（Manifest V3），把日常开发、调试、运维中零散需要的小工具集中到一个侧边栏里。
86 个工具覆盖 9 个类别：

| 类别 | 数量 | 代表工具 |
| --- | --- | --- |
| 极客工具 | 17 | UA 切换、视频倍速/解锁、cURL 生成、JWT 生成、端口扫描 |
| 数据格式化 | 10 | SQL/XML/CSS 格式化、数据格式互转、Cron 解析 |
| 网页开发 | 11 | 元素编辑、Cookie 管理、资源嗅探、网页截图 |
| 安全工具 | 11 | 网页安全扫描、隐私追踪检测、银狐木马拦截、反指纹 |
| 设计工具 | 10 | 图片处理、取色器、渐变生成、CSS 阴影、SVG 预览 |
| 编码转换 | 9 | Base64、哈希、JWT 解码、UUID |
| 文本处理 | 8 | JSON 格式化、正则测试、文本对比、Markdown 编辑器 |
| 网络工具 | 7 | HTTP 测试、DNS 查询、IP 查询、Web Vitals |
| 日常效率 | 3 | 计算器、剪贴板历史、标签管理 |

设计上的两个取舍值得说明：

1. **无构建步骤**。源码即产物，`git clone` 后可以直接在浏览器里加载调试，不需要 Node 工具链。
   代价是不能用 TS / JSX，换来的是任何人都能在 5 分钟内读懂并修改。
2. **联网能力与工具解耦**。工具不直接访问第三方服务，而是统一走一层「服务端点」注册表
   （见 [`common/service-providers.js`](common/service-providers.js)）。这样更换服务商、
   指向自建服务器、新增数据源都不需要改动工具代码。

---

## 核心特性

### 工具侧

- **侧边栏工作流**：任意网页右侧滑出，支持拖拽、缩放、快捷键唤起
- **搜索与分类**：支持中文名、英文名、ID 与拼音首字母搜索
- **收藏与最近使用**：常用工具一键直达
- **全局开关**：一键让扩展"不存在"（停止注入、停止拦截）
- **纯本地优先**：绝大多数工具零网络请求；有联网能力的工具会明确标注

### 平台侧

- **跨浏览器**：同一份清单同时声明 Firefox 事件页与 Chrome/Edge Service Worker
- **可插拔服务端点**：17 类外部服务（45+ 服务商），每类均支持自建自托管
- **持久化功能**：UA 切换、视频倍速、自定义请求头、脚本注入等按域名持久生效
- **CSP 安全**：扩展页 CSP 为 `script-src 'self'`，全程不使用 `eval` / `new Function` / 内联脚本

### 工程质量

- **零运行时依赖**：`libs/` 下仅两个第三方库（acorn、jsQR），均有明确许可证与引入理由
- **18 步自动化校验**：语法校验（全项目 JS）+ 17 组单元测试，共 **1005 条断言**
- **一条命令回归**：`npm test`
- **官方校验通过**：`npm run lint` → `errors: 0`

---

## 安装

### 从源码加载（开发/自用）

**Firefox**

```bash
git clone https://github.com/l1111118/ToolCube.git
cd ToolCube
npm install          # 仅安装开发依赖 web-ext，扩展本身无运行时依赖
npm start            # 启动一个装有本扩展的临时 Firefox 实例
```

或手动加载：打开 `about:debugging#/runtime/this-firefox` → 「临时载入附加组件」→ 选择 `manifest.json`。

**Chrome / Edge**

打开 `chrome://extensions` → 开启「开发者模式」→ 「加载已解压的扩展程序」→ 选择项目根目录。

> 无需执行任何构建命令，仓库根目录就是可加载的扩展。

### 打包发布

```bash
npm run build        # 生成 web-ext-artifacts/*.zip
```

---

## 快速上手

1. 安装后，点击工具栏图标打开弹窗，或按 `Ctrl+Shift+B`（macOS: `Cmd+Shift+B`）唤出侧边栏。
2. 首次使用需阅读并同意用户协议。
3. 在侧边栏顶部搜索框输入关键词（支持拼音首字母，如输入 `ewm` 可找到"二维码"），
   或按分类浏览。
4. 点击工具即可在侧边栏中打开使用；工具之间可以通过右键菜单互相传递选中内容。
5. 在设置页（`⚙️`）中可以：
   - 调整主题、语言、侧边栏位置与宽度
   - 启用/禁用单个工具
   - **配置服务端点**（把联网功能指向自建服务器）
   - 导出/导入全部数据

### 常用快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+Shift+E` | 打开弹窗菜单 |
| `Ctrl+Shift+B` | 显示/隐藏侧边栏 |
| `Ctrl+Shift+K` | 快速搜索（打开侧边栏并聚焦搜索框） |

快捷键可在浏览器的扩展快捷键设置中自定义。

---

## 接入你自己的服务器

这是本项目与其他同类扩展的主要差异点：**所有需要联网的能力都可以指向你自己的服务**。

### 为什么需要

- 公司内网无法访问公共 DNS / WHOIS 服务
- 希望统一出口、做审计或缓存
- 公共免费接口有速率限制或不稳定
- 数据合规要求查询不经第三方

### 怎么用（两种方式）

**方式一：把内置服务商指向自建实例**（最省事）

如果你的自建服务**遵循与内置服务商相同的协议**（例如自建 DoH 服务、自建 RDAP 网关），
只需在「设置 → 服务端点」把该类别的「服务地址」改成你的地址即可。

以 DNS 为例：选择服务商 `Cloudflare DNS`，把服务地址改为
`https://dns.your-company.com/dns-query`，工具发出的请求就会打到你的服务器。

**方式二：选择「自定义服务」并实现归一化接口**（最灵活）

在对应类别的「服务商」下拉中选择 **自定义服务（自建 / 自托管）**，
填写你的服务地址（支持 `{name}`、`{domain}`、`{type}` 等占位符），
你的服务只需返回该类别的**归一化 JSON 结构**。

例如 DNS 类别：

```
服务地址：https://api.your-company.com/dns?name={name}&type={type}
```

你的服务返回：

```json
{
  "status": 0,
  "ad": false,
  "answers": [
    { "name": "example.com.", "type": 1, "ttl": 300, "data": "93.184.216.34" }
  ]
}
```

完整的类别清单、参数说明与返回结构见 **[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)**。

### 现成的适配器示例

[`docs/adapters/cloudflare-worker.js`](docs/adapters/cloudflare-worker.js) 是一份
可直接部署到 Cloudflare Workers 的适配器，实现了 8 个 HTTP 服务类别。
把它部署起来，再把扩展的对应类别全部指向它，就得到一个完全自控的查询后端。

```bash
# 示例：部署到 Cloudflare Workers
npx wrangler deploy docs/adapters/cloudflare-worker.js --name toolcube-adapter
```

---

## 项目结构

```
.
├── manifest.json               # 扩展清单（同时声明 Firefox 与 Chrome 的后台形式）
├── background.js               # 后台：消息分发 + 服务端点层 + 各类特权操作
├── common/                     # 跨页面共享模块（ES Module）
│   ├── service-providers.js    # ★ 可插拔外部服务注册表（本文档重点）
│   ├── tool-registry.js        # ★ 工具注册表：86 个工具的单一数据源
│   ├── storage.js              # chrome.storage + IndexedDB 封装（设置页导入/导出/清空）
│   ├── utils.js                # 共享工具函数（防抖/截断/HTML 转义）
│   ├── i18n.js                 # 国际化（简中/繁中/英文）+ 简繁对照表
│   ├── terms.js                # 用户协议弹窗与首次使用判定
│   ├── tool-runtime.js         # 工具页共享运行时（setData 兜底 / 自动保存应答）
│   ├── tool-i18n.js            # 工具页界面文案翻译运行时
│   ├── tool-i18n-dict.js       # 工具页文案词典（en 人工翻译 / zh-TW 自动生成）
│   └── pe-analyzer.js          # PE 文件分析（银狐木马拦截使用）
├── content/                    # 内容脚本
│   ├── injector.js             # 宿主页面注入 + 侧边栏宿主
│   ├── sidebar.js/html         # 侧边栏 UI
│   ├── video-*.js              # 视频倍速 / 解锁 / 增强
│   ├── anti-fingerprint.js     # 反指纹
│   └── auto-play-next.js       # 自动连播
├── tools/<tool-id>/            # 86 个工具，每个含 tool.html / tool.js / tool.css
├── popup/                      # 工具栏弹窗
├── options/                    # 设置页（含「服务端点」配置界面）
├── libs/                       # 第三方运行时库（含许可全文）
└── docs/                       # 自建服务文档与适配器示例
```

**约定**：工具目录名必须与 `common/tool-registry.js` 中的 `id` 一致，
否则侧边栏与设置页会出现不一致。

---

## 开发

### 环境要求

- Node.js 18+（仅用于开发脚本与 lint，扩展运行时不需要）
- 无需构建工具

### 常用命令

```bash
npm test        # 语法校验（全项目 JS）+ 全部单元测试
npm run lint    # AMO 官方校验器（web-ext lint），目标 errors: 0
npm start       # 启动装有扩展的临时 Firefox
npm run build   # 打包为 zip
```

### 测试组织

| 文件 | 覆盖内容 |
| --- | --- |
| `tools/_verify-syntax.mjs` | 全项目 JS 语法解析（acorn，module/script 双模式） |
| `tools/_test-registry.mjs` | 工具注册表一致性：`TOOLS_CONFIG` 与磁盘目录、分类表、拼音表互验 |
| `tools/_test-service-providers.mjs` | 服务注册表：完整性、参数校验、配置规范化、各 provider 的请求构造与解析 |
| `tools/_test-service-endpoints-ui.mjs` | 设置页「服务端点」渲染：字段渲染、selected 标记、HTML 转义防注入 |
| `tools/_test-service-kinds.mjs` | 服务类别 ↔ 消费者闭环：`usedBy` 声明的工具必须真实调用，杜绝"空壳端点" |
| `tools/_test-security-invariants.mjs` | **安全不变量**：CSP 约束、消息来源校验、特权代理限制、外部出口唯一 |
| `tools/_test-hash.mjs` | MD5 实现（RFC 1321 向量、分块边界、二进制、Unicode） |
| `tools/_test-qrcode.mjs` | 二维码编码器：用 jsQR 做**端到端往返解码**（含中文、版本 ≥7、四种纠错等级） |
| `tools/_test-calculator.mjs` | 计算器表达式解析器 |
| `tools/_test-cron-parser.mjs` | Cron 解析与调度语义 |
| `tools/_test-jsonpath.mjs` | JSONPath 查询 |
| `tools/_test-minifier.mjs` | 代码压缩器（含全项目 token 等价性比对） |
| `tools/_test-text-diff.mjs` | 文本对比 LCS（含随机等价性比对） |
| `tools/_test-color-contrast.mjs` | WCAG 2.1 对比度边界值（4.5:1 分界） |
| `tools/_test-string-counter.mjs` | 字符统计边界（空输入、中英混排、UTF-8 字节） |
| `tools/_test-timestamp-tz.mjs` | 时间戳转换的时区逻辑 |
| `tools/_test-tool-i18n.mjs` | 工具页 i18n：词典结构、zh-TW 与 en 键同步、88 页引入顺序、运行时安全边界 |
| `tools/_test-tool-runtime.mjs` | 工具页共享运行时：同源校验、不覆盖非空输入、`setData` 载荷兼容性 |
| `tools/_test-registry.mjs` | 注册表一致性：目录 ↔ `TOOLS_CONFIG` ↔ 分类 ↔ 拼音映射（含悬挂键推导式校验） |
| `tools/_test-color-contrast.mjs` | 颜色对比度：WCAG 相对亮度、对比度公式、等级阈值（含规范边界值） |
| `tools/_test-string-counter.mjs` | 字符串统计：空/空白/中英混排/多行/UTF-8 字节/emoji 边界 |
| `tools/_test-all.mjs` | 总入口，依次运行以上全部 |

> 工具源码中的函数多位于 IIFE / `DOMContentLoaded` 内部，无法直接 `import`。
> 测试的统一做法是：用 acorn 解析源码 → 按函数名提取片段 → `new Function` 求值。
> 这样既能测到真实实现，又不需要在源码里为测试开洞。

### 改动后的检查清单

1. `npm test` 全绿
2. `npm run lint` 为 `errors: 0`
3. 若新增/删除工具，确认 `common/tool-registry.js` 已同步
4. 若引入第三方库，须随包附许可全文（`libs/<name>.LICENSE`）—— 打包会忽略 `*.md`
5. 手动冒烟：安装 → 同意协议 → 打开侧边栏 → 右键菜单 → 全局开关开/关

---

## 扩展开发

### 新增一个工具

简要流程：

1. 新建 `tools/<your-tool-id>/{tool.html,tool.js,tool.css}`
2. 在 `common/tool-registry.js` 的 `TOOLS_CONFIG` 中登记
3. `npm test && npm run lint`

### 新增一个外部服务商 / 服务类别

见 **[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)**。
在 `common/service-providers.js` 中追加一个 provider 对象（实现 `buildRequest` 与 `parse`
两个纯函数）即可，设置页界面会自动出现新选项。

### 编码约定（重要）

扩展页的 CSP 为 `script-src 'self'`，以下写法**一定不可用**：

| 禁止 | 替代方案 |
| --- | --- |
| `eval()` / `new Function()` | 使用 vendored 的纯解析器（如 `libs/acorn.js`） |
| HTML 内联 `<script>` | 独立的 `.js` 文件 |
| 内联 `onclick="..."` 等事件处理器 | `addEventListener` |
| `innerHTML` 拼接未转义的外部数据 | 统一经 `escapeHtml` |

其他约定：注释解释「为什么」而非复述「做什么」；不用魔法数；事件监听器与观察器须可释放；
文本处理类工具禁止用全局正则直接改写源码（须先做词法切分）。

---

## 浏览器兼容性

| 浏览器 | 后台形式 | 最低版本 |
| --- | --- | --- |
| Firefox（桌面） | 事件页（`background.scripts`） | 140 |
| Firefox for Android | 事件页 | 142 |
| Chrome / Edge | Service Worker（`background.service_worker`） | 121+ |

清单同时声明两种后台形式，由浏览器各取所需 —— 这是 MDN 推荐的跨浏览器 MV3 写法。

> **关于最低版本**：`strict_min_version` 设为 140 是为了与
> `browser_specific_settings.gecko.data_collection_permissions`（需 140+）保持一致。
> 若需要支持更早的 Firefox（113+），可把 `manifest.json` 中
> `strict_min_version` 改回 `113.0`，并**同时**删除 `data_collection_permissions`
> —— 两者必须自洽。

---

## 隐私说明

- **默认纯本地**：绝大多数工具不发起任何网络请求。
- **联网功能可审计**：所有外部请求都集中在 `background.js` 的服务端点层，
  使用的域名可在 `common/service-providers.js` 中一览无余。
- **可完全自控**：把服务端点指向自建服务器后，扩展不会联系任何第三方。
- **不收集数据**：扩展不包含任何统计、埋点或遥测代码；
  `manifest.json` 中声明 `data_collection_permissions: { required: ["none"] }`。
- **敏感操作显式授权**：剪贴板读写、摄像头、麦克风等能力仅在用户主动触发时申请。

---

## 发布前检查清单

仓库地址已按本项目实际配置（`https://github.com/l1111118/ToolCube`）。
若你 fork 后发布到自己的仓库，请同步替换下列位置：

| 位置 | 说明 |
| --- | --- |
| `manifest.json` → `homepage_url` | 设置页的「自建服务文档」与「问题反馈」链接由它生成 |
| `package.json` → `homepage` / `repository.url` / `bugs.url` | npm 元数据 |
| `README.md` → `git clone` 地址 | 上手说明 |

> 设置页中的「自建服务接入指南」链接会**自动**依据 `manifest.json` 的 `homepage_url`
> 生成，未填写时该链接会被隐藏 —— 因此只需维护一处。

### 上架前需确认

| 项 | 现状 | 说明 |
| --- | --- | --- |
| `browser_specific_settings.gecko.id` | `{1b3172be-aed1-4587-b52c-752d79af2de9}` | Firefox 扩展的**唯一标识**（类似 Android 包名），用于区分扩展、关联本地数据、签名与自动更新。一旦上架 AMO 便**永久不可更改** —— 改了等于变成另一个扩展，老用户收不到更新且数据不会迁移。若想改用域名形式（如 `toolcube@your-domain.com`），必须在**首次上架前**决定。Chrome / Edge 不使用该字段 |
| `LICENSE` 版权行 | `lhs` | 作者署名（有意选择）；如需改为其他名称或组织，直接修改该行 |

> 仓库内**不含**任何个人信息（邮箱 / 姓名）。漏洞报告渠道使用 GitHub 的私密报告功能，
> 见 [`SECURITY.md`](SECURITY.md) —— 因此无需为开源而公开个人邮箱。

上架前建议再跑一遍：

```bash
npm test          # 全部测试
npm run lint      # AMO 官方校验，目标 errors: 0
npm run build     # 产出可分发的 zip
```

---

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md) | **自建服务接入指南**：8 类服务的参数与返回结构契约、示例适配器 |
| [SECURITY.md](SECURITY.md) | **安全策略**：漏洞报告渠道、处理预期、安全模型与已知边界 |
| [CHANGELOG.md](CHANGELOG.md) | 面向使用者的变更记录 |

---

## 许可证

本项目以 **MIT** 许可证发布，详见 [LICENSE](LICENSE)。

第三方依赖：

- [acorn](https://github.com/acornjs/acorn) — MIT
- [jsQR](https://github.com/cozmo/jsQR) — Apache-2.0

> 若你希望改用其他许可证（如 Apache-2.0、GPL-3.0），
> 替换 `LICENSE` 文件并同步修改 `package.json` 的 `license` 字段即可。
> 注意 `libs/jsQR.js` 为 Apache-2.0，其许可全文需随分发保留（见 `libs/jsQR.LICENSE`）。
