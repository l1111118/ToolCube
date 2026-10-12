/**
 * 哈希生成器 - 使用Web Crypto API（无外部依赖，纯本地运行）
 */
const elements = {
  inputText: document.getElementById('input-text'),
  fileInput: document.getElementById('file-input'),
  btnCalculate: document.getElementById('btn-calculate'),
  btnClear: document.getElementById('btn-clear'),
  btnFile: document.getElementById('btn-file'),
  resultUpper: document.getElementById('result-upper'),
  resultLower: document.getElementById('result-lower'),
  toast: document.getElementById('toast'),
  algoRadios: document.querySelectorAll('input[name="algo"]')
};

function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
// ============ MD5 纯 JS 实现（RFC 1321） ============
// WebCrypto 不提供 MD5，故自行实现。两处历史缺陷已在此修正：
//  1) 必须按 64 字节分块处理「全部」数据。原实现只处理最后一个填充块，
//     导致长度 ≥64 字节的输入全部算错 —— 文件哈希（任何文件都 ≥64 字节）必然错误。
//  2) 必须直接在字节层面运算。原 md5ArrayBuffer 先把字节转成字符再交给 md5() 做 UTF-8 编码，
//     使 ≥0x80 的字节被二次编码，二进制内容哈希错误。
/**
 * 对「每字符即一字节」的字节串计算 MD5
 * @param {string} byteStr 字节串（charCodeAt 取值 0-255）
 * @returns {string} 32 位小写十六进制摘要
 */
function md5FromBytes(byteStr) {
  function rotl(n, b) { return (n << b) | (n >>> (32 - b)); }
  function toHexStr(n) {
    var s = '', i, v;
    for (i = 0; i <= 3; i++) {
      v = (n >>> (i * 8)) & 0xFF;
      s += ('0' + v.toString(16)).slice(-2);
    }
    return s;
  }
  function md5cycle(x, k) {
    var a = x[0], b = x[1], c = x[2], d = x[3];
    a = ff(a, b, c, d, k[0], 7, -680876936);
    d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819);
    b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897);
    d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341);
    b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416);
    d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063);
    b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682);
    d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290);
    b = ff(b, c, d, a, k[15], 22, 1236535329);
    a = gg(a, b, c, d, k[1], 5, -165796510);
    d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713);
    b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691);
    d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335);
    b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438);
    d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961);
    b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467);
    d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473);
    b = gg(b, c, d, a, k[12], 20, -1926607734);
    a = hh(a, b, c, d, k[5], 4, -378558);
    d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562);
    b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060);
    d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632);
    b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174);
    d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979);
    b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487);
    d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520);
    b = hh(b, c, d, a, k[2], 23, -995338651);
    a = ii(a, b, c, d, k[0], 6, -198630844);
    d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905);
    b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571);
    d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523);
    b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359);
    d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380);
    b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070);
    d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259);
    b = ii(b, c, d, a, k[9], 21, -343485551);
    x[0] = add32(a, x[0]);
    x[1] = add32(b, x[1]);
    x[2] = add32(c, x[2]);
    x[3] = add32(d, x[3]);
  }
  function cmn(q, a, b, x, s, t) {
    a = add32(add32(a, q), add32(x, t));
    return add32(rotl(a, s), b);
  }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
  function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
  
  var len = byteStr.length;   // 字节长度
  var bitLen = len * 8;       // 位长度

  // 填充规则（RFC 1321）：追加 0x80，补零至 (len + 1 + 8) 为 64 字节的整数倍，
  // 末尾 8 字节写入小端位长度。这里一次性构造完整的 32 位小端字数组。
  var wordCount = (Math.floor((bitLen + 64) / 512) + 1) * 16;
  var x = new Array(wordCount);
  for (var w = 0; w < wordCount; w++) x[w] = 0;
  for (var b = 0; b < len; b++) {
    x[b >> 2] |= byteStr.charCodeAt(b) << ((b % 4) << 3);
  }
  x[Math.floor(bitLen / 32)] |= 0x80 << (bitLen % 32);
  var lenWord = Math.floor((bitLen + 64) / 512) * 16 + 14;
  x[lenWord] = bitLen >>> 0;                        // 长度低 32 位
  x[lenWord + 1] = Math.floor(bitLen / 4294967296); // 长度高 32 位

  // 按 64 字节（16 个字）逐块处理全部数据
  var state = [1732584193, -271733879, -1732584194, 271733878];
  for (var off = 0; off < x.length; off += 16) {
    md5cycle(state, x.slice(off, off + 16));
  }
  return toHexStr(state[0]) + toHexStr(state[1]) + toHexStr(state[2]) + toHexStr(state[3]);
}

/**
 * UTF-8 编码：字符串 → 字节串（每字符一字节）
 * @param {string} string
 * @returns {string}
 */
