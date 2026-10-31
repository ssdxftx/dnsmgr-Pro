import { mkdtemp } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function assert(condition: any, message: string): asserts condition {
  if (!condition) {
    console.error('失败：' + message);
    process.exit(1);
  }
  console.log('通过：' + message);
}

const dir = await mkdtemp(path.join(os.tmpdir(), 'dnsmgr-sqlite-check-'));
process.env.DNSMGR_DATA_DIR = dir;
process.env.DNSMGR_DATA_PERSISTENT = '1';
process.env.DB_TYPE = 'sqlite';

const installer = await import('../src/installer.js');
const db = await import('../src/db.js');
const { isGeneratedColumn } = await import('../src/db/types.js');
const config = await import('../src/config.js');
const backupExport = await import('../src/lib/backup/export.js');
const backupImport = await import('../src/lib/backup/import.js');
const backupArchive = await import('../src/lib/backup/archive.js');
const { hitRateLimitDistributed } = await import('../src/lib/rateLimit.js');
const backupKey = await import('../src/lib/backup/key.js');

assert(isGeneratedColumn('VIRTUAL GENERATED'), '识别 VIRTUAL 生成列');
assert(isGeneratedColumn('STORED GENERATED'), '识别 STORED 生成列');
assert(!isGeneratedColumn('DEFAULT_GENERATED'), 'DEFAULT_GENERATED 不算生成列');
assert(!isGeneratedColumn(''), '普通列不算生成列');

assert((await installer.getInstallState()) === 'not_installed', '空 SQLite 数据库视为未安装');

const cfg = {
  db_type: 'sqlite' as const,
  db_host: '',
  db_port: 3306,
  db_user: '',
  db_password: '',
  db_name: 'sqlite',
  db_prefix: 'dnsmgr_',
  db_file: '',
};

const install = await installer.performInstall(cfg, 'admin', 'password123');
assert(install.ok && !install.bound, 'SQLite 全新安装成功');
assert((await installer.getInstallState()) === 'installed', '安装状态为已安装');
assert(db.getDbType() === 'sqlite', '驱动类型为 sqlite');

const users = await db.query<any>('SELECT id, username, level, is_super FROM dnsmgr_user');
assert(users.length === 1 && Number(users[0].id) === 1000 && Number(users[0].is_super) === 1, '管理员 ID=1000 且为超级管理员');
let duplicateRejected = false;
try {
  await db.query(
    `INSERT INTO dnsmgr_user (username, password, is_api, apikey, level, regtime, lasttime, status, is_super)
     VALUES ('ADMIN', 'x', 0, '', 2, NOW(), NOW(), 1, 0)`,
  );
} catch {
  duplicateRejected = true;
}
assert(duplicateRejected, '用户名唯一约束不区分大小写');
assert((await db.queryOne<any>(`SELECT id FROM dnsmgr_user WHERE username = 'Admin'`))?.id === 1000, '用户名查询不区分大小写');

await config.configSet('check_key', 'one');
await config.configSet('check_key', 'two');
assert((await config.configGet('check_key')) === 'two', '配置 upsert 生效');
assert((await db.query<any>('SELECT COUNT(*) AS c FROM dnsmgr_config WHERE `key` = ?', ['check_key']))[0].c === 1, '配置 upsert 只保留一行');

