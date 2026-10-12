/**
 * ToolCube - Shared Tool Registry
 * 统一的工具注册表，所有组件共享单个数据源
 * @version 1.3.0
 */

// ==================== 工具配置 ====================
export const TOOLS_CONFIG = [
  // 📝 文本处理 (text)
  { id: 'json-formatter', name: 'JSON格式化', nameEn: 'JSON Formatter', category: 'text', icon: '📋', premium: false, desc: '美化/压缩/验证JSON' },
  { id: 'regex-tester', name: '正则测试', nameEn: 'Regex Tester', category: 'text', icon: '🔍', premium: false, desc: '正则匹配/替换/高亮' },
  { id: 'markdown-editor', name: 'Markdown编辑器', nameEn: 'Markdown Editor', category: 'text', icon: '📝', premium: false, desc: '实时预览/GFM风格' },
  { id: 'text-diff', name: '文本对比', nameEn: 'Text Diff', category: 'text', icon: '📊', premium: false, desc: '文本差异对比 (LCS算法)' },
  { id: 'string-counter', name: '字符串统计', nameEn: 'String Counter', category: 'text', icon: '📏', premium: false, desc: '字符/单词/行数统计' },
  { id: 'text-case', name: '大小写转换', nameEn: 'Text Case', category: 'text', icon: 'Aa', premium: false, desc: '大写/小写/驼峰/蛇形' },
  { id: 'password-generator', name: '密码生成器', nameEn: 'Password Generator', category: 'text', icon: '🔒', premium: false, desc: '强密码/密钥生成' },
  { id: 'timezone-converter', name: '时区转换器', nameEn: 'Timezone Converter', category: 'text', icon: '🌐', premium: false, desc: '跨时区时间批量转换' },

  // 🔣 编码解码 (encoding)
  { id: 'base64-converter', name: 'Base64编解码', nameEn: 'Base64 Converter', category: 'encoding', icon: '🔤', premium: false, desc: '文本/图片/文件Base64编解码' },
  { id: 'timestamp-converter', name: '时间戳转换', nameEn: 'Timestamp Converter', category: 'encoding', icon: '⏰', premium: false, desc: 'Unix时间戳↔日期' },
  { id: 'url-encoder', name: 'URL编解码', nameEn: 'URL Encoder', category: 'encoding', icon: '🔗', premium: false, desc: 'URL编码/解码转换' },
  { id: 'hash-generator', name: '哈希生成器', nameEn: 'Hash Generator', category: 'encoding', icon: '🔐', premium: false, desc: 'MD5/SHA-1/256/512' },
  { id: 'base-converter', name: '进制转换', nameEn: 'Base Converter', category: 'encoding', icon: '🔢', premium: false, desc: '2/8/10/16进制互转' },
  { id: 'jwt-decoder', name: 'JWT解码', nameEn: 'JWT Decoder', category: 'encoding', icon: '🔑', premium: false, desc: 'JWT Token解析/验证' },
  { id: 'html-entity', name: 'HTML实体编码', nameEn: 'HTML Entity', category: 'encoding', icon: '🏷️', premium: false, desc: 'HTML实体编解码' },
  { id: 'unicode-converter', name: 'Unicode转换', nameEn: 'Unicode Converter', category: 'encoding', icon: '🔤', premium: false, desc: 'Unicode/中文互转' },
  { id: 'uuid-generator', name: 'UUID生成', nameEn: 'UUID Generator', category: 'encoding', icon: '🆔', premium: false, desc: 'GUID/UUID批量生成' },

  // 📊 数据格式 (data)
  { id: 'css-beautifier', name: 'CSS美化', nameEn: 'CSS Beautifier', category: 'data', icon: '🎨', premium: false, desc: 'CSS代码格式化' },
  { id: 'sql-formatter', name: 'SQL格式化', nameEn: 'SQL Formatter', category: 'data', icon: '🗄️', premium: false, desc: 'SQL语句美化/压缩' },
  { id: 'data-converter', name: '数据格式转换', nameEn: 'Data Converter', category: 'data', icon: '🔄', premium: false, desc: 'JSON/XML/YAML/CSV互转' },
  { id: 'xml-formatter', name: 'XML格式化', nameEn: 'XML Formatter', category: 'data', icon: '📋', premium: false, desc: 'XML美化/压缩/验证' },
  { id: 'code-minifier', name: '代码压缩', nameEn: 'Code Minifier', category: 'data', icon: '📦', premium: false, desc: 'JS/CSS/HTML压缩美化' },
  { id: 'qrcode-generator', name: '二维码生成', nameEn: 'QR Code Generator', category: 'data', icon: '▣', premium: false, desc: '文本/URL/WiFi二维码' },
  { id: 'cron-parser', name: 'Cron解析', nameEn: 'Cron Parser', category: 'data', icon: '⏱️', premium: false, desc: 'Cron表达式解析' },
  { id: 'file-hash', name: '文件哈希', nameEn: 'File Hash', category: 'data', icon: '🔐', premium: false, desc: 'MD5/SHA文件哈希校验' },
  { id: 'json-diff', name: 'JSON对比', nameEn: 'JSON Diff', category: 'data', icon: '🔍', premium: false, desc: 'JSON差异对比分析' },
  { id: 'currency-converter', name: '汇率换算', nameEn: 'Currency Converter', category: 'data', icon: '💱', premium: false, desc: '实时汇率换算/货币转换' },

  // 🎨 设计视觉 (design)
  { id: 'color-manager', name: '颜色管理', nameEn: 'Color Manager', category: 'design', icon: '🎨', premium: false, desc: '拾色器/色板/格式转换' },
  { id: 'color-contrast', name: '颜色对比度', nameEn: 'Color Contrast', category: 'design', icon: '🎯', premium: false, desc: 'WCAG对比度检查' },
  { id: 'image-processor', name: '图片处理', nameEn: 'Image Processor', category: 'design', icon: '🖼️', premium: false, desc: '压缩/格式转换/调整' },
  { id: 'svg-editor', name: 'SVG预览', nameEn: 'SVG Preview', category: 'design', icon: '🖌️', premium: false, desc: 'SVG代码实时预览' },
  { id: 'qrcode-reader', name: '二维码读取', nameEn: 'QR Reader', category: 'design', icon: '📷', premium: false, desc: '扫描图片中的二维码' },
  { id: 'color-picker', name: '屏幕取色器', nameEn: 'Color Picker', category: 'design', icon: '💉', premium: false, desc: 'EyeDropper屏幕取色' },
  { id: 'image-editor', name: '图片编辑器', nameEn: 'Image Editor', category: 'design', icon: '✂️', premium: false, desc: '旋转/翻转/滤镜/裁剪' },
  { id: 'css-shadow', name: 'CSS阴影生成器', nameEn: 'CSS Shadow', category: 'design', icon: '🖼️', premium: false, desc: 'Box-shadow/Text-shadow可视化' },
  { id: 'color-gradient', name: '渐变生成器', nameEn: 'Gradient Generator', category: 'design', icon: '🎨', premium: false, desc: 'CSS渐变色可视化生成' },
  { id: 'html-preview', name: 'HTML预览', nameEn: 'HTML Preview', category: 'design', icon: '👁', premium: false, desc: 'HTML/CSS实时预览' },

  // 🌐 网络工具 (network)
  { id: 'http-tester', name: 'HTTP测试', nameEn: 'HTTP Tester', category: 'network', icon: '🌐', premium: false, desc: 'REST API测试工具' },
  { id: 'websocket-client', name: 'WebSocket客户端', nameEn: 'WebSocket Client', category: 'network', icon: '🔌', premium: false, desc: 'WS连接/消息收发' },
  { id: 'ip-lookup', name: 'IP查询', nameEn: 'IP Lookup', category: 'network', icon: '📍', premium: false, desc: 'IP地址信息查询' },
  { id: 'url-parser', name: 'URL解析', nameEn: 'URL Parser', category: 'network', icon: '🔗', premium: false, desc: 'URL参数/协议/路径解析' },
  { id: 'url-expander', name: '短链还原', nameEn: 'URL Expander', category: 'network', icon: '⛓', premium: false, desc: '展开 t.cn/bit.ly 等' },
  { id: 'network-analyzer', name: '网络分析器', nameEn: 'Network Analyzer', category: 'network', icon: '📊', premium: false, desc: '页面网络请求详情分析' },
  { id: 'web-vitals', name: 'Web Vitals', nameEn: 'Web Vitals', category: 'network', icon: '📈', premium: false, desc: 'LCP/FID/CLS 实时仪表盘' },

  // 🔍 网页开发 (devtools)
  { id: 'page-analyzer', name: '网页分析', nameEn: 'Page Analyzer', category: 'devtools', icon: '📊', premium: false, desc: 'SEO/结构/性能分析' },
  { id: 'screenshot-tool', name: '网页截图', nameEn: 'Screenshot', category: 'devtools', icon: '📸', premium: false, desc: '页面可见区域截图' },
  { id: 'elements-editor', name: '元素编辑器', nameEn: 'Element Editor', category: 'devtools', icon: '✏️', premium: false, desc: 'DOM元素检查与编辑' },
  { id: 'link-extractor', name: '链接提取器', nameEn: 'Link Extractor', category: 'devtools', icon: '🔗', premium: false, desc: '提取页面上所有链接' },
  { id: 'color-extractor', name: '颜色提取器', nameEn: 'Color Extractor', category: 'devtools', icon: '🎨', premium: false, desc: '网页配色方案提取' },
  { id: 'resource-sniffer', name: '资源嗅探器', nameEn: 'Resource Sniffer', category: 'devtools', icon: '🕵️', premium: false, desc: '提取页面所有可下载资源（视频/音频/图片/文档/字体）(持久化)' },
  { id: 'web-clipper', name: '网页剪报', nameEn: 'Web Clipper', category: 'devtools', icon: '📰', premium: false, desc: '页面保存为 Markdown/HTML' },
  { id: 'localstorage-manager', name: '存储管理', nameEn: 'Storage Manager', category: 'devtools', icon: '💾', premium: false, desc: 'LocalStorage/SessionStorage' },
  { id: 'cookie-manager', name: 'Cookie 管理', nameEn: 'Cookie Manager', category: 'devtools', icon: '🍪', premium: false, desc: '增删改查所有 Cookie' },
  { id: 'hex-editor', name: '十六进制编辑器', nameEn: 'Hex Editor', category: 'devtools', icon: '🔢', premium: false, desc: 'Hex查看/编辑文本与文件' },
  { id: 'exif-reader', name: 'EXIF分析器', nameEn: 'EXIF Analyzer', category: 'devtools', icon: '📷', premium: false, desc: '读取图片元数据检测隐私泄露' },

  // 🎭 极客工具 (geek)
  { id: 'user-agent-switcher', name: 'UA 切换器', nameEn: 'UA Switcher', category: 'geek', icon: '🎭', premium: false, desc: '修改 User-Agent 绕过检测(持久化)' },
  { id: 'video-speed', name: '视频倍速', nameEn: 'Video Speed', category: 'geek', icon: '▶️', premium: false, desc: '全局视频倍速控制(持久化)' },
  { id: 'video-unlocker', name: '视频解锁', nameEn: 'Video Unlocker', category: 'geek', icon: '🔓', premium: false, desc: '强制控件解锁/进度伪装/上报拦截(持久化)' },
  { id: 'jsonpath-query', name: 'JSONPath 查询', nameEn: 'JSONPath Query', category: 'geek', icon: '🧭', premium: false, desc: '$.a.b[*] 风格查询 JSON' },
  { id: 'curl-generator', name: 'cURL 生成器', nameEn: 'cURL Generator', category: 'geek', icon: '🔧', premium: false, desc: '可视化构造 cURL 命令并测试' },
  { id: 'jwt-generator', name: 'JWT 生成器', nameEn: 'JWT Generator', category: 'geek', icon: '🔐', premium: false, desc: 'HS256/384/512 本地签名生成' },
  { id: 'reverse-shell-generator', name: '反向Shell生成器', nameEn: 'Reverse Shell Generator', category: 'geek', icon: '🐚', premium: false, desc: '多语言Reverse Shell命令生成' },
  { id: 'payload-encoder', name: 'Payload编码器', nameEn: 'Payload Encoder', category: 'geek', icon: '💉', premium: false, desc: '多层编码/解码(URL/Base64/Hex/Unicode)' },
  { id: 'dns-lookup', name: 'DNS查询', nameEn: 'DNS Lookup', category: 'geek', icon: '🌐', premium: false, desc: 'DoH查询A/AAAA/MX/TXT/NS/CNAME' },
  { id: 'ssl-checker', name: 'SSL证书检查', nameEn: 'SSL Checker', category: 'geek', icon: '🔐', premium: false, desc: '证书信息/过期/协议版本检查' },
  { id: 'xss-tester', name: 'XSS测试器', nameEn: 'XSS Tester', category: 'geek', icon: '💉', premium: false, desc: 'XSS payload向量生成与编码' },
  { id: 'subdomain-finder', name: '子域名发现', nameEn: 'Subdomain Finder', category: 'geek', icon: '🔍', premium: false, desc: 'CT日志枚举子域名' },
  { id: 'cors-tester', name: 'CORS测试器', nameEn: 'CORS Tester', category: 'geek', icon: '🔀', premium: false, desc: '跨域配置安全性测试' },
  { id: 'whois-lookup', name: 'WHOIS查询', nameEn: 'WHOIS Lookup', category: 'geek', icon: '📋', premium: false, desc: '域名注册信息查询' },
  { id: 'port-scanner', name: '端口扫描', nameEn: 'Port Scanner', category: 'geek', icon: '🔌', premium: false, desc: '扫描目标主机开放端口' },
  { id: 'password-strength', name: '密码强度检测', nameEn: 'Password Strength', category: 'geek', icon: '🛡️', premium: false, desc: '熵/破解时间/改进建议' },
  { id: 'auto-play-next', name: '自动连播', nameEn: 'Auto Play Next', category: 'geek', icon: '⏭️', premium: false, desc: '视频结束自动播放下一集(持久化)' },

  // 🚀 日常效率 (daily)
  { id: 'calculator', name: '计算器', nameEn: 'Calculator', category: 'daily', icon: '🔢', premium: false, desc: '四则运算/科学计算' },
  { id: 'clipboard-history', name: '剪贴板历史', nameEn: 'Clipboard History', category: 'daily', icon: '📋', premium: false, desc: '记录最近 200 条剪贴板' },
  { id: 'tab-manager', name: '标签管理', nameEn: 'Tab Manager', category: 'daily', icon: '🗂️', premium: false, desc: '跨窗口搜索/分组标签' },

  // 🛡️ 安全工具 (security) - 检测与防护
  { id: 'security-scanner', name: '网页安全扫描', nameEn: 'Security Scanner', category: 'security', icon: '🛡️', premium: false, desc: 'HTTPS/混合内容/安全头/CSP全面检测' },
  { id: 'privacy-checker', name: '隐私追踪检测', nameEn: 'Privacy Checker', category: 'security', icon: '👁️', premium: false, desc: '追踪器/第三方请求/Cookie检测' },
  { id: 'fingerprint-detector', name: '浏览器指纹检测', nameEn: 'Fingerprint Detector', category: 'security', icon: '🖐️', premium: false, desc: 'Canvas/WebGL/Audio/字体指纹泄露检测' },
  { id: 'header-analyzer', name: '安全响应头分析', nameEn: 'Header Analyzer', category: 'security', icon: '📋', premium: false, desc: 'HSTS/CSP/X-Frame等安全头评分' },
  { id: 'password-leak-check', name: '密码泄露检测', nameEn: 'Password Leak Check', category: 'security', icon: '🔓', premium: false, desc: 'Have I Been Pwned k-匿名查询' },
  { id: 'tracker-blocker', name: '追踪拦截器', nameEn: 'Tracker Blocker', category: 'security', icon: '🚫', premium: false, desc: '拦截追踪/广告域名(持久化)' },
  { id: 'https-enforcer', name: 'HTTPS强制', nameEn: 'HTTPS Enforcer', category: 'security', icon: '🔒', premium: false, desc: 'HTTP→HTTPS自动升级(持久化)' },
  { id: 'anti-fingerprint', name: '反指纹保护', nameEn: 'Anti-Fingerprint', category: 'security', icon: '🖐️', premium: false, desc: '干扰Canvas/WebGL/Audio指纹(持久化)' },
  { id: 'custom-headers', name: '自定义请求头', nameEn: 'Custom Headers', category: 'security', icon: '📡', premium: false, desc: '添加/修改HTTP请求头(持久化)' },
  { id: 'script-injector', name: '自定义脚本注入', nameEn: 'Script Injector', category: 'security', icon: '💉', premium: false, desc: '指定网站注入JS/CSS(持久化)' },
  { id: 'silver-fox-guard', name: '银狐木马拦截', nameEn: 'Silver Fox Guard', category: 'security', icon: '🛡️', premium: false, desc: '实时检测并拦截银狐木马等恶意软件下载(持久化)' }
];

