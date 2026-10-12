/**
 * ToolCube - Pure JavaScript PE File Analyzer
 * 纯JS实现PE文件启发式分析，无需Python/外部依赖
 * @version 1.3.0
 */

// ==================== 可疑API组合定义 ====================
const SUSPICIOUS_API_GROUPS = {
  network_download: {
    weight: 3,
    apis: ['URLDownloadToFile', 'InternetOpen', 'HttpOpenRequest', 'InternetReadFile',
           'WinHttpOpen', 'WinHttpOpenRequest', 'WinHttpReadFile', 'HttpSendRequest'],
    desc: '网络下载相关API'
  },
  process_injection: {
    weight: 4,
    apis: ['VirtualAllocEx', 'WriteProcessMemory', 'CreateRemoteThread',
           'NtCreateThreadEx', 'RtlCreateUserThread', 'VirtualProtectEx'],
    desc: '进程注入相关API'
  },
  command_exec: {
    weight: 3,
    apis: ['CreateProcess', 'ShellExecute', 'WinExec', 'system', '_popen', 'CmdRun',
           'ShellExecuteEx'],
    desc: '命令执行相关API'
  },
  keylogging: {
    weight: 3,
    apis: ['SetWindowsHookEx', 'GetAsyncKeyState', 'GetKeyState', 'RegisterHotKey',
           'GetMessage'],
    desc: '键盘记录相关API'
  },
  anti_analysis: {
    weight: 2,
    apis: ['IsDebuggerPresent', 'CheckRemoteDebuggerPresent', 'NtQueryInformationProcess',
           'GetTickCount', 'OutputDebugString', 'EnumWindows'],
    desc: '反分析/反调试API'
  },
  persistence: {
    weight: 2,
    apis: ['RegSetValueEx', 'RegCreateKeyEx', 'CreateService', 'StartService',
           'CopyFile', 'MoveFile', 'WriteFile'],
    desc: '持久化驻留相关API'
  }
};

// 已知银狐木马SHA256黑名单
// 注意：此列表曾存放占位哈希（a1b2c3... 递增串），永远无法命中真实样本，属于"看似有效实则无效"的代码。
// 真实威胁情报哈希需从微步/奇安信/VirusTotal 等源持续同步，未接入前保持空列表，
// 检测完全依赖下方启发式分析（API 调用、节区、熵、图标伪装等）。
const SHA256_BLACKLIST = [
  // 接入真实威胁情报源后在此追加哈希（小写 hex，64 字符）
];

// 可疑节区名（加壳/混淆工具特征）
const SUSPICIOUS_SECTION_NAMES = [
  '.vmp', '.vmp1', '.vmp2', '.mpress1', '.mpress2',
  '.enigma1', '.enigma2', '.themida', '.winlice',
  '.upx', '.nsp0', '.nsp1', '.nsp2'
];

// ==================== 核心分析函数 ====================

/**
 * 计算Shannon信息熵
 */
