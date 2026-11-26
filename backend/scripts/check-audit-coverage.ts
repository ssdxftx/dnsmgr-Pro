import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIT_ROUTES, resolveRoute } from '../src/lib/audit/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'src/routes');

const found: string[] = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const re = /app\.(post|put|patch|delete)\(\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) found.push(`${m[1].toUpperCase()} ${m[2]}`);
}

const uniq = [...new Set(found)].sort();
const skipped = uniq.filter((k) => /\/api\/setup\//.test(k));
const unmapped = uniq.filter((k) => !AUDIT_ROUTES[k] && !/\/api\/setup\//.test(k));

console.log(`写路由总数：${uniq.length}`);
console.log(`精确映射：${uniq.length - unmapped.length - skipped.length}`);
console.log(`跳过（安装向导）：${skipped.length}`);
console.log(`走 fallback：${unmapped.length}`);
for (const k of unmapped) {
  const [method, route] = k.split(' ');
  const meta = resolveRoute(method, route);
  console.log(`  ${k}  →  ${meta.module} / ${meta.action}`);
}
if (unmapped.length) {
  console.error(`[audit] ${unmapped.length} 条写路由未精确映射，请在 backend/src/lib/audit/catalog.ts 中补充。`);
  process.exitCode = 1;
}
