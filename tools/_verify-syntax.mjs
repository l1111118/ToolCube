/**
 * 语法校验脚本（开发期使用，非扩展运行时依赖）
 * 用 acorn 以「模块 + classic 双模式」解析目标 JS 文件，报告语法错误。
 *
 * 用途：本项目无构建流程，改动后需要一个比"肉眼检查"可靠的验证手段。
 * 之所以不用 `node --check`：扩展源码大量使用 ESM import 与浏览器全局，
 * node 默认按 CommonJS 解析会误报；acorn 可以显式指定 sourceType。
 *
 * 用法： node tools/_verify-syntax.mjs <file...>
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const acorn = require('../libs/acorn.js');

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('用法: node tools/_verify-syntax.mjs <file...>');
  process.exit(2);
}

let failed = 0;
for (const file of files) {
  const abs = resolve(file);
  let source;
  try {
    source = readFileSync(abs, 'utf8');
  } catch (e) {
    console.error(`✗ ${file}: 无法读取 (${e.message})`);
    failed++;
    continue;
  }

  // 先按 ES module 解析（扩展的 background / popup / options / common 使用 import）
  let moduleError = null;
  try {
    acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true });
  } catch (e) {
    moduleError = e;
  }

  if (!moduleError) {
    console.log(`✓ ${file} (module)`);
    continue;
  }

  // 再按 classic script 解析（content scripts / tools 不使用 import）
  try {
    acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
    console.log(`✓ ${file} (script)`);
  } catch (e) {
    failed++;
    const line = moduleError.loc ? moduleError.loc.line : (e.loc ? e.loc.line : '?');
    const col = moduleError.loc ? moduleError.loc.column : (e.loc ? e.loc.column : '?');
    const msg = e.message || moduleError.message;
    console.error(`✗ ${file}: ${msg} @ ${line}:${col}`);
  }
}

if (failed > 0) {
  console.error(`\n语法校验失败: ${failed} 个文件`);
  process.exit(1);
}
console.log(`\n语法校验通过: ${files.length} 个文件`);