const { createHash } = await import('node:crypto');
const { legacyApiAuth, legacyBody } = await import('../src/lib/legacyApi.js');
const form = legacyBody({ query: {}, body: 'uid=1000&domains%5B%5D=a.example.com&domains%5B%5D=b.example.com' });
assert(Array.isArray(form.domains) && form.domains.length === 2, '旧版表单数组字段解析正确');
await db.query('UPDATE dnsmgr_user SET is_api = 1, apikey = ? WHERE id = 1000', ['legacy-check-key']);
await config.configSet('legacy_api_enable', '0');
const offAuth = await legacyApiAuth({ query: {}, body: { uid: 1000, timestamp: '1', sign: 'x' }, headers: {} });
assert(!offAuth.ok && offAuth.status === 404, '旧版 API 兼容层默认关闭');
await config.configSet('legacy_api_enable', '1');
const timestamp = String(Math.floor(Date.now() / 1000));
const sign = createHash('md5').update('1000' + timestamp + 'legacy-check-key').digest('hex');
const legacyReq: any = { query: {}, body: { uid: '1000', timestamp, sign }, headers: {} };
const okAuth = await legacyApiAuth(legacyReq);
assert(okAuth.ok && legacyReq.user.uid === 1000 && legacyReq.user.auth_type === 'legacy_api', '旧版签名认证通过');
const badAuth = await legacyApiAuth({ query: {}, body: { uid: 1000, timestamp, sign: 'bad' }, headers: {} });
assert(!badAuth.ok && badAuth.status === 403, '旧版签名错误被拒绝');

const setInsert: any = await db.query('INSERT INTO dnsmgr_cert_order SET ?', [
  { aid: 1, status: 0, isauto: true },
]);
assert(Number(setInsert.insertId) > 0, 'INSERT ... SET ? 展开正确');
await db.query('UPDATE dnsmgr_cert_order SET ? WHERE id = ?', [{ status: 1 }, setInsert.insertId]);
assert((await db.query<any>('SELECT status, isauto FROM dnsmgr_cert_order WHERE id = ?', [setInsert.insertId]))[0].status === 1, 'UPDATE ... SET ? 展开正确');

const accountInsert: any = await db.query(
  'INSERT INTO dnsmgr_account (type, name, config, remark, owner_uid, visibility, addtime) VALUES (?, ?, ?, ?, ?, ?, NOW())',
  ['aliyun', 'check-account', '{}', '', 0, 'shared'],
);
assert(Number(accountInsert.insertId) > 0, 'INSERT 返回 insertId');
await db.query('INSERT INTO dnsmgr_domain (aid, name, thirdid, recordcount, addtime) VALUES (?, ?, ?, ?, NOW())', [accountInsert.insertId, 'example.com', 'x', 0]);
await db.query('INSERT INTO dnsmgr_domain (aid, name, thirdid, recordcount, addtime) VALUES (?, ?, ?, ?, NOW())', [accountInsert.insertId, 'example.net', 'y', 0]);

const Fastify = (await import('fastify')).default;
const legacyApp = Fastify({ logger: false });
await legacyApp.register((await import('../src/routes/domain.js')).default);
const legacyRes = await legacyApp.inject({
  method: 'POST',
  url: '/api/domain',
  payload: { uid: 1000, timestamp, sign, offset: 0, limit: 10 },
});
assert(legacyRes.statusCode === 200 && JSON.parse(legacyRes.body).total === 2, '旧版域名列表接口可用');
await legacyApp.close();

const grouped = await db.query<any>("SELECT GROUP_CONCAT(name ORDER BY id ASC SEPARATOR ',') AS names FROM dnsmgr_domain");
assert(grouped[0].names === 'example.com,example.net', 'GROUP_CONCAT + ORDER BY 翻译正确');
const trimmed = await db.query<any>("SELECT LOWER(TRIM(TRAILING '.' FROM ?)) AS value", ['Example.COM.']);
assert(trimmed[0].value === 'example.com', 'TRIM(TRAILING) 翻译正确');
const greatest = await db.query<any>('SELECT GREATEST(?, 0) AS value', [-1]);
assert(Number(greatest[0].value) === 0, 'GREATEST 翻译正确');
const dates = await db.query<any>(
  'SELECT DATE_ADD(NOW(), INTERVAL ? DAY) AS later, DATE_SUB(NOW(), INTERVAL 1 DAY) AS earlier, CURDATE() AS today, NOW() AS now',
  [1],
);
assert(String(dates[0].later) > String(dates[0].now), 'DATE_ADD 翻译正确');
assert(String(dates[0].earlier) < String(dates[0].now), 'DATE_SUB 翻译正确');
assert(/^\d{4}-\d{2}-\d{2}$/.test(String(dates[0].today)), 'CURDATE 翻译正确');
const relativeDates = await db.query<any>(
  'SELECT NOW() - INTERVAL 1 DAY AS earlier, NOW() + INTERVAL 1 HOUR AS later, NOW() AS now',
);
assert(String(relativeDates[0].earlier) < String(relativeDates[0].now), 'NOW() - INTERVAL 翻译正确');
assert(String(relativeDates[0].later) > String(relativeDates[0].now), 'NOW() + INTERVAL 翻译正确');

