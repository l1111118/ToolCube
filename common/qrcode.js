/**
 * ToolCube - 二维码编码器（共享，经典脚本）
 *
 * 纯本地实现：无外部依赖、无网络请求。抽到 common/ 共享的原因：
 *   - qrcode-generator 需要「生成并渲染二维码」；
 *   - url-parser 需要「为解析出的 URL 生成二维码预览」。
 *   两处若各写一份，行为会随时间漂移（此前 url-parser 就是直接请求了第三方
 *   接口，既是硬编码外部地址，其 onerror 兜底又会被扩展页 CSP 拦截而失效）。
 *
 * 本文件是**经典脚本**（与 common/tool-i18n.js、common/tool-runtime.js 同类），
 * 通过 window.ToolCubeQR 暴露 encodeQR，供工具页在 tool.js 之前引入。
 *
 * 编码流程遵循 ISO/IEC 18004：
 *   Byte 模式比特流 → 选版 → 补齐码字 → 分块 Reed-Solomon → 交错 →
 *   之字形填充 → 掩码择优（四条罚分规则）→ 写入格式信息与版本信息。
 *
 * @version 1.3.0
 */
(function () {
  'use strict';

// Galois field 对数/反对数表 (GF(256))
  var QR_GF256_EXP = [];
  var QR_GF256_LOG = [];
  (function initGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      QR_GF256_EXP[i] = x;
      QR_GF256_LOG[x] = i;
      x <<= 1;
      if (x & 256) x ^= 285; // 0x11D
    }
    for (var i = 255; i < 512; i++) {
      QR_GF256_EXP[i] = QR_GF256_EXP[i - 255];
    }
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return QR_GF256_EXP[(QR_GF256_LOG[a] + QR_GF256_LOG[b]) % 255];
  }

  function gfPolyMul(p1, p2) {
    var res = new Array(p1.length + p2.length - 1).fill(0);
    for (var i = 0; i < p1.length; i++) {
      for (var j = 0; j < p2.length; j++) {
        res[i + j] ^= gfMul(p1[i], p2[j]);
      }
    }
    return res;
  }

  // Reed-Solomon 纠错码生成
  function rsGeneratorPoly(nsym) {
    var g = [1];
    for (var i = 0; i < nsym; i++) {
      g = gfPolyMul(g, [1, QR_GF256_EXP[i]]);
    }
    return g;
  }

  function rsEncode(data, nsym) {
    var gen = rsGeneratorPoly(nsym);
    var res = new Array(data.length + nsym).fill(0);
    for (var i = 0; i < data.length; i++) res[i] = data[i];
    for (var i = 0; i < data.length; i++) {
      var coef = res[i];
      if (coef !== 0) {
        for (var j = 1; j < gen.length; j++) {
          res[i + j] ^= gfMul(gen[j], coef);
        }
      }
    }
    for (var i = 0; i < data.length; i++) res[i] = data[i];
    return res;
  }

  // 版本容量表 (L, M, Q, H) -> [totalCodewords, ecCodewordsPerBlock, numBlocks1, numBlocks2]
  var QR_CAPACITY = [
    null, // version 0 (unused)
    // v1
    {L:[26,7,1,0],M:[26,10,1,0],Q:[26,13,1,0],H:[26,17,1,0]},
    {L:[44,10,1,0],M:[44,16,1,0],Q:[44,22,1,0],H:[44,28,1,0]},
    {L:[70,15,1,0],M:[70,26,1,0],Q:[70,18,2,0],H:[70,22,2,0]},
    {L:[100,20,1,0],M:[100,18,2,0],Q:[100,26,2,0],H:[100,16,4,0]},
    {L:[134,26,1,0],M:[134,24,2,0],Q:[134,18,4,0],H:[134,22,4,0]},
    {L:[172,18,2,0],M:[172,16,4,0],Q:[172,24,4,0],H:[172,28,4,0]},
    {L:[196,20,2,0],M:[196,18,4,0],Q:[196,18,6,0],H:[196,26,5,0]},
    {L:[242,24,2,0],M:[242,22,4,0],Q:[242,22,6,0],H:[242,26,6,0]},
    {L:[292,30,2,0],M:[292,22,5,0],Q:[292,20,8,0],H:[292,24,8,0]},
    {L:[346,18,4,0],M:[346,26,5,0],Q:[346,24,8,0],H:[346,28,8,0]},
    {L:[404,20,4,0],M:[404,30,5,0],Q:[404,28,8,0],H:[404,24,11,0]},
    {L:[466,24,4,0],M:[466,22,8,0],Q:[466,26,10,0],H:[466,28,11,0]},
    {L:[532,26,4,0],M:[532,22,9,0],Q:[532,24,12,0],H:[532,22,16,0]},
    {L:[581,30,4,0],M:[581,24,9,0],Q:[581,20,16,0],H:[581,24,16,0]},
    {L:[655,22,6,0],M:[655,24,10,0],Q:[655,30,12,0],H:[655,24,18,0]},
    {L:[733,24,6,0],M:[733,28,10,0],Q:[733,24,17,0],H:[733,30,16,0]},
    {L:[815,28,6,0],M:[815,28,11,0],Q:[815,28,16,0],H:[815,28,19,0]},
    {L:[901,30,6,0],M:[901,26,13,0],Q:[901,28,18,0],H:[901,28,21,0]},
    {L:[991,28,7,0],M:[991,26,14,0],Q:[991,26,21,0],H:[991,26,25,0]},
    {L:[1085,28,8,0],M:[1085,26,16,0],Q:[1085,30,20,0],H:[1085,28,25,0]},
    {L:[1156,28,8,0],M:[1156,26,17,0],Q:[1156,28,23,0],H:[1156,30,25,0]},
    {L:[1258,28,9,0],M:[1258,28,17,0],Q:[1258,30,23,0],H:[1258,24,34,0]},
    {L:[1364,30,9,0],M:[1364,28,18,0],Q:[1364,30,25,0],H:[1364,30,31,0]},
    {L:[1474,30,10,0],M:[1474,28,20,0],Q:[1474,30,27,0],H:[1474,30,34,0]},
    {L:[1588,26,12,0],M:[1588,28,21,0],Q:[1588,30,29,0],H:[1588,30,34,0]},
    {L:[1706,28,12,0],M:[1706,28,23,0],Q:[1706,30,31,0],H:[1706,30,35,0]},
    {L:[1828,30,12,0],M:[1828,28,25,0],Q:[1828,30,33,0],H:[1828,30,37,0]},
    {L:[1921,30,13,0],M:[1921,28,26,0],Q:[1921,30,35,0],H:[1921,30,40,0]},
    {L:[2051,30,14,0],M:[2051,28,28,0],Q:[2051,30,37,0],H:[2051,30,42,0]},
    {L:[2185,30,15,0],M:[2185,28,29,0],Q:[2185,30,40,0],H:[2185,30,45,0]},
    {L:[2323,30,16,0],M:[2323,28,31,0],Q:[2323,30,43,0],H:[2323,30,48,0]},
    {L:[2465,30,17,0],M:[2465,28,33,0],Q:[2465,30,45,0],H:[2465,30,51,0]},
    {L:[2611,30,18,0],M:[2611,28,35,0],Q:[2611,30,48,0],H:[2611,30,54,0]},
    {L:[2761,30,19,0],M:[2761,28,37,0],Q:[2761,30,51,0],H:[2761,30,57,0]},
    {L:[2876,30,19,0],M:[2876,28,38,0],Q:[2876,30,53,0],H:[2876,30,59,0]},
    {L:[2992,30,20,0],M:[2992,28,40,0],Q:[2992,30,56,0],H:[2992,30,62,0]},
    {L:[3136,30,21,0],M:[3136,28,43,0],Q:[3136,30,59,0],H:[3136,30,65,0]},
    {L:[3283,30,22,0],M:[3283,28,45,0],Q:[3283,30,62,0],H:[3283,30,68,0]},
    {L:[3433,30,23,0],M:[3433,28,48,0],Q:[3433,30,65,0],H:[3433,30,72,0]},
    {L:[3586,30,24,0],M:[3586,28,51,0],Q:[3586,30,68,0],H:[3586,30,76,0]}
  ];

  /**
   * 版本选择：按「实际比特数」选择最小的可用版本。
   *
   * Byte 模式的比特数 = 4(模式指示符) + 字符计数指示符 + 8×字节数；
   * 字符计数指示符在版本 1–9 为 8 位、10–40 为 16 位。
   * 必须按位比较容量：旧实现按"估算字节数"选版，会选到容量不足的版本，
   * 数据被静默截断，生成的二维码无法被任何扫码器解码。
   */
  function getBestVersion(byteLen, ecl) {
    for (var v = 1; v <= 40; v++) {
      var countBits = v <= 9 ? 8 : 16;
      if (4 + countBits + byteLen * 8 <= dataCodewordCount(v, ecl) * 8) return v;
    }
    throw new Error('内容过长，超出二维码容量上限（版本 40 / ' + ecl + ' 级）');
  }

  /** 指定版本与纠错等级下的「数据码字数」= 总码字数 − 纠错码字数 */
  function dataCodewordCount(version, ecl) {
    var cap = QR_CAPACITY[version][ecl];
    return cap[0] - cap[1] * (cap[2] + cap[3]);
  }

  /** 定位图案坐标（版本 2+）；版本 1 无对齐图案 */
  var QR_ALIGN_PATTERN = [
    [], // v0
    [], // v1
    [6,18], [6,22], [6,26], [6,30], [6,34], [6,22,38], [6,24,42], [6,26,46], [6,28,50],
    [6,30,54], [6,32,58], [6,34,62], [6,26,46,66], [6,26,48,70], [6,26,50,74], [6,30,54,78],
    [6,30,56,82], [6,30,58,86], [6,34,62,90], [6,28,50,72,94], [6,26,50,74,98],
    [6,30,54,78,102], [6,28,54,80,106], [6,32,58,84,110], [6,30,58,86,114],
    [6,34,62,90,118], [6,26,50,74,98,122], [6,30,54,78,102,126], [6,26,52,78,104,130],
    [6,30,56,82,108,134], [6,34,60,86,112,138], [6,30,58,86,114,142],
    [6,34,62,90,118,146], [6,30,54,78,102,126,150], [6,24,50,76,102,128,154],
    [6,28,54,80,106,132,158], [6,32,58,84,110,136,162], [6,26,54,82,110,138,166],
    [6,30,58,86,114,142,170]
  ];

  /** 格式信息生成多项式与掩码常量（ISO/IEC 18004 §8.9） */
  var QR_FORMAT_POLY = 0x537;
  var QR_FORMAT_MASK = 0x5412;

  /** 纠错等级在格式信息中的编码值 */
  var QR_ECL_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  /** 按位写入的比特缓冲（先写高位） */
  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.put = function (value, length) {
    for (var i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };

  /**
   * 掩码条件：row 为行、col 为列，返回该位置是否需要翻转
   * @param {number} row
   * @param {number} col
   * @param {number} mask 0–7
   */
  function maskCondition(row, col, mask) {
    switch (mask) {
      case 0: return (row + col) % 2 === 0;
      case 1: return row % 2 === 0;
      case 2: return col % 3 === 0;
      case 3: return (row + col) % 3 === 0;
      case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
      case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
      case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
      case 7: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
      default: return false;
    }
  }

  /** 对「非功能模块」应用掩码，返回新矩阵（不修改原矩阵） */
  function applyMask(modules, isFunction, mask) {
    var size = modules.length;
    var out = [];
    for (var r = 0; r < size; r++) {
      var row = new Array(size);
      for (var c = 0; c < size; c++) {
        row[c] = (!isFunction[r][c] && maskCondition(r, c, mask)) ? !modules[r][c] : modules[r][c];
      }
      out.push(row);
    }
    return out;
  }

  /** 罚分规则 1：行/列上同色模块连续 ≥5 个 */
  function penaltyRuns(modules) {
    var size = modules.length;
    var penalty = 0;
    for (var line = 0; line < size * 2; line++) {
      var isRow = line < size;
      var index = isRow ? line : line - size;
      var color = isRow ? modules[index][0] : modules[0][index];
      var run = 1;
      for (var k = 1; k < size; k++) {
        var current = isRow ? modules[index][k] : modules[k][index];
        if (current === color) {
          run++;
          if (run === 5) penalty += 3;
          else if (run > 5) penalty++;
        } else {
          color = current;
          run = 1;
        }
      }
    }
    return penalty;
  }

  /** 罚分规则 2：2×2 同色块 */
  function penaltyBlocks(modules) {
    var size = modules.length;
    var penalty = 0;
    for (var r = 0; r < size - 1; r++) {
      for (var c = 0; c < size - 1; c++) {
        var v = modules[r][c];
        if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) penalty += 3;
      }
    }
    return penalty;
  }

  /** 罚分规则 3：行/列中出现定位图案特征（1:1:3:1:1 且一侧有 4 个浅色模块） */
  function penaltyFinderLike(modules) {
    var size = modules.length;
    var pattern = [true, false, true, true, true, false, true];
    var penalty = 0;
    for (var line = 0; line < size * 2; line++) {
      var isRow = line < size;
      var index = isRow ? line : line - size;
      var get = function (i) { return isRow ? modules[index][i] : modules[i][index]; };
      for (var start = 0; start + pattern.length <= size; start++) {
        var matched = true;
        for (var k = 0; k < pattern.length; k++) {
          if (get(start + k) !== pattern[k]) { matched = false; break; }
        }
        if (!matched) continue;
        var clearBefore = true;
        for (var b = 1; b <= 4; b++) {
          if (start - b < 0 || get(start - b)) { clearBefore = false; break; }
        }
        var clearAfter = true;
        for (var a = 1; a <= 4; a++) {
          var idx = start + pattern.length - 1 + a;
          if (idx >= size || get(idx)) { clearAfter = false; break; }
        }
        if (clearBefore || clearAfter) penalty += 40;
      }
    }
    return penalty;
  }

  /** 罚分规则 4：暗色模块比例偏离 50% 的程度 */
  function penaltyDarkRatio(modules) {
    var size = modules.length;
    var dark = 0;
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) if (modules[r][c]) dark++;
    }
    var total = size * size;
    return (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  }

  /** 掩码总罚分：四条规则之和，越小说明图案越"随机"、越不易被误读 */
  function maskPenalty(modules) {
    return penaltyRuns(modules) + penaltyBlocks(modules) + penaltyFinderLike(modules) + penaltyDarkRatio(modules);
  }

  /**
   * 写入格式信息（15 位，含 BCH(15,5) 纠错）并放置固定暗模块。
   *
   * 位序按 ISO/IEC 18004：索引 0 为最高位；第一份环绕左上定位图案，
   * 第二份分布在左下（7 位）与右上（8 位）。这两处属于功能图案，不受掩码影响。
   */
  function drawFormatBits(modules, size, ecl, mask) {
    var data = (QR_ECL_FORMAT_BITS[ecl] << 3) | mask; // 5 位
    var rem = data << 10;
    for (var i = 14; i >= 10; i--) {
      if ((rem >>> i) & 1) rem ^= QR_FORMAT_POLY << (i - 10);
    }
    var bits = (((data << 10) | rem) ^ QR_FORMAT_MASK) & 0x7FFF;
    var bitAt = function (k) { return ((bits >>> (14 - k)) & 1) !== 0; };

    var firstCopy = [
      [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
      [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
    ];
    for (var k = 0; k < firstCopy.length; k++) {
      modules[firstCopy[k][0]][firstCopy[k][1]] = bitAt(k);
    }
    for (var lo = 0; lo < 7; lo++) modules[size - 1 - lo][8] = bitAt(lo);
    for (var hi = 7; hi < 15; hi++) modules[8][size - 15 + hi] = bitAt(hi);
    modules[size - 8][8] = true;
  }

  /**
   * 写入版本信息（18 位，含 BCH(18,6) 纠错）。
   * 仅版本 ≥ 7 需要；位于左下 3×6 与右上 6×3 两块。
   */
  function drawVersionBits(modules, size, version) {
    var rem = version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = (version << 12) | rem;
    for (var k = 0; k < 18; k++) {
      var dark = ((bits >>> k) & 1) !== 0;
      var a = size - 11 + (k % 3);
      var b = Math.floor(k / 3);
      modules[a][b] = dark;
      modules[b][a] = dark;
    }
  }

  /**
   * 由「已填充完毕的数据码字」构建最终模块矩阵。
   *
   * 与旧实现的区别（旧实现生成的二维码无法解码）：
   *   1. 旧实现把原始文本字节直接当作数据码字，丢失了模式指示符与字符计数；
   *   2. 旧实现的多块交错是"简化处理"（直接顺序拼接），仅单块版本下碰巧正确；
   *   3. 旧实现的掩码范围用几何启发式判断，会把对齐图案一并掩码；
   *   4. 旧实现完全没有写入版本信息（版本 ≥ 7 必需）。
   *
   * @param {number[]} dataCodewords 长度恰为 dataCodewordCount(version, ecl) 的字节数组
   * @param {number} version 1–40
   * @param {'L'|'M'|'Q'|'H'} ecl
   * @returns {{matrix: boolean[][], size: number}}
   */
  function buildMatrix(dataCodewords, version, ecl) {
    var size = version * 4 + 17;
    var modules = [];
    var isFunction = [];
    for (var i = 0; i < size; i++) {
      modules.push(new Array(size).fill(false));
      isFunction.push(new Array(size).fill(false));
    }

    function setFunction(row, col, dark) {
      if (row < 0 || row >= size || col < 0 || col >= size) return;
      modules[row][col] = dark;
      isFunction[row][col] = true;
    }

    // 定位图案 + 1 模块宽的分隔符（分隔符必须为浅色）
    function placeFinder(row, col) {
      for (var r = -1; r <= 7; r++) {
        for (var c = -1; c <= 7; c++) {
          var dist = Math.max(Math.abs(r - 3), Math.abs(c - 3));
          setFunction(row + r, col + c, dist !== 2 && dist !== 4);
        }
      }
    }
    placeFinder(0, 0);
    placeFinder(0, size - 7);
    placeFinder(size - 7, 0);

    // 时序图案
    for (var t = 8; t < size - 8; t++) {
      setFunction(6, t, t % 2 === 0);
      setFunction(t, 6, t % 2 === 0);
    }

    // 对齐图案
    if (version >= 2) {
      var centers = QR_ALIGN_PATTERN[version];
      var last = centers.length - 1;
      for (var a = 0; a < centers.length; a++) {
        for (var b = 0; b < centers.length; b++) {
          // 与三个定位图案重叠的组合不放置对齐图案
          if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) continue;
          for (var dr = -2; dr <= 2; dr++) {
            for (var dc = -2; dc <= 2; dc++) {
              setFunction(centers[a] + dr, centers[b] + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
            }
          }
        }
      }
    }

    // 预留格式信息与版本信息区域（功能图案，先占位为浅色）
    for (var f = 0; f <= 8; f++) {
      setFunction(8, f, false);
      setFunction(f, 8, false);
    }
    for (var e = 0; e < 8; e++) {
      setFunction(size - 1 - e, 8, false);
      setFunction(8, size - 1 - e, false);
    }
    if (version >= 7) {
      for (var vi = 0; vi < 18; vi++) {
        setFunction(size - 11 + (vi % 3), Math.floor(vi / 3), false);
        setFunction(Math.floor(vi / 3), size - 11 + (vi % 3), false);
      }
    }
    setFunction(size - 8, 8, true); // 固定的暗模块

    // ---- 分块 → 纠错 → 交错 ----
    var cap = QR_CAPACITY[version][ecl];
    var ecPerBlock = cap[1];
    var blockCount = cap[2] + cap[3];
    var dataCw = cap[0] - ecPerBlock * blockCount;
    // 标准规定：数据码字平均分块，前若干块比后面的块少 1 个码字
    var shortLen = Math.floor(dataCw / blockCount);
    var shortBlocks = blockCount - (dataCw % blockCount);

    var dataBlocks = [];
    var ecBlocks = [];
    var offset = 0;
    for (var blk = 0; blk < blockCount; blk++) {
      var len = shortLen + (blk < shortBlocks ? 0 : 1);
      var block = dataCodewords.slice(offset, offset + len);
      offset += len;
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, ecPerBlock).slice(len));
    }

    var codewords = [];
    var maxLen = shortLen + 1;
    for (var i = 0; i < maxLen; i++) {
      for (var blk = 0; blk < blockCount; blk++) {
        if (i < dataBlocks[blk].length) codewords.push(dataBlocks[blk][i]);
      }
    }
    for (var i = 0; i < ecPerBlock; i++) {
      for (var blk = 0; blk < blockCount; blk++) codewords.push(ecBlocks[blk][i]);
    }

    // ---- 之字形填充数据（自右下向左上，遇功能模块跳过）----
    var bitIndex = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // 跳过垂直时序图案所在列
      var upward = ((right + 1) & 2) === 0;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var col = right - j;
          var row = upward ? size - 1 - vert : vert;
          if (!isFunction[row][col] && bitIndex < codewords.length * 8) {
            modules[row][col] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
            bitIndex++;
          }
        }
      }
    }

    // ---- 掩码选择：按标准罚分取最优 ----
    var bestMask = 0;
    var bestPenalty = Infinity;
    var bestModules = null;
    for (var mask = 0; mask < 8; mask++) {
      var candidate = applyMask(modules, isFunction, mask);
      var penalty = maskPenalty(candidate);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestMask = mask;
        bestModules = candidate;
      }
    }

    drawFormatBits(bestModules, size, ecl, bestMask);
    if (version >= 7) drawVersionBits(bestModules, size, version);

    return { matrix: bestModules, size: size };
  }

  /**
   * 主编码函数：Byte 模式 + 自动选版 + Reed-Solomon 纠错 + 掩码优化。
   * @param {string} text 待编码文本（UTF-8）
   * @param {{correctLevel?: 'L'|'M'|'Q'|'H'}} [options]
   * @returns {{matrix: boolean[][], size: number}}
   */
  function encodeQR(text, options) {
    options = options || {};
    var ecl = ['L', 'M', 'Q', 'H'].indexOf(options.correctLevel) >= 0 ? options.correctLevel : 'M';
    var bytes = new TextEncoder().encode(text);
    if (!bytes.length) throw new Error('内容不能为空');

    var version = getBestVersion(bytes.length, ecl);
    var dataCw = dataCodewordCount(version, ecl);
    var capacityBits = dataCw * 8;

    // 比特流：模式指示符(0100) + 字符计数 + 数据字节
    var buf = new BitBuffer();
    buf.put(4, 4);
    buf.put(bytes.length, version <= 9 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) buf.put(bytes[i], 8);

    // 终结符（最多 4 个 0 位）+ 补齐到字节边界
    buf.put(0, Math.min(4, capacityBits - buf.bits.length));
    buf.put(0, (8 - (buf.bits.length % 8)) % 8);

    // 转成码字，剩余空间用 0xEC / 0x11 交替填充
    var codewords = [];
    for (var i = 0; i < buf.bits.length; i += 8) {
      var value = 0;
      for (var j = 0; j < 8; j++) value = (value << 1) | buf.bits[i + j];
      codewords.push(value);
    }
    for (var pad = 0; codewords.length < dataCw; pad++) {
      codewords.push(pad % 2 === 0 ? 0xEC : 0x11);
    }

    return buildMatrix(codewords, version, ecl);
  }

  window.ToolCubeQR = { encode: encodeQR };
})();
