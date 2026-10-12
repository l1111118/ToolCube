/**
 * Payload编码器 - 多层链式编码/解码工具
 */
document.addEventListener('DOMContentLoaded', () => {
  const els = {
    inputArea: document.getElementById('input-area'),
    outputArea: document.getElementById('output-area'),
    inputStatus: document.getElementById('input-status'),
    encodingList: document.getElementById('encoding-list'),
    btnEncode: document.getElementById('btn-encode'),
    btnDecode: document.getElementById('btn-decode'),
    btnExecute: document.getElementById('btn-execute'),
    btnClear: document.getElementById('btn-clear'),
    btnCopy: document.getElementById('btn-copy'),
    chainText: document.getElementById('chain-text'),
    toast: document.getElementById('toast')
  };
  function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
  function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
  function safeStorage(op, ...args) { if (!isCtxValid()) return op === 'get' ? Promise.resolve({}) : Promise.resolve(); try { return chrome.storage.local[op](...args); } catch(e) { return op === 'get' ? Promise.resolve({}) : Promise.resolve(); } }

  async function saveToHistory(input, action) {
    try {
      await safeSend({
        action: 'saveToHistory',
        data: { toolId: 'payload-encoder', type: action, data: { input: input.substring(0, 200), action } }
      });
    } catch (e) {}
  }

  let direction = 'encode';

  // Encoding name map
  const ENC_NAMES = {
    'url': 'URL编码',
    'double-url': '双重URL编码',
    'base64': 'Base64编码',
    'base32': 'Base32编码',
    'html': 'HTML实体编码',
    'unicode': 'Unicode编码',
    'hex': '十六进制编码',
    'octal': '八进制编码',
    'rot13': 'ROT13',
    'reverse': '反转字符串',
    'utf8-bytes': 'UTF-8字节',
    'xml-cdata': 'XML CDATA'
  };

  // HTML entity map
  const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  const HTML_ENTITY_REVERSE = {};
  for (const [k, v] of Object.entries(HTML_ENTITIES)) HTML_ENTITY_REVERSE[v] = k;

  // --- Encode functions ---
  function encodeURL(s) { return encodeURIComponent(s); }
  function encodeDoubleURL(s) { return encodeURIComponent(encodeURIComponent(s)); }
  function encodeBase64(s) {
    try { return btoa(unescape(encodeURIComponent(s))); }
    catch (e) { throw new Error('Base64编码失败'); }
  }
  // Base32 编码 (RFC 4648, 字母表 A-Z2-7)
  const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function encodeBase32(s) {
    try {
      const bytes = new TextEncoder().encode(s);
      let bits = 0, value = 0, output = '';
      for (let i = 0; i < bytes.length; i++) {
        value = (value << 8) | bytes[i];
        bits += 8;
        while (bits >= 5) {
          output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
          bits -= 5;
        }
      }
      if (bits > 0) {
        output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
      }
      // 按 8 字符分组填充 =
      while (output.length % 8 !== 0) output += '=';
      return output;
    } catch (e) { throw new Error('Base32编码失败'); }
  }
  function encodeHTML(s) {
    return s.replace(/[&<>"']/g, c => HTML_ENTITIES[c] || c);
  }
  function encodeUnicode(s) {
    return s.split('').map(c => {
      const code = c.charCodeAt(0);
      if (code > 0xFFFF) {
        const hi = Math.floor((code - 0x10000) / 0x400) + 0xD800;
        const lo = ((code - 0x10000) % 0x400) + 0xDC00;
        return '\\u' + hi.toString(16).padStart(4, '0') + '\\u' + lo.toString(16).padStart(4, '0');
      }
      return '\\u' + code.toString(16).padStart(4, '0');
    }).join('');
  }
  function encodeHex(s) {
    return s.split('').map(c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  }
  function encodeOctal(s) {
    return s.split('').map(c => '\\' + c.charCodeAt(0).toString(8).padStart(3, '0')).join('');
  }
  function encodeROT13(s) {
    return s.replace(/[a-zA-Z]/g, c => {
      const base = c <= 'Z' ? 65 : 97;
      return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
    });
  }
  function encodeReverse(s) { return s.split('').reverse().join(''); }
  function encodeUTF8Bytes(s) {
    return Array.from(new TextEncoder().encode(s)).map(b => '%' + b.toString(16).padStart(2, '0')).join('');
  }
  function encodeXMLCdata(s) { return '<![CDATA[' + s + ']]>'; }

  // --- Decode functions ---
  function decodeURL(s) {
    try { return decodeURIComponent(s); }
    catch (e) { throw new Error('URL解码失败：无效编码'); }
  }
  function decodeDoubleURL(s) {
    try { return decodeURIComponent(decodeURIComponent(s)); }
    catch (e) { throw new Error('双重URL解码失败：无效编码'); }
  }
  function decodeBase64(s) {
    try { return decodeURIComponent(escape(atob(s))); }
    catch (e) { throw new Error('Base64解码失败：无效编码'); }
  }
  // Base32 解码
  function decodeBase32(s) {
    try {
      const cleaned = s.replace(/=+$/g, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
      let bits = 0, value = 0;
      const bytes = [];
      for (let i = 0; i < cleaned.length; i++) {
        const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
        if (idx < 0) continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
          bytes.push((value >>> (bits - 8)) & 0xff);
          bits -= 8;
        }
      }
      return new TextDecoder().decode(new Uint8Array(bytes));
    } catch (e) { throw new Error('Base32解码失败：无效编码'); }
  }
  function decodeHTML(s) {
    return s.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(\w+));/g, (match, dec, hex, name) => {
      if (dec) return String.fromCharCode(parseInt(dec, 10));
      if (hex) return String.fromCharCode(parseInt(hex, 16));
      if (HTML_ENTITY_REVERSE[match]) return HTML_ENTITY_REVERSE[match];
      const el = document.createElement('textarea');
      el.innerHTML = match;
      return el.value;
    });
  }
  function decodeUnicode(s) {
    return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  function decodeHex(s) {
    return s.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  function decodeOctal(s) {
    return s.replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
  }
  function decodeROT13(s) { return encodeROT13(s); }
  function decodeReverse(s) { return s.split('').reverse().join(''); }
  function decodeUTF8Bytes(s) {
    try {
      const bytes = s.replace(/%([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).split('');
      const arr = new Uint8Array(bytes.map(c => c.charCodeAt(0)));
      return new TextDecoder().decode(arr);
    } catch (e) { throw new Error('UTF-8字节解码失败'); }
  }
  function decodeXMLCdata(s) { return s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, ''); }

  // --- 编码检测 ---
  function detectEncoding(s) {
    const results = [];
    // Base64检测
    if (/^[A-Za-z0-9+\/]+=*$/.test(s) && s.length % 4 === 0 && s.length > 4) {
      try { atob(s); results.push({ type: 'base64', confidence: 'high' }); } catch(e) {}
    }
    // Base32检测 (A-Z2-7, 可选 = 填充, 长度8的倍数)
    if (/^[A-Z2-7]+=*$/.test(s.toUpperCase()) && s.length % 8 === 0 && s.length >= 8) {
      results.push({ type: 'base32', confidence: 'medium' });
    }
    // URL编码检测
    if (/%[0-9a-fA-F]{2}/.test(s)) {
      const count = (s.match(/%[0-9a-fA-F]{2}/g) || []).length;
      results.push({ type: count > 3 ? 'url' : 'double-url', confidence: count > 3 ? 'high' : 'medium' });
    }
    // Unicode编码检测
    if (/\\u[0-9a-fA-F]{4}/.test(s)) results.push({ type: 'unicode', confidence: 'high' });
    // Hex编码检测
    if (/\\x[0-9a-fA-F]{2}/.test(s)) results.push({ type: 'hex', confidence: 'high' });
    // HTML实体检测
    if (/&#\d+;|&#x[0-9a-fA-F]+;|&\w+;/.test(s)) results.push({ type: 'html', confidence: 'high' });
    // 八进制检测
    if (/\\[0-7]{3}/.test(s)) results.push({ type: 'octal', confidence: 'medium' });
    return results;
  }

  // Encode / decode function maps
  const ENCODERS = {
    'url': encodeURL,
    'double-url': encodeDoubleURL,
    'base64': encodeBase64,
    'base32': encodeBase32,
    'html': encodeHTML,
    'unicode': encodeUnicode,
    'hex': encodeHex,
    'octal': encodeOctal,
    'rot13': encodeROT13,
    'reverse': encodeReverse,
    'utf8-bytes': encodeUTF8Bytes,
    'xml-cdata': encodeXMLCdata
  };
  const DECODERS = {
    'url': decodeURL,
    'double-url': decodeDoubleURL,
    'base64': decodeBase64,
    'base32': decodeBase32,
    'html': decodeHTML,
    'unicode': decodeUnicode,
    'hex': decodeHex,
    'octal': decodeOctal,
    'rot13': decodeROT13,
    'reverse': decodeReverse,
    'utf8-bytes': decodeUTF8Bytes,
    'xml-cdata': decodeXMLCdata
  };

  // Get selected encoding order
  function getSelectedEncodings() {
    const chips = els.encodingList.querySelectorAll('.chip');
    const selected = [];
    chips.forEach(chip => {
      if (chip.classList.contains('checked')) {
        selected.push(chip.dataset.enc);
      }
    });
    return selected;
  }

  // Chip toggle
  els.encodingList.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    chip.classList.toggle('checked');
    const cb = chip.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = chip.classList.contains('checked');
  });

  // Direction toggle
  els.btnEncode.addEventListener('click', () => {
    direction = 'encode';
    els.btnEncode.classList.add('active');
    els.btnDecode.classList.remove('active');
  });
  els.btnDecode.addEventListener('click', () => {
    direction = 'decode';
    els.btnDecode.classList.add('active');
    els.btnEncode.classList.remove('active');
  });

  // Execute
  els.btnExecute.addEventListener('click', () => {
    const input = els.inputArea.value;
    if (!input) { showToast('请输入内容', 'error'); return; }

    const selected = getSelectedEncodings();
    if (selected.length === 0) { showToast('请选择至少一种编码方式', 'error'); return; }

    let result = input;
    const steps = [];
    const funcMap = direction === 'encode' ? ENCODERS : DECODERS;
    // For decode, apply in reverse order
    const order = direction === 'decode' ? [...selected].reverse() : selected;

    for (const enc of order) {
      try {
        result = funcMap[enc](result);
        steps.push(ENC_NAMES[enc]);
      } catch (err) {
        showToast(`${ENC_NAMES[enc]}${direction === 'encode' ? '编码' : '解码'}失败：${err.message}`, 'error');
        return;
      }
    }

    els.outputArea.value = result;

    // Build chain display
    const chainParts = ['原文'];
    if (direction === 'decode') {
      const reversedSteps = [...steps].reverse();
      reversedSteps.forEach(s => chainParts.push(s));
    } else {
      steps.forEach(s => chainParts.push(s));
    }
    chainParts.push('结果');
    els.chainText.innerHTML = chainParts.map(p =>
      p === '原文' || p === '结果'
        ? `<span>${p}</span>`
        : `<span class="chain-step">${p}</span>`
    ).join('<span class="chain-arrow"> → </span>');

    showToast(`${direction === 'encode' ? '编码' : '解码'}成功`, 'success');
    saveToHistory(input, direction);
    // 保存到本地编码历史（包含链式步骤）
    saveHistory(direction, steps, input, result);
  });

  // Copy
  els.btnCopy.addEventListener('click', async () => {
    const text = els.outputArea.value;
    if (!text) { showToast('没有可复制的内容', 'error'); return; }
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制到剪贴板', 'success');
    } catch (e) {
      showToast('复制失败', 'error');
    }
  });

  // Clear
  els.btnClear.addEventListener('click', () => {
    els.inputArea.value = '';
    els.outputArea.value = '';
    els.inputStatus.textContent = '0 字符';
    els.chainText.innerHTML = '等待执行';
    // Uncheck all chips
    els.encodingList.querySelectorAll('.chip').forEach(chip => {
      chip.classList.remove('checked');
      const cb = chip.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = false;
    });
  });

  // Input status
  els.inputArea.addEventListener('input', () => {
    els.inputStatus.textContent = `${els.inputArea.value.length} 字符`;
  });

  // 多重编码（同一编码重复N次）
  var btnMultiEncode = document.getElementById('btn-multi-encode');
  var multiCount = document.getElementById('multi-encode-count');
  var multiEncType = document.getElementById('multi-encode-type');
  if (btnMultiEncode) {
    btnMultiEncode.addEventListener('click', () => {
      const input = els.inputArea.value;
      if (!input) { showToast('请输入内容', 'error'); return; }
      const count = Math.min(10, Math.max(1, parseInt(multiCount ? multiCount.value : '3', 10) || 3));
      const encType = multiEncType ? multiEncType.value : 'url';
      let result = input;
      const funcMap = direction === 'encode' ? ENCODERS : DECODERS;
      for (let i = 0; i < count; i++) {
        try { result = funcMap[encType](result); } catch (err) { showToast(`第${i+1}次${direction === 'encode' ? '编码' : '解码'}失败：${err.message}`, 'error'); return; }
      }
      els.outputArea.value = result;
      els.chainText.innerHTML = `<span>原文</span><span class="chain-arrow"> → </span><span class="chain-step">${ENC_NAMES[encType]} ×${count}</span><span class="chain-arrow"> → </span><span>结果</span>`;
      showToast(`${direction === 'encode' ? '编码' : '解码'}成功 (${count}次)`, 'success');
    });
  }

  // 编码检测
  var btnDetect = document.getElementById('btn-detect-encoding');
  var detectResult = document.getElementById('detect-result');
  if (btnDetect && detectResult) {
    btnDetect.addEventListener('click', () => {
      const input = els.inputArea.value;
      if (!input) { showToast('请输入内容', 'error'); return; }
      const results = detectEncoding(input);
      if (results.length === 0) {
        detectResult.innerHTML = '<div style="color:var(--tt-text-tertiary);font-size:12px">未检测到已知编码格式</div>';
      } else {
        detectResult.innerHTML = results.map(r =>
          '<div style="font-size:12px;padding:2px 0">' +
          (r.confidence === 'high' ? '🟢' : '🟡') + ' ' +
          '<strong>' + (ENC_NAMES[r.type] || r.type) + '</strong>' +
          ' (置信度: ' + (r.confidence === 'high' ? '高' : '中') + ')' +
          ' <button class="detect-apply" data-type="' + r.type + '" style="cursor:pointer;color:var(--tt-primary);font-size:11px">应用解码</button></div>'
        ).join('');
        detectResult.querySelectorAll('.detect-apply').forEach(btn => {
          btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            if (DECODERS[type]) {
              try {
                els.outputArea.value = DECODERS[type](els.inputArea.value);
                showToast('已应用' + ENC_NAMES[type] + '解码', 'success');
              } catch(e) { showToast('解码失败: ' + e.message, 'error'); }
            }
          });
        });
      }
    });
  }

  // ==================== 编码历史记录 ====================
  const HISTORY_KEY = 'payload-encoder-history';
  const MAX_HISTORY = 15;
  const historyList = document.getElementById('history-list');
  const btnClearHistory = document.getElementById('btn-clear-history');

  // 保存历史记录到 storage
  async function saveHistory(action, chainSteps, inputPreview, outputPreview) {
    try {
      const data = await safeStorage('get', HISTORY_KEY);
      const list = data[HISTORY_KEY] || [];
      list.unshift({
        action: action,
        chain: chainSteps.join(' → '),
        input: inputPreview.substring(0, 60),
        output: outputPreview.substring(0, 60),
        time: Date.now()
      });
      // 限制最大数量
      if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
      await safeStorage('set', { [HISTORY_KEY]: list });
      renderHistory(list);
    } catch (e) {}
  }

  // 渲染历史记录
  function renderHistory(list) {
    if (!historyList) return;
    if (!list || list.length === 0) {
      historyList.innerHTML = '<div class="history-empty">暂无历史记录</div>';
      return;
    }
    historyList.innerHTML = list.map((item, idx) => {
      const timeStr = new Date(item.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const actionLabel = item.action === 'encode' ? '🔒编码' : '🔓解码';
      return '<div class="history-item" data-idx="' + idx + '" title="点击恢复输入">' +
        '<span class="history-item-action">' + actionLabel + '</span>' +
        '<span class="history-item-chain">' + escapeHtml(item.chain) + '</span>' +
        '<span class="history-item-time">' + timeStr + '</span>' +
      '</div>';
    }).join('');
    // 存一份到全局供点击恢复使用
    historyList._items = list;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // 点击历史项恢复输入
  if (historyList) {
    historyList.addEventListener('click', (e) => {
      const item = e.target.closest('.history-item');
      if (!item) return;
      const list = historyList._items || [];
      const idx = parseInt(item.dataset.idx, 10);
      const rec = list[idx];
      if (!rec) return;
      // 编码则恢复原始输入；解码则恢复原始输入（即被解码的内容）
      els.inputArea.value = rec.input;
      els.inputStatus.textContent = rec.input.length + ' 字符';
      showToast('已恢复历史记录', 'info');
    });
  }

  // 清空历史
  if (btnClearHistory) {
    btnClearHistory.addEventListener('click', async () => {
      try {
        await safeStorage('set', { [HISTORY_KEY]: [] });
        renderHistory([]);
        showToast('历史已清空', 'success');
      } catch (e) { showToast('清空失败', 'error'); }
    });
  }

  // 初始化加载历史
  (async () => {
    try {
      const data = await safeStorage('get', HISTORY_KEY);
      renderHistory(data[HISTORY_KEY] || []);
    } catch (e) { renderHistory([]); }
  })();

  // Message handler for theme and data
  window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!event.data || event.source !== window.parent) return;
    const { action, data } = event.data;
    if (action === 'setTheme' && data && data.theme) {
      document.documentElement.setAttribute('data-theme', data.theme);
      return;
    }
    if (action === 'setData') {
      if (typeof data === 'object' && data.text) {
        els.inputArea.value = data.text;
        els.inputStatus.textContent = `${data.text.length} 字符`;
        if (data.action === 'encode') {
          direction = 'encode';
          els.btnEncode.classList.add('active');
          els.btnDecode.classList.remove('active');
        } else if (data.action === 'decode') {
          direction = 'decode';
          els.btnDecode.classList.add('active');
          els.btnEncode.classList.remove('active');
        }
      } else if (typeof data === 'string') {
        els.inputArea.value = data;
        els.inputStatus.textContent = `${data.length} 字符`;
      }
    }
  });
});

// Toast
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast toast--' + type;
  toast.classList.add('toast--show');
  setTimeout(() => toast.classList.remove('toast--show'), 3000);
}