await db.query(
  'INSERT INTO dnsmgr_audit_log (uid, module, action, method, path, addtime) VALUES ?',
  [[[1, 'check', 'a', 'GET', '/a', '2026-01-01 00:00:00'], [1, 'check', 'b', 'GET', '/b', '2026-01-01 00:00:00']]],
);
assert((await db.query<any>("SELECT COUNT(*) AS c FROM dnsmgr_audit_log WHERE module = 'check'"))[0].c === 2, 'VALUES ? 批量插入展开正确');

await db.query('INSERT INTO dnsmgr_user_vault (uid, mode, salt) VALUES (?, ?, ?)', [1000, 'none', Buffer.from('blob-check')]);
const blobRow: any = await db.queryOne('SELECT salt FROM dnsmgr_user_vault WHERE uid = ?', [1000]);
assert(Buffer.isBuffer(blobRow.salt) && blobRow.salt.toString() === 'blob-check', 'BLOB 往返为 Buffer');

await db.query('INSERT INTO dnsmgr_totp_replay (uid, code, expire_at) VALUES (?, ?, ?)', [1, '123456', Date.now() + 60_000]);
await db.query('INSERT IGNORE INTO dnsmgr_totp_replay (uid, code, expire_at) VALUES (?, ?, ?)', [1, '123456', Date.now() + 60_000]);
assert((await db.query<any>('SELECT COUNT(*) AS c FROM dnsmgr_totp_replay'))[0].c === 1, 'INSERT IGNORE 翻译正确');

let rolledBack = false;
try {
  await db.withTransaction(async (q) => {
    await q('INSERT INTO dnsmgr_log (uid, action, domain, data, addtime) VALUES (?, ?, ?, ?, NOW())', [1, 'tx-local', 'example.com', 'x']);
    await db.query('INSERT INTO dnsmgr_log (uid, action, domain, data, addtime) VALUES (?, ?, ?, ?, NOW())', [1, 'tx-global', 'example.com', 'y']);
    throw new Error('rollback');
  });
} catch {
  rolledBack = true;
}
assert(rolledBack, '事务异常向外抛出');
assert((await db.query<any>("SELECT COUNT(*) AS c FROM dnsmgr_log WHERE action LIKE 'tx-%'"))[0].c === 0, '事务内本地与全局 query 一起回滚');

const snapshot = await db.readSnapshot(async (read) => {
  const domains = await read('SELECT COUNT(*) AS c FROM dnsmgr_domain');
  const accounts = await read('SELECT COUNT(*) AS c FROM dnsmgr_account');
  return { domains: Number(domains[0].c), accounts: Number(accounts[0].c) };
});
assert(snapshot.domains === 2 && snapshot.accounts === 1, '一致性快照读取');

const lock1 = db.withDistributedLockResult('check-lock', async () => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  return 1;
});
await new Promise((resolve) => setTimeout(resolve, 20));
const lock2 = await db.withDistributedLockResult('check-lock', async () => 2);
assert((await lock1).locked && !lock2.locked, 'SQLite 命名锁互斥');

