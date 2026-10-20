#!/usr/bin/env node
/**
 * 移动端约定的静态校验（无需浏览器）：
 * 1. 使用 TelemetryCard 的页面必须给 KPI 网格加 class="telemetry-row"
 * 2. 使用 StatCard 的页面必须给网格加 class="stat-grid"
 * 3. 不再出现移动端单列的旧 KPI 写法 cols="1 ..."
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const viewsDir = new URL('../src/views/', import.meta.url).pathname;
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.vue')) out.push(full);
  }
  return out;
}
const files = walk(viewsDir);

const problems = [];
for (const full of files) {
  const file = relative(viewsDir, full);
  const src = readFileSync(full, 'utf8');
  if (src.includes('TelemetryCard') && !src.includes('telemetry-row')) {
    problems.push(`${file}: 使用 TelemetryCard 但 KPI 网格缺少 class="telemetry-row"`);
  }
  if (src.includes('StatCard') && !src.includes('stat-grid')) {
    problems.push(`${file}: 使用 StatCard 但网格缺少 class="stat-grid"`);
  }
  if (/cols="1 s:2 m:[34]"/.test(src)) {
    problems.push(`${file}: KPI 网格仍是移动端单列（cols="1 ..."）`);
  }
}

if (problems.length) {
  console.error('移动端静态校验未通过：');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`移动端静态校验通过：${files.length} 个视图`);