// ==================== 分类配置 ====================
export const CATEGORIES = [
  { id: 'text', name: '文本处理', nameEn: 'Text Tools', icon: '📝' },
  { id: 'encoding', name: '编码转换', nameEn: 'Encoding Tools', icon: '🔣' },
  { id: 'data', name: '数据格式化', nameEn: 'Data Tools', icon: '📊' },
  { id: 'design', name: '设计工具', nameEn: 'Design Tools', icon: '🎨' },
  { id: 'network', name: '网络工具', nameEn: 'Network Tools', icon: '🌐' },
  { id: 'devtools', name: '网页开发', nameEn: 'Dev Tools', icon: '🔍' },
  { id: 'geek', name: '极客工具', nameEn: 'Geek Tools', icon: '🎭' },
  { id: 'daily', name: '日常效率', nameEn: 'Daily Tools', icon: '🚀' },
  { id: 'security', name: '安全工具', nameEn: 'Security Tools', icon: '🛡️' }
];

// ==================== 拼音搜索映射 ====================
export const PINYIN_MAP = {
  'json': ['json', 'ge', 'shi', 'hua'],
  'base64': ['base64', 'bian', 'ma', 'jie'],
  'regex': ['zheng', 'ze', 'ce', 'shi'],
  'markdown': ['markdown', 'bian', 'ji', 'qi'],
  'text': ['wen', 'ben', 'dui', 'bi', 'zi', 'fu', 'chuan'],
  'string': ['zi', 'fu', 'chuan', 'tong', 'ji'],
  'timestamp': ['shi', 'jian', 'chuo', 'zhuan', 'huan'],
  'url': ['url', 'bian', 'ma', 'jie', 'ma'],
  'hash': ['ha', 'xi', 'sheng', 'cheng'],
  'base': ['jin', 'zhi', 'zhuan', 'huan'],
  'css': ['css', 'mei', 'hua'],
  'sql': ['sql', 'ge', 'shi', 'hua'],
  'data': ['shu', 'ju', 'ge', 'shi', 'zhuan', 'huan'],
  'qrcode': ['er', 'wei', 'ma'],
  'color': ['yan', 'se', 'guan', 'li'],
  'image': ['tu', 'pian', 'chu', 'li'],
  'http': ['http', 'ce', 'shi'],
  'websocket': ['websocket', 'ke', 'hu', 'duan'],
  'jwt': ['jwt', 'jie', 'ma'],
  'password': ['mi', 'ma', 'sheng', 'cheng'],
  'uuid': ['uuid', 'sheng', 'cheng'],
  'html': ['html', 'shi', 'ti', 'bian', 'ma'],
  'unicode': ['unicode', 'zhuan', 'huan'],
  'ip': ['ip', 'cha', 'xun'],
  'cron': ['cron', 'jie', 'xi'],
  'svg': ['svg', 'yu', 'lan'],
  'code': ['dai', 'ma', 'ya', 'suo'],
  'xml': ['xml', 'ge', 'shi', 'hua'],
  'video': ['shi', 'pin', 'bei', 'su'],
  'calculator': ['ji', 'suan', 'qi'],
  'qrcode-reader': ['er', 'wei', 'ma', 'du', 'qu'],
  'screenshot': ['jie', 'tu', 'ping', 'mu'],
  'elements': ['yuan', 'su', 'jian', 'cha', 'bian', 'ji'],
  'link': ['lian', 'jie', 'ti', 'qu'],
  'currency': ['hui', 'lv', 'huan', 'suan', 'huo', 'bi'],
  'file': ['wen', 'jian', 'ha', 'xi', 'xiao', 'yan'],
  'web-clipper': ['wang', 'ye', 'jian', 'bao', 'bao', 'cun'],
  'clipboard': ['jian', 'tie', 'ban', 'li', 'shi'],
  'url-expander': ['duan', 'lian', 'huan', 'yuan', 'zhuan', 'xiang'],
  'tab-manager': ['biao', 'qian', 'ye', 'guan', 'li', 'fen', 'zu'],
  'user-agent': ['yong', 'hu', 'dai', 'li', 'qie', 'huan'],
  'jsonpath': ['jsonpath', 'cha', 'xun', 'lu', 'jing'],
  'cookie': ['cookie', 'guan', 'li'],
  'localstorage': ['localstorage', 'cun', 'chu', 'guan', 'li'],
  'web-vitals': ['xing', 'neng', 'zhi', 'biao', 'web', 'vitals'],
  'resource': ['zi', 'yuan', 'xiu', 'tan', 'xiazai'],
  'security': ['an', 'quan', 'sao', 'miao', 'wang', 'ye'],
  'privacy': ['yin', 'si', 'zhui', 'zong', 'jian', 'ce'],
  'fingerprint': ['zhi', 'wen', 'jian', 'ce', 'liu', 'lan', 'qi'],
  'header': ['an', 'quan', 'xiang', 'ying', 'tou', 'fen', 'xi'],
  'password-leak': ['mi', 'ma', 'xie', 'lu', 'jian', 'ce'],
  'hex': ['shi', 'liu', 'jin', 'zhi', 'bian', 'ji', 'qi'],
  'reverse-shell': ['fan', 'xiang', 'shell', 'sheng', 'cheng'],
  'payload': ['payload', 'bian', 'ma', 'jie', 'ma'],
  'dns': ['dns', 'cha', 'xun', 'yu', 'ming'],
  'ssl': ['ssl', 'zheng', 'shu', 'jian', 'cha'],
  'xss': ['xss', 'ce', 'shi', 'kua', 'zhan'],
  'subdomain': ['zi', 'yu', 'ming', 'fa', 'xian'],
  'cors': ['cors', 'kua', 'yuan', 'ce', 'shi'],
  'whois': ['whois', 'yu', 'ming', 'cha', 'xun'],
  'network-analyzer': ['wang', 'luo', 'fen', 'xi'],
  'tracker-blocker': ['zhui', 'zong', 'lan', 'jie'],
  'https-enforcer': ['https', 'qiang', 'zhi'],
  'anti-fingerprint': ['fan', 'zhi', 'wen', 'bao', 'hu'],
  'custom-headers': ['zi', 'ding', 'yi', 'qing', 'qiu', 'tou'],
  'script-injector': ['jiao', 'ben', 'zhu', 'ru'],
  'auto-play-next': ['zi', 'dong', 'lian', 'bo'],
  'silver-fox-guard': ['yin', 'hu', 'mu', 'ma', 'lan', 'jie'],
  'timezone': ['shi', 'qu', 'zhuan', 'huan'],
  'page': ['wang', 'ye', 'fen', 'xi'],
  'exif': ['exif', 'zhao', 'xiang', 'shu', 'ju'],
  'port': ['duan', 'kou', 'sao', 'miao'],
  'curl': ['curl', 'sheng', 'cheng'],
  // 以下为补充的独立工具拼音映射，解决共享前缀覆盖问题
  'color-picker': ['pingmu', 'quse', 'eyedropper'],
  'color-gradient': ['jianbian', 'shengcheng', 'css'],
  'color-extractor': ['yanse', 'tiqu', 'tiquqi'],
  'image-editor': ['tupian', 'bianji', 'xuanzhuan', 'fanzhuan'],
  'video-unlocker': ['shipin', 'jiesuo', 'jiekong'],
  'password-strength': ['mima', 'qiangdu', 'jiance', 'kangpo'],
  'text-case': ['daxie', 'xiaoxie', 'tuofeng', 'zhuanhuan'],
  'url-parser': ['url', 'jiexi', 'canshu', 'lujing'],
  'json-diff': ['json', 'duibi', 'chayi'],
  'jwt-generator': ['jwt', 'shengcheng', 'qianming'],
  'http-tester': ['http', 'ceshi', 'rest', 'api'],
  'security-scanner': ['anquan', 'saomiao', 'wangye', 'jiance'],
  'calculator': ['jisuanqi', 'jisuan', 'sizhe', 'kexue'],
  'timezone-converter': ['shiqu', 'zhuanhuan', 'shiquzhuanhuan'],
  'cron-parser': ['cron', 'jiexi', 'biaodashi'],
  'tab-manager': ['biaoqian', 'guanli', 'fenzu', 'chakou'],
  'web-clipper': ['wangye', 'jianbao', 'baocun', 'markdown'],
  'network-analyzer': ['wangluo', 'fenxi', 'waterfall', 'pubu'],
  'ip-lookup': ['ip', 'chaxun', 'dili', 'weizhi'],
  'web-vitals': ['xingneng', 'zhibiao', 'vitals', 'core']
};

/**
 * 说明：本模块只负责「数据」——工具清单、分类清单与拼音映射。
 *
 * 早期还导出了 `getToolById` / `getToolsByCategory` / `searchTools` 三个查询函数，
 * 但侧边栏与弹窗各自实现了更贴合自身 UI 的过滤逻辑（例如侧边栏需要「按分类隐藏空分组」
 * 与「拼音首字母组合匹配」），这三个函数**从未被任何模块引用**，已移除，
 * 避免出现两套行为不一致的搜索实现。
 */