const columns = await db.listColumns('dnsmgr_user');
assert(columns.some((column) => column.Field === 'email'), 'listColumns 返回表结构');
assert(await db.columnExists('dnsmgr_cert_order', 'cdn_domain_id'), '生成列检测可用');
assert(await db.tableExists('dnsmgr_announcement'), '公告表迁移成功');
const generated: any = await db.query('INSERT INTO dnsmgr_cert_order (aid, status, isauto, link) VALUES (?, ?, ?, ?)', [1, 3, 1, '{"cdnDomainId":123}']);
assert((await db.query<any>('SELECT cdn_domain_id FROM dnsmgr_cert_order WHERE id = ?', [generated.insertId]))[0].cdn_domain_id === 123, '生成列可查询');
const migrate = await import('../src/migrate.js');
await migrate.migrate();
assert(true, '迁移可重复执行');
await db.query('UPDATE dnsmgr_user SET is_super = 0');
await migrate.migrate();
const supers = await db.query<any>('SELECT id FROM dnsmgr_user WHERE is_super = 1');
assert(supers.length === 1 && Number(supers[0].id) === 1000, '旧库超级管理员回填正确');

await db.query(
  `INSERT INTO dnsmgr_cf_rule_credential (aid, config, addtime, updatetime) VALUES (?, ?, NOW(), NOW())
   ON DUPLICATE KEY UPDATE config = ?, updatetime = NOW()`,
  [1, 'a', 'a'],
);
await db.query(
  `INSERT INTO dnsmgr_cf_rule_credential (aid, config, addtime, updatetime) VALUES (?, ?, NOW(), NOW())
   ON DUPLICATE KEY UPDATE config = ?, updatetime = NOW()`,
  [1, 'b', 'b'],
);
const cfRow: any = await db.queryOne('SELECT config FROM dnsmgr_cf_rule_credential WHERE aid = 1');
assert(cfRow?.config === 'b', 'ON DUPLICATE KEY UPDATE 带参数翻译正确');

await db.query(
  `INSERT INTO dnsmgr_cdn_stat_data (route, aid, granularity, ts, data, addtime)
   VALUES (?, ?, ?, ?, ?, NOW()), (?, ?, ?, ?, ?, NOW())
   ON DUPLICATE KEY UPDATE data = VALUES(data)`,
  ['r', 1, 'day', '2026-01-01 00:00:00', 'a', 'r', 1, 'day', '2026-01-01 00:00:00', 'b'],
);
const statRow: any = await db.queryOne(
  `SELECT data FROM dnsmgr_cdn_stat_data WHERE route = 'r' AND aid = 1 AND granularity = 'day'`,
);
assert(statRow?.data === 'b', '多行 upsert 与 VALUES(col) 翻译正确');

await db.query(
  `INSERT INTO dnsmgr_announcement (title, content, type, active, sort_order, starttime, endtime, addtime, updatetime)
   VALUES (?, ?, 'info', 1, 0, NULL, NULL, NOW(), NOW())`,
  ['check-announcement', 'backup check'],
);

const exported = await backupExport.exportBackup({ scope: 'site', includeLogs: true });
assert(exported.size > 0 && exported.file.endsWith('.dnsmgrbk'), 'SQLite 备份导出成功');
const key = await backupKey.getBackupKey();
assert(key, '备份密钥可用');
const report = await backupImport.importArchive(path.join(backupArchive.backupsDir(), exported.file), { key, mode: 'replace', trusted: true });
assert(report.tables.domain?.inserted === 2, 'SQLite 备份恢复域名数据');
assert(report.tables.announcement?.inserted === 1, 'SQLite 备份恢复公告数据');

const configFile = path.join(dir, 'config.json');
const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
assert(saved.db_type === 'sqlite' && saved.db_file === 'dnsmgr.sqlite', 'SQLite 配置以相对路径持久化');
assert(fs.existsSync(path.join(dir, 'dnsmgr.sqlite')), 'SQLite 数据文件已创建');
assert(fs.existsSync(path.join(dir, 'dnsmgr.sqlite.lock')), 'SQLite 单实例锁文件已创建');

