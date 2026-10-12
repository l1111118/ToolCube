/**
 * ToolCube - Internationalization (3 Languages)
 * 简体中文 / 繁體中文 / English
 * @version 2.0.0
 */

// ==================== 用户协议 ====================
// 注意：协议内容在尾部统一导出

const TERMS_ZH_CN = `
【ToolCube 用户协议】

请在使用本扩展程序前仔细阅读本协议。您安装、使用或以任何方式接触本扩展程序，即视为已阅读、理解并同意本协议全部条款。若您不同意，请立即停止使用并卸载。

一、定义与适用范围
1. 「本软件」指 ToolCube 浏览器扩展程序的源代码及其构建产物。
2. 「官方版本」指本项目维护者通过其指定渠道（如官方代码仓库、浏览器扩展商店）发布的版本。
3. 「服务端点」指本软件在您主动触发时访问的外部接口，以及您自行配置的自建或第三方服务地址。
4. 本协议规范您对官方版本的使用行为，以及本软件与第三方服务交互时您应遵守的义务；它不改变、也不限制您依据开源许可证对源代码享有的权利（见第二条）。

二、开源许可（重要）
1. 本软件以 MIT 许可证开源发布。在遵守 MIT 许可证条款的前提下，您有权使用、复制、修改、合并、发布、分发、再许可及销售本软件的副本。
2. 本协议不限制、也不替代 MIT 许可证授予您的权利。就本软件源代码的使用而言，二者如有冲突，以 MIT 许可证为准。
3. 「ToolCube」名称、图标及其他标识仅用于识别官方版本。您不得以暗示官方认可、赞助或关联的方式使用上述标识，亦不得将修改后的版本冒充为官方版本。您分发修改后的版本时，请保留 MIT 许可证与版权声明，并自行承担由此产生的责任。

三、合法与授权使用（重要）
1. 您承诺遵守您所在司法辖区的法律法规以及软件分发平台的政策，不得利用本软件从事任何违法或侵权活动。
2. 本软件包含面向安全研究与测试的工具（如端口扫描、DNS/WHOIS 查询、XSS/CORS 测试、Payload 编码、反向 Shell 命令生成等）。您仅可在下列情形使用这些工具：
   （1）您拥有目标系统，或已获得目标系统所有者的明确书面授权；或
   （2）法律明确允许的、非侵入性的合法用途。
   未经授权对他人系统进行扫描、探测或攻击，可能构成违法甚至犯罪，由此产生的一切责任由您自行承担。
3. 您不得利用本软件实施网络攻击、未授权入侵、数据窃取，不得传播病毒、木马等恶意程序，不得大规模抓取个人信息，不得规避法律或平台的安全机制。
4. 本软件中的安全扫描、隐私检测、指纹检测、密码强度与泄露检测等结果仅供参考，不构成专业安全评估、合规意见或法律意见。
5. 本软件不是安全防护产品：其中的木马下载拦截、追踪器屏蔽、HTTPS 升级等功能基于启发式规则，无法识别或阻断全部威胁。请勿以本软件替代杀毒软件、防火墙或专业安全方案。

四、第三方服务（重要）
1. 部分功能需要访问第三方在线服务（DNS、WHOIS/RDAP、IP 归属地、证书透明度日志、子域名枚举、汇率、泄露查询、公网 IP 等）。这些请求仅在您主动触发时发出，目的地由内置服务商或您自行配置的服务地址决定。
2. 使用这些功能时，您应同时遵守相应第三方服务的使用条款、速率限制与数据政策；因您违反第三方条款而产生的后果，由您自行承担。
3. 若您将服务端点配置为自建或第三方地址，该服务的可用性、安全性、数据处理与合法性由您或该服务提供方负责，与开发者无关。

五、免责声明
1. 本软件按「现状」（AS IS）与「现有」（AS AVAILABLE）提供，不附带任何明示或默示的担保，包括但不限于对适销性、特定用途适用性、准确性、不侵权以及无中断运行的担保。
2. 在适用法律允许的最大范围内，开发者不对因使用或无法使用本软件而产生的任何直接、间接、附带、特殊、惩罚性或后果性损害负责，包括但不限于数据丢失、业务中断、利润损失、设备损坏或信息泄露。
3. 本软件访问的第三方数据由其各自来源提供，开发者不对其准确性、完整性、时效性或合法性作出保证。
4. 本软件与任何被访问、被测试或被查询的网站、服务、组织，以及与 Mozilla、Google 等浏览器厂商，均无隶属、赞助或背书关系。
5. 若适用法律不允许排除或限制某些担保或责任，上述排除与限制应在法律允许的最大范围内适用，且不适用于依法不可排除的责任。

六、责任限制
在适用法律允许的最大范围内，开发者就本协议或本软件对您承担的全部责任总额，不超过您为获得本软件而实际支付的金额（本软件免费提供，故该金额为零）。

七、赔偿
因您违反本协议或适用法律使用本软件，导致第三方提出索赔、诉讼或主张，或使开发者遭受损失（包括合理的律师费），您应自行承担全部责任，并赔偿开发者因此遭受的全部损失、费用与支出。

八、用户数据与隐私
1. 本软件不会主动收集或上传您的个人数据至开发者控制的服务器。设置、历史记录、剪贴板等数据默认存储在您的本地浏览器中，您可随时在设置页导出或清除。
2. 资源嗅探、Cookie 管理、存储管理等工具仅在本地运行，不会向外部服务器发送数据。
3. 具有联网能力的工具仅在您主动触发时，向相应服务端点发起请求；请求的内容与目的地取决于您的配置。

九、协议更新
1. 开发者可因法律变化或功能调整修订本协议，修订版在官方版本中发布后生效。
2. 若您不同意修订内容，可停止使用本软件；继续使用即视为您接受修订后的协议。

十、其他
1. 若本协议任何条款被认定为无效或不可执行，该条款应在法律允许的范围内调整至最接近其原意的程度，其余条款继续有效。
2. 本协议构成您与开发者就官方版本的使用达成的完整约定，并取代此前的相关沟通或表述；就源代码的使用，以 MIT 许可证为准。
3. 本协议各节标题仅为阅读方便，不影响条款的解释。
4. 因本协议产生的争议，双方应首先友好协商解决，亦可通过项目主页公布的反馈渠道提出。本协议不指定特定司法管辖区的法院管辖，也不排除您依法享有的任何强制性权利。

【提示】若您为未成年人，请在法定监护人同意后使用本软件。使用即表示您已阅读并接受上述全部条款。
`;

const TERMS_ZH_TW = `
【ToolCube 使用者協議】

請在使用本擴充功能前仔細閱讀本協議。您安裝、使用或以任何方式接觸本擴充功能，即視為已閱讀、理解並同意本協議全部條款。若您不同意，請立即停止使用並解除安裝。

一、定義與適用範圍
1. 「本軟體」指 ToolCube 瀏覽器擴充功能的原始碼及其建置產物。
2. 「官方版本」指本專案維護者透過其指定管道（如官方程式碼倉庫、瀏覽器擴充商店）發布的版本。
3. 「服務端點」指本軟體在您主動觸發時存取的外部介面，以及您自行設定的自建或第三方服務位址。
4. 本協議規範您對官方版本的使用行為，以及本軟體與第三方服務互動時您應遵守的義務；它不改變、也不限制您依開源授權條款對原始碼享有的權利（見第二條）。

二、開源授權（重要）
1. 本軟體以 MIT 授權條款開源發布。在遵守 MIT 授權條款的前提下，您有權使用、複製、修改、合併、發布、散布、再授權及銷售本軟體的副本。
2. 本協議不限制、也不取代 MIT 授權條款授予您的權利。就本軟體原始碼的使用而言，二者如有衝突，以 MIT 授權條款為準。
3. 「ToolCube」名稱、圖示及其他標識僅用於識別官方版本。您不得以暗示官方認可、贊助或關聯的方式使用上述標識，亦不得將修改後的版本冒充為官方版本。您散布修改後的版本時，請保留 MIT 授權條款與著作權聲明，並自行承擔由此產生的責任。

三、合法與授權使用（重要）
1. 您承諾遵守您所在司法管轄區的法律法規以及軟體散布平台的政策，不得利用本軟體從事任何違法或侵權活動。
2. 本軟體包含面向安全研究與測試的工具（如連接埠掃描、DNS/WHOIS 查詢、XSS/CORS 測試、Payload 編碼、反向 Shell 指令產生等）。您僅可在下列情形使用這些工具：
   （1）您擁有目標系統，或已取得目標系統所有者的明確書面授權；或
   （2）法律明確允許的、非侵入性的合法用途。
   未經授權對他人系統進行掃描、探測或攻擊，可能構成違法甚至犯罪，由此產生的一切責任由您自行承擔。
3. 您不得利用本軟體實施網路攻擊、未授權入侵、資料竊取，不得散布病毒、木馬等惡意程式，不得大規模擷取個人資料，不得規避法律或平台的安全機制。
4. 本軟體中的安全掃描、隱私偵測、指紋偵測、密碼強度與洩漏偵測等結果僅供參考，不構成專業安全評估、合規意見或法律意見。
5. 本軟體不是安全防護產品：其中的木馬下載攔截、追蹤器遮蔽、HTTPS 升級等功能基於啟發式規則，無法識別或阻斷全部威脅。請勿以本軟體取代防毒軟體、防火牆或專業安全方案。

四、第三方服務（重要）
1. 部分功能需要存取第三方線上服務（DNS、WHOIS/RDAP、IP 歸屬地、憑證透明度日誌、子網域列舉、匯率、洩漏查詢、公網 IP 等）。這些請求僅在您主動觸發時發出，目的地由內建服務商或您自行設定的服務位址決定。
2. 使用這些功能時，您應同時遵守相應第三方服務的使用條款、速率限制與資料政策；因您違反第三方條款而產生的後果，由您自行承擔。
3. 若您將服務端點設定為自建或第三方位址，該服務的可用性、安全性、資料處理與合法性由您或該服務提供方負責，與開發者無關。

五、免責聲明
1. 本軟體按「現狀」（AS IS）與「現有」（AS AVAILABLE）提供，不附帶任何明示或默示的擔保，包括但不限於對可商用性、特定用途適用性、準確性、不侵權以及不中斷運行的擔保。
2. 在適用法律允許的最大範圍內，開發者不對因使用或無法使用本軟體而產生的任何直接、間接、附帶、特殊、懲罰性或後果性損害負責，包括但不限於資料遺失、業務中斷、利潤損失、裝置損壞或資訊洩漏。
3. 本軟體存取的第三方資料由其各自來源提供，開發者不對其準確性、完整性、時效性或合法性作出保證。
4. 本軟體與任何被存取、被測試或被查詢的網站、服務、組織，以及與 Mozilla、Google 等瀏覽器廠商，均無隸屬、贊助或背書關係。
5. 若適用法律不允許排除或限制某些擔保或責任，上述排除與限制應在適用法律允許的最大範圍內適用，且不適用於依法不可排除的責任。

六、責任限制
在適用法律允許的最大範圍內，開發者就本協議或本軟體對您承擔的全部責任總額，不超過您為取得本軟體而實際支付的金額（本軟體免費提供，故該金額為零）。

七、賠償
因您違反本協議或適用法律使用本軟體，導致第三方提出索賠、訴訟或主張，或使開發者遭受損失（包括合理的律師費），您應自行承擔全部責任，並賠償開發者因此遭受的全部損失、費用與支出。

八、使用者資料與隱私
1. 本軟體不會主動蒐集或上傳您的個人資料至開發者控制的伺服器。設定、歷史記錄、剪貼簿等資料預設儲存在您的本機瀏覽器中，您可隨時在設定頁匯出或清除。
2. 資源探測、Cookie 管理、儲存管理等工具僅在本機執行，不會向外部伺服器傳送資料。
3. 具有連網能力的工具僅在您主動觸發時，向相應服務端點發起請求；請求的內容與目的地取決於您的設定。

九、協議更新
1. 開發者可因法律變化或功能調整修訂本協議，修訂版在官方版本中發布後生效。
2. 若您不同意修訂內容，可停止使用本軟體；繼續使用即視為您接受修訂後的協議。

十、其他
1. 若本協議任何條款被認定為無效或不可執行，該條款應在適用法律允許的範圍內調整至最接近其原意的程度，其餘條款繼續有效。
2. 本協議構成您與開發者就官方版本的使用達成的完整約定，並取代此前的相關溝通或表述；就原始碼的使用，以 MIT 授權條款為準。
3. 本協議各節標題僅為閱讀方便，不影響條款的解釋。
4. 因本協議產生之爭議，雙方應首先友好協商解決，亦可透過專案首頁公布的意見回饋管道提出。本協議不指定特定司法管轄區之法院管轄，也不排除您依法享有的任何強制性權利。

【提示】若您為未成年人，請在法定監護人同意後使用本軟體。使用即表示您已閱讀並接受上述全部條款。
`;

