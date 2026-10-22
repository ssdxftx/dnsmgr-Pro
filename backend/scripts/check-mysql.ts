import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function assert(condition: any, message: string): asserts condition {
  if (!condition) {
    console.error('失败：' + message);
    process.exit(1);
  }
  console.log('通过：' + message);
}

const host = process.env.DB_HOST || '';
const name = process.env.DB_NAME || '';
if (!host || !name) {
  const message = '未设置 DB_HOST / DB_NAME，跳过 MySQL 自检';
  if (process.env.DNSMGR_REQUIRE_MYSQL === '1') {
    console.error('失败：' + message);
    process.exit(1);
  }
  console.log(message);
  process.exit(0);
}

const dir = await mkdtemp(path.join(os.tmpdir(), 'dnsmgr-mysql-check-'));
process.env.DNSMGR_DATA_DIR = dir;
process.env.DNSMGR_DATA_PERSISTENT = '0';
process.env.DB_TYPE = 'mysql';

const installer = await import('../src/installer.js');
const db = await import('../src/db.js');
const config = await import('../src/config.js');
const backupExport = await import('../src/lib/backup/export.js');
const backupImport = await import('../src/lib/backup/import.js');
const backupArchive = await import('../src/lib/backup/archive.js');
const backupKey = await import('../src/lib/backup/key.js');

const prefix = 'ci_' + Math.random().toString(16).slice(2, 8) + '_';
const cfg = {
  db_type: 'mysql' as const,
  db_host: host,
  db_port: Number(process.env.DB_PORT || 3306),
  db_user: process.env.DB_USER || 'root',
  db_password: process.env.DB_PASSWORD || '',
  db_name: name,
  db_prefix: prefix,
  db_file: '',
};

const install = await installer.performInstall(cfg, 'admin', 'password123');
assert(install.ok && !install.bound, 'MySQL 全新安装成功');
assert((await installer.getInstallState()) === 'installed', '安装状态为已安装');
assert(db.getDbType() === 'mysql', '驱动类型为 mysql');

const users = await db.query<any>(`SELECT id, username, level, is_super FROM ${db.table('user')}`);
assert(users.length === 1 && Number(users[0].is_super) === 1, '管理员创建成功');

await config.configSet('check_key', 'one');
await config.configSet('check_key', 'two');
assert((await config.configGet('check_key')) === 'two', '配置 upsert 生效');

const accountInsert: any = await db.query(
  `INSERT INTO ${db.table('account')} (type, name, config, remark, owner_uid, visibility, addtime) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
  ['aliyun', 'check-account', '{}', '', 0, 'shared'],
);
assert(Number(accountInsert.insertId) > 0, 'INSERT 返回 insertId');
await db.query(`INSERT INTO ${db.table('domain')} (aid, name, thirdid, recordcount, addtime) VALUES (?, ?, ?, ?, NOW())`, [accountInsert.insertId, 'example.com', 'x', 0]);
await db.query(`INSERT INTO ${db.table('domain')} (aid, name, thirdid, recordcount, addtime) VALUES (?, ?, ?, ?, NOW())`, [accountInsert.insertId, 'example.net', 'y', 0]);

const grouped = await db.query<any>(`SELECT GROUP_CONCAT(name ORDER BY id ASC SEPARATOR ',') AS names FROM ${db.table('domain')}`);
assert(grouped[0].names === 'example.com,example.net', 'GROUP_CONCAT 正常');
const trimmed = await db.query<any>(`SELECT LOWER(TRIM(TRAILING '.' FROM ?)) AS value`, ['Example.COM.']);
assert(trimmed[0].value === 'example.com', 'TRIM(TRAILING) 正常');
const greatest = await db.query<any>('SELECT GREATEST(?, 0) AS value', [-1]);
assert(Number(greatest[0].value) === 0, 'GREATEST 正常');
const dates = await db.query<any>('SELECT DATE_ADD(NOW(), INTERVAL ? DAY) AS later, NOW() AS now', [1]);
assert(String(dates[0].later) > String(dates[0].now), 'DATE_ADD 正常');

await db.query(`INSERT INTO ${db.table('totp_replay')} (uid, code, expire_at) VALUES (?, ?, ?)`, [1, '123456', Date.now() + 60_000]);
await db.query(`INSERT IGNORE INTO ${db.table('totp_replay')} (uid, code, expire_at) VALUES (?, ?, ?)`, [1, '123456', Date.now() + 60_000]);
assert((await db.query<any>(`SELECT COUNT(*) AS c FROM ${db.table('totp_replay')}`))[0].c === 1, 'INSERT IGNORE 正常');

let rolledBack = false;
try {
  await db.withTransaction(async (q) => {
    await q(`INSERT INTO ${db.table('log')} (uid, action, domain, data, addtime) VALUES (?, ?, ?, ?, NOW())`, [1, 'tx-local', 'example.com', 'x']);
    await q(`INSERT INTO ${db.table('log')} (uid, action, domain, data, addtime) VALUES (?, ?, ?, ?, NOW())`, [1, 'tx-local-2', 'example.com', 'y']);
    throw new Error('rollback');
  });
} catch {
  rolledBack = true;
}
assert(rolledBack, '事务异常向外抛出');
assert((await db.query<any>(`SELECT COUNT(*) AS c FROM ${db.table('log')} WHERE action LIKE 'tx-%'`))[0].c === 0, '事务回滚');

const snapshot = await db.readSnapshot(async (read) => {
  const domains = await read(`SELECT COUNT(*) AS c FROM ${db.table('domain')}`);
  const accounts = await read(`SELECT COUNT(*) AS c FROM ${db.table('account')}`);
  return { domains: Number(domains[0].c), accounts: Number(accounts[0].c) };
});
assert(snapshot.domains === 2 && snapshot.accounts === 1, '一致性快照读取');

const lock1 = db.withDistributedLockResult('check-lock', async () => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  return 1;
});
await new Promise((resolve) => setTimeout(resolve, 20));
const lock2 = await db.withDistributedLockResult('check-lock', async () => 2);
assert((await lock1).locked && !lock2.locked, 'MySQL 命名锁互斥');

const columns = await db.listColumns(db.table('user'));
assert(columns.some((column) => column.Field === 'email'), 'listColumns 返回表结构');
const migrate = await import('../src/migrate.js');
await migrate.migrate();
assert(true, '迁移可重复执行');

const exported = await backupExport.exportBackup({ scope: 'site', includeLogs: true });
assert(exported.size > 0 && exported.file.endsWith('.dnsmgrbk'), 'MySQL 备份导出成功');
const key = await backupKey.getBackupKey();
assert(key, '备份密钥可用');
const report = await backupImport.importArchive(path.join(backupArchive.backupsDir(), exported.file), { key, mode: 'replace' });
assert(report.tables.domain?.inserted === 2, 'MySQL 备份恢复域名数据');

await db.getDriver().close();
console.log('\nMySQL 自检全部通过');
