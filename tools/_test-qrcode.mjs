/**
 * 二维码编码器测试（开发期使用，非扩展运行时依赖）
 *
 * 为什么需要这个测试
 * ------------------
 * 二维码生成器是纯本地实现，一旦编码有误（例如漏写模式指示符、交错顺序不对、
 * 掩码范围算错），界面上依然会画出一张"看起来像二维码"的图片，
 * 但任何扫码器都读不出来 —— 这正是本次审计要根除的"看似有效实则无效"。
 *
 * 因此这里不做"结构自检"（自己写的编码器配自己写的校验很容易一起错），
 * 而是把生成的矩阵**栅格化成像素**，交给项目内已有的第三方解码库 jsQR
 * （libs/jsQR.js，与工具页用的是同一份）去解码，断言解出的文本与原文一致。
 * 这是一条与编码实现完全独立的验证链路。
 *
 * 覆盖：ASCII / URL / 中文（UTF-8）/ 超长内容（版本 ≥ 7，触发版本信息写入）
 *       四种纠错等级 / 空输入 / 超容量输入。
 *
 * 用法： node tools/_test-qrcode.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// jsQR 是 UMD 构建；在 Node 下通过 require 得到解码函数
const jsQR = require('../libs/jsQR.js');

// ==================== 从共享模块加载编码器 ====================
// 编码器实现位于 common/qrcode.js（经典脚本，挂载到 window.ToolCubeQR）。
// 这里用一个空对象冒充 window 求值，取出的就是工具页运行时用的同一份实现。
const qrSource = readFileSync(resolve(root, 'common/qrcode.js'), 'utf8');
const QRCode = new Function('window', qrSource + '\nreturn window.ToolCubeQR;')({});

// ==================== 断言工具 ====================
let pass = 0;
let fail = 0;
function ok(cond, label, extra = '') {
  if (cond) { pass++; return; }
  console.error(`✗ ${label}${extra ? '\n    ' + extra : ''}`);
  fail++;
}

// ==================== 栅格化 ====================
/**
 * 把模块矩阵转成 RGBA 像素缓冲（白底黑模块 + 4 模块静默区）。
 * 静默区是二维码规范要求的，缺少它解码器可能无法定位。
 */
function rasterize(matrix, size, scale = 6, quiet = 4) {
  const dim = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const my = Math.floor(y / scale) - quiet;
      const dark = mx >= 0 && mx < size && my >= 0 && my < size ? matrix[my][mx] === true : false;
      const v = dark ? 0 : 255;
      const i = (y * dim + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: dim, height: dim };
}

/** 编码 → 栅格化 → jsQR 解码，返回解码文本（失败返回 null） */
function roundTrip(text, ecl) {
  const qr = QRCode.encode(text, { correctLevel: ecl });
  if (!qr || !qr.matrix || typeof qr.size !== 'number') return null;
  const raster = rasterize(qr.matrix, qr.size);
  const decoded = jsQR(raster.data, raster.width, raster.height);
  return decoded ? decoded.data : null;
}

// ==================== 1. 基本往返解码 ====================
const basicCases = [
  'HELLO WORLD',
  '1234567890',
  'https://github.com/l1111118/ToolCube',
  'a'
];
for (const text of basicCases) {
  const decoded = roundTrip(text, 'M');
  ok(decoded === text, `应能解码并还原: ${JSON.stringify(text)}`, `实际解码: ${JSON.stringify(decoded)}`);
}

// ==================== 2. UTF-8 多字节内容 ====================
const utf8Cases = [
  '你好，世界',
  '二维码生成器 · 纯本地实现',
  '混合 mixed 内容 123 と日本語'
];
for (const text of utf8Cases) {
  const decoded = roundTrip(text, 'M');
  ok(decoded === text, `应能解码 UTF-8 内容: ${JSON.stringify(text)}`, `实际解码: ${JSON.stringify(decoded)}`);
}

// ==================== 3. 四种纠错等级 ====================
for (const ecl of ['L', 'M', 'Q', 'H']) {
  const text = '纠错等级 ' + ecl;
  const decoded = roundTrip(text, ecl);
  ok(decoded === text, `纠错等级 ${ecl} 应能解码`, `实际解码: ${JSON.stringify(decoded)}`);
}

// ==================== 4. 超长内容（版本 ≥ 7，必须写入版本信息）====================
{
  const longText = 'A'.repeat(400);
  const decoded = roundTrip(longText, 'M');
  ok(decoded === longText, '400 字节内容（版本 ≥ 7）应能解码', `实际解码长度: ${decoded ? decoded.length : 'null'}`);

  // 用中文验证多字节计数：200 个汉字 = 600 字节，强制更大的版本
  const longCjk = '中'.repeat(200);
  const decodedCjk = roundTrip(longCjk, 'L');
  ok(decodedCjk === longCjk, '200 个汉字（600 字节）应能解码', `实际解码长度: ${decodedCjk ? decodedCjk.length : 'null'}`);
}

// ==================== 5. 版本与尺寸自洽 ====================
{
  const qr = QRCode.encode('HELLO WORLD', { correctLevel: 'M' });
  ok(qr.size === 21, '短内容应选择版本 1（21×21）', `实际尺寸: ${qr.size}`);
  ok(qr.matrix.length === qr.size && qr.matrix[0].length === qr.size, '矩阵应为 size×size');
  ok(qr.matrix[0][0] === true, '左上角定位图案的角点应为深色');
  ok(qr.matrix[qr.size - 8][8] === true, '固定暗模块 (size-8, 8) 应为深色');
}

// ==================== 6. 边界与异常 ====================
{
  let threw = false;
  try { QRCode.encode('', { correctLevel: 'M' }); } catch (e) { threw = true; }
  ok(threw, '空内容应抛出可读错误而不是生成空二维码');

  // 版本 40 / L 的数据容量为 2953 字节；超过必须报错而不是静默截断
  let overflowThrew = false;
  try { QRCode.encode('A'.repeat(3000), { correctLevel: 'L' }); } catch (e) { overflowThrew = true; }
  ok(overflowThrew, '超出容量上限应抛出错误（不得静默截断）');
}

// ==================== 7. 共享模块的引入（静态检查）====================
{
  for (const toolId of ['qrcode-generator', 'url-parser']) {
    const html = readFileSync(resolve(root, 'tools', toolId, 'tool.html'), 'utf8');
    const iQr = html.indexOf('common/qrcode.js');
    const iTool = html.indexOf('src="tool.js"');
    ok(iQr >= 0 && iTool >= 0 && iQr < iTool, `${toolId} 应在 tool.js 之前引入 common/qrcode.js`);
  }
  // url-parser 此前硬编码了第三方二维码接口，且兜底用的是会被 CSP 拦截的内联 onerror
  const urlParser = readFileSync(resolve(root, 'tools/url-parser/tool.js'), 'utf8');
  ok(!/https?:\/\/[^'"\s]*qrserver/.test(urlParser), 'url-parser 不应再请求第三方二维码接口');
  ok(!/onerror\s*=/.test(urlParser), 'url-parser 不应使用内联 onerror（会被扩展页 CSP 拦截）');
}

console.log(`\n二维码编码器测试：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
