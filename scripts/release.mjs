#!/usr/bin/env node
/**
 * 发布新版本：升级版本号 -> 提交 -> 打版本标签 -> 推送代码与标签
 *
 * 用法：
 *   git add <本次改动的文件>          # 先把要发布的内容加入暂存区
 *   node scripts/release.mjs 1.0.2    # 可选：追加自定义提交信息
 *
 * 版本标签统一为 vX.Y.Z（如 v1.0.2），代码与标签在同一次推送中提交到 origin。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_FILES = ['frontend/package.json', 'frontend/package-lock.json', 'backend/package.json', 'backend/package-lock.json'];

function git(args, opts = {}) {
  const out = execFileSync('git', args, { cwd: root, encoding: 'utf8', ...opts });
  // stdio:'inherit' 时 execFileSync 返回 null
  return out ? String(out).trim() : '';
}

function fail(msg) {
  console.error(`\n[release] 发布中止：${msg}\n`);
  process.exit(1);
}

const [version, ...msgParts] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  fail('请提供符合 x.y.z 的版本号，例如：node scripts/release.mjs 1.0.1');
}
const tag = `v${version}`;
const message = msgParts.join(' ').trim() || `chore(release): ${tag}`;

if (git(['tag', '-l', tag])) fail(`标签 ${tag} 已存在`);

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') fail(`当前分支为 ${branch}，请在 main 分支发布`);

const staged = git(['diff', '--cached', '--name-only']);
if (!staged) fail('暂存区为空，请先 git add 本次要发布的改动');
console.log(`[release] 待发布改动：\n${staged.split('\n').map((f) => '  - ' + f).join('\n')}`);

for (const rel of VERSION_FILES) {
  const file = join(root, rel);
  let json;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`解析 ${rel} 失败：${e.message}`);
  }
  json.version = version;
  if (rel.endsWith('package-lock.json') && json.packages?.['']) json.packages[''].version = version;
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  console.log(`[release] ${rel} -> ${version}`);
}

git(['add', ...VERSION_FILES], { stdio: 'inherit' });
git(['commit', '-m', message], { stdio: 'inherit' });
git(['tag', '-a', tag, '-m', `${tag}: ${message}`], { stdio: 'inherit' });
git(['push', 'origin', 'main', tag], { stdio: 'inherit' });

console.log(`\n[release] 完成：${tag} 已推送（分支 main + 标签 ${tag}）`);
if (!msgParts.length) console.log('[release] 提示：可通过第二个参数自定义提交信息');
