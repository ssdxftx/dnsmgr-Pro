/**
 * EO 归属状态诊断：打印 DescribeZones / DescribeIdentifications 的原始状态
 * 用法：cd backend && npx tsx scripts/diag-eo-ident.ts [--zone zone-xxx]
 */
import { query, table } from '../src/db.js';
import { getSysKey } from '../src/config.js';
import { setSecretKey, decryptConfig } from '../src/lib/secret.js';
import { TencentCloud } from '../src/lib/clients/TencentCloud.js';

const arg = (n: string, d = '') => {
  const i = process.argv.indexOf(n);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

async function main() {
  await setSecretKey(await getSysKey());
  const accts: any[] = await query(`SELECT id, name, config FROM ${table('cdn_account')} WHERE type = ? LIMIT 1`, ['tencent_edgeone']);
  if (!accts.length) throw new Error('未找到 EO 账户');
  const cfg: any = decryptConfig(accts[0].config) || {};
  const client = new TencentCloud(cfg.SecretId, cfg.SecretKey, 'teo.tencentcloudapi.com', 'teo', '2022-09-01');

  const zoneFilter = arg('--zone');
  const zonesResp = await client.request('DescribeZones', { Offset: 0, Limit: 100 });
  const zones: any[] = zonesResp?.Zones || [];
  console.log(`站点数：${zones.length}`);
  for (const z of zones) {
    if (zoneFilter && z.ZoneId !== zoneFilter) continue;
    console.log(`\n[${z.ZoneName}] ${z.ZoneId}`);
    console.log('  Status          =', z.Status);
    console.log('  NameServers     =', JSON.stringify(z.NSDetail?.NameServers ?? z.NameServers ?? []));
    console.log('  OriginalNS      =', JSON.stringify(z.NSDetail?.OriginalNameServers ?? z.OriginalNameServers ?? []));
    console.log('  OwnershipVerif  =', JSON.stringify(z.OwnershipVerification ?? null));
  }

  const names = zones.map((z) => String(z.ZoneName)).filter(Boolean);
  for (let i = 0; i < names.length; i += 20) {
    const batch = names.slice(i, i + 20);
    const resp = await client
      .request('DescribeIdentifications', {
        Offset: 0,
        Limit: 100,
        Filters: [{ Name: 'zone-name', Values: batch }],
      })
      .catch((e: any) => {
        console.log('\n[DescribeIdentifications 失败]', e?.message || e);
        return null;
      });
    if (!resp) break;
    for (const it of resp?.Identifications || []) {
      console.log(`\n[ident] ${it.ZoneName}  Status=${it.Status}  keys=${Object.keys(it).join(',')}`);
    }
  }
}

main().catch((e) => {
  console.error('诊断失败：', e?.message || e);
  process.exit(1);
});
