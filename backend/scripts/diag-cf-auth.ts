/**
 * Cloudflare 账户凭证诊断（只读）
 * 用法：cd backend && npx tsx scripts/diag-cf-auth.ts
 */
import { query, table } from '../src/db.js';
import { getSysKey } from '../src/config.js';
import { setSecretKey, decryptConfig } from '../src/lib/secret.js';
import { Cloudflare } from '../src/lib/clients/Cloudflare.js';

function mask(v: any): string {
  const s = String(v ?? '');
  if (!s) return '(空)';
  if (s === '**********') return '(掩码)';
  return `${s.slice(0, 4)}…${s.slice(-2)} (len=${s.length})`;
}

async function main() {
  await setSecretKey(await getSysKey());
  const rows: any[] = await query(
    `SELECT id, name, config FROM ${table('account')} WHERE type = 'cloudflare' ORDER BY id`,
  );
  console.log(`Cloudflare DNS 账户数：${rows.length}\n`);

  for (const r of rows) {
    const raw = String(r.config ?? '');
    console.log(`[#${r.id}] ${r.name}`);
    console.log(`  raw 前缀        = ${raw.slice(0, 12)}${raw.startsWith('enc:v1:') ? ' (已加密)' : ' (明文/异常)'}`);
    console.log(`  双重加密        = ${raw.startsWith('enc:v1:enc:v1:') ? '是 ⚠' : '否'}`);

    const cfg = decryptConfig(raw);
    if (!cfg) {
      console.log('  解密结果        = null ⚠（系统密钥不匹配或密文损坏）');
      console.log('  → 该账户当前必然认证失败，需重新填写凭证\n');
      continue;
    }
    console.log(`  字段            = ${Object.keys(cfg).join(', ')}`);
    console.log(`  email           = ${mask(cfg.email)}`);
    console.log(`  apikey          = ${mask(cfg.apikey)}`);
    console.log(`  auth            = ${cfg.auth === undefined ? '(缺失，走自动判断)' : JSON.stringify(cfg.auth)}`);
    const key = String(cfg.apikey || '');
    const looksGlobal = /^[0-9a-f]{37}$/i.test(key);
    const looksToken = /^[A-Za-z0-9_-]{30,}$/.test(key) && !looksGlobal;
    console.log(`  key 形态        = ${looksGlobal ? 'Global API Key（37 位 hex）' : looksToken ? 'API Token' : '未知'}`);
    if (cfg.auth !== undefined && Number(cfg.auth) === 0 && looksToken) {
      console.log('  ⚠ 认证方式选了「API密钥」，但密钥形态像 Token');
    }
    if (cfg.auth !== undefined && Number(cfg.auth) === 1 && looksGlobal) {
      console.log('  ⚠ 认证方式选了「API令牌」，但密钥形态像 Global Key');
    }

    // 真实连通性测试
    try {
      const auth = cfg.auth !== undefined ? Number(cfg.auth) : looksGlobal ? 0 : 1;
      const cf = new Cloudflare(cfg.email, cfg.apikey, auth);
      const res = await cf.request('GET', '/zones', { per_page: 1 });
      console.log(`  CF 连通性       = OK（可见 zone 数：${res?.result_info?.total_count ?? 0}）`);
    } catch (e: any) {
      console.log(`  CF 连通性       = 失败：${e?.message || e}`);
    }
    console.log('');
  }

  // 规则专用凭证（可能覆盖 DNS 凭证，仅用于规则页，确认是否被误配）
  const cred: any[] = await query(`SELECT aid, config FROM ${table('cf_rule_credential')}`).catch(() => []);
  console.log(`规则专用凭证行数：${cred.length}`);
  for (const c of cred) {
    const cfg = decryptConfig(c.config);
    console.log(`  aid=${c.aid}  apikey=${mask(cfg?.apikey)}  email=${mask(cfg?.email)}  auth=${cfg?.auth ?? '(缺失)'}`);
  }
}

main().catch((e) => {
  console.error('诊断失败：', e?.message || e);
  process.exit(1);
});