const TERMS_EN = `
[ToolCube - Terms of Service]

Please read this agreement carefully before using this extension. By installing, using, or otherwise engaging with this extension, you confirm that you have read, understood, and agreed to all of its terms. If you do not agree, please stop using and uninstall it immediately.

1. Definitions and Scope
   1.1 "Software" means the source code and build artifacts of the ToolCube browser extension.
   1.2 "Official Version" means a release published by the maintainer of this project through its designated channels (e.g. the official repository or a browser extension store).
   1.3 "Service Endpoint" means any external interface the Software accesses when you actively trigger it, as well as any self-hosted or third-party endpoint you configure yourself.
   1.4 This agreement governs your use of the Official Version and your obligations when the Software interacts with third-party services. It does not alter or limit the rights you hold over the source code under its open-source license (see Section 2).

2. Open-Source License (Important)
   2.1 The Software is released under the MIT License. Subject to its terms, you may use, copy, modify, merge, publish, distribute, sublicense, and sell copies of the Software.
   2.2 This agreement neither limits nor replaces the rights granted to you by the MIT License. As to your use of the source code, the MIT License prevails in the event of any conflict.
   2.3 The name "ToolCube", its icons, and other marks are used solely to identify the Official Version. You may not use them in any way that suggests official endorsement, sponsorship, or affiliation, nor present modified versions as the Official Version. If you distribute a modified version, you must retain the MIT License and copyright notice, and you bear sole responsibility for it.

3. Lawful and Authorized Use (Important)
   3.1 You agree to comply with the laws and regulations of your jurisdiction and with the policies of the platform distributing the Software, and not to use the Software for any unlawful or infringing activity.
   3.2 The Software includes tools intended for security research and testing (e.g. port scanning, DNS/WHOIS lookups, XSS/CORS testing, payload encoding, and reverse shell command generation). You may use these tools only:
       (a) on systems you own or for which you hold explicit written authorization from the owner; or
       (b) for lawful, non-intrusive purposes expressly permitted by law.
       Scanning, probing, or attacking systems without authorization may be illegal or criminal, and you bear sole responsibility for any consequences.
   3.3 You shall not use the Software to conduct network attacks, unauthorized intrusions, or data theft; to distribute viruses, trojans, or other malicious software; to scrape personal information at scale; or to circumvent legal or platform security mechanisms.
   3.4 Results from the security scanner, privacy, fingerprint, password-strength, and breach-checking tools are for reference only and do not constitute professional security, compliance, or legal advice.
   3.5 The Software is not a security product: features such as trojan-download blocking, tracker blocking, and HTTPS upgrading rely on heuristic rules and cannot detect or block every threat. Do not rely on the Software in place of antivirus software, a firewall, or a professional security solution.

4. Third-Party Services (Important)
   4.1 Some features access third-party online services (DNS, WHOIS/RDAP, IP geolocation, certificate transparency logs, subdomain enumeration, exchange rates, breach lookup, public IP, etc.). These requests are sent only when you actively trigger them, and their destination is determined by the built-in provider or by an endpoint you configure yourself.
   4.2 When using these features you must also comply with the terms of use, rate limits, and data policies of the relevant third-party services. Any consequences of your breach of those terms are your responsibility.
   4.3 If you configure the Service Endpoint as a self-hosted or third-party address, that service's availability, security, data handling, and legality are your responsibility or that of its provider, not the developer's.

5. Disclaimer
   5.1 The Software is provided on an "AS IS" and "AS AVAILABLE" basis, without any express or implied warranty, including but not limited to warranties of merchantability, fitness for a particular purpose, accuracy, non-infringement, and uninterrupted operation.
   5.2 To the maximum extent permitted by applicable law, the developer shall not be liable for any direct, indirect, incidental, special, punitive, or consequential damages arising from the use of, or inability to use, the Software, including but not limited to data loss, business interruption, loss of profits, device damage, or information disclosure.
   5.3 Third-party data accessed by the Software is provided by its respective sources; the developer makes no warranty as to its accuracy, completeness, timeliness, or legality.
   5.4 The Software is not affiliated with, sponsored by, or endorsed by any website, service, or organization it accesses, tests, or queries, nor by browser vendors such as Mozilla or Google.
   5.5 Where applicable law does not allow the exclusion or limitation of certain warranties or liabilities, the above exclusions and limitations apply to the maximum extent permitted by law and do not apply to liabilities that cannot be excluded by law.

6. Limitation of Liability
   To the maximum extent permitted by applicable law, the developer's total aggregate liability to you under this agreement or in connection with the Software shall not exceed the amount you actually paid to obtain the Software (the Software is provided free of charge, so that amount is zero).

7. Indemnification
   If your use of the Software in violation of this agreement or applicable law gives rise to any third-party claim, action, or demand, or causes loss to the developer (including reasonable attorneys' fees), you shall bear full responsibility and indemnify the developer against all resulting losses, costs, and expenses.

8. User Data and Privacy
   8.1 The Software does not proactively collect or upload your personal data to any server controlled by the developer. Settings, history, clipboard contents, and similar data are stored locally in your browser by default, and you may export or clear them at any time from the settings page.
   8.2 Tools such as the resource sniffer, cookie manager, and storage manager run locally only and do not send data to external servers.
   8.3 Tools with network capability contact the relevant Service Endpoint only when you actively trigger them; the content and destination of those requests depend on your configuration.

9. Changes to This Agreement
   9.1 The developer may revise this agreement due to legal changes or feature adjustments. A revised version takes effect once published in the Official Version.
   9.2 If you disagree with a revision, you may stop using the Software; continued use constitutes acceptance of the revised agreement.

10. Miscellaneous
   10.1 If any provision of this agreement is held invalid or unenforceable, it shall be modified to the extent permitted by law to reflect its original intent as closely as possible, and the remaining provisions shall remain in effect.
   10.2 This agreement constitutes the entire agreement between you and the developer regarding use of the Official Version and supersedes any prior communications or representations; use of the source code is governed by the MIT License.
   10.3 Section headings are for convenience only and do not affect the interpretation of any provision.
   10.4 Any dispute arising from this agreement shall first be resolved through friendly negotiation, and may also be raised through the feedback channel published on the project homepage. This agreement does not designate the courts of any particular jurisdiction, nor does it waive any mandatory rights you may have under applicable law.

[Notice] If you are a minor, please use the Software only with the consent of your parent or legal guardian. By using the Software you confirm that you have read and accepted all of the terms above.
`;

// ==================== 语言包 ====================

