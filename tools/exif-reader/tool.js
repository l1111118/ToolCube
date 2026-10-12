/**
 * EXIF分析器 - 读取和分析图片元数据
 */
(function () {
  'use strict';

  var E = {
    drop: document.getElementById('er-drop'),
    file: document.getElementById('er-file'),
    preview: document.getElementById('er-preview'),
    img: document.getElementById('er-img'),
    fileInfo: document.getElementById('er-file-info'),
    results: document.getElementById('er-results')
  };

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var GPS_KEYS = ['GPSLatitude', 'GPSLongitude', 'GPSAltitude'];
  var PRIVACY_RISK_KEYS = ['GPSLatitude', 'GPSLongitude', 'GPSAltitude', 'Make', 'Model', 'Software', 'DateTimeOriginal'];

  // EXIF tag names
  var TAG_NAMES = {
    0x010F: 'Make', 0x0110: 'Model', 0x0112: 'Orientation', 0x011A: 'XResolution',
    0x011B: 'YResolution', 0x0128: 'ResolutionUnit', 0x0131: 'Software',
    0x0132: 'DateTime', 0x013B: 'Artist', 0x8298: 'Copyright',
    0x8769: 'ExifIFDPointer', 0x9000: 'ExifVersion', 0x9003: 'DateTimeOriginal',
    0x9004: 'DateTimeDigitized', 0x9201: 'ShutterSpeedValue', 0x9202: 'ApertureValue',
    0x9204: 'ExposureBiasValue', 0x9205: 'MaxApertureValue', 0x9207: 'MeteringMode',
    0x9209: 'Flash', 0x920A: 'FocalLength', 0xA001: 'ColorSpace',
    0xA002: 'PixelXDimension', 0xA003: 'PixelYDimension', 0xA405: 'FocalLengthIn35mmFilm',
    0xA433: 'LensMake', 0xA434: 'LensModel', 0xA432: 'LensInfo',
    0x8825: 'GPSInfoIFDPointer', 0x0001: 'GPSLatitudeRef', 0x0002: 'GPSLatitude',
    0x0003: 'GPSLongitudeRef', 0x0004: 'GPSLongitude', 0x0005: 'GPSAltitudeRef',
    0x0006: 'GPSAltitude', 0x0007: 'GPSTimeStamp'
  };

  function parseExif(arrayBuffer) {
    var view = new DataView(arrayBuffer);
    if (view.getUint16(0, false) !== 0xFFD8) return null; // Not JPEG

    var offset = 2;
    var exifData = {};
    var gpsData = {};

    while (offset < view.byteLength - 1) {
      var marker = view.getUint16(offset, false);
      offset += 2;

      if (marker === 0xFFE1) { // APP1 - EXIF
        var length = view.getUint16(offset, false);
        offset += 2;
        // Check "Exif\0\0"
        if (view.getUint32(offset, false) === 0x45786966 && view.getUint16(offset + 4, false) === 0x0000) {
          var tiffOffset = offset + 6;
          var littleEndian = view.getUint16(tiffOffset, false) === 0x4949;
          var ifdOffset = view.getUint32(tiffOffset + 4, littleEndian);
          parseIFD(view, tiffOffset + ifdOffset, tiffOffset, littleEndian, exifData, gpsData, 0);
        }
        offset += length - 2;
      } else if ((marker & 0xFF00) === 0xFF00) {
        var len = view.getUint16(offset, false);
        offset += len;
      } else {
        break;
      }
    }
    return { exif: exifData, gps: gpsData };
  }

  function parseIFD(view, offset, tiffOffset, le, exifData, gpsData, depth) {
    if (depth > 5) return; // 防止循环引用导致的无限递归
    if (offset + 2 > view.byteLength) return;
    var entries = view.getUint16(offset, le);
    offset += 2;
    for (var i = 0; i < entries && offset + 12 <= view.byteLength; i++) {
      var tag = view.getUint16(offset, le);
      var type = view.getUint16(offset + 2, le);
      var count = view.getUint32(offset + 4, le);
      var valueOffset = offset + 8;
      var value;
      var tagName = TAG_NAMES[tag] || ('Tag_0x' + tag.toString(16).toUpperCase());

      try {
        if (type === 2) { // ASCII
          var strOffset = count > 4 ? view.getUint32(valueOffset, le) : valueOffset;
          value = '';
          for (var j = 0; j < count - 1 && (tiffOffset + strOffset + j) < view.byteLength; j++) {
            value += String.fromCharCode(view.getUint8(tiffOffset + strOffset + j));
          }
        } else if (type === 3 && count === 1) {
          value = view.getUint16(valueOffset, le);
        } else if (type === 4 && count === 1) {
          value = view.getUint32(valueOffset, le);
        } else if (type === 5 && count === 1) { // RATIONAL
          var numOff = view.getUint32(valueOffset, le);
          var denOff = view.getUint32(valueOffset + 4, le);
          value = view.getUint32(tiffOffset + numOff, le) / Math.max(1, view.getUint32(tiffOffset + denOff, le));
          value = Math.round(value * 1000) / 1000;
        } else if (type === 10 && count === 1) { // SRATIONAL
          var numOff2 = view.getUint32(valueOffset, le);
          var denOff2 = view.getUint32(valueOffset + 4, le);
          value = view.getInt32(tiffOffset + numOff2, le) / Math.max(1, view.getInt32(tiffOffset + denOff2, le));
          value = Math.round(value * 1000) / 1000;
        } else {
          value = '[' + type + ':' + count + ']';
        }
      } catch (e) {
        value = '[解析错误]';
      }

      if (tag === 0x8769 && typeof value === 'number') { // ExifIFDPointer
        parseIFD(view, tiffOffset + value, tiffOffset, le, exifData, gpsData, (depth || 0) + 1);
      } else if (tag === 0x8825 && typeof value === 'number') { // GPSInfoIFDPointer
        parseIFD(view, tiffOffset + value, tiffOffset, le, gpsData, gpsData, (depth || 0) + 1);
      } else {
        var target = (tag >= 0x0001 && tag <= 0x001F) ? gpsData : exifData;
        target[tagName] = value;
      }
      offset += 12;
    }
  }

  function formatGPS(lat, latRef, lon, lonRef) {
    if (!lat || !lon) return null;
    var latDeg = typeof lat === 'number' ? lat : lat;
    var lonDeg = typeof lon === 'number' ? lon : lon;
    var latStr = (latRef === 'S' ? '-' : '') + latDeg;
    var lonStr = (lonRef === 'W' ? '-' : '') + lonDeg;
    return latStr + ', ' + lonStr;
  }

  var currentFile = null;
  var currentArrayBuffer = null;

  function analyzeImage(file) {
    currentFile = file;
    var reader = new FileReader();
    reader.onload = function (e) {
      var buffer = e.target.result;
      currentArrayBuffer = buffer;
      E.img.src = URL.createObjectURL(file);
      E.preview.style.display = 'flex';
      E.fileInfo.textContent = file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB, ' + file.type + ')';

      var parsed = parseExif(buffer);
      if (!parsed) {
        E.results.innerHTML = '<div class="er-empty">非JPEG文件或无EXIF数据</div>';
        return;
      }

      var html = '';
      var hasPrivacyRisk = false;

      // Privacy check
      if (parsed.gps.GPSLatitude || parsed.gps.GPSLongitude) {
        hasPrivacyRisk = true;
        html += '<div class="er-privacy-alert">⚠️ 此图片包含GPS定位信息，可能泄露隐私！<br><button class="btn btn--danger btn--sm" id="btn-remove-all-exif">🗑️ 移除全部元数据并下载</button> <button class="btn btn--secondary btn--sm" id="btn-reencode">🖼 重新编码导出（清除元数据）</button></div>';
      }

      // Camera info
      var cameraKeys = ['Make', 'Model', 'LensModel', 'LensMake', 'Software'];
      var cameraItems = cameraKeys.filter(function (k) { return parsed.exif[k]; });
      if (cameraItems.length) {
        html += '<div class="er-group"><div class="er-group-title">📷 相机信息</div>';
        cameraItems.forEach(function (k) {
          html += '<div class="er-item"><span class="er-key">' + k + '</span><span class="er-val" data-field="exif.' + k + '">' + escapeHtml(String(parsed.exif[k])) + '</span></div>';
        });
        html += '</div>';
      }

      // Date/Time
      var dateKeys = ['DateTime', 'DateTimeOriginal', 'DateTimeDigitized'];
      var dateItems = dateKeys.filter(function (k) { return parsed.exif[k]; });
      if (dateItems.length) {
        html += '<div class="er-group"><div class="er-group-title">🕐 时间信息</div>';
        dateItems.forEach(function (k) {
          html += '<div class="er-item"><span class="er-key">' + k + '</span><span class="er-val" data-field="exif.' + k + '">' + escapeHtml(String(parsed.exif[k])) + '</span></div>';
        });
        html += '</div>';
      }

      // Photo settings
      var photoKeys = ['FocalLength', 'FocalLengthIn35mmFilm', 'ApertureValue', 'ShutterSpeedValue', 'ExposureBiasValue', 'Flash', 'MeteringMode'];
      var photoItems = photoKeys.filter(function (k) { return parsed.exif[k]; });
      if (photoItems.length) {
        html += '<div class="er-group"><div class="er-group-title">📸 拍摄参数</div>';
        photoItems.forEach(function (k) {
          var val = parsed.exif[k];
          var unit = '';
          if (k === 'FocalLength') unit = 'mm';
          if (k === 'FocalLengthIn35mmFilm') unit = 'mm';
          if (k === 'ApertureValue') unit = ' EV';
          html += '<div class="er-item"><span class="er-key">' + k + '</span><span class="er-val">' + escapeHtml(String(val)) + unit + '</span></div>';
        });
        html += '</div>';
      }

      // GPS info with embedded map
      var gpsKeys = ['GPSLatitudeRef', 'GPSLatitude', 'GPSLongitudeRef', 'GPSLongitude', 'GPSAltitude'];
      var gpsItems = gpsKeys.filter(function (k) { return parsed.gps[k]; });
      if (gpsItems.length) {
        html += '<div class="er-group"><div class="er-group-title">📍 GPS定位</div>';
        gpsItems.forEach(function (k) {
          var danger = (k === 'GPSLatitude' || k === 'GPSLongitude') ? ' er-val--danger' : '';
          html += '<div class="er-item"><span class="er-key">' + k + '</span><span class="er-val' + danger + '">' + escapeHtml(String(parsed.gps[k])) + '</span></div>';
        });
        var coords = formatGPS(parsed.gps.GPSLatitude, parsed.gps.GPSLatitudeRef, parsed.gps.GPSLongitude, parsed.gps.GPSLongitudeRef);
        if (coords) {
          // 使用 OpenStreetMap：开放数据、无追踪；同时避免把第三方地图服务地址硬编码进工具
          html += '<div class="er-item"><span class="er-key">地图</span><span class="er-val er-val--danger"><a href="https://www.openstreetmap.org/?mlat=' + encodeURIComponent(coords.split(',')[0]) + '&mlon=' + encodeURIComponent(coords.split(',')[1]) + '#map=15" target="_blank" rel="noopener" style="color:inherit">📍 在 OpenStreetMap 查看</a></span></div>';
        }
        html += '</div>';
      }

      // Image dimensions
      if (parsed.exif.PixelXDimension || parsed.exif.PixelYDimension) {
        html += '<div class="er-group"><div class="er-group-title">🖼️ 图像尺寸</div>';
        if (parsed.exif.PixelXDimension) html += '<div class="er-item"><span class="er-key">宽度</span><span class="er-val">' + parsed.exif.PixelXDimension + 'px</span></div>';
        if (parsed.exif.PixelYDimension) html += '<div class="er-item"><span class="er-key">高度</span><span class="er-val">' + parsed.exif.PixelYDimension + 'px</span></div>';
        html += '</div>';
      }

      if (!html) {
        html = '<div class="er-empty">未找到EXIF数据</div>';
      } else {
        html += '<div class="er-actions" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn--danger btn--sm" id="btn-strip-exif">🗑️ 移除全部元数据（无损，仅 JPEG）</button><button class="btn btn--secondary btn--sm" id="btn-reencode">🖼 重新编码导出（清除元数据）</button><button class="btn btn--secondary btn--sm" id="btn-batch-select">📂 批量处理</button><input type="file" id="er-batch-file" multiple accept="image/jpeg" style="display:none"></div>';
      }

      E.results.innerHTML = html;

      // 绑定按钮
      var btnRemoveAll = document.getElementById('btn-remove-all-exif');
      if (btnRemoveAll) btnRemoveAll.addEventListener('click', function() { stripExif(); });
      var btnStripExif = document.getElementById('btn-strip-exif');
      if (btnStripExif) btnStripExif.addEventListener('click', function() { stripExif(); });
      var btnReencode = document.getElementById('btn-reencode');
      if (btnReencode) btnReencode.addEventListener('click', function() { reencodeWithoutMetadata(); });
      var btnBatchSelect = document.getElementById('btn-batch-select');
      if (btnBatchSelect) btnBatchSelect.addEventListener('click', function() {
        var batchInput = document.getElementById('er-batch-file');
        if (batchInput) batchInput.click();
      });
      var batchInput = document.getElementById('er-batch-file');
      if (batchInput) batchInput.addEventListener('change', function() {
        var files = Array.from(this.files).filter(function(f) { return f.type === 'image/jpeg'; });
        if (!files.length) return;
        processBatchFiles(files);
      });
    };
    reader.readAsArrayBuffer(file);
  }

  /**
   * 无损移除 JPEG 的全部元数据（含 EXIF / GPS）并下载。
   *
   * 说明：APP1(0xFFE1) 段承载 EXIF，其中包含 GPS 子块。**无法在不解码图像数据的前提下
   * 只删掉 GPS 而保留其它 EXIF**，因此这里只提供「移除全部元数据」这一条真实可行的路径。
   * 旧实现同时提供「删除GPS数据」与「删除全部EXIF」两个按钮，但两者执行的是同一件事，
   * 前者还会弹出一个自相矛盾的确认框，属于误导性 UI。
   */
  function stripExif() {
    if (!currentArrayBuffer) { alert('请先加载图片'); return; }
    var view = new DataView(currentArrayBuffer);
    if (view.getUint16(0, false) !== 0xFFD8) { alert('无损移除仅支持 JPEG，请改用「重新编码导出」'); return; }
    var segments = [];
    var offset = 2;
    while (offset < view.byteLength - 1) {
      var marker = view.getUint16(offset, false);
      offset += 2;
      if (marker === 0xFFDA) {
        // 到达扫描数据，剩余内容整体保留
        segments.push({ data: new Uint8Array(currentArrayBuffer, offset - 2) });
        break;
      }
      var len = view.getUint16(offset, false);
      // 跳过 APP1（EXIF/GPS）与 APP13（IPTC）等元数据段，其余段原样保留
      var isMetadata = marker === 0xFFE1 || marker === 0xFFED;
      if (!isMetadata && (marker & 0xFF00) === 0xFF00 && marker !== 0xFFD8 && marker !== 0xFFD9) {
        segments.push({ data: new Uint8Array(currentArrayBuffer, offset - 2, len + 2) });
      }
      offset += len;
    }
    var totalSize = 2;
    segments.forEach(function(s) { totalSize += s.data.length; });
    var result = new Uint8Array(totalSize);
    result[0] = 0xFF; result[1] = 0xD8;
    var pos = 2;
    segments.forEach(function(s) { result.set(s.data, pos); pos += s.data.length; });
    var blob = new Blob([result], { type: 'image/jpeg' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (currentFile ? currentFile.name.replace(/\.[^.]+$/, '') : 'image') + '_no_exif.jpg';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    // 及时释放对象 URL，避免长时间占用内存
    setTimeout(function() { URL.revokeObjectURL(a.href); }, 0);
  }

  /**
   * 通过 Canvas 重新编码导出：适用于任意可解码图片格式（PNG/WebP/JPEG 等）。
   *
   * 重新编码会丢弃全部元数据（这正是"清除元数据"的目的），代价是有损重编码，
   * 因此按钮文案中明确写出，与上面的无损移除区分开。
   */
  function reencodeWithoutMetadata() {
    if (!currentFile) { alert('请先加载图片'); return; }
    var img = new Image();
    var objectUrl = URL.createObjectURL(currentFile);
    img.onload = function() {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        canvas.toBlob(function(blob) {
          URL.revokeObjectURL(objectUrl);
          if (!blob) { alert('导出失败：当前浏览器不支持该格式的重新编码'); return; }
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = (currentFile.name.replace(/\.[^.]+$/, '') || 'image') + '_clean.' + (blob.type === 'image/png' ? 'png' : 'jpg');
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(function() { URL.revokeObjectURL(a.href); }, 0);
        }, 'image/png');
      } catch (e) {
        URL.revokeObjectURL(objectUrl);
        alert('导出失败: ' + e.message);
      }
    };
    img.onerror = function() {
      URL.revokeObjectURL(objectUrl);
      alert('无法解码该图片，导出失败');
    };
    img.src = objectUrl;
  }

  // 批量处理
  function processBatchFiles(files) {
    var results = [];
    var idx = 0;
    function next() {
      if (idx >= files.length) {
        // 显示汇总
        var html = '<div class="er-group"><div class="er-group-title">📊 批量处理结果 (' + results.length + ' 个文件)</div>';
        results.forEach(function(r) {
          html += '<div class="er-item"><span class="er-key">' + escapeHtml(r.name) + '</span><span class="er-val">' + (r.hasExif ? '✅ 有EXIF' : '❌ 无EXIF') + (r.hasGps ? ' 📍有GPS' : '') + '</span></div>';
        });
        html += '</div>';
        E.results.innerHTML = html;
        return;
      }
      var file = files[idx++];
      var reader = new FileReader();
      reader.onload = function(e) {
        var parsed = parseExif(e.target.result);
        results.push({
          name: file.name,
          hasExif: !!parsed && Object.keys(parsed.exif).length > 0,
          hasGps: !!(parsed && parsed.gps && (parsed.gps.GPSLatitude || parsed.gps.GPSLongitude))
        });
        next();
      };
      reader.readAsArrayBuffer(file);
    }
    next();
  }

  // File selection
  E.drop.addEventListener('click', function () { E.file.click(); });
  E.file.addEventListener('change', function () { if (this.files[0]) analyzeImage(this.files[0]); });
  E.drop.addEventListener('dragover', function (e) { e.preventDefault(); this.classList.add('dragover'); });
  E.drop.addEventListener('dragleave', function () { this.classList.remove('dragover'); });
  E.drop.addEventListener('drop', function (e) {
    e.preventDefault();
    this.classList.remove('dragover');
    if (e.dataTransfer.files[0]) analyzeImage(e.dataTransfer.files[0]);
  });

  // Theme
  window.addEventListener('message', function (e) {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!e.data || e.source !== window.parent) return;
    if (e.data.action === 'setTheme' && e.data.data) {
      document.documentElement.setAttribute('data-theme', e.data.data.theme);
    }
  });
})();
