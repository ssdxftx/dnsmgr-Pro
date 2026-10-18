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
const ms0 = f.msAxisFormatter(0);
const ms1 = f.msAxisFormatter(1);
if (ms0(150) !== '150 ms' || ms1(90) !== '90.0 ms' || ms1(1500) !== '1.50 s') {
  failed++;
  console.error('msAxisFormatter 输出异常');
}
if (f.formatMetric(1024, 'byte') !== '1.00 KB') {
  failed++;
  console.error('formatMetric(1024, byte) 输出异常');
}
if (f.formatMetric(null, 'percent') !== '—') {
  failed++;
  console.error('formatMetric(null, percent) 应返回 —');
}

// 加速场景模板的域名填充
const fillSource = readFileSync(join(root, 'src/lib/cdn/fillRuleHost.ts'), 'utf8');
const fillCode = ts.transpileModule(fillSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const fillModule = { exports: {} };
new Function('module', 'exports', fillCode)(fillModule, fillModule.exports);
const fill = fillModule.exports.fillHostValues;
const hostIn = (condition) => ({ Condition: condition });
const casesFill = [
  [{ Condition: '${http.request.host} in []' }, 'a.com', "${http.request.host} in ['a.com']"],
  [{ Condition: 'lower(${http.request.host}) not in []' }, 'a.com', "lower(${http.request.host}) not in ['a.com']"],
];
for (const [node, domain, expected] of casesFill) {
  if (fill(node, domain) !== 1 || node.Condition !== expected) {
    failed++;
    console.error(`fillHostValues 输出异常：${node.Condition}，期望 ${expected}`);
  }
}
const deep = { Branches: [{ SubRules: [{ Condition: '${http.request.host} in []' }] }] };
if (fill(deep, 'a.com') !== 1 || deep.Branches[0].SubRules[0].Condition !== "${http.request.host} in ['a.com']") {
  failed++;
  console.error('fillHostValues 未替换深层子规则');
}
const plain = { Condition: 'true' };
if (fill(plain, 'a.com') !== 0 || plain.Condition !== 'true') {
  failed++;
  console.error('fillHostValues 不应修改无 HOST 条件的节点');
}
if (failed) {
  console.error(`单位格式化校验失败：${failed} 项`);
  process.exit(1);
}
console.log(`单位格式化校验通过：${cases.length} 项`);