const TRANSLATIONS = {
  'zh-CN': {
    // 通用
    'app.name': 'ToolCube',

    // 设置 - 常规
    'settings.general': '常规设置',
    'settings.tools': '工具管理',
    'settings.shortcuts': '快捷键',
    'settings.data': '数据管理',
    'settings.about': '关于',
    'settings.theme': '主题',
    'settings.language': '语言',
    'settings.sidebarPosition': '侧边栏位置',
    'settings.sidebarWidth': '侧边栏宽度',
    'settings.autoSave': '自动保存工具输入内容',
    'settings.notifications': '显示操作通知',
    'settings.floatingBtn': '显示便捷悬浮按钮',

    // 设置 - 主题选项
    'theme.light': '浅色',
    'theme.dark': '深色',
    'theme.auto': '跟随系统',

    // 设置 - 位置选项
    'position.right': '右侧',
    'position.left': '左侧',

    // 设置 - 通用按钮
    'btn.save': '保存设置',
    'btn.reset': '恢复默认',
    'btn.saveChanges': '保存更改',
    'btn.resetTools': '恢复默认',

    // 设置 - 数据管理
    'data.export': '导出数据',
    'data.exportDesc': '将所有设置和历史记录导出为文件',
    'data.import': '导入数据',
    'data.importDesc': '从文件导入设置和历史记录',
    'data.clear': '清除所有数据',
    'data.clearDesc': '删除所有设置、历史记录和缓存',
    'data.exportSuccess': '✅ 数据已导出',
    'data.exportFail': '❌ 导出失败',
    'data.importSuccess': '✅ 数据已导入',
    'data.importFail': '❌ 导入失败',
    'data.clearSuccess': '✅ 数据已清除',
    'data.clearFail': '❌ 清除失败',
    'data.loadFail': '加载设置失败',
    'data.saveFail': '保存失败',

    // 设置 - 关于
    'about.version': '版本',
    'about.desc': '一款功能强大的浏览器扩展，整合了多种高频实用工具，涵盖文本处理、编码解码、数据格式、设计视觉、网络工具、元素检查、金融换算等多个领域。',
    'about.features': '功能特点',
    'about.feature1': '实用工具，涵盖文本处理、编码解码、数据格式化、设计视觉、网络工具、元素检查',
    'about.feature2': '纯本地运行，保护您的隐私',
    'about.feature3': '浮动侧边栏设计，随时随地调用',
    'about.feature4': '支持快捷键、收藏夹、分类折叠、历史记录',
    'about.feature5': '深色 / 浅色主题切换',
    'about.feature6': '视频倍速控制器，支持几乎所有网页视频',
    'about.feature7': '图形化元素检查器，轻松查看和修改 DOM',
    'about.feature8': '银狐木马下载拦截、追踪器屏蔽、HTTPS 强制升级',
    'about.feature9': '多浏览器兼容：Chrome / Edge / Firefox / Kiwi 等',
    'about.feedback': '问题反馈',
    'about.openSource': '开源声明',
    'about.openSourceDesc': '本扩展遵循相关开源协议发布。所有数据处理均在本地完成，不收集任何用户隐私数据。部分在线功能（IP查询、汇率换算等）仅在用户主动触发时访问公开API。',
    'about.shortcutsTip': '💡 提示：快捷键可在浏览器的扩展快捷键设置中自定义',
    'about.openShortcuts': '打开快捷键设置',

    // 设置 - 关于页面
    'about.extName': 'ToolCube',
    'about.pureLocal': '纯本地运行，保护隐私',

    // 快捷键
    'shortcuts.openSidebar': '打开 / 关闭侧边栏',
    'shortcuts.openSidebarDesc': '在任何页面快速打开侧边栏',
    'shortcuts.quickSearch': '快速搜索',
    'shortcuts.quickSearchDesc': '直接聚焦到搜索框',
    'shortcuts.openPopup': '打开弹出菜单',
    'shortcuts.openPopupDesc': '打开插件弹出窗口',

    // 侧边栏
    'sidebar.search': '搜索工具...',
    'sidebar.all': '全部',
    'sidebar.favorites': '收藏',
    'sidebar.recent': '最近使用',
    'sidebar.noFavorites': '暂无收藏',
    'sidebar.noRecent': '暂无最近使用',
    'sidebar.settings': '设置',
    'sidebar.close': '关闭',

    // 分类
    'category.text': '文本处理',
    'category.encoding': '编码转换',
    'category.data': '数据格式化',
    'category.design': '设计工具',
    'category.network': '网络工具',
    'category.devtools': '网页开发',
    'category.geek': '极客工具',
    'category.daily': '日常效率',
    'category.security': '安全工具',

    // 操作反馈
    'toast.settingsSaved': '✅ 设置已保存',
    'toast.settingsReset': '已恢复默认设置',
    'toast.toolsSaved': '✅ 工具状态已保存',

    // 弹出菜单
    'popup.openSidebar': '打开侧边栏',
    'popup.quickSearch': '快速搜索',
    'popup.allTools': '所有工具',
    'popup.noResults': '未找到匹配的工具',
    'popup.options': '设置',
    'popup.help': '帮助',

    // 用户协议
    'terms.title': '用户协议',
    'terms.subtitle': '使用前请阅读并同意以下协议条款',
    'terms.agree': '同意',
    'terms.disagree': '不同意',
    'terms.notice': '点击「不同意」将无法使用本扩展程序',
    'terms.scrollHint': '请向下滚动阅读完整协议',

    // 锁定屏幕
    'locked.title': '未同意用户协议',
    'locked.desc': '您需要先同意用户协议才能使用本扩展程序',
    'locked.btn': '阅读并同意协议',

    // 语言

    // 空状态

    // 确认
    'confirm.clearAll': '确定要清除所有数据吗？此操作不可恢复！',

    // 工具管理
    'tools.managerDesc': '启用或禁用工具，拖拽调整顺序',
    'tools.enabled': '已启用',

    // 本轮补充：设置页 / 侧边栏 / 弹窗的界面文案
    'settings.services': '服务端点',
    'settings.appearance': '外观',
    'settings.behavior': '行为',
    'settings.pageTitle': 'ToolCube - 设置',
    'services.desc': '本扩展中需要联网的功能（DNS 查询、WHOIS、IP 归属地、证书透明度、子域名枚举、汇率、泄露查询等）都通过下列「服务端点」访问外部服务。你可以把任意一类指向自己的服务器，或更换为其他服务商 —— 无需修改任何代码。',
    'services.noteBody': '如何接入自建服务：在对应类别的「服务商」中选择「自定义服务（自建 / 自托管）」，然后填写你的服务地址（支持 {name}、{type} 等占位符），你的服务只需返回该类别的归一化 JSON 结构即可。',
    'services.noteAdapters': '（含各类别的参数说明、返回结构，以及可直接部署的示例适配器）',
    'services.docsLink': '自建服务接入指南',
    'services.loading': '正在加载服务端点配置…',
    'services.save': '保存服务端点',
    'services.reset': '全部恢复默认',
    'services.loadFail': '无法加载服务端点配置，请重新打开设置页',
    'services.loadFailPrefix': '加载失败: ',
    'services.saveOk': '✅ 服务端点已保存',
    'services.saveFailPrefix': '保存失败: ',
    'services.resetConfirm': '确定将全部服务端点恢复为默认服务商？已填写的自建地址与 API Key 将被清除。',
    'services.resetOk': '✅ 已恢复默认服务端点',
    'services.resetFail': '恢复失败',
    'about.feedbackLink': '提交 Issue / 查看项目主页',
    'data.exportAction': '导出',
    'data.importAction': '导入',
    'data.clearAction': '清除',
    'data.importInvalidJson': '导入失败：无效的 JSON 格式',
    'data.importBadShape': '导入失败：数据格式不正确，期望对象结构',
    'toast.toolsLoadFail': '加载工具列表失败',
    'toast.toolsResetOk': '✅ 已恢复默认工具',
    'toast.toolsResetFail': '重置失败',
    'toast.unknownError': '未知错误',
    'sidebar.clearSearch': '清除搜索',
    'sidebar.enabledSection': '已开启的功能',
    'sidebar.toolName': '工具名称',
    'sidebar.favorite': '收藏',
    'sidebar.history': '历史记录',
    'sidebar.ready': '就绪',
    'sidebar.clearHistory': '清空历史',
    'history.empty': '暂无历史记录',
    'sidebar.usingTool': '正在使用: ',
    'masterSwitch.label': '全局开关',
    'masterSwitch.on': '全局开关已开启',
    'masterSwitch.off': '全局开关已关闭',
    'popup.toggleTheme': '切换主题',
    'popup.internalPageUnsupported': '浏览器内部页面不支持，请切换到普通网页',
    'popup.cannotOpenSidebar': '无法在当前页面打开侧边栏',
    'popup.cannotOpenSearch': '无法打开搜索',
    'masterSwitch.disabledHint': '全局开关已关闭，请先开启扩展',
    'toast.addedFav': '已添加到收藏',
    'toast.removedFav': '已取消收藏',
    'toast.historyLoadFail': '加载历史记录失败',
    'toast.historyCleared': '历史记录已清空',
    'toast.historyClearFail': '清空历史记录失败',
    'sidebar.noSearchResult': '未找到匹配的工具',
    'sidebar.searchHint': '试试用工具名、分类名或拼音搜索',
    'sidebar.unnamed': '未命名',
    'sidebar.unfavorite': '⭐ 取消收藏',
    'sidebar.addFavorite': '⭐ 添加收藏',
    'sidebar.openInNewTab': '🔗 在新标签页打开',
    'confirm.clearToolHistory': '确定要清空该工具的所有历史记录吗？',
    'btn.cancel': '取消',
    'btn.confirmClear': '确认清空',
    'time.justNow': '刚刚',
    'time.minutesAgo': '{n}分钟前',
    'time.hoursAgo': '{n}小时前',
    'time.daysAgo': '{n}天前',
    'services.providerDoc': '服务说明 ↗',
    'services.testBtn': '保存并测试',
    'services.fieldProvider': '服务商',
    'services.fieldResultSchema': '返回结构：',
    'services.clientOnlyHint': '客户端直连：不通过 HTTP 请求，因此无「保存并测试」。',
    'services.testing': '⏳ 正在保存并测试…',
    'services.testSaveFail': '❌ 保存失败，未执行测试',
    'services.testOk': '✅ 连接成功（服务商：{provider}，耗时 {ms}ms）',
    'services.testFail': '❌ 测试失败：',
    'services.unknownProvider': '未知',
    'popup.cannotOpenTool': '无法在当前页面打开工具',
    'serviceKind.dns.label': 'DNS 查询（DoH）',
    'serviceKind.dns.desc': '通过 DNS over HTTPS 查询 A/AAAA/MX/TXT 等记录，并可用于 DNS 传播与 DNSSEC 检测。',
    'serviceKind.whois.label': 'WHOIS / RDAP 查询',
    'serviceKind.whois.desc': '查询域名注册信息（注册商、注册/到期时间、域名服务器、状态）。',
    'serviceKind.ipGeo.label': 'IP 归属地',
    'serviceKind.ipGeo.desc': '查询 IP 的地理位置与运营商信息；不传 IP 时查询本机公网 IP。',
    'serviceKind.ct.label': '证书透明度日志（CT）',
    'serviceKind.ct.desc': '查询证书透明度日志，用于了解某个域名签发过哪些证书。',
    'serviceKind.subdomain.label': '子域名枚举',
    'serviceKind.subdomain.desc': '通过证书透明度日志等公开数据源枚举子域名。',
    'serviceKind.currency.label': '汇率',
    'serviceKind.currency.desc': '获取以某个基准货币计价的汇率表。',
    'serviceKind.breach.label': '密码 / 邮箱泄露查询',
    'serviceKind.breach.desc': '密码采用 k-匿名模型（仅上传 SHA-1 前 5 位）；邮箱查询需要 API Key。',
    'serviceKind.publicIp.label': '公网 IP 查询',
    'serviceKind.publicIp.desc': '获取本机出口公网 IP。',
    'serviceKind.ssl.label': 'SSL/TLS 深度评级',
    'serviceKind.ssl.desc': '由外部服务对目标域名做完整 TLS 握手与配置评分（协议版本、加密套件、证书链、已知漏洞）。',
    'serviceKind.portScan.label': '端口扫描（服务端视角）',
    'serviceKind.portScan.desc': '由外部服务从公网视角扫描目标主机的开放端口，用于浏览器无法直连的场景。',
    'serviceKind.proxy.label': 'HTTP 转发代理',
    'serviceKind.proxy.desc': '把完整的目标 URL 交给代理服务转发，用于绕过页面 CORS 限制，或让请求从你自己的出口 IP 发出。',
    'serviceKind.readability.label': '正文提取（服务端）',
    'serviceKind.readability.desc': '由外部服务抓取页面并抽取正文，用于把文章保存为 Markdown。',
    'serviceKind.screenshot.label': '网页截图（服务端渲染）',
    'serviceKind.screenshot.desc': '由外部服务渲染并截图任意 URL（可整页）。用于截取非当前标签页，或需要完整页面高度的场景。',
    'serviceKind.stun.label': 'STUN 服务器（WebRTC 检测）',
    'serviceKind.stun.desc': '用于探测 WebRTC 是否会泄露真实 IP；客户端直连的 UDP 服务，可指向自建 coturn / STUN。',
    'serviceKind.urlScan.label': 'URL 安全检测',
    'serviceKind.urlScan.desc': '查询某个 URL 是否被安全社区举报过（钓鱼、恶意软件分发等）。用于短链展开后判断目标是否可信。',
    'serviceKind.webArchive.label': '网页归档快照',
    'serviceKind.webArchive.desc': '查询网页在互联网档案馆（Wayback Machine）中的历史快照，用于判断站点存在时长或获取历史版本。',
    'serviceKind.ipReputation.label': 'IP 信誉查询',
    'serviceKind.ipReputation.desc': '查询 IP 是否被观测到扫描、暴力破解等恶意活动，辅助判断访问来源风险。',
    'serviceField.baseUrl': '服务地址',
    'serviceField.apiKey': 'API Token（可选）',
    'serviceField.emailBaseUrl': '邮箱查询地址',
    'serviceProvider.custom.label': '自定义服务（自建 / 自托管）',
    'serviceProvider.whois.rdap.label': 'RDAP.org（标准 RDAP）',
    'serviceProvider.dns.alibaba.label': '阿里公共 DNS',
    'serviceProvider.subdomain.crt-sh.label': 'crt.sh（证书透明度日志）',
    'serviceProvider.currency.frankfurter.label': 'Frankfurter (ECB 数据)',
  },

  'zh-TW': {
    // 通用
    'app.name': 'ToolCube',

    // 設置 - 常規
    'settings.general': '常規設置',
    'settings.tools': '工具管理',
    'settings.shortcuts': '快捷鍵',
    'settings.data': '資料管理',
    'settings.about': '關於',
    'settings.theme': '主題',
    'settings.language': '語言',
    'settings.sidebarPosition': '側邊欄位置',
    'settings.sidebarWidth': '側邊欄寬度',
    'settings.autoSave': '自動儲存工具輸入內容',
    'settings.notifications': '顯示操作通知',
    'settings.floatingBtn': '顯示便捷懸浮按鈕',

    // 設置 - 主題選項
    'theme.light': '淺色',
    'theme.dark': '深色',
    'theme.auto': '跟隨系統',

    // 設置 - 位置選項
    'position.right': '右側',
    'position.left': '左側',

    // 設置 - 通用按鈕
    'btn.save': '儲存設定',
    'btn.reset': '恢復預設',
    'btn.saveChanges': '儲存更改',
    'btn.resetTools': '恢復預設',

    // 設置 - 資料管理
    'data.export': '匯出資料',
    'data.exportDesc': '將所有設定和歷史記錄匯出為檔案',
    'data.import': '匯入資料',
    'data.importDesc': '從檔案匯入設定和歷史記錄',
    'data.clear': '清除所有資料',
    'data.clearDesc': '刪除所有設定、歷史記錄和快取',
    'data.exportSuccess': '✅ 資料已匯出',
    'data.exportFail': '❌ 匯出失敗',
    'data.importSuccess': '✅ 資料已匯入',
    'data.importFail': '❌ 匯入失敗',
    'data.clearSuccess': '✅ 資料已清除',
    'data.clearFail': '❌ 清除失敗',
    'data.loadFail': '載入設定失敗',
    'data.saveFail': '儲存失敗',

    // 設置 - 關於
    'about.version': '版本',
    'about.desc': '一款功能強大的瀏覽器擴充功能，整合了多種高頻實用工具，涵蓋文字處理、編碼解碼、資料格式、設計視覺、網路工具、元素檢查、金融換算等多個領域。',
    'about.features': '功能特點',
    'about.feature1': '實用工具，涵蓋文字處理、編碼解碼、資料格式化、設計視覺、網路工具、元素檢查',
    'about.feature2': '純本地運行，保護您的隱私',
    'about.feature3': '浮動側邊欄設計，隨時隨地呼叫',
    'about.feature4': '支援快捷鍵、收藏夾、分類折疊、歷史記錄',
    'about.feature5': '深色 / 淺色主題切換',
    'about.feature6': '影片倍速控制器，支援幾乎所有網頁影片',
    'about.feature7': '圖形化元素檢查器，輕鬆檢視和修改 DOM',
    'about.feature8': '銀狐木馬下載攔截、追蹤器遮蔽、HTTPS 強制升級',
    'about.feature9': '多瀏覽器相容：Chrome / Edge / Firefox / Kiwi 等',
    'about.feedback': '問題回報',
    'about.openSource': '開源聲明',
    'about.openSourceDesc': '本擴展遵循相關開源協議發布。所有資料處理均在本地完成，不收集任何用戶隱私資料。部分線上功能（IP查詢、匯率換算等）僅在用戶主動觸發時存取公開API。',
    'about.shortcutsTip': '💡 提示：快捷鍵可在瀏覽器的擴充功能快速鍵設定中自訂',
    'about.openShortcuts': '打開快捷鍵設定',

    // 設置 - 關於頁面
    'about.extName': 'ToolCube',
    'about.pureLocal': '純本地運行，保護隱私',

    // 快捷鍵
    'shortcuts.openSidebar': '開啟 / 關閉側邊欄',
    'shortcuts.openSidebarDesc': '在任何頁面快速開啟側邊欄',
    'shortcuts.quickSearch': '快速搜尋',
    'shortcuts.quickSearchDesc': '直接聚焦到搜尋框',
    'shortcuts.openPopup': '開啟彈出選單',
    'shortcuts.openPopupDesc': '開啟插件彈出視窗',

    // 側邊欄
    'sidebar.search': '搜尋工具...',
    'sidebar.all': '全部',
    'sidebar.favorites': '收藏',
    'sidebar.recent': '最近使用',
    'sidebar.noFavorites': '暫無收藏',
    'sidebar.noRecent': '暫無最近使用',
    'sidebar.settings': '設定',
    'sidebar.close': '關閉',

    // 分類
    'category.text': '文字處理',
    'category.encoding': '編碼轉換',
    'category.data': '資料格式化',
    'category.design': '設計工具',
    'category.network': '網路工具',
    'category.devtools': '網頁開發',
    'category.geek': '極客工具',
    'category.daily': '日常效率',
    'category.security': '安全工具',

    // 操作反饋
    'toast.settingsSaved': '✅ 設定已儲存',
    'toast.settingsReset': '已恢復預設設定',
    'toast.toolsSaved': '✅ 工具狀態已儲存',

    // 彈出選單
    'popup.openSidebar': '開啟側邊欄',
    'popup.quickSearch': '快速搜尋',
    'popup.allTools': '所有工具',
    'popup.noResults': '未找到匹配的工具',
    'popup.options': '設定',
    'popup.help': '幫助',

    // 用戶協議
    'terms.title': '用戶協議',
    'terms.subtitle': '使用前請閱讀並同意以下協議條款',
    'terms.agree': '同意',
    'terms.disagree': '不同意',
    'terms.notice': '點擊「不同意」將無法使用本擴展程式',
    'terms.scrollHint': '請向下滾動閱讀完整協議',

    // 鎖定畫面
    'locked.title': '未同意用戶協議',
    'locked.desc': '您需要先同意用戶協議才能使用本擴展程式',
    'locked.btn': '閱讀並同意協議',

    // 語言

    // 空狀態

    // 確認
    'confirm.clearAll': '確定要清除所有資料嗎？此操作不可恢復！',

    // 工具管理
    'tools.managerDesc': '啟用或停用工具，拖曳調整順序',
    'tools.enabled': '已啟用',

    // 本輪補充：設定頁 / 側邊欄 / 彈窗的介面文案
    'settings.services': '服務端點',
    'settings.appearance': '外觀',
    'settings.behavior': '行為',
    'settings.pageTitle': 'ToolCube - 設定',
    'services.desc': '本擴充功能中需要連網的功能（DNS 查詢、WHOIS、IP 歸屬地、憑證透明度、子網域列舉、匯率、洩漏查詢等）都透過下列「服務端點」存取外部服務。你可以把任意一類指向自己的伺服器，或更換為其他服務商 —— 無需修改任何程式碼。',
    'services.noteBody': '如何接入自建服務：在對應類別的「服務商」中選擇「自訂服務（自建 / 自託管）」，然後填寫你的服務位址（支援 {name}、{type} 等佔位符），你的服務只需回傳該類別的標準化 JSON 結構即可。',
    'services.noteAdapters': '（含各類別的參數說明、回傳結構，以及可直接部署的範例轉接器）',
    'services.docsLink': '自建服務接入指南',
    'services.loading': '正在載入服務端點設定…',
    'services.save': '儲存服務端點',
    'services.reset': '全部恢復預設',
    'services.loadFail': '無法載入服務端點設定，請重新開啟設定頁',
    'services.loadFailPrefix': '載入失敗: ',
    'services.saveOk': '✅ 服務端點已儲存',
    'services.saveFailPrefix': '儲存失敗: ',
    'services.resetConfirm': '確定將全部服務端點恢復為預設服務商？已填寫的自建位址與 API Key 將被清除。',
    'services.resetOk': '✅ 已恢復預設服務端點',
    'services.resetFail': '恢復失敗',
    'about.feedbackLink': '提交 Issue / 查看專案首頁',
    'data.exportAction': '匯出',
    'data.importAction': '匯入',
    'data.clearAction': '清除',
    'data.importInvalidJson': '匯入失敗：無效的 JSON 格式',
    'data.importBadShape': '匯入失敗：資料格式不正確，期望物件結構',
    'toast.toolsLoadFail': '載入工具清單失敗',
    'toast.toolsResetOk': '✅ 已恢復預設工具',
    'toast.toolsResetFail': '重設失敗',
    'toast.unknownError': '未知錯誤',
    'sidebar.clearSearch': '清除搜尋',
    'sidebar.enabledSection': '已開啟的功能',
    'sidebar.toolName': '工具名稱',
    'sidebar.favorite': '收藏',
    'sidebar.history': '歷史記錄',
    'sidebar.ready': '就緒',
    'sidebar.clearHistory': '清空歷史',
    'history.empty': '暫無歷史記錄',
    'sidebar.usingTool': '正在使用: ',
    'masterSwitch.label': '全域開關',
    'masterSwitch.on': '全域開關已開啟',
    'masterSwitch.off': '全域開關已關閉',
    'popup.toggleTheme': '切換主題',
    'popup.internalPageUnsupported': '瀏覽器內部頁面不支援，請切換到一般網頁',
    'popup.cannotOpenSidebar': '無法在目前頁面開啟側邊欄',
    'popup.cannotOpenSearch': '無法開啟搜尋',
    'masterSwitch.disabledHint': '全域開關已關閉，請先開啟擴充功能',
    'toast.addedFav': '已加入收藏',
    'toast.removedFav': '已移除收藏',
    'toast.historyLoadFail': '載入歷史記錄失敗',
    'toast.historyCleared': '歷史記錄已清空',
    'toast.historyClearFail': '清空歷史記錄失敗',
    'sidebar.noSearchResult': '找不到相符的工具',
    'sidebar.searchHint': '試試用工具名稱、分類名稱或拼音搜尋',
    'sidebar.unnamed': '未命名',
    'sidebar.unfavorite': '⭐ 取消收藏',
    'sidebar.addFavorite': '⭐ 加入收藏',
    'sidebar.openInNewTab': '🔗 在新分頁開啟',
    'confirm.clearToolHistory': '確定要清空此工具的所有歷史記錄嗎？',
    'btn.cancel': '取消',
    'btn.confirmClear': '確認清空',
    'time.justNow': '剛剛',
    'time.minutesAgo': '{n} 分鐘前',
    'time.hoursAgo': '{n} 小時前',
    'time.daysAgo': '{n} 天前',
    'services.providerDoc': '服務說明 ↗',
    'services.testBtn': '儲存並測試',
    'services.fieldProvider': '服務商',
    'services.fieldResultSchema': '回傳結構：',
    'services.clientOnlyHint': '用戶端直連：不透過 HTTP 請求，因此無「儲存並測試」。',
    'services.testing': '⏳ 正在儲存並測試…',
    'services.testSaveFail': '❌ 儲存失敗，未執行測試',
    'services.testOk': '✅ 連線成功（服務商：{provider}，耗時 {ms}ms）',
    'services.testFail': '❌ 測試失敗：',
    'services.unknownProvider': '未知',
    'popup.cannotOpenTool': '無法在目前頁面開啟工具',
    'serviceKind.dns.label': 'DNS 查詢（DoH）',
    'serviceKind.dns.desc': '透過 DNS over HTTPS 查詢 A/AAAA/MX/TXT 等記錄，並可用於 DNS 傳播與 DNSSEC 檢測。',
    'serviceKind.whois.label': 'WHOIS / RDAP 查詢',
    'serviceKind.whois.desc': '查詢網域註冊資訊（註冊商、註冊/到期時間、名稱伺服器、狀態）。',
    'serviceKind.ipGeo.label': 'IP 歸屬地',
    'serviceKind.ipGeo.desc': '查詢 IP 的地理位置與電信商資訊；未提供 IP 時查詢本機公網 IP。',
    'serviceKind.ct.label': '憑證透明度日誌（CT）',
    'serviceKind.ct.desc': '查詢憑證透明度日誌，用於了解某個網域簽發過哪些憑證。',
    'serviceKind.subdomain.label': '子網域列舉',
    'serviceKind.subdomain.desc': '透過憑證透明度日誌等公開資料來源列舉子網域。',
    'serviceKind.currency.label': '匯率',
    'serviceKind.currency.desc': '取得以某個基準貨幣計價的匯率表。',
    'serviceKind.breach.label': '密碼 / 信箱洩漏查詢',
    'serviceKind.breach.desc': '密碼採用 k-匿名模型（僅上傳 SHA-1 前 5 位）；信箱查詢需要 API Key。',
    'serviceKind.publicIp.label': '公網 IP 查詢',
    'serviceKind.publicIp.desc': '取得本機出口公網 IP。',
    'serviceKind.ssl.label': 'SSL/TLS 深度評級',
    'serviceKind.ssl.desc': '由外部服務對目標網域做完整 TLS 握手與設定評分（協定版本、加密套件、憑證鏈、已知漏洞）。',
    'serviceKind.portScan.label': '連接埠掃描（伺服器端視角）',
    'serviceKind.portScan.desc': '由外部服務從公網視角掃描目標主機的開放連接埠，用於瀏覽器無法直連的場景。',
    'serviceKind.proxy.label': 'HTTP 轉發代理',
    'serviceKind.proxy.desc': '把完整的目標 URL 交給代理服務轉發，用於繞過頁面 CORS 限制，或讓請求從你自己的出口 IP 發出。',
    'serviceKind.readability.label': '正文擷取（伺服器端）',
    'serviceKind.readability.desc': '由外部服務抓取頁面並擷取正文，用於把文章儲存為 Markdown。',
    'serviceKind.screenshot.label': '網頁截圖（伺服器端渲染）',
    'serviceKind.screenshot.desc': '由外部服務渲染並截圖任意 URL（可整頁）。用於截取非目前分頁，或需要完整頁面高度的場景。',
    'serviceKind.stun.label': 'STUN 伺服器（WebRTC 檢測）',
    'serviceKind.stun.desc': '用於探測 WebRTC 是否會洩漏真實 IP；用戶端直連的 UDP 服務，可指向自建 coturn / STUN。',
    'serviceKind.urlScan.label': 'URL 安全檢測',
    'serviceKind.urlScan.desc': '查詢某個 URL 是否被安全社群檢舉過（釣魚、惡意軟體散佈等）。用於短連結展開後判斷目標是否可信。',
    'serviceKind.webArchive.label': '網頁封存快照',
    'serviceKind.webArchive.desc': '查詢網頁在網際網路檔案館（Wayback Machine）中的歷史快照，用於判斷站點存在時長或取得歷史版本。',
    'serviceKind.ipReputation.label': 'IP 信譽查詢',
    'serviceKind.ipReputation.desc': '查詢 IP 是否被觀測到掃描、暴力破解等惡意活動，輔助判斷存取來源風險。',
    'serviceField.baseUrl': '服務位址',
    'serviceField.apiKey': 'API Token（選填）',
    'serviceField.emailBaseUrl': '信箱查詢位址',
    'serviceProvider.custom.label': '自訂服務（自建 / 自託管）',
    'serviceProvider.whois.rdap.label': 'RDAP.org（標準 RDAP）',
    'serviceProvider.dns.alibaba.label': '阿里公共 DNS',
    'serviceProvider.subdomain.crt-sh.label': 'crt.sh（憑證透明度日誌）',
    'serviceProvider.currency.frankfurter.label': 'Frankfurter (ECB 資料)',
  },

  'en': {
    // General
    'app.name': 'ToolCube',

    // Settings - General
    'settings.general': 'General',
    'settings.tools': 'Tools',
    'settings.shortcuts': 'Shortcuts',
    'settings.data': 'Data',
    'settings.about': 'About',
    'settings.theme': 'Theme',
    'settings.language': 'Language',
    'settings.sidebarPosition': 'Sidebar Position',
    'settings.sidebarWidth': 'Sidebar Width',
    'settings.autoSave': 'Auto-save tool input',
    'settings.notifications': 'Show notifications',
    'settings.floatingBtn': 'Show floating button',

    // Settings - Theme
    'theme.light': 'Light',
    'theme.dark': 'Dark',
    'theme.auto': 'Follow system',

    // Settings - Position
    'position.right': 'Right',
    'position.left': 'Left',

    // Settings - Buttons
    'btn.save': 'Save Settings',
    'btn.reset': 'Reset to Default',
    'btn.saveChanges': 'Save Changes',
    'btn.resetTools': 'Reset to Default',

    // Settings - Data
    'data.export': 'Export Data',
    'data.exportDesc': 'Export all settings and history to a file',
    'data.import': 'Import Data',
    'data.importDesc': 'Import settings and history from a file',
    'data.clear': 'Clear All Data',
    'data.clearDesc': 'Delete all settings, history, and cache',
    'data.exportSuccess': '✅ Data exported',
    'data.exportFail': '❌ Export failed',
    'data.importSuccess': '✅ Data imported',
    'data.importFail': '❌ Import failed',
    'data.clearSuccess': '✅ Data cleared',
    'data.clearFail': '❌ Clear failed',
    'data.loadFail': 'Failed to load settings',
    'data.saveFail': 'Failed to save',

    // Settings - About
    'about.version': 'Version',
    'about.desc': 'A powerful browser extension integrating a wide range of practical tools, covering text processing, encoding/decoding, data formatting, design, network tools, element inspection, financial conversion, and more.',
    'about.features': 'Features',
    'about.feature1': 'Practical tools: text processing, encoding, data formatting, design, network, element inspection',
    'about.feature2': 'Pure local execution, protecting your privacy',
    'about.feature3': 'Floating sidebar, available anytime',
    'about.feature4': 'Shortcuts, favorites, collapsible categories, history',
    'about.feature5': 'Dark / Light theme switching',
    'about.feature6': 'Video speed controller for nearly all websites',
    'about.feature7': 'Visual DOM inspector and editor',
    'about.feature8': 'Silver Fox trojan blocker, tracker shield, HTTPS enforcer',
    'about.feature9': 'Multi-browser support: Chrome / Edge / Firefox / Kiwi',
    'about.feedback': 'Feedback',
    'about.openSource': 'Open Source',
    'about.openSourceDesc': 'This extension is released under open source licenses. All data processing is done locally — no user privacy data is collected. Some online features (IP lookup, currency conversion) only access public APIs when actively triggered.',
    'about.shortcutsTip': '💡 Tip: shortcuts can be customized in your browser\'s extension shortcut settings',
    'about.openShortcuts': 'Open Shortcuts Settings',

    // About Page
    'about.extName': 'ToolCube',
    'about.pureLocal': 'Pure local, privacy-safe',

    // Shortcuts
    'shortcuts.openSidebar': 'Open / Close Sidebar',
    'shortcuts.openSidebarDesc': 'Quickly open the sidebar on any page',
    'shortcuts.quickSearch': 'Quick Search',
    'shortcuts.quickSearchDesc': 'Direct focus to the search bar',
    'shortcuts.openPopup': 'Open Popup',
    'shortcuts.openPopupDesc': 'Open the extension popup',

    // Sidebar
    'sidebar.search': 'Search tools...',
    'sidebar.all': 'All',
    'sidebar.favorites': 'Favorites',
    'sidebar.recent': 'Recent',
    'sidebar.noFavorites': 'No favorites yet',
    'sidebar.noRecent': 'No recent items',
    'sidebar.settings': 'Settings',
    'sidebar.close': 'Close',

    // Categories
    'category.text': 'Text Tools',
    'category.encoding': 'Encoding',
    'category.data': 'Data Tools',
    'category.design': 'Design',
    'category.network': 'Network',
    'category.devtools': 'Dev Tools',
    'category.geek': 'Geek Tools',
    'category.daily': 'Daily Tools',
    'category.security': 'Security Tools',

    // Feedback
    'toast.settingsSaved': '✅ Settings saved',
    'toast.settingsReset': 'Settings reset to default',
    'toast.toolsSaved': '✅ Tools status saved',

    // Popup
    'popup.openSidebar': 'Open Sidebar',
    'popup.quickSearch': 'Quick Search',
    'popup.allTools': 'All Tools',
    'popup.noResults': 'No matching tools',
    'popup.options': 'Settings',
    'popup.help': 'Help',

    // Terms
    'terms.title': 'Terms of Service',
    'terms.subtitle': 'Please read and agree to the following terms before using',
    'terms.agree': 'Agree',
    'terms.disagree': 'Disagree',
    'terms.notice': 'Clicking "Disagree" will prevent you from using this extension',
    'terms.scrollHint': 'Please scroll down to read the full agreement',

    // Locked screen
    'locked.title': 'Terms of Service Not Accepted',
    'locked.desc': 'You must accept the Terms of Service to use this extension',
    'locked.btn': 'Read & Accept Terms',

    // Language

    // Empty

    // Confirm
    'confirm.clearAll': 'Are you sure you want to clear all data? This cannot be undone!',

    // Tools Manager
    'tools.managerDesc': 'Enable or disable tools',
    'tools.enabled': 'Enabled',

    // Added this round: settings / sidebar / popup UI strings
    'settings.services': 'Service Endpoints',
    'settings.appearance': 'Appearance',
    'settings.behavior': 'Behavior',
    'settings.pageTitle': 'ToolCube - Settings',
    'services.desc': 'Features that need network access (DNS lookup, WHOIS, IP geolocation, certificate transparency, subdomain enumeration, exchange rates, breach lookup, etc.) reach external services through the Service Endpoints below. You can point any category at your own server, or switch to another provider — without changing any code.',
    'services.noteBody': 'To use a self-hosted service: pick "Custom service (self-hosted)" for that category, then enter your service URL (placeholders such as {name} and {type} are supported). Your service only needs to return the normalized JSON structure for that category.',
    'services.noteAdapters': '(parameter descriptions, response structures, and a deployable example adapter)',
    'services.docsLink': 'Self-hosting guide',
    'services.loading': 'Loading service endpoint configuration…',
    'services.save': 'Save endpoints',
    'services.reset': 'Reset all to defaults',
    'services.loadFail': 'Failed to load service endpoint configuration. Please reopen the settings page.',
    'services.loadFailPrefix': 'Load failed: ',
    'services.saveOk': '✅ Service endpoints saved',
    'services.saveFailPrefix': 'Save failed: ',
    'services.resetConfirm': 'Reset all service endpoints to the default providers? Any self-hosted URLs and API keys you entered will be cleared.',
    'services.resetOk': '✅ Service endpoints reset to defaults',
    'services.resetFail': 'Reset failed',
    'about.feedbackLink': 'Submit an issue / view project homepage',
    'data.exportAction': 'Export',
    'data.importAction': 'Import',
    'data.clearAction': 'Clear',
    'data.importInvalidJson': 'Import failed: invalid JSON',
    'data.importBadShape': 'Import failed: unexpected data shape (object expected)',
    'toast.toolsLoadFail': 'Failed to load the tool list',
    'toast.toolsResetOk': '✅ Tools reset to defaults',
    'toast.toolsResetFail': 'Reset failed',
    'toast.unknownError': 'Unknown error',
    'sidebar.clearSearch': 'Clear search',
    'sidebar.enabledSection': 'Active features',
    'sidebar.toolName': 'Tool name',
    'sidebar.favorite': 'Favorite',
    'sidebar.history': 'History',
    'sidebar.ready': 'Ready',
    'sidebar.clearHistory': 'Clear history',
    'history.empty': 'No history yet',
    'sidebar.usingTool': 'Using: ',
    'masterSwitch.label': 'Master switch',
    'masterSwitch.on': 'Master switch enabled',
    'masterSwitch.off': 'Master switch disabled',
    'popup.toggleTheme': 'Toggle theme',
    'popup.internalPageUnsupported': 'Browser internal pages are not supported. Please switch to a regular web page.',
    'popup.cannotOpenSidebar': 'Cannot open the sidebar on this page',
    'popup.cannotOpenSearch': 'Cannot open search',
    'masterSwitch.disabledHint': 'The master switch is off. Please enable the extension first.',
    'toast.addedFav': 'Added to favorites',
    'toast.removedFav': 'Removed from favorites',
    'toast.historyLoadFail': 'Failed to load history',
    'toast.historyCleared': 'History cleared',
    'toast.historyClearFail': 'Failed to clear history',
    'sidebar.noSearchResult': 'No matching tools',
    'sidebar.searchHint': 'Try a tool name, category, or pinyin',
    'sidebar.unnamed': 'Untitled',
    'sidebar.unfavorite': '⭐ Remove from favorites',
    'sidebar.addFavorite': '⭐ Add to favorites',
    'sidebar.openInNewTab': '🔗 Open in new tab',
    'confirm.clearToolHistory': 'Clear all history for this tool?',
    'btn.cancel': 'Cancel',
    'btn.confirmClear': 'Clear',
    'time.justNow': 'just now',
    'time.minutesAgo': '{n} min ago',
    'time.hoursAgo': '{n} h ago',
    'time.daysAgo': '{n} d ago',
    'services.providerDoc': 'Provider docs ↗',
    'services.testBtn': 'Save & test',
    'services.fieldProvider': 'Provider',
    'services.fieldResultSchema': 'Response shape: ',
    'services.clientOnlyHint': 'Client-side connection: no HTTP request, so there is no "save & test".',
    'services.testing': '⏳ Saving and testing…',
    'services.testSaveFail': '❌ Save failed; test not run',
    'services.testOk': '✅ Connected (provider: {provider}, {ms} ms)',
    'services.testFail': '❌ Test failed: ',
    'services.unknownProvider': 'unknown',
    'popup.cannotOpenTool': 'Cannot open the tool on this page',
    'serviceKind.dns.label': 'DNS Lookup (DoH)',
    'serviceKind.dns.desc': 'Query A/AAAA/MX/TXT records over DNS-over-HTTPS; also used for DNS propagation and DNSSEC checks.',
    'serviceKind.whois.label': 'WHOIS / RDAP Lookup',
    'serviceKind.whois.desc': 'Look up domain registration data (registrar, creation/expiry dates, name servers, status).',
    'serviceKind.ipGeo.label': 'IP Geolocation',
    'serviceKind.ipGeo.desc': 'Look up IP geolocation and ISP information; queries your public IP when none is given.',
    'serviceKind.ct.label': 'Certificate Transparency (CT)',
    'serviceKind.ct.desc': 'Query Certificate Transparency logs to see which certificates were issued for a domain.',
    'serviceKind.subdomain.label': 'Subdomain Enumeration',
    'serviceKind.subdomain.desc': 'Enumerate subdomains via Certificate Transparency logs and other public sources.',
    'serviceKind.currency.label': 'Exchange Rates',
    'serviceKind.currency.desc': 'Fetch an exchange-rate table based on a given base currency.',
    'serviceKind.breach.label': 'Password / Email Breach Lookup',
    'serviceKind.breach.desc': 'Passwords use the k-anonymity model (only the first 5 SHA-1 chars are sent); email lookup requires an API key.',
    'serviceKind.publicIp.label': 'Public IP Lookup',
    'serviceKind.publicIp.desc': 'Get your public egress IP address.',
    'serviceKind.ssl.label': 'SSL/TLS Deep Rating',
    'serviceKind.ssl.desc': 'An external service performs a full TLS handshake and configuration rating for the domain (protocol versions, cipher suites, certificate chain, known vulnerabilities).',
    'serviceKind.portScan.label': 'Port Scan (server-side view)',
    'serviceKind.portScan.desc': 'An external service scans the target host for open ports from the public internet, for cases the browser cannot reach directly.',
    'serviceKind.proxy.label': 'HTTP Forward Proxy',
    'serviceKind.proxy.desc': 'Hand a full target URL to a proxy service, to bypass page CORS restrictions or make the request leave from your own egress IP.',
    'serviceKind.readability.label': 'Article Extraction (server-side)',
    'serviceKind.readability.desc': 'An external service fetches the page and extracts the article body, for saving it as Markdown.',
    'serviceKind.screenshot.label': 'Page Screenshot (server-side render)',
    'serviceKind.screenshot.desc': 'An external service renders and screenshots any URL (optionally full page), for capturing tabs other than the current one or full-height pages.',
    'serviceKind.stun.label': 'STUN Server (WebRTC check)',
    'serviceKind.stun.desc': 'Used to detect whether WebRTC leaks your real IP. A client-side UDP service; can point to a self-hosted coturn / STUN.',
    'serviceKind.urlScan.label': 'URL Safety Check',
    'serviceKind.urlScan.desc': 'Check whether a URL has been reported by security communities (phishing, malware distribution, etc.), for judging a shortened link target.',
    'serviceKind.webArchive.label': 'Web Archive Snapshot',
    'serviceKind.webArchive.desc': 'Look up historical snapshots of a page in the Internet Archive (Wayback Machine), to gauge site age or retrieve an earlier version.',
    'serviceKind.ipReputation.label': 'IP Reputation',
    'serviceKind.ipReputation.desc': 'Check whether an IP has been observed scanning or brute-forcing, to help assess the risk of an access source.',
    'serviceField.baseUrl': 'Service URL',
    'serviceField.apiKey': 'API Token (optional)',
    'serviceField.emailBaseUrl': 'Email lookup URL',
    'serviceProvider.custom.label': 'Custom service (self-hosted)',
    'serviceProvider.whois.rdap.label': 'RDAP.org (standard RDAP)',
    'serviceProvider.dns.alibaba.label': 'Alibaba Public DNS',
    'serviceProvider.subdomain.crt-sh.label': 'crt.sh (CT logs)',
    'serviceProvider.currency.frankfurter.label': 'Frankfurter (ECB data)',
  }
};

