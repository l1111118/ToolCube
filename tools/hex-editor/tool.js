document.addEventListener('DOMContentLoaded', function () {
  var PAGE_SIZE = 65536; // 64KB per page
  var BYTES_PER_ROW = 16;

  var currentBytes = null;   // Uint8Array of all data
  var currentMode = 'text';  // 'text' | 'file'
  var currentPage = 0;
  var totalPages = 1;

  // Search state
  var searchMatches = [];    // [{offset, length}]
  var currentMatchIdx = -1;

  // DOM refs
  var inputArea = document.getElementById('input-area');
  var hexContent = document.getElementById('hex-content');
  var hexBody = document.getElementById('hex-body');
  var textPanel = document.getElementById('text-panel');
  var filePanel = document.getElementById('file-panel');
  var fileInput = document.getElementById('file-input');
  var fileDropZone = document.getElementById('file-drop-zone');
  var searchInput = document.getElementById('search-input');
  var gotoInput = document.getElementById('goto-input');
  var toast = document.getElementById('toast');
  var inputStatus = document.getElementById('input-status');
  var fileStatus = document.getElementById('file-status');
  var byteCount = document.getElementById('byte-count');
  var encodingInfo = document.getElementById('encoding-info');
  var pageInfo = document.getElementById('page-info');
  var searchStatus = document.getElementById('search-status');
  function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
  function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
  // ---- Mode toggle ----
  var btnTextMode = document.getElementById('btn-text-mode');
  var btnFileMode = document.getElementById('btn-file-mode');

  function setMode(mode) {
    currentMode = mode;
    if (mode === 'text') {
      textPanel.style.display = '';
      filePanel.style.display = 'none';
      btnTextMode.className = 'btn btn--primary';
      btnFileMode.className = 'btn btn--secondary';
      encodingInfo.textContent = '编码: UTF-8';
    } else {
      textPanel.style.display = 'none';
      filePanel.style.display = '';
      btnTextMode.className = 'btn btn--secondary';
      btnFileMode.className = 'btn btn--primary';
      encodingInfo.textContent = '编码: 二进制';
    }
  }

  btnTextMode.onclick = function () { setMode('text'); };
  btnFileMode.onclick = function () { setMode('file'); };

  // ---- Text input ----
  inputArea.addEventListener('input', function () {
    var text = inputArea.value;
    inputStatus.textContent = text.length + ' 字符';
    if (!text) {
      currentBytes = null;
      renderHex();
      return;
    }
    currentBytes = new TextEncoder().encode(text);
    currentPage = 0;
    searchMatches = [];
    currentMatchIdx = -1;
    searchStatus.textContent = '';
    renderHex();
  });

  // ---- File input ----
  fileDropZone.onclick = function () { fileInput.click(); };

  fileDropZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    fileDropZone.classList.add('dragover');
  });
  fileDropZone.addEventListener('dragleave', function () {
    fileDropZone.classList.remove('dragover');
  });
  fileDropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    fileDropZone.classList.remove('dragover');
    var files = e.dataTransfer.files;
    if (files.length > 0) loadFile(files[0]);
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files.length > 0) loadFile(fileInput.files[0]);
  });

  function loadFile(file) {
    fileStatus.textContent = file.name + ' (' + formatSize(file.size) + ')';
    var reader = new FileReader();
    reader.onload = function (e) {
      currentBytes = new Uint8Array(e.target.result);
      currentPage = 0;
      searchMatches = [];
      currentMatchIdx = -1;
      searchStatus.textContent = '';
      renderHex();
      showToast('文件加载完成: ' + file.name, 'success');
      saveToHistory(file.name, 'file');
    };
    reader.readAsArrayBuffer(file);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  // CRC32 计算
  function computeCRC32(data) {
    var crcTable = [];
    for (var i = 0; i < 256; i++) {
      var crc = i;
      for (var j = 0; j < 8; j++) {
        if (crc & 1) crc = (crc >>> 1) ^ 0xEDB88320;
        else crc = crc >>> 1;
      }
      crcTable.push(crc);
    }
    var crc = 0xFFFFFFFF;
    for (var k = 0; k < data.length; k++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ data[k]) & 0xFF];
    }
    return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }

  // 数据统计更新
  function updateStats() {
    var statsEl = document.getElementById('hex-stats');
    if (!statsEl) return;
    if (!currentBytes || currentBytes.length === 0) {
      statsEl.textContent = '';
      return;
    }
    var crc = computeCRC32(currentBytes);
    var md5Note = 'CRC32: ' + crc;
    // 字节分布统计
    var zeroBytes = 0, printableBytes = 0;
    for (var i = 0; i < currentBytes.length; i++) {
      if (currentBytes[i] === 0) zeroBytes++;
      if (currentBytes[i] >= 0x20 && currentBytes[i] <= 0x7E) printableBytes++;
    }
    statsEl.textContent = md5Note + ' · 零字节: ' + zeroBytes + ' (' + (zeroBytes/currentBytes.length*100).toFixed(1) + '%) · 可打印: ' + printableBytes + ' (' + (printableBytes/currentBytes.length*100).toFixed(1) + '%)';
  }

  // 二进制差异比较
  var compareBytes = null;
  var btnCompare = document.getElementById('btn-compare');
  var compareFile = document.getElementById('compare-file');
  if (btnCompare && compareFile) {
    btnCompare.addEventListener('click', function() {
      compareFile.click();
    });
    compareFile.addEventListener('change', function() {
      if (!compareFile.files[0] || !currentBytes) return;
      var reader = new FileReader();
      reader.onload = function(e) {
        compareBytes = new Uint8Array(e.target.result);
        showBinaryDiff();
      };
      reader.readAsArrayBuffer(compareFile.files[0]);
    });
  }

  function showBinaryDiff() {
    if (!currentBytes || !compareBytes) return;
    var diffPanel = document.getElementById('hex-diff-panel');
    if (!diffPanel) return;
    var maxLen = Math.max(currentBytes.length, compareBytes.length);
    var diffs = [];
    var matchCount = 0;
    for (var i = 0; i < maxLen; i++) {
      var b1 = i < currentBytes.length ? currentBytes[i] : null;
      var b2 = i < compareBytes.length ? compareBytes[i] : null;
      if (b1 !== b2) {
        diffs.push({ offset: i, byte1: b1, byte2: b2 });
      } else {
        matchCount++;
      }
    }
    var samePct = maxLen > 0 ? (matchCount / maxLen * 100).toFixed(1) : '0.0';
    var html = '<div class="hex-diff-header">📊 二进制差异比较</div>';
    html += '<div class="hex-diff-summary">文件1: ' + formatSize(currentBytes.length) + ' · 文件2: ' + formatSize(compareBytes.length) + ' · 相同: ' + samePct + '% · 差异: ' + diffs.length + ' 字节</div>';
    // 显示前100个差异
    var showDiffs = diffs.slice(0, 100);
    html += '<div class="hex-diff-list">';
    showDiffs.forEach(function(d) {
      var offset = d.offset.toString(16).toUpperCase().padStart(8, '0');
      var b1Str = d.byte1 !== null ? d.byte1.toString(16).toUpperCase().padStart(2, '0') : '--';
      var b2Str = d.byte2 !== null ? d.byte2.toString(16).toUpperCase().padStart(2, '0') : '--';
      html += '<div class="hex-diff-row"><span class="hex-diff-offset">0x' + offset + '</span><span class="hex-diff-b1">' + b1Str + '</span><span class="hex-diff-b2">' + b2Str + '</span></div>';
    });
    if (diffs.length > 100) html += '<div class="hex-diff-more">...还有 ' + (diffs.length - 100) + ' 个差异未显示</div>';
    html += '</div>';
    html += '<button class="btn btn--secondary btn--sm" id="btn-close-diff">关闭</button>';
    diffPanel.innerHTML = html;
    diffPanel.style.display = 'block';
    document.getElementById('btn-close-diff').addEventListener('click', function() {
      diffPanel.style.display = 'none';
    });
  }

  // ---- Hex rendering ----
  function renderHex() {
    if (!currentBytes || currentBytes.length === 0) {
      hexContent.innerHTML = '<div class="hex-empty">等待输入...</div>';
      byteCount.textContent = '0 字节';
      pageInfo.textContent = '';
      return;
    }

    var totalLen = currentBytes.length;
    totalPages = Math.ceil(totalLen / PAGE_SIZE) || 1;
    byteCount.textContent = totalLen + ' 字节';

    var startByte = currentPage * PAGE_SIZE;
    var endByte = Math.min(startByte + PAGE_SIZE, totalLen);
    var pageBytes = currentBytes.subarray(startByte, endByte);

    // Build search match index for fast lookup within this page
    var matchMap = {}; // byteOffset -> match info {matchIdx, isCurrent}
    for (var m = 0; m < searchMatches.length; m++) {
      var sm = searchMatches[m];
      if (sm.offset >= startByte && sm.offset < endByte) {
        for (var k = 0; k < sm.length; k++) {
          var bOff = sm.offset + k - startByte;
          if (!matchMap[bOff]) matchMap[bOff] = [];
          matchMap[bOff].push({ matchIdx: m, isCurrent: m === currentMatchIdx });
        }
      }
    }

    var html = '';
    var numRows = Math.ceil(pageBytes.length / BYTES_PER_ROW);

    for (var row = 0; row < numRows; row++) {
      var rowStart = row * BYTES_PER_ROW;
      var rowEnd = Math.min(rowStart + BYTES_PER_ROW, pageBytes.length);
      var absOffset = startByte + rowStart;

      // Offset
      var offsetStr = absOffset.toString(16).toUpperCase().padStart(8, '0');

      // Hex bytes
      var hexParts = [];
      for (var i = 0; i < BYTES_PER_ROW; i++) {
        if (i === 8) hexParts.push(' ');
        if (rowStart + i < rowEnd) {
          var byteIdx = rowStart + i;
          var absIdx = startByte + byteIdx;
          var hexVal = pageBytes[byteIdx].toString(16).toUpperCase().padStart(2, '0');
          var matchInfo = matchMap[byteIdx];
          if (matchInfo) {
            var isCur = matchInfo.some(function (mi) { return mi.isCurrent; });
            var cls = isCur ? 'byte-highlight-current' : 'byte-highlight';
            hexParts.push('<span class="' + cls + '">' + hexVal + '</span>');
          } else {
            // 每个字节可双击编辑（data-idx 为绝对偏移），这是"编辑器"与"查看器"的区别
            hexParts.push('<span class="hex-byte" data-idx="' + absIdx + '" title="双击编辑此字节">' + hexVal + '</span>');
          }
        } else {
          hexParts.push('  ');
        }
        if (i < BYTES_PER_ROW - 1 && i !== 7) hexParts.push(' ');
      }

      // ASCII
      var asciiParts = [];
      for (var j = rowStart; j < rowEnd; j++) {
        var b = pageBytes[j];
        var ch = (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : '.';
        var matchInfo2 = matchMap[j];
        if (matchInfo2) {
          var isCur2 = matchInfo2.some(function (mi) { return mi.isCurrent; });
          var cls2 = isCur2 ? 'byte-highlight-current' : 'byte-highlight';
          asciiParts.push('<span class="' + cls2 + '">' + escapeHtml(ch) + '</span>');
        } else {
          asciiParts.push(escapeHtml(ch));
        }
      }

      html += '<div class="hex-row" data-offset="' + absOffset + '">'
        + '<span class="hex-row-offset">' + offsetStr + '</span>'
        + '<span class="hex-row-bytes">' + hexParts.join('') + '</span>'
        + '<span class="hex-row-ascii">' + asciiParts.join('') + '</span>'
        + '</div>';
    }

    hexContent.innerHTML = html;

    // 绑定字节编辑：双击任意字节可修改其值（"编辑器"的核心能力）
    hexContent.querySelectorAll('.hex-byte').forEach(function (el) {
      el.addEventListener('dblclick', function () {
        var idx = parseInt(el.dataset.idx, 10);
        if (isNaN(idx) || idx < 0 || idx >= currentBytes.length) return;
        var cur = currentBytes[idx].toString(16).toUpperCase().padStart(2, '0');
        var input = prompt('编辑偏移 0x' + idx.toString(16).toUpperCase() + ' 处的字节（十六进制，00-FF）：', cur);
        if (input === null) return;
        var cleaned = input.trim().replace(/^0x/i, '');
        if (!/^[0-9a-fA-F]{1,2}$/.test(cleaned)) {
          alert('请输入 1-2 位十六进制数（00-FF）');
          return;
        }
        currentBytes[idx] = parseInt(cleaned, 16) & 0xFF;
        renderHex();
        updateStats();
      });
    });

    // Page info
    if (totalPages > 1) {
      pageInfo.innerHTML = '<span class="page-info-text">' + (currentPage + 1) + '/' + totalPages + ' 页</span>'
        + '<button class="btn btn--icon" id="btn-prev-page" title="上一页" style="width:24px;height:24px;font-size:10px">◀</button>'
        + '<button class="btn btn--icon" id="btn-next-page" title="下一页" style="width:24px;height:24px;font-size:10px">▶</button>';
      document.getElementById('btn-prev-page').onclick = function () {
        if (currentPage > 0) { currentPage--; renderHex(); }
      };
      document.getElementById('btn-next-page').onclick = function () {
        if (currentPage < totalPages - 1) { currentPage++; renderHex(); }
      };
    } else {
      pageInfo.textContent = '';
    }

    // Scroll to current match
    if (currentMatchIdx >= 0 && searchMatches[currentMatchIdx]) {
      scrollToOffset(searchMatches[currentMatchIdx].offset);
    }
    // Update data statistics
    updateStats();
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function scrollToOffset(absOffset) {
    var startByte = currentPage * PAGE_SIZE;
    var endByte = startByte + PAGE_SIZE;
    if (absOffset < startByte || absOffset >= endByte) {
      // Need to switch page
      currentPage = Math.floor(absOffset / PAGE_SIZE);
      renderHex();
      return;
    }
    var localOffset = absOffset - startByte;
    var rowIndex = Math.floor(localOffset / BYTES_PER_ROW);
    var rows = hexContent.querySelectorAll('.hex-row');
    if (rows[rowIndex]) {
      rows[rowIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
      rows[rowIndex].classList.add('jump-target');
      setTimeout(function () { rows[rowIndex].classList.remove('jump-target'); }, 1500);
    }
  }

  // ---- Search ----
  var btnSearch = document.getElementById('btn-search');
  var btnSearchPrev = document.getElementById('btn-search-prev');
  var btnSearchNext = document.getElementById('btn-search-next');

  function doSearch() {
    var query = searchInput.value.trim();
    if (!query || !currentBytes) {
      searchMatches = [];
      currentMatchIdx = -1;
      searchStatus.textContent = '';
      renderHex();
      return;
    }

    searchMatches = [];
    currentMatchIdx = -1;

    // Determine if query is hex pattern (e.g., "4A 6F 68 6E" or "4A6F686E")
    var pattern = [];
    var isHexQuery = false;

    // Try parsing as hex first
    var cleaned = query.replace(/\s+/g, '');
    if (/^[0-9a-fA-F]+$/.test(cleaned) && cleaned.length % 2 === 0 && cleaned.length >= 2) {
      isHexQuery = true;
      for (var i = 0; i < cleaned.length; i += 2) {
        pattern.push(parseInt(cleaned.substr(i, 2), 16));
      }
    } else {
      // Treat as ASCII/UTF-8 text
      pattern = new TextEncoder().encode(query);
    }

    // Search through bytes
    var data = currentBytes;
    for (var offset = 0; offset <= data.length - pattern.length; offset++) {
      var found = true;
      for (var j = 0; j < pattern.length; j++) {
        if (data[offset + j] !== pattern[j]) {
          found = false;
          break;
        }
      }
      if (found) {
        searchMatches.push({ offset: offset, length: pattern.length });
      }
    }

    if (searchMatches.length > 0) {
      currentMatchIdx = 0;
      var pageForMatch = Math.floor(searchMatches[0].offset / PAGE_SIZE);
      if (pageForMatch !== currentPage) {
        currentPage = pageForMatch;
      }
      searchStatus.textContent = searchMatches.length + ' 个匹配';
      renderHex();
      showToast('找到 ' + searchMatches.length + ' 个匹配', 'success');
    } else {
      searchStatus.textContent = '无匹配';
      renderHex();
      showToast('未找到匹配', 'error');
    }
  }

  btnSearch.onclick = doSearch;
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doSearch();
  });

  btnSearchNext.onclick = function () {
    if (searchMatches.length === 0) return;
    currentMatchIdx = (currentMatchIdx + 1) % searchMatches.length;
    var pageForMatch = Math.floor(searchMatches[currentMatchIdx].offset / PAGE_SIZE);
    if (pageForMatch !== currentPage) currentPage = pageForMatch;
    searchStatus.textContent = searchMatches.length + ' 个匹配 (' + (currentMatchIdx + 1) + '/' + searchMatches.length + ')';
    renderHex();
  };

  btnSearchPrev.onclick = function () {
    if (searchMatches.length === 0) return;
    currentMatchIdx = (currentMatchIdx - 1 + searchMatches.length) % searchMatches.length;
    var pageForMatch = Math.floor(searchMatches[currentMatchIdx].offset / PAGE_SIZE);
    if (pageForMatch !== currentPage) currentPage = pageForMatch;
    searchStatus.textContent = searchMatches.length + ' 个匹配 (' + (currentMatchIdx + 1) + '/' + searchMatches.length + ')';
    renderHex();
  };

  // ---- Go to offset ----
  var btnGoto = document.getElementById('btn-goto');
  btnGoto.onclick = function () {
    var val = gotoInput.value.trim();
    if (!val || !currentBytes) return;
    var offset = parseInt(val, 16);
    if (isNaN(offset) || offset < 0 || offset >= currentBytes.length) {
      showToast('无效偏移量: 0x' + val, 'error');
      return;
    }
    var pageForOffset = Math.floor(offset / PAGE_SIZE);
    if (pageForOffset !== currentPage) currentPage = pageForOffset;
    searchMatches = [];
    currentMatchIdx = -1;
    searchStatus.textContent = '';
    renderHex();
    // After render, scroll
    setTimeout(function () { scrollToOffset(offset); }, 50);
    showToast('跳转到 0x' + offset.toString(16).toUpperCase().padStart(8, '0'), 'success');
  };

  gotoInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') btnGoto.click();
  });

  // ---- Copy hex output ----
  var btnCopy = document.getElementById('btn-copy');
  btnCopy.onclick = function () {
    if (!currentBytes) { showToast('没有可复制的内容', 'error'); return; }
    var text = generateHexText();
    navigator.clipboard.writeText(text).then(function () {
      showToast('十六进制输出已复制', 'success');
    }).catch(function () {
      showToast('复制失败', 'error');
    });
  };

  // ---- 导出编辑后的二进制 ----
  // 编辑能力必须配套导出，否则改了字节却无法保存，编辑就失去了意义。
  var btnExport = document.getElementById('btn-export');
  if (btnExport) {
    btnExport.onclick = function () {
      if (!currentBytes || currentBytes.length === 0) { showToast('没有可导出的内容', 'error'); return; }
      var blob = new Blob([currentBytes], { type: 'application/octet-stream' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'hex-edit-' + Date.now() + '.bin';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 0);
      showToast('已导出 ' + currentBytes.length + ' 字节', 'success');
    };
  }

  function generateHexText() {
    if (!currentBytes) return '';
    var lines = [];
    for (var offset = 0; offset < currentBytes.length; offset += BYTES_PER_ROW) {
      var offsetStr = offset.toString(16).toUpperCase().padStart(8, '0');
      var hexParts = [];
      var asciiParts = [];
      for (var i = 0; i < BYTES_PER_ROW; i++) {
        if (i === 8) hexParts.push('');
        if (offset + i < currentBytes.length) {
          hexParts.push(currentBytes[offset + i].toString(16).toUpperCase().padStart(2, '0'));
          var b = currentBytes[offset + i];
          asciiParts.push((b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : '.');
        } else {
          hexParts.push('  ');
          asciiParts.push(' ');
        }
      }
      lines.push(offsetStr + '  ' + hexParts.join(' ') + '  ' + asciiParts.join(''));
    }
    return lines.join('\n');
  }

  // ---- Paste ----
  var btnPaste = document.getElementById('btn-paste');
  btnPaste.onclick = function () {
    navigator.clipboard.readText().then(function (text) {
      inputArea.value = text;
      inputArea.dispatchEvent(new Event('input'));
    }).catch(function () {
      showToast('粘贴失败', 'error');
    });
  };

  // ---- Clear ----
  var btnClear = document.getElementById('btn-clear');
  btnClear.onclick = function () {
    inputArea.value = '';
    currentBytes = null;
    currentPage = 0;
    searchMatches = [];
    currentMatchIdx = -1;
    searchStatus.textContent = '';
    inputStatus.textContent = '0 字符';
    fileStatus.textContent = '未选择文件';
    fileInput.value = '';
    searchInput.value = '';
    gotoInput.value = '';
    renderHex();
  };

  // ---- Toast ----
  function showToast(msg, type) {
    type = type || 'info';
    toast.textContent = msg;
    toast.className = 'toast toast--' + type + ' toast--show';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      toast.classList.remove('toast--show');
    }, 3000);
  }

  // ---- Save to history ----
  function saveToHistory(input, action) {
    try {
      safeSend({
        action: 'saveToHistory',
        data: { toolId: 'hex-editor', type: action, data: { input: input, action: action } }
      });
    } catch (e) { /* ignore */ }
  }

  // ---- Window message listener ----
  window.addEventListener('message', function (event) {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!event.data || event.source !== window.parent) return;
    if (event.data && event.data.action === 'setTheme' && event.data.data) {
      document.documentElement.setAttribute('data-theme', event.data.data.theme);
    }
    if (event.data && event.data.action === 'setData') {
      if (typeof event.data.data === 'string') {
        setMode('text');
        inputArea.value = event.data.data;
        inputArea.dispatchEvent(new Event('input'));
      }
    }
  });
});
