/**
 * 旧操作日志回填（一次性，手动执行，不在启动时自动运行）
 * 用法：cd backend && npx tsx scripts/backfill-audit.ts
 */
import { query, table } from '../src/db.js';

async function main() {
  const rows: any[] = await query(
    `SELECT id, uid, action, domain, data, addtime FROM ${table('log')} ORDER BY id`,
  );
  if (!rows.length) {
    console.log('旧日志表为空，无需回填');
    return;
  }

  const users: any[] = await query(`SELECT id, username FROM ${table('user')}`);
  const nameById = new Map(users.map((u) => [Number(u.id), u.username]));

  const doneRows: any[] = await query(
    `SELECT target_id FROM ${table('audit_log')} WHERE module = 'legacy' AND action = 'legacy.operation'`,
  );
  const done = new Set(doneRows.map((r) => String(r.target_id)));

  let inserted = 0;
  let skipped = 0;
  for (const r of rows) {
    if (done.has(String(r.id))) {
      skipped++;
      continue;
    }
    await query(
      `INSERT INTO ${table('audit_log')}
       (uid, username, module, action, method, path, route, target_type, target_id, target_name,
        summary, detail, changes, result, errmsg, status, ip, ua, cost_ms, addtime)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        Number(r.uid || 0),
        nameById.get(Number(r.uid)) || '',
        'legacy',
        'legacy.operation',
        'POST',
        '/api/legacy',
        '',
        'domain',
        String(r.id),
        String(r.domain || ''),
        String(r.action || ''),
        JSON.stringify({ data: r.data || '' }),
        null,
        1,
        '',
        0,
        '',
        '',
        0,
        r.addtime,
      ],
    );
    inserted++;
  }

  console.log(`回填完成：新增 ${inserted} 条，跳过已存在 ${skipped} 条`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
