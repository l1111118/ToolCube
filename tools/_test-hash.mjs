/**
 * 哈希实现测试（开发期使用，非扩展运行时依赖）
 *
 * 重点验证 tools/hash-generator/tool.js 中自行实现的 MD5：
 * 与 Node 内置 crypto 的 MD5 结果逐字节比对，覆盖
 *   1) 分块边界（0/1/55/56/63/64/65/119/120 字节等，历史缺陷正是 ≥64 字节全错）
 *   2) 二进制字节（≥0x80 会被二次 UTF-8 编码，历史缺陷）
 *   3) 多字节 UTF-8 与代理对（emoji）
 *
 * 用法： node tools/_test-hash.mjs
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const acorn = require('../libs/acorn.js');

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../tools/hash-generator/tool.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });

const WANTED = new Set(['md5FromBytes', 'toUtf8ByteString', 'md5', 'md5ArrayBuffer']);
const pieces = [];
for (const node of ast.body) {
  if (node.type === 'FunctionDeclaration' && node.id && WANTED.has(node.id.name)) {
    pieces.push(source.slice(node.start, node.end));
  }
}
if (pieces.length !== WANTED.size) {
  console.error(`仅提取到 ${pieces.length}/${WANTED.size} 个函数，提取逻辑可能失效`);
  process.exit(1);
}

const api = new Function(`${pieces.join('\n')}
  return { md5, md5ArrayBuffer, toUtf8ByteString };`)();

let pass = 0;
let fail = 0;

function expect(label, actual, expected) {
  if (actual === expected) { pass++; return; }
  console.error(`✗ ${label}\n    实际: ${actual}\n    期望: ${expected}`);
  fail++;
}

// ── 标准测试向量（RFC 1321 附录 A.5）──
expect('RFC1321 ""', api.md5(''), 'd41d8cd98f00b204e9800998ecf8427e');
expect('RFC1321 "a"', api.md5('a'), '0cc175b9c0f1b6a831c399e269772661');
expect('RFC1321 "abc"', api.md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
expect('RFC1321 "message digest"', api.md5('message digest'), 'f96b697d7cb7938d525a2f31aaf161d0');
expect('RFC1321 a..z', api.md5('abcdefghijklmnopqrstuvwxyz'), 'c3fcd3d76192e4007dfb496cca67e13b');
expect('RFC1321 A-Za-z0-9', api.md5('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'), 'd174ab98d277d9f5a5611c2c9f419d9f');
expect('RFC1321 8x数字', api.md5('12345678901234567890123456789012345678901234567890123456789012345678901234567890'), '57edf4a22be3c955ac49da2e2107b67a');

// ── 分块边界：覆盖历史缺陷（≥64 字节全部算错）──
const boundaryLengths = [0, 1, 54, 55, 56, 57, 63, 64, 65, 100, 119, 120, 121, 127, 128, 129, 191, 192, 1000, 4096, 8193];
for (const n of boundaryLengths) {
  const input = 'a'.repeat(n);
  expect(`长度 ${n} 的 "a"`, api.md5(input), createHash('md5').update(input, 'utf8').digest('hex'));
}

// ── 二进制字节：覆盖"字节被二次 UTF-8 编码"的历史缺陷 ──
for (const n of [0, 1, 63, 64, 65, 200, 1000]) {
  const bytes = Buffer.alloc(n);
  for (let i = 0; i < n; i++) bytes[i] = (i * 37 + 128) & 0xff; // 含大量 ≥0x80 的字节
  const expected = createHash('md5').update(bytes).digest('hex');
  const actual = api.md5ArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  expect(`二进制 ${n} 字节`, actual, expected);
}

// ── 全 0xFF 字节（最容易被二次编码破坏的情形）──
{
  const bytes = Buffer.alloc(100, 0xff);
  expect('二进制 100×0xFF',
    api.md5ArrayBuffer(bytes.buffer.slice(0)),
    createHash('md5').update(bytes).digest('hex'));
}

// ── 多字节 UTF-8 与代理对 ──
const unicodeCases = ['中文测试', '日本語テスト', '한국어', 'emoji 😀🚀❤️', '混合 mixed 中文😀 123', 'ßöüä'];
for (const s of unicodeCases) {
  expect(`UTF-8 "${s}"`, api.md5(s), createHash('md5').update(s, 'utf8').digest('hex'));
}

// ── UTF-8 字节串长度校验（代理对应编码为 4 字节）──
expect('emoji 编码为 4 字节', String(api.toUtf8ByteString('😀').length), '4');
expect('中文编码为 3 字节', String(api.toUtf8ByteString('中').length), '3');
expect('ASCII 编码为 1 字节', String(api.toUtf8ByteString('a').length), '1');

// ==================== file-hash 的独立 MD5 实现 ====================
// tools/file-hash 自带一套「增量式」MD5（与 hash-generator 的实现相互独立），
// 用于大文件流式计算，同样必须与标准结果一致。
{
  const fhSource = readFileSync(resolve(here, '../tools/file-hash/tool.js'), 'utf8');
  const fhAst = acorn.parse(fhSource, { ecmaVersion: 'latest', sourceType: 'script' });
  const FH_NAMES = new Set(['md5_create', 'md5_rotl', 'md5_add32', 'md5_cmn', 'md5_ff', 'md5_gg', 'md5_hh', 'md5_ii', 'md5_cycle', 'md5_update', 'md5_final']);
  const fhPieces = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration' && node.id && FH_NAMES.has(node.id.name)) {
      fhPieces.push(fhSource.slice(node.start, node.end));
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value.type === 'string') walk(value);
    }
  })(fhAst);

  if (fhPieces.length !== FH_NAMES.size) {
    console.error(`✗ file-hash：仅提取到 ${fhPieces.length}/${FH_NAMES.size} 个函数，跳过该组测试`);
    fail++;
  } else {
    const fh = new Function(`${fhPieces.join('\n')}
      return { md5_create, md5_update, md5_final };`)();

    /**
     * 按给定分块大小流式计算 MD5，用于同时验证增量更新的跨块拼接。
     * 注意：必须传入真正的 Uint8Array，而不是 Node 的 Buffer ——
     * Buffer.prototype.slice 返回共享内存的视图（其 .buffer 是整块内存），
     * 与 Uint8Array.prototype.slice 的「复制」语义不同，会与生产路径行为不一致。
     */
    function incrementalMd5(bytes, chunkSize) {
      const ctx = fh.md5_create();
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const part = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        fh.md5_update(ctx, new Uint8Array(part));
      }
      return fh.md5_final(ctx);
    }

    // 边界长度 + 不同分块粒度（含 1 字节分块，最大化跨块拼接的考验）
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 8193]) {
      const bytes = Buffer.alloc(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 91 + 17) & 0xff;
      const expected = createHash('md5').update(bytes).digest('hex');
      expect(`file-hash 二进制 ${n} 字节（单块）`, incrementalMd5(bytes, Math.max(1, n)), expected);
      expect(`file-hash 二进制 ${n} 字节（1 字节分块）`, incrementalMd5(bytes, 1), expected);
      expect(`file-hash 二进制 ${n} 字节（7 字节分块）`, incrementalMd5(bytes, 7), expected);
      expect(`file-hash 二进制 ${n} 字节（64 字节分块）`, incrementalMd5(bytes, 64), expected);
    }
  }
}

console.log(`\n哈希实现测试：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