// ==================== 协议导出 ====================

export const TERMS = {
  'zh-CN': TERMS_ZH_CN,
  'zh-TW': TERMS_ZH_TW,
  'en': TERMS_EN
};

// ==================== 简繁转换映射 ====================
// 覆盖常用字符（确保工具名称与描述在 zh-TW 模式下可读）
const SIMP_TO_TRAD = {
  '万': '萬', '与': '與', '严': '嚴', '个': '個', '中': '中', '为': '為', '举': '舉', '久': '久',
  '义': '義', '事': '事', '云': '雲', '产': '產', '享': '享', '亿': '億', '仅': '僅', '们': '們',
  '众': '眾', '优': '優', '会': '會', '传': '傳', '伪': '偽', '位': '位', '体': '體', '佛': '佛',
  '作': '作', '例': '例', '保': '保', '信': '信', '修': '修', '储': '儲', '像': '像', '儒': '儒',
  '充': '充', '先': '先', '全': '全', '关': '關', '内': '內', '写': '寫', '农': '農', '准': '準',
  '减': '減', '出': '出', '击': '擊', '分': '分', '则': '則', '创': '創', '删': '刪', '别': '別',
  '制': '製', '刻': '刻', '剧': '劇', '办': '辦', '加': '加', '务': '務', '动': '動', '化': '化',
  '区': '區', '单': '單', '南': '南', '厂': '廠', '历': '歷', '压': '壓', '参': '參', '反': '反',
  '发': '發', '取': '取', '变': '變', '台': '臺', '号': '號', '合': '合', '名': '名', '后': '後',
  '听': '聽', '启': '啟', '员': '員', '响': '響', '回': '回', '团': '團', '园': '園', '围': '圍',
  '国': '國', '图': '圖', '圆': '圓', '圣': '聖', '地': '地', '场': '場', '块': '塊', '坚': '堅',
  '填': '填', '境': '境', '声': '聲', '处': '處', '备': '備', '复': '複', '多': '多', '头': '頭',
  '威': '威', '媒': '媒', '子': '子', '字': '字', '存': '存', '学': '學', '安': '安', '定': '定',
  '实': '實', '审': '審', '密': '密', '对': '對', '导': '導', '将': '將', '屏': '屏', '展': '展',
  '属': '屬', '差': '差', '布': '布', '师': '師', '带': '帶', '帧': '幀', '常': '常', '幕': '幕',
  '并': '並', '广': '廣', '库': '庫', '应': '應', '度': '度', '延': '延', '建': '建', '开': '開',
  '强': '強', '归': '歸', '当': '當', '录': '錄', '形': '形', '影': '影', '心': '心', '态': '態',
  '急': '急', '总': '總', '息': '息', '截': '截', '戳': '戳', '户': '戶', '执': '執', '扫': '掃',
  '批': '批', '找': '找', '抖': '抖', '护': '護', '报': '報', '担': '擔', '拦': '攔', '择': '擇',
  '挂': '掛', '指': '指', '换': '換', '据': '據', '控': '控', '描': '描', '提': '提', '搜': '搜',
  '摄': '攝', '摆': '擺', '播': '播', '收': '收', '改': '改', '放': '放', '数': '數', '断': '斷',
  '无': '無', '日': '日', '旧': '舊', '时': '時', '明': '明', '显': '顯', '晓': '曉', '晰': '晰',
  '暂': '暫', '替': '替', '期': '期', '本': '本', '术': '術', '机': '機', '杀': '殺', '杂': '雜',
  '权': '權', '条': '條', '来': '來', '极': '極', '构': '構', '林': '林', '枪': '槍', '查': '查',
  '标': '標', '栏': '欄', '树': '樹', '校': '校', '样': '樣', '格': '格', '档': '檔', '桥': '橋',
  '梦': '夢', '检': '檢', '楼': '樓', '横': '橫', '欢': '歡', '欧': '歐', '正': '正', '残': '殘',
  '气': '氣', '永': '永', '汇': '彙', '汉': '漢', '没': '沒', '治': '治', '泄': '洩', '法': '法',
  '注': '註', '洁': '潔', '流': '流', '浅': '淺', '测': '測', '济': '濟', '浏': '瀏', '涨': '漲',
  '清': '清', '渐': '漸', '温': '溫', '湾': '灣', '湿': '濕', '滚': '滾', '满': '滿', '滤': '濾',
  '潜': '潛', '灭': '滅', '灯': '燈', '灵': '靈', '灾': '災', '点': '點', '烈': '烈', '烦': '煩',
  '烧': '燒', '热': '熱', '爱': '愛', '牵': '牽', '状': '狀', '犹': '猶', '独': '獨', '狭': '狹',
  '狮': '獅', '猎': '獵', '猪': '豬', '献': '獻', '率': '率', '环': '環', '现': '現', '理': '理',
  '电': '電', '画': '畫', '畅': '暢', '疗': '療', '疯': '瘋', '痴': '癡', '监': '監', '盖': '蓋',
  '盘': '盤', '码': '碼', '础': '礎', '硕': '碩', '确': '確', '碍': '礙', '示': '示', '礼': '禮',
  '离': '離', '种': '種', '积': '積', '称': '稱', '稳': '穩', '竞': '競', '笔': '筆', '签': '簽',
  '简': '簡', '算': '算', '管': '管', '类': '類', '索': '索', '紧': '緊', '红': '紅', '约': '約',
  '级': '級', '纪': '紀', '纯': '純', '纳': '納', '纵': '縱', '纷': '紛', '纸': '紙', '纹': '紋',
  '线': '線', '练': '練', '组': '組', '细': '細', '织': '織', '终': '終', '经': '經', '绑': '綁',
  '结': '結', '绕': '繞', '绘': '繪', '给': '給', '络': '絡', '绝': '絕', '统': '統', '继': '繼',
  '绩': '績', '绪': '緒', '续': '續', '维': '維', '综': '綜', '绿': '綠', '缓': '緩', '编': '編',
  '缘': '緣', '缩': '縮', '缴': '繳', '网': '網', '罗': '羅', '罚': '罰', '耗': '耗', '职': '職',
  '联': '聯', '聪': '聰', '肃': '肅', '肠': '腸', '肤': '膚', '胜': '勝', '胶': '膠', '能': '能',
  '脑': '腦', '脚': '腳', '脱': '脫', '脸': '臉', '腊': '臘', '腾': '騰', '航': '航', '艺': '藝',
  '节': '節', '芦': '蘆', '苏': '蘇', '范': '範', '茎': '莖', '荣': '榮', '药': '藥', '莱': '萊',
  '莲': '蓮', '获': '獲', '莹': '瑩', '菜': '菜', '营': '營', '萧': '蕭', '蓝': '藍', '虑': '慮',
  '虚': '虛', '虫': '蟲', '虽': '雖', '补': '補', '表': '表', '装': '裝', '见': '見', '观': '觀',
  '规': '規', '视': '視', '览': '覽', '觉': '覺', '解': '解', '触': '觸', '计': '計', '订': '訂',
  '认': '認', '讨': '討', '让': '讓', '训': '訓', '议': '議', '记': '記', '讲': '講', '许': '許',
  '论': '論', '设': '設', '访': '訪', '证': '證', '评': '評', '识': '識', '诉': '訴', '诊': '診',
  '词': '詞', '译': '譯', '试': '試', '诗': '詩', '诚': '誠', '话': '話', '诞': '誕', '询': '詢',
  '该': '該', '详': '詳', '语': '語', '误': '誤', '说': '說', '请': '請', '诸': '諸', '读': '讀',
  '课': '課', '谁': '誰', '调': '調', '谋': '謀', '谎': '謊', '谐': '諧', '谓': '謂', '谜': '謎',
  '谢': '謝', '谨': '謹', '谱': '譜', '负': '負', '贡': '貢', '财': '財', '责': '責', '败': '敗',
  '货': '貨', '质': '質', '贩': '販', '贪': '貪', '贫': '貧', '购': '購', '贯': '貫', '贱': '賤',
  '贴': '貼', '贵': '貴', '贷': '貸', '贸': '貿', '费': '費', '贺': '賀', '贼': '賊', '资': '資',
  '赋': '賦', '赌': '賭', '赏': '賞', '赐': '賜', '赔': '賠', '赚': '賺', '赛': '賽', '赞': '讚',
  '赠': '贈', '赢': '贏', '赶': '趕', '趋': '趨', '距': '距', '跳': '跳', '践': '踐', '踪': '蹤',
  '车': '車', '轨': '軌', '转': '轉', '轮': '輪', '软': '軟', '轴': '軸', '轻': '輕', '载': '載',
  '较': '較', '辅': '輔', '辆': '輛', '辈': '輩', '辉': '輝', '辐': '輻', '辑': '輯', '输': '輸',
  '辞': '辭', '辩': '辯', '边': '邊', '达': '達', '迁': '遷', '过': '過', '运': '運', '近': '近',
  '还': '還', '这': '這', '进': '進', '远': '遠', '违': '違', '连': '連', '迟': '遲', '送': '送',
  '适': '適', '选': '選', '逊': '遜', '递': '遞', '速': '速', '逻': '邏', '遗': '遺', '遥': '遙',
  '邓': '鄧', '邮': '郵', '邻': '鄰', '郑': '鄭', '释': '釋', '里': '裡', '量': '量', '针': '針',
  '钉': '釘', '钓': '釣', '钙': '鈣', '钝': '鈍', '钢': '鋼', '钥': '鑰', '钦': '欽', '钩': '鉤',
  '钮': '鈕', '钱': '錢', '铁': '鐵', '铅': '鉛', '银': '銀', '铺': '鋪', '链': '鏈', '销': '銷',
  '锁': '鎖', '锅': '鍋', '锋': '鋒', '锐': '銳', '错': '錯', '锡': '錫', '锣': '鑼', '锤': '錘',
  '锦': '錦', '键': '鍵', '锯': '鋸', '锰': '錳', '镇': '鎮', '镜': '鏡', '长': '長', '门': '門',
  '闪': '閃', '闭': '閉', '问': '問', '闯': '闖', '闲': '閒', '间': '間', '闷': '悶', '闸': '閘',
  '闹': '鬧', '闻': '聞', '阀': '閥', '阁': '閣', '阅': '閱', '队': '隊', '阳': '陽', '阴': '陰',
  '阵': '陣', '阶': '階', '附': '附', '际': '際', '陆': '陸', '陈': '陳', '限': '限', '险': '險',
  '随': '隨', '隐': '隱', '障': '障', '难': '難', '集': '集', '雾': '霧', '静': '靜', '靠': '靠',
  '面': '面', '页': '頁', '顶': '頂', '项': '項', '顺': '順', '须': '須', '顽': '頑', '顾': '顧',
  '顿': '頓', '颁': '頒', '预': '預', '领': '領', '颊': '頰', '频': '頻', '颗': '顆', '题': '題',
  '颜': '顏', '额': '額', '颠': '顛', '风': '風', '飘': '飄', '飞': '飛', '饭': '飯', '饮': '飲',
  '饰': '飾', '饱': '飽', '饲': '飼', '饶': '饒', '饼': '餅', '饿': '餓', '馆': '館', '馈': '饋',
  '马': '馬', '驱': '驅', '驳': '駁', '驴': '驢', '驶': '駛', '驼': '駝', '驾': '駕', '骂': '罵',
  '骄': '驕', '验': '驗', '骑': '騎', '骗': '騙', '骚': '騷', '骤': '驟', '鱼': '魚', '鲁': '魯',
  '鲜': '鮮', '鸟': '鳥', '鸡': '雞', '鸣': '鳴', '鸦': '鴉', '鸭': '鴨', '鸽': '鴿', '鹅': '鵝',
  '鹰': '鷹', '麦': '麥', '黄': '黃', '齿': '齒', '龙': '龍', '龟': '龜'
};