function calculateEntropy(bytes) {
  if (!bytes || bytes.length === 0) return 0;
  var freq = new Array(256).fill(0);
  for (var i = 0; i < bytes.length; i++) {
    freq[bytes[i]]++;
  }
  var entropy = 0;
  for (var j = 0; j < 256; j++) {
    if (freq[j] === 0) continue;
    var p = freq[j] / bytes.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * RVA转文件偏移
 */
function rvaToOffset(rva, sections) {
  for (var i = 0; i < sections.length; i++) {
    var s = sections[i];
    if (rva >= s.virtualAddress && rva < s.virtualAddress + Math.max(s.virtualSize, s.rawDataSize)) {
      return rva - s.virtualAddress + s.rawDataPointer;
    }
  }
  return null;
}

/**
 * 读取null结尾ASCII字符串
 */
function readAsciiString(view, offset, maxLength) {
  var str = '';
  for (var i = 0; i < maxLength; i++) {
    if (offset + i >= view.byteLength) break;
    var ch = view.getUint8(offset + i);
    if (ch === 0) break;
    str += String.fromCharCode(ch);
  }
  return str;
}

/**
 * 解析PE文件结构
 * @param {ArrayBuffer} buffer - 文件数据（至少前1MB）
 * @returns {Object} PE分析结果
 */
export function analyzePE(buffer) {
  var result = {
    isPE: false,
    riskScore: 0,
    reasons: [],
    sections: [],
    imports: [],
    entropyWarnings: []
  };

  var view = new DataView(buffer);

  // 检查DOS签名 "MZ"
  if (buffer.byteLength < 64) return result;
  if (view.getUint16(0, true) !== 0x5A4D) return result;

  result.isPE = true;

  // 获取PE头偏移
  var peOffset = view.getUint32(0x3C, true);
  if (peOffset + 4 > buffer.byteLength) {
    result.reasons.push('PE头不完整');
    result.riskScore += 10;
    return result;
  }

  // 检查PE签名 "PE\0\0"
  if (view.getUint32(peOffset, true) !== 0x00004550) {
    result.isPE = false;
    return result;
  }

  // COFF Header
  var coffOffset = peOffset + 4;
  if (coffOffset + 20 > buffer.byteLength) return result;

  var numberOfSections = view.getUint16(coffOffset + 2, true);
  var sizeOfOptionalHeader = view.getUint16(coffOffset + 16, true);

  // Optional Header
  var optOffset = coffOffset + 20;
  if (optOffset + 2 > buffer.byteLength) return result;

  var optMagic = view.getUint16(optOffset, true);
  var is64 = optMagic === 0x20B; // PE32+

  // 获取导入表数据目录（索引1）
  var importRVA = 0, importSize = 0;
  var dataDirOffset;

  if (is64) {
    if (optOffset + 112 + 8 > buffer.byteLength) return result;
    var numDirEntries64 = view.getUint32(optOffset + 108, true);
    dataDirOffset = optOffset + 112;
  } else {
    if (optOffset + 96 + 8 > buffer.byteLength) return result;
    var numDirEntries32 = view.getUint32(optOffset + 92, true);
    dataDirOffset = optOffset + 96;
  }

  // 导入目录是第2个数据目录项（索引1）
  if (dataDirOffset + 16 <= buffer.byteLength) {
    importRVA = view.getUint32(dataDirOffset + 8, true);
    importSize = view.getUint32(dataDirOffset + 12, true);
  }

  // 解析节区头
  var sectionOffset = optOffset + sizeOfOptionalHeader;
  var sections = [];

  for (var i = 0; i < numberOfSections && i < 96; i++) {
    var secOff = sectionOffset + i * 40;
    if (secOff + 40 > buffer.byteLength) break;

    var nameBytes = new Uint8Array(buffer, secOff, 8);
    var name = '';
    for (var n = 0; n < 8 && nameBytes[n] !== 0; n++) {
      name += String.fromCharCode(nameBytes[n]);
    }

    var virtualSize = view.getUint32(secOff + 8, true);
    var virtualAddress = view.getUint32(secOff + 12, true);
    var rawDataSize = view.getUint32(secOff + 16, true);
    var rawDataPointer = view.getUint32(secOff + 20, true);
    var characteristics = view.getUint32(secOff + 36, true);

    // 计算节区熵值
    var entropy = 0;
    if (rawDataPointer > 0 && rawDataSize > 0) {
      var start = rawDataPointer;
      var end = Math.min(start + rawDataSize, buffer.byteLength);
      if (start < end) {
        entropy = calculateEntropy(new Uint8Array(buffer, start, end - start));
      }
    }

    var sec = {
      name: name, virtualSize: virtualSize, virtualAddress: virtualAddress,
      rawDataSize: rawDataSize, rawDataPointer: rawDataPointer,
      characteristics: characteristics, entropy: entropy
    };
    sections.push(sec);

    result.sections.push({
      name: name, entropy: entropy.toFixed(2),
      virtualSize: virtualSize, virtualAddress: virtualAddress,
      rawDataSize: rawDataSize, rawDataPointer: rawDataPointer,
      isExecutable: !!(characteristics & 0x20000000),
      isWritable: !!(characteristics & 0x80000000)
    });

    // 高熵值检测（可能加壳）
    if (entropy > 7.0 && rawDataSize > 0) {
      result.riskScore += 15;
      result.entropyWarnings.push('节区 ' + name + ' 熵值 ' + entropy.toFixed(2) + ' (疑似加壳)');
    }

    // 可疑节区名
    var nameLower = name.toLowerCase();
    for (var si = 0; si < SUSPICIOUS_SECTION_NAMES.length; si++) {
      if (nameLower.startsWith(SUSPICIOUS_SECTION_NAMES[si])) {
        result.riskScore += 20;
        result.reasons.push('检测到加壳节区: ' + name);
        break;
      }
    }

    // 可写+可执行节区（RWX）
    if ((characteristics & 0x20000000) && (characteristics & 0x80000000)) {
      result.riskScore += 10;
      result.reasons.push('节区 ' + name + ' 可写且可执行 (RWX)');
    }
  }

  // 解析导入表
  if (importRVA > 0 && sections.length > 0) {
    var importFileOffset = rvaToOffset(importRVA, sections);
    if (importFileOffset !== null && importFileOffset < buffer.byteLength) {
      var allFunctions = [];
      var entryOffset = importFileOffset;

      for (var di = 0; di < 200; di++) {
        if (entryOffset + 20 > buffer.byteLength) break;

        var originalFirstThunk = view.getUint32(entryOffset, true);
        var nameRVA = view.getUint32(entryOffset + 12, true);

        // 导入表结束标记
        if (originalFirstThunk === 0 && nameRVA === 0) break;

        // 获取DLL名
        var nameOff = rvaToOffset(nameRVA, sections);
        if (nameOff !== null && nameOff < buffer.byteLength) {
          var dllName = readAsciiString(view, nameOff, 256).toLowerCase();

          // 通过OriginalFirstThunk获取导入函数名
          if (originalFirstThunk > 0) {
            var thunkOffset = rvaToOffset(originalFirstThunk, sections);
            if (thunkOffset !== null) {
              var thunkEntry = thunkOffset;
              for (var fi = 0; fi < 500; fi++) {
                if (thunkEntry + (is64 ? 8 : 4) > buffer.byteLength) break;
                var thunkValue = is64
                  ? (view.getUint32(thunkEntry, true) >>> 0) // 低32位
                  : view.getUint32(thunkEntry, true);
                if (thunkValue === 0) break;

                // 检查是否按序号导入（最高位为1）
                if (thunkValue & 0x80000000) {
                  allFunctions.push({ dll: dllName, name: 'Ordinal#' + (thunkValue & 0xFFFF) });
                } else {
                  var hintOff = rvaToOffset(thunkValue, sections);
                  if (hintOff !== null && hintOff + 2 < buffer.byteLength) {
                    var funcName = readAsciiString(view, hintOff + 2, 256);
                    if (funcName) {
                      allFunctions.push({ dll: dllName, name: funcName });
                    }
                  }
                }
                thunkEntry += is64 ? 8 : 4;
              }
            }
          }
        }
        entryOffset += 20;
      }

      // 记录导入信息
      var dllMap = {};
      for (var af = 0; af < allFunctions.length; af++) {
        var f = allFunctions[af];
        if (!dllMap[f.dll]) dllMap[f.dll] = [];
        dllMap[f.dll].push(f.name);
      }
      for (var dk in dllMap) {
        result.imports.push(dk + ': ' + dllMap[dk].slice(0, 10).join(', ') + (dllMap[dk].length > 10 ? '...' : ''));
      }

      // 可疑API组合分析
      for (var groupKey in SUSPICIOUS_API_GROUPS) {
        var group = SUSPICIOUS_API_GROUPS[groupKey];
        var matched = [];
        for (var ai = 0; ai < group.apis.length; ai++) {
          for (var afi = 0; afi < allFunctions.length; afi++) {
            if (allFunctions[afi].name.indexOf(group.apis[ai]) !== -1) {
              matched.push(group.apis[ai]);
              break;
            }
          }
        }
        if (matched.length > 0) {
          result.riskScore += group.weight * matched.length;
          result.reasons.push(group.desc + ': ' + matched.join(', '));
        }
      }
    }
  }

  return result;
}

/**
 * 计算SHA256哈希
 */
export async function calculateSHA256(buffer) {
  var hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  var hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

/**
 * 检查SHA256是否在黑名单中
 */
export function checkBlacklist(sha256) {
  return SHA256_BLACKLIST.indexOf(sha256.toLowerCase()) !== -1;
}

/**
 * 检测PE文件是否包含图标资源（简化版图标伪装检测）
 * 无法做pHash，但可检测"文档扩展名+PE含图标"的异常组合
 */
function hasIconResource(buffer, sections, peOffset, optOffset, sizeOfOptionalHeader) {
  try {
    var view = new DataView(buffer);
    // 资源目录在数据目录索引2
    var is64 = view.getUint16(optOffset, true) === 0x20B;
    var dataDirOff = is64 ? optOffset + 112 : optOffset + 96;
    if (dataDirOff + 24 > buffer.byteLength) return false;

    var resourceRVA = view.getUint32(dataDirOff + 16, true); // 索引2
    var resourceSize = view.getUint32(dataDirOff + 20, true);

    if (resourceRVA === 0) return false;

    var resOffset = rvaToOffset(resourceRVA, sections);
    if (resOffset === null) return false;

    // 检查资源目录中是否有RT_ICON (类型3) 或 RT_GROUP_ICON (类型14)
    if (resOffset + 16 > buffer.byteLength) return false;

    var numNamedEntries = view.getUint16(resOffset + 12, true);
    var numIdEntries = view.getUint16(resOffset + 14, true);
    var entryStart = resOffset + 16;

    for (var e = 0; e < numNamedEntries + numIdEntries && e < 20; e++) {
      var eOff = entryStart + e * 8;
      if (eOff + 8 > buffer.byteLength) break;
      var typeId = view.getUint32(eOff, true);
      // RT_ICON=3, RT_GROUP_ICON=14
      if (typeId === 3 || typeId === 14) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * 分析下载URL的恶意特征
 * 银狐木马通常通过特定URL模式分发
 */
function analyzeUrl(url) {
  var result = { score: 0, reasons: [] };
  if (!url) return result;

  try {
    var u = new URL(url);
    var host = u.hostname.toLowerCase();
    var path = u.pathname.toLowerCase();

    // 1. 可疑域名特征 - 银狐常使用临时/免费域名、CDN直链
    // 扩展可疑顶级域名清单（含免费TLD + 高滥用TLD）
    var suspiciousTLDs = [
      // 免费/廉价TLD
      '.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.club', '.site', '.icu',
      // 高滥用率TLD
      '.work', '.click', '.country', '.stream', '.download', '.loan', '.men',
      '.review', '.party', '.trade', '.science', '.racing', '.accountant',
      '.date', '.cricket', '.faith', '.place', '.fun', '.rest', '.uno',
      '.wang', '.gdn', '.kim', '.win', '.bid', '.blue', '.red', '.pw'
    ];
    for (var t = 0; t < suspiciousTLDs.length; t++) {
      if (host.endsWith(suspiciousTLDs[t])) {
        result.score += 8;
        result.reasons.push('可疑顶级域名: ' + suspiciousTLDs[t]);
        break;
      }
    }

    // 2. Punycode/IDN 同形异义域名（homograph attack）
    // 银狐木马常使用含 punycode 的域名伪装知名品牌
    if (host.indexOf('xn--') !== -1) {
      result.score += 15;
      result.reasons.push('域名含Punycode编码（可能为IDN同形异义攻击）');
    }

    // 3. 子域名滥用（过多的子域名层级，常见于免费托管/动态DNS）
    var subdomains = host.split('.').length - 2;
    if (subdomains >= 4) {
      result.score += 8;
      result.reasons.push('子域名层级过多(' + subdomains + '层)，可疑分发渠道');
    }

    // 4. 拼写错误/仿冒域名（typosquatting）
    // 银狐常注册仿冒知名品牌的域名
    var brandPatterns = [
      { brand: 'microsoft', patterns: ['microsft', 'micro-soft', 'micosoft', 'micrasoft', 'microsofts'] },
      { brand: 'adobe', patterns: ['adob', 'adobe-download', 'adobe-update'] },
      { brand: 'google', patterns: ['googie', 'googl', 'goggle', 'google-update'] },
      { brand: 'windows', patterns: ['windos', 'window-update', 'windows-defender'] },
      { brand: 'office', patterns: ['offce', 'office-download', 'office-update', 'wps-office'] },
      { brand: 'chrome', patterns: ['chrom', 'chrome-update', 'chrome-download'] },
      { brand: 'java', patterns: ['java-update', 'java-download', 'jave'] },
      { brand: '360', patterns: ['360safe', '360se', '360doc'] },
      { brand: 'qq', patterns: ['qq-download', 'tencent-download'] }
    ];
    var hostNoTld = host.split('.').slice(-3).join('.');
    for (var b = 0; b < brandPatterns.length; b++) {
      for (var p = 0; p < brandPatterns[b].patterns.length; p++) {
        if (hostNoTld.indexOf(brandPatterns[b].patterns[p]) !== -1) {
          result.score += 12;
          result.reasons.push('疑似仿冒品牌域名: ' + brandPatterns[b].brand + '（typosquatting）');
          b = brandPatterns.length; // 跳出外层循环
          break;
        }
      }
    }

    // 5. 超长随机路径（常用于临时分发链接）
    var pathParts = path.split('/').filter(function(p) { return p.length > 0; });
    var randomParts = pathParts.filter(function(p) { return p.length > 16 && /^[a-z0-9]+$/i.test(p); });
    if (randomParts.length >= 2) {
      result.score += 10;
      result.reasons.push('URL含多层随机路径（典型恶意分发链接）');
    }

    // 6. 直链下载模式（无页面、直接文件链接）
    var dlExts = ['.exe', '.msi', '.bat', '.cmd', '.ps1', '.scr', '.com', '.hta', '.dll'];
    for (var d = 0; d < dlExts.length; d++) {
      if (path.endsWith(dlExts[d])) {
        result.score += 5;
        result.reasons.push('URL直接指向可执行文件: ' + dlExts[d]);
        break;
      }
    }

    // 7. IP地址直接访问（无域名，绕过域名信誉检查）
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
      result.score += 12;
      result.reasons.push('使用IP地址直连（非域名），可疑');
    }
    // IPv6 直接访问
    if (host.indexOf('[') === 0 || (/^[0-9a-f:]+$/i.test(host) && host.indexOf(':') !== -1)) {
      result.score += 12;
      result.reasons.push('使用IPv6地址直连，可疑');
    }

    // 8. 非标准端口访问
    var port = u.port;
    if (port && port !== '80' && port !== '443' && port !== '8080' && port !== '8443') {
      result.score += 6;
      result.reasons.push('使用非标准端口: ' + port);
    }

    // 9. URL 内嵌凭据（user:pass@host，常用于钓鱼/伪装）
    if (u.username || u.password) {
      result.score += 10;
      result.reasons.push('URL含内嵌凭据（user:pass@host），常见于钓鱼链接');
    }

    // 10. 短链接/重定向服务
    var shorteners = ['bit.ly', 't.cn', 'dwz.cn', 'suo.im', 'tinyurl.com', 't.co', 'is.gd', 'v.gd',
      'soo.gd', 'cutt.ly', 'shorte.st', 'bc.vc', 'adfly', 'ouo.io', '1337.to', 'rebrand.ly'];
    for (var s = 0; s < shorteners.length; s++) {
      if (host === shorteners[s] || host.endsWith('.' + shorteners[s])) {
        result.score += 8;
        result.reasons.push('使用短链接服务: ' + shorteners[s] + '（可能隐藏真实下载地址）');
        break;
      }
    }

    // 11. 云存储/社交平台直链（银狐常用网盘分发）
    var cloudHosts = ['objects.githubusercontent.com', 'raw.githubusercontent.com',
      'cdn.discordapp.com', 'media.discordapp.net', 'drive.google.com',
      'dl.dropboxusercontent.com', 'api.telegram.org',
      // 扩展云存储/网盘域名
      'docs.google.com', 'onedrive.live.com', '1drv.ms',
      'mega.nz', 'mega.co.nz', 'mediafire.com',
      'wetransfer.com', 'onedrive.live.com',
      'aliyundrive.net', 'alipan.com', 'aliyundrive.com',
      'pan.baidu.com', 'pan.quark.cn', 'cloud.189.cn',
      'lanzou.com', 'lanzoui.com', 'lanzoux.com', 'lanzoup.com', 'lanzoue.com', 'lanzouw.com',
      'catbox.moe', 'litterbox.catbox.moe', 'ufile.io', 'file.io', 'gofile.io',
      'workupload.com', 'send-anywhere.com', 'transfer.sh', '0x0.st'];
    for (var c = 0; c < cloudHosts.length; c++) {
      if (host.endsWith(cloudHosts[c])) {
        result.score += 6;
        result.reasons.push('从云存储/网盘下载可执行文件: ' + cloudHosts[c]);
        break;
      }
    }

    // 12. 可疑查询参数（如带密码、过期时间等）
    var search = u.search.toLowerCase();
    if (search.includes('token=') || search.includes('key=') || search.includes('pass=')) {
      result.score += 3;
      result.reasons.push('URL含认证参数（可能为限时恶意链接）');
    }

    // 13. 重定向参数（可能跳转到恶意下载）
    var redirectParams = ['redirect=', 'url=', 'goto=', 'next=', 'target=', 'redir=', 'return='];
    for (var r = 0; r < redirectParams.length; r++) {
      if (search.indexOf(redirectParams[r]) !== -1) {
        result.score += 4;
        result.reasons.push('URL含重定向参数: ' + redirectParams[r].replace('=', '') + '（可能跳转恶意地址）');
        break;
      }
    }

    // 14. 动态DNS/免费托管服务域名
    var dynamicDnsHosts = ['ddns.net', 'duckdns.org', 'no-ip.com', 'freedns.org', 'dynu.net',
      'changeip.com', 'myftp.org', 'serveftp.com', 'sytes.net', 'zapto.org'];
    for (var dd = 0; dd < dynamicDnsHosts.length; dd++) {
      if (host.endsWith(dynamicDnsHosts[dd])) {
        result.score += 10;
        result.reasons.push('使用动态DNS服务: ' + dynamicDnsHosts[dd] + '（常用于临时C2/分发）');
        break;
      }
    }

    // 15. 可疑URL编码路径（多次URL编码，常见于规避检测）
    var decoded = decodeURIComponent(path);
    var encodeCount = 0;
    var testPath = path;
    for (var enc = 0; enc < 3; enc++) {
      try {
        var newDecoded = decodeURIComponent(testPath);
        if (newDecoded !== testPath) {
          encodeCount++;
          testPath = newDecoded;
        } else break;
      } catch (e) { break; }
    }
    if (encodeCount >= 2) {
      result.score += 7;
      result.reasons.push('URL路径含多层编码(' + encodeCount + '层)，疑似规避检测');
    }

  } catch (e) {
    // URL解析失败，不加分
  }

  return result;
}

/**
 * 分析文件名的可疑特征
 * 银狐木马经常使用特定文件名模式伪装
 */
function analyzeFilename(filename) {
  var result = { score: 0, reasons: [] };
  if (!filename) return result;

  var name = filename.toLowerCase();

  // 1. 双扩展名伪装（如 .pdf.exe, .docx.scr）
  var doubleExtPattern = /\.(pdf|docx?|xlsx?|pptx?|txt|rtf|jpg|png|zip|rar)\.(exe|msi|bat|cmd|ps1|vbs|js|scr|com|hta|cpl|dll|sys|wsf)$/i;
  if (doubleExtPattern.test(filename)) {
    result.score += 40;
    result.reasons.push('双扩展名伪装（如 .pdf.exe），极大概率恶意');
  }

  // 2. 文档图标伪装关键词
  var docKeywords = ['通知', '公告', '文件', '通知单', '通报', '决定', '报告', '方案',
    'statement', 'invoice', 'receipt', 'order', 'document', 'report', 'payment'];
  var dangerousExts = ['.exe', '.scr', '.com', '.bat', '.cmd', '.ps1', '.vbs', '.hta'];
  var ext = '.' + filename.split('.').pop().toLowerCase();
  if (dangerousExts.indexOf(ext) !== -1) {
    for (var k = 0; k < docKeywords.length; k++) {
      if (name.indexOf(docKeywords[k]) !== -1) {
        result.score += 15;
        result.reasons.push('文件名含文档关键词但为可执行文件: "' + docKeywords[k] + '"');
        break;
      }
    }
  }

  // 3. Unicode/零宽度字符混淆（RTL override 等）
  if (/[^\x00-\x7F]/.test(filename) && dangerousExts.indexOf(ext) !== -1) {
    // 检查是否含RTL覆盖等控制字符
    if (/[\u202A-\u202E\u2066-\u2069]/.test(filename)) {
      result.score += 35;
      result.reasons.push('文件名含Unicode方向控制字符（RTL欺骗）');
    }
  }

  // 4. 超长文件名（混淆注意力）
  if (filename.length > 80) {
    result.score += 5;
    result.reasons.push('文件名异常长（可能用于混淆）');
  }

  // 5. 多个连续空格或点
  if (/\s{3,}/.test(filename) || /\.{3,}/.test(filename)) {
    result.score += 8;
    result.reasons.push('文件名含多个连续空格或点（常见伪装手法）');
  }

  return result;
}

/**
 * 主分析入口 - 结合元数据与PE深度分析
 * @param {Object} params
 * @param {ArrayBuffer} [params.buffer] - 文件数据（前1MB）
 * @param {string} params.filename - 下载文件名
 * @param {string} [params.mime] - MIME类型
 * @param {string} params.url - 下载URL
 * @param {string} sensitivity - 'low' | 'medium' | 'high'
 * @returns {Object} { is_malicious, risk_score, reasons }
 */
export async function analyzeFile(params, sensitivity) {
  sensitivity = sensitivity || 'medium';
  var buffer = params.buffer;
  var filename = params.filename || '';
  var mime = params.mime;
  var url = params.url || '';
  var reasons = [];
  var riskScore = 0;

  var ext = filename ? filename.split('.').pop().toLowerCase() : '';
  var DANGEROUS_EXTS = ['exe', 'msi', 'bat', 'cmd', 'ps1', 'vbs', 'js', 'wsf', 'scr', 'com', 'dll', 'sys', 'hta', 'cpl',
    'jar', 'lnk', 'url', 'reg', 'chm', 'iso', 'img', 'vhd', 'vhdx', 'hwp', 'hwpx', 'sh', 'py', 'pyc', 'apk', 'ocx', 'job'];
  var DOC_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf'];
  var SUSPICIOUS_MIMES = ['application/octet-stream', 'application/x-msdownload', 'application/x-dosexec', 'application/x-executable'];

  var isDangerous = DANGEROUS_EXTS.indexOf(ext) !== -1;
  var looksLikeDoc = DOC_EXTS.indexOf(ext) !== -1;

  // 1. 文件名分析（双扩展名、关键词伪装、Unicode欺骗等）
  var filenameResult = analyzeFilename(filename);
  riskScore += filenameResult.score;
  for (var fn = 0; fn < filenameResult.reasons.length; fn++) reasons.push(filenameResult.reasons[fn]);

  // 2. URL模式分析（可疑域名、直链、短链接等）
  var urlResult = analyzeUrl(url);
  riskScore += urlResult.score;
  for (var un = 0; un < urlResult.reasons.length; un++) reasons.push(urlResult.reasons[un]);

  // 3. MIME与扩展名不匹配
  if (looksLikeDoc && mime && SUSPICIOUS_MIMES.indexOf(mime) !== -1) {
    riskScore += 30;
    reasons.push('文件扩展名 .' + ext + ' 与MIME类型 ' + mime + ' 不匹配 (疑似伪装)');
  }
  if (looksLikeDoc && mime && mime.indexOf('executable') !== -1) {
    riskScore += 25;
    reasons.push('文档扩展名但MIME为可执行类型: ' + mime);
  }

  // 4. 可执行文件基础风险
  if (isDangerous) {
    riskScore += 5;
  }

  // 3. PE深度分析（如果有文件数据）
  var peAnalyzed = false;
  if (buffer && buffer.byteLength > 64) {
    var peResult = analyzePE(buffer);
    peAnalyzed = peResult.isPE;

    if (peResult.isPE) {
      riskScore += peResult.riskScore;
      for (var r = 0; r < peResult.reasons.length; r++) reasons.push(peResult.reasons[r]);
      for (var w = 0; w < peResult.entropyWarnings.length; w++) reasons.push(peResult.entropyWarnings[w]);

      // 文档扩展名+PE文件 = 极大概率图标伪装
      if (looksLikeDoc) {
        riskScore += 50;
        reasons.push('文件扩展名为文档类型但实际为PE可执行文件 (图标伪装)');
      }

      // 含图标资源的可执行文件 + 文档扩展名 → 伪装概率极高
      if (looksLikeDoc && peResult.sections.length > 0) {
        var peOff = new DataView(buffer).getUint32(0x3C, true);
        var optOff = peOff + 4 + 20;
        if (hasIconResource(buffer, peResult.sections, peOff, optOff, 0)) {
          riskScore += 20;
          reasons.push('PE文件含图标资源且伪装为文档 (银狐特征)');
        }
      }

      // SHA256黑名单
      try {
        var sha256 = await calculateSHA256(buffer);
        if (checkBlacklist(sha256)) {
          riskScore += 100;
          reasons.push('SHA256命中黑名单: ' + sha256.substring(0, 16) + '...');
        }
      } catch (e) {}
    }
  }

  // 4. 灵敏度阈值判断
  var THRESHOLDS = { low: 40, medium: 25, high: 15 };
  var threshold = THRESHOLDS[sensitivity] || 25;

  return {
    is_malicious: riskScore >= threshold,
    risk_score: riskScore,
    reasons: reasons.length > 0 ? reasons : ['未发现明显威胁特征'],
    details: { peAnalyzed: peAnalyzed }
  };
}
