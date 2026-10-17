#!/usr/bin/env node
/**
 * 校验 i18n key 一致性：
 *  1) 源码中静态引用的 key 是否存在于 zh-CN / en-US 语言包
 *  2) zh-CN 与 en-US 两套语言包的 key 集合是否完全对称
 *
 * 用法：node scripts/check-i18n.mjs [--strict]
 *   --strict 时存在不一致会以非零退出码结束（供 CI 使用）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const localesRoot = join(root, 'src/i18n/locales');
const strict = process.argv.includes('--strict');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function flatten(obj, prefix = '', out = new Set()) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, path, out);
    else out.add(path);
  }
  return out;
}

function loadLocale(lang) {
  const dir = join(localesRoot, lang);
  const keys = new Set();
  for (const file of walk(dir).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(file, 'utf8');
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, (id) => {
      throw new Error(`语言包模块不应包含运行时依赖：${id}`);
    });
    const data = module.exports?.default ?? module.exports;
    if (data && typeof data === 'object') flatten(data, '', keys);
  }
  return keys;
}

function collectUsedKeys() {
  const used = new Map();
  const files = walk(join(root, 'src')).filter((f) => /\.(ts|vue)$/.test(f));
  // 匹配 t('a.b') / $t('a.b') / i18n.global.t('a.b')，排除 split('x')、import('x') 等误命中
  const patterns = [
    /(?<![\w$])\$?t\(\s*['"]([^'"\s]+)['"]/g,
    /\.t\(\s*['"]([^'"\s]+)['"]/g,
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const re of patterns) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(source))) {
        const key = match[1];
        if (!key.includes('.') || key.startsWith('.')) continue;
        const line = source.slice(0, match.index).split('\n').length;
        if (!used.has(key)) used.set(key, []);
        used.get(key).push(`${file.replace(root + '/', '')}:${line}`);
      }
    }
  }
  return used;
}

const zh = loadLocale('zh-CN');
const en = loadLocale('en-US');
const used = collectUsedKeys();

const missingZh = [];
const missingEn = [];
for (const [key, refs] of used) {
  if (!zh.has(key)) missingZh.push({ key, refs });
  if (!en.has(key)) missingEn.push({ key, refs });
}

const onlyZh = [...zh].filter((k) => !en.has(k));
const onlyEn = [...en].filter((k) => !zh.has(k));

const report = (title, list, render = (k) => k) => {
  if (!list.length) return;
  console.log(`\n✗ ${title}（${list.length}）`);
  for (const item of list) {
    if (typeof item === 'string') console.log(`    ${item}`);
    else console.log(`    ${item.key}    ← ${item.refs.join(', ')}`);
  }
};

console.log(`语言包 key：zh-CN ${zh.size} / en-US ${en.size}`);
console.log(`源码静态引用：${used.size} 个 key`);

report('源码引用了但 zh-CN 不存在', missingZh);
report('源码引用了但 en-US 不存在', missingEn);
report('zh-CN 有但 en-US 缺失', onlyZh);
report('en-US 有但 zh-CN 缺失', onlyEn);

const failed =
  missingZh.length > 0 || missingEn.length > 0 || onlyZh.length > 0 || onlyEn.length > 0;

if (failed) {
  console.log('\n结果：存在不一致');
  if (strict) process.exit(1);
} else {
  console.log('\n结果：通过');
}