const TRAD_RE = new RegExp('[' + Object.keys(SIMP_TO_TRAD).join('') + ']', 'g');

/**
 * 简繁转换（简体 → 繁体）
 * 用于自动将 TOOLS_CONFIG 中的 name/desc 转为繁体显示
 */
export function simplifiedToTraditional(text) {
  if (!text) return text;
  return String(text).replace(TRAD_RE, ch => SIMP_TO_TRAD[ch] || ch);
}

/**
 * 本地化工具对象（按当前语言选择合适的 name/desc）
 * @param {Object} tool
 * @returns {Object} 浅拷贝后的工具对象
 */
export function localizeTool(tool) {
  if (!tool) return tool;
  const locale = getI18n().getCurrentLocale();
  const result = { ...tool };
  if (locale === 'zh-TW') {
    // 优先使用 nameTw 字段，否则将简体中文通过转换器转繁体
    result.name = tool.nameTw || simplifiedToTraditional(tool.name) || tool.name;
    if (tool.desc) result.desc = simplifiedToTraditional(tool.desc);
  } else if (locale === 'en') {
    result.name = tool.nameEn || tool.name;
  }
  return result;
}

// ==================== 国际化管理器 ====================

export class I18n {
  constructor() {
    this.currentLocale = 'zh-CN';
    this._initialized = false;
  }

