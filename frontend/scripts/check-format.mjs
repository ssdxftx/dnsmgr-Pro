#!/usr/bin/env node
/** 单位格式化单测（无需测试框架）：transpile format.ts 后断言关键输出 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src/lib/statistics/format.ts'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const module = { exports: {} };
new Function('module', 'exports', code)(module, module.exports);
const f = module.exports;

const cases = [
  ['formatBytes', null, '—'],
  ['formatBytes', 0, '0 B'],
  ['formatBytes', 1024, '1.00 KB'],
  ['formatBytes', 1536, '1.50 KB'],
  ['formatBitRate', null, '—'],
  ['formatBitRate', 1024 * 1024, '1.00 Mbps'],
  ['formatBitRate', 1024 * 1024 * 1024, '1.00 Gbps'],
  ['formatCount', 1234567, '1,234,567'],
  ['formatPercent', 92.44, '92.4%'],
  ['formatPercent', null, '—'],
  ['formatMs', 88.4, '88.4 ms'],
  ['formatMs', 1500, '1.50 s'],
  ['formatQps', 12.345, '12.35'],
];

let failed = 0;
for (const [name, input, expected] of cases) {
  const actual = f[name](input, expected);
  if (actual !== expected) {
    failed++;
    console.error(`${name}(${input}) => ${actual}，期望 ${expected}`);
  }
}
if (f.formatMetric(1024, 'byte') !== '1.00 KB') {
  failed++;
  console.error('formatMetric(1024, byte) 输出异常');
}
if (f.formatMetric(null, 'percent') !== '—') {
  failed++;
  console.error('formatMetric(null, percent) 应返回 —');
}
if (failed) {
  console.error(`单位格式化校验失败：${failed} 项`);
  process.exit(1);
}
console.log(`单位格式化校验通过：${cases.length} 项`);