// 模拟进程被 SIGKILL 后遗留的锁：同主机、PID 已不存在时应自动清理并继续启动
const staleFile = path.join(dir, 'stale.sqlite');
fs.writeFileSync(
  staleFile + '.lock',
  JSON.stringify({ pid: 999999, host: os.hostname(), started: new Date().toISOString(), token: 'stale' }),
  { mode: 0o600 },
);
const { createSqliteDriver } = await import('../src/db/sqlite.js');
const staleDriver = createSqliteDriver({ ...cfg, db_file: staleFile });
assert(fs.existsSync(staleFile + '.lock'), '遗留锁清理后可重新创建锁文件');
await staleDriver.close();
assert(!fs.existsSync(staleFile + '.lock'), '关闭驱动后释放遗留锁测试的锁文件');

const bind = await installer.performInstall(cfg, '', '');
assert(bind.ok && bind.bound, '已安装的 SQLite 数据库可重复绑定');
const boundUsers = await db.query<any>('SELECT COUNT(*) AS c FROM dnsmgr_user');
assert(boundUsers[0].c === 1, '重复绑定不新增管理员');

// 个人备份不能把「有子域名授权的共享域名」下的其他用户任务导出
const bob: any = await db.query(
  `INSERT INTO dnsmgr_user (username, password, is_api, apikey, level, regtime, lasttime, status, is_super, email)
   VALUES ('backup-bob', 'x', 0, '', 1, NOW(), NOW(), 1, 0, 'bob@example.com')`,
);
const victimAccount: any = await db.query(
  `INSERT INTO dnsmgr_account (type, name, config, remark, owner_uid, visibility, addtime)
   VALUES ('aliyun', 'victim-account', '{}', '', 0, 'shared', NOW())`,
);
const victimDomain: any = await db.query(
  `INSERT INTO dnsmgr_domain (aid, name, thirdid, recordcount, addtime)
   VALUES (?, 'victim.example.com', 'v', 0, NOW())`,
  [victimAccount.insertId],
);
await db.query(
  `INSERT INTO dnsmgr_permission (uid, domain, sub, readonly) VALUES (?, 'victim.example.com', 'www', 0)`,
  [bob.insertId],
);
await db.query(
  `INSERT INTO dnsmgr_dns_check_task (name, did, uid, sub, types, cycle, interval_min, notice_email, active, addtime)
   VALUES ('victim-task', ?, 1000, 'www', 'A', 'daily', 0, 'admin@example.com', 1, NOW())`,
  [victimDomain.insertId],
);
const bobExport = await backupExport.exportBackup({ scope: 'user', ownerUid: Number(bob.insertId), includeLogs: true });
const bobArchive = await backupArchive.openArchive(path.join(backupArchive.backupsDir(), bobExport.file), key!);
try {
  const exportedDomains: any[] = [];
  const domainStream = bobArchive.readTable('domain');
  if (domainStream) for await (const row of domainStream) exportedDomains.push(row);
  assert(!exportedDomains.some((row) => row.name === 'victim.example.com'), '个人备份不导出仅授权域名的 domain 行');
  const exportedTasks: any[] = [];
  const taskStream = bobArchive.readTable('dns_check_task');
  if (taskStream) for await (const row of taskStream) exportedTasks.push(row);
  assert(exportedTasks.length === 0, '个人备份不导出其他用户的 DNS 检测任务');
} finally {
  await bobArchive.dispose();
}