  async init() {
    try {
      const result = await chrome.storage.local.get('toolbox_settings');
      const settings = result.toolbox_settings || {};
      this.currentLocale = settings.language || this.detectLocale();
    } catch (e) {
      this.currentLocale = this.detectLocale();
    }
    this._initialized = true;
  }

  detectLocale() {
    const lang = navigator.language || '';
    if (lang.startsWith('zh')) {
      // 区分简体和繁体：zh-CN / zh-SG → 简体中文，zh-TW / zh-HK / zh-MO → 繁体
      if (lang === 'zh-TW' || lang === 'zh-HK' || lang === 'zh-MO') return 'zh-TW';
      if (lang === 'zh-CN' || lang === 'zh-SG') return 'zh-CN';
      // 未知中文 → 默认为简体
      return 'zh-CN';
    }
    return 'en';
  }

  t(key, fallback = '') {
    const dict = TRANSLATIONS[this.currentLocale] || TRANSLATIONS['en'];
    return dict[key] || fallback || key;
  }

  async setLocale(locale) {
    if (!TRANSLATIONS[locale]) return;
    this.currentLocale = locale;
    try {
      const result = await chrome.storage.local.get('toolbox_settings');
      const settings = result.toolbox_settings || {};
      settings.language = locale;
      await chrome.storage.local.set({ toolbox_settings: settings });
    } catch (e) {
      console.error('[I18n] Failed to save locale:', e);
    }
  }

  getCurrentLocale() {
    return this.currentLocale;
  }

  getSupportedLocales() {
    return ['zh-CN', 'zh-TW', 'en'];
  }

  getTerms() {
    return TERMS[this.currentLocale] || TERMS['en'];
  }

  getTermsLocale() {
    if (this.currentLocale === 'zh-TW') return '繁體中文';
    if (this.currentLocale === 'zh-CN') return '简体中文';
    return 'English';
  }
}

// 单例
let _instance = null;

export function getI18n() {
  if (!_instance) {
    _instance = new I18n();
  }
  return _instance;
}

export function t(key, fallback = '') {
  return getI18n().t(key, fallback);
}

export default I18n;
