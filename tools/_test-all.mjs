/**
 * 测试总入口（开发期使用，非扩展运行时依赖）
 *
 * 依次运行「全项目语法校验 + 全部单元测试」，任一失败即返回非 0 退出码。
 * 用法： node tools/_test-all.mjs
 *
 * 实现说明：这里在同进程内用动态 import 依次加载各测试文件，而不是 spawn 子进程。
 * 原因有两个：
 *  1) 部分受限/沙箱环境下无法派生子进程（spawn 会直接 EBUSY 失败）；
 *  2) 同进程加载更快，且不需要在每个测试文件里维护“被导入时不退出”的分支。
 * 各测试文件末尾会调用 process.exit(code)，因此这里临时接管 process.exit，
 * 把退出码记录下来并抛出哨兵异常以中断该文件的后续执行，随后继续下一个文件。
 */
import { readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

class ExitSignal {
  constructor(code) { this.code = code; }
}

function collectJsFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.workbuddy-ai' || name === '.git' || name === 'libs') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collectJsFiles(full, acc);
    else if (name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

const jsFiles = collectJsFiles(root).filter(f => !f.includes('_test-') && !f.includes('_verify-'));

const testFiles = readdirSync(here)
  // 必须排除自身：本文件名同样匹配 _test-*.mjs，若被当作测试导入会形成
  // 顶层 await 的循环导入（TLA deadlock），Node 会以 "unsettled top-level await" 中止进程
  .filter(name => name !== '_test-all.mjs' && /^_test-.+\.mjs$/.test(name))
  .sort()
  .map(name => join(here, name));

const steps = [
  { name: '语法校验（全项目 JS）', file: join(here, '_verify-syntax.mjs'), argv: jsFiles },
  ...testFiles.map(file => ({
    name: file.slice(file.lastIndexOf('_test-') + 6).replace(/\.mjs$/, ''),
    file,
    argv: []
  }))
];

const realExit = process.exit;
const realArgv = process.argv.slice();

let failed = 0;
const failures = [];

for (const step of steps) {
  // 每个测试文件会读取 process.argv.slice(2)，这里按需注入
  process.argv = [process.execPath, step.file, ...step.argv];
  let code = 0;
  const capturedErrors = [];
  const realConsoleError = console.error;
  console.error = (...args) => { capturedErrors.push(args.join(' ')); };

  try {
    process.exit = (c) => { throw new ExitSignal(typeof c === 'number' ? c : 0); };
    await import(pathToFileURL(step.file).href);
  } catch (e) {
    if (e instanceof ExitSignal) {
      code = e.code;
    } else {
      code = 1;
      capturedErrors.push(String(e && e.stack ? e.stack : e));
    }
  } finally {
    process.exit = realExit;
    console.error = realConsoleError;
  }

  if (code === 0) {
    console.log(`✓ ${step.name}`);
  } else {
    failed++;
    failures.push(step.name);
    console.error(`✗ ${step.name}`);
    for (const line of capturedErrors.slice(-8)) {
      console.error('    ' + line);
    }
  }
}

process.argv = realArgv;

console.log(`\n共 ${steps.length} 个步骤，失败 ${failed} 个`);
if (failed > 0) console.error('失败项: ' + failures.join(', '));
realExit(failed === 0 ? 0 : 1);