function toUtf8ByteString(string) {
  var utf8 = '';
  for (var i = 0; i < string.length; i++) {
    var c = string.charCodeAt(i);
    if (c < 128) {
      utf8 += String.fromCharCode(c);
    } else if (c < 2048) {
      utf8 += String.fromCharCode(192 | (c >> 6));
      utf8 += String.fromCharCode(128 | (c & 63));
    } else if (c < 55296 || c >= 57344) {
      utf8 += String.fromCharCode(224 | (c >> 12));
      utf8 += String.fromCharCode(128 | ((c >> 6) & 63));
      utf8 += String.fromCharCode(128 | (c & 63));
    } else {
      // 代理对：合并为完整码点后按 4 字节 UTF-8 编码
      i++;
      c = 65536 + ((c & 1023) << 10) | (string.charCodeAt(i) & 1023);
      utf8 += String.fromCharCode(240 | (c >> 18));
      utf8 += String.fromCharCode(128 | ((c >> 12) & 63));
      utf8 += String.fromCharCode(128 | ((c >> 6) & 63));
      utf8 += String.fromCharCode(128 | (c & 63));
    }
  }
  return utf8;
}

/**
 * 计算字符串的 MD5（先做 UTF-8 编码）
 * @param {string} string
 * @returns {string}
 */
function md5(string) {
  return md5FromBytes(toUtf8ByteString(string));
}

/**
 * 计算 ArrayBuffer 的 MD5
 * 直接使用原始字节，不做 UTF-8 再编码（否则 ≥0x80 的字节会被二次编码，结果错误）
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function md5ArrayBuffer(buffer) {
  var bytes = new Uint8Array(buffer);
  var CHUNK = 8192; // 分块避免 String.fromCharCode 参数过多导致栈溢出
  var parts = [];
  for (var i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length))));
  }
  return md5FromBytes(parts.join(''));
}

// ============ Web Crypto API 哈希计算 ============
async function shaHash(algo, data) {
  if (algo === 'MD5') {
    return typeof data === 'string' ? md5(data) : md5ArrayBuffer(data);
  }
  const encoder = new TextEncoder();
  const buffer = typeof data === 'string' ? encoder.encode(data) : data;
  const hashBuffer = await crypto.subtle.digest(algo, buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  elements.btnCalculate.addEventListener('click', calculateHash);
  elements.btnClear.addEventListener('click', () => {
    elements.inputText.value = '';
    elements.resultUpper.value = '';
    elements.resultLower.value = '';
  });
  elements.btnFile.addEventListener('click', () => elements.fileInput.click());
  elements.fileInput.addEventListener('change', handleFile);
  document.querySelectorAll('.btn--icon').forEach(btn => {
    btn.addEventListener('click', () => copyToClipboard(document.getElementById(btn.dataset.target).value));
  });
  // 主题和setData消息通过window.addEventListener处理
  loadSavedData();
});

async function calculateHash() {
  const text = elements.inputText.value;
  if (!text) { showToast('请输入文本', 'error'); return; }
  
  const algo = document.querySelector('input[name="algo"]:checked').value;
  
  try {
    const algoMap = { 'MD5': 'MD5', 'SHA-1': 'SHA-1', 'SHA-256': 'SHA-256', 'SHA-512': 'SHA-512' };
    const hex = await shaHash(algoMap[algo], text);
    elements.resultUpper.value = hex.toUpperCase();
    elements.resultLower.value = hex.toLowerCase();
    showToast('计算完成', 'success');
    saveToHistory(algo, 'hash');
  } catch (e) { showToast('计算失败: ' + e.message, 'error'); }
}

function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = async (event) => {
    const algo = document.querySelector('input[name="algo"]:checked').value;
    try {
      const algoMap = { 'MD5': 'MD5', 'SHA-1': 'SHA-1', 'SHA-256': 'SHA-256', 'SHA-512': 'SHA-512' };
      const hex = await shaHash(algoMap[algo], event.target.result);
      elements.resultUpper.value = hex.toUpperCase();
      elements.resultLower.value = hex.toLowerCase();
      elements.inputText.value = '[文件] ' + file.name + ' (' + formatSize(file.size) + ')';
      showToast('文件哈希计算完成', 'success');
    } catch (e) {
      showToast('计算失败: ' + e.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

async function copyToClipboard(text) {
  if (!text) { showToast('没有可复制的内容', 'error'); return; }
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制', 'success');
  } catch (e) { showToast('复制失败', 'error'); }
}

function showToast(msg, type) {
  type = type || 'info';
  elements.toast.textContent = msg;
  elements.toast.className = 'toast toast--' + type;
  elements.toast.classList.add('toast--show');
  setTimeout(function() { elements.toast.classList.remove('toast--show'); }, 3000);
}

async function saveToHistory(input, action) {
  try {
    await safeSend({
      action: 'saveToHistory',
      data: { toolId: 'hash-generator', type: action, data: { algo: input, action: action } }
    });
  } catch (e) {}
}

async function loadSavedData() {
  try {
    var res = await safeSend({ action: 'getToolData', data: { toolId: 'hash-generator' } });
    if (res && res.text) elements.inputText.value = res.text;
  } catch (e) {}
}

// 主题切换和setData消息监听（统一处理，无重复）
window.addEventListener('message', function(event) {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!event.data || event.source !== window.parent) return;
  if (event.data && event.data.action === 'setTheme' && event.data.data) {
    document.documentElement.setAttribute('data-theme', event.data.data.theme);
  }
  if (event.data && event.data.action === 'setData' && typeof event.data.data === 'string') {
    elements.inputText.value = event.data.data;
    calculateHash();
  }
});