// 整站备份排除某用户时，其私有账户下的域名也不能出现在归档中
const privateAccount: any = await db.query(
  `INSERT INTO dnsmgr_account (type, name, config, remark, owner_uid, visibility, addtime)
   VALUES ('aliyun', 'bob-private', '{}', '', ?, 'private', NOW())`,
  [bob.insertId],
);
await db.query(
  `INSERT INTO dnsmgr_domain (aid, name, thirdid, recordcount, addtime)
   VALUES (?, 'excluded.example.com', 'e', 0, NOW())`,
  [privateAccount.insertId],
);
await db.query(
  `INSERT INTO dnsmgr_user_vault (uid, mode, exclude_from_site_backup) VALUES (?, 'none', 1)`,
  [bob.insertId],
);
const sharedAccount: any = await db.query(
  `INSERT INTO dnsmgr_account (type, name, config, remark, owner_uid, visibility, addtime)
   VALUES ('aliyun', 'shared', '{}', '', 0, 'shared', NOW())`,
);
const sharedDomain: any = await db.query(
  `INSERT INTO dnsmgr_domain (aid, name, thirdid, recordcount, addtime)
   VALUES (?, 'shared.example.com', 's', 0, NOW())`,
  [sharedAccount.insertId],
);
await db.query(
  `INSERT INTO dnsmgr_dmtask (did, rr, recordid, type, main_value, backup_value, checktype, checkurl, frequency, cycle, timeout, owner_uid, addtime, active)
   VALUES (?, 'www', 'excluded-task', 1, '1.1.1.1', '2.2.2.2', 0, '', 60, 1, 10, ?, NOW(), 1)`,
  [sharedDomain.insertId, bob.insertId],
);
await db.query(
  `INSERT INTO dnsmgr_cdn_cache_task (url, type, provider, task_id, status, msg, addtime, owner_uid)
   VALUES ('https://excluded.example.com/a.js', 'url', 'aliyun', NULL, 0, NULL, NOW(), ?)`,
  [bob.insertId],
);
const siteExport = await backupExport.exportBackup({ scope: 'site', includeLogs: true });
const siteArchive = await backupArchive.openArchive(path.join(backupArchive.backupsDir(), siteExport.file), key!);
try {
  const siteDomains: any[] = [];
  const siteStream = siteArchive.readTable('domain');
  if (siteStream) for await (const row of siteStream) siteDomains.push(row);
  assert(!siteDomains.some((row) => row.name === 'excluded.example.com'), '整站备份排除用户时不导出其私有域名');
  const siteTasks: any[] = [];
  const taskStream = siteArchive.readTable('dmtask');
  if (taskStream) for await (const row of taskStream) siteTasks.push(row);
  assert(!siteTasks.some((row) => row.recordid === 'excluded-task'), '整站备份排除用户时按 owner_uid 排除其容灾任务');
  const cacheTasks: any[] = [];
  const cacheStream = siteArchive.readTable('cdn_cache_task');
  if (cacheStream) for await (const row of cacheStream) cacheTasks.push(row);
  assert(!cacheTasks.some((row) => String(row.url).includes('excluded.example.com')), '整站备份排除用户时按 owner_uid 排除其缓存任务');
} finally {
  await siteArchive.dispose();
}

assert(await hitRateLimitDistributed('rate-check', 2, 60_000), '分布式限流第一次放行');
assert(await hitRateLimitDistributed('rate-check', 2, 60_000), '分布式限流第二次放行');
assert(!(await hitRateLimitDistributed('rate-check', 2, 60_000)), '分布式限流超限拒绝');
await db.query(`DELETE FROM dnsmgr_rate_limit WHERE bucket = 'rate-check'`);
assert(await hitRateLimitDistributed('rate-rollover', 1, 50), '分布式限流窗口首次放行');
await new Promise((resolve) => setTimeout(resolve, 70));
assert(await hitRateLimitDistributed('rate-rollover', 1, 50), '分布式限流跨窗口后重新计数');
await db.query(`DELETE FROM dnsmgr_rate_limit WHERE bucket = 'rate-rollover'`);

await db.getDriver().close();
assert(!fs.existsSync(path.join(dir, 'dnsmgr.sqlite.lock')), '关闭驱动后释放单实例锁');
console.log('\nSQLite 自检全部通过');
