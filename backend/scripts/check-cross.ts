import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function assert(condition: any, message: string): asserts condition {
  if (!condition) {
    console.error('失败：' + message);
    process.exit(1);
  }
  console.log('通过：' + message);
}

const stage = process.env.CROSS_STAGE || '';

function emit(data: Record<string, any>): void {
  console.log('CROSS_RESULT ' + JSON.stringify(data));
}

async function sqliteExport(): Promise<void> {
  const dir = process.env.CROSS_SQLITE_DIR || mkdtempSync(path.join(os.tmpdir(), 'dnsmgr-cross-sqlite-'));
  process.env.DNSMGR_DATA_DIR = dir;
  process.env.DNSMGR_DATA_PERSISTENT = '1';
  process.env.DB_TYPE = 'sqlite';

  const installer = await import('../src/installer.js');
  const db = await import('../src/db.js');
  const backupExport = await import('../src/lib/backup/export.js');
  const backupArchive = await import('../src/lib/backup/archive.js');
  const backupKey = await import('../src/lib/backup/key.js');

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
  assert(install.ok, 'SQLite 跨库测试安装成功');
  const account: any = await db.query(
    'INSERT INTO dnsmgr_account (type, name, config, remark, owner_uid, visibility, addtime) VALUES (?, ?, ?, ?, ?, ?, NOW())',
    ['aliyun', 'cross-account', '{}', '', 0, 'shared'],
  );
  await db.query(
    'INSERT INTO dnsmgr_domain (aid, name, thirdid, recordcount, addtime) VALUES (?, ?, ?, ?, NOW())',
    [account.insertId, 'cross.example.com', 'x', 0],
  );
  await db.query('INSERT INTO dnsmgr_user_vault (uid, mode, salt) VALUES (?, ?, ?)', [1000, 'none', Buffer.from('cross-blob')]);
  const exported = await backupExport.exportBackup({ scope: 'site', includeLogs: true });
  const key = await backupKey.getBackupKey();
  assert(key, 'SQLite 备份密钥可用');
  emit({ file: path.join(backupArchive.backupsDir(), exported.file), key: key!.toString('base64url'), dir });
  await db.getDriver().close();
}

async function mysqlImport(): Promise<void> {
  const dir = process.env.CROSS_MYSQL_DIR || mkdtempSync(path.join(os.tmpdir(), 'dnsmgr-cross-mysql-'));
  process.env.DNSMGR_DATA_DIR = dir;
  process.env.DNSMGR_DATA_PERSISTENT = '0';
  process.env.DB_TYPE = 'mysql';

  const installer = await import('../src/installer.js');
  const db = await import('../src/db.js');
  const backupImport = await import('../src/lib/backup/import.js');
  const backupExport = await import('../src/lib/backup/export.js');
  const backupArchive = await import('../src/lib/backup/archive.js');
  const backupKey = await import('../src/lib/backup/key.js');

  const archive = String(process.env.CROSS_ARCHIVE || '');
  const key = Buffer.from(String(process.env.CROSS_KEY || ''), 'base64url');
  assert(archive && key.length === 32, 'MySQL 跨库测试收到 SQLite 归档与密钥');
  const prefix = String(process.env.CROSS_PREFIX || 'cross_');
  const cfg = {
    db_type: 'mysql' as const,
    db_host: process.env.DB_HOST || '',
    db_port: Number(process.env.DB_PORT || 3306),
    db_user: process.env.DB_USER || '',
    db_password: process.env.DB_PASSWORD || '',
    db_name: process.env.DB_NAME || '',
    db_prefix: prefix,
    db_file: '',
  };
  const install = await installer.performInstall(cfg, 'admin', 'password123');
  assert(install.ok, 'MySQL 跨库测试安装成功');
  const report = await backupImport.importArchive(archive, { key, mode: 'replace' });
  assert(report.tables.domain?.inserted === 1, 'SQLite 归档导入 MySQL');
  const user: any = await db.queryOne(`SELECT id, username FROM ${prefix}user LIMIT 1`);
  const domain: any = await db.queryOne(`SELECT name FROM ${prefix}domain LIMIT 1`);
  const vault: any = await db.queryOne(`SELECT salt FROM ${prefix}user_vault WHERE uid = ?`, [1000]);
  assert(user?.username === 'admin' && domain?.name === 'cross.example.com', 'MySQL 导入后用户与域名正确');
  assert(Buffer.isBuffer(vault?.salt) && vault.salt.toString() === 'cross-blob', 'MySQL 导入后 BLOB 正确');
  const exported = await backupExport.exportBackup({ scope: 'site', includeLogs: true });
  const outKey = await backupKey.getBackupKey();
  assert(outKey, 'MySQL 备份密钥可用');
  emit({ file: path.join(backupArchive.backupsDir(), exported.file), key: outKey!.toString('base64url'), dir });
  await db.getDriver().close();
}

async function sqliteImport(): Promise<void> {
  const dir = process.env.CROSS_SQLITE2_DIR || mkdtempSync(path.join(os.tmpdir(), 'dnsmgr-cross-sqlite2-'));
  process.env.DNSMGR_DATA_DIR = dir;
  process.env.DNSMGR_DATA_PERSISTENT = '1';
  process.env.DB_TYPE = 'sqlite';

  const installer = await import('../src/installer.js');
  const db = await import('../src/db.js');
  const backupImport = await import('../src/lib/backup/import.js');

  const archive = String(process.env.CROSS_ARCHIVE || '');
  const key = Buffer.from(String(process.env.CROSS_KEY || ''), 'base64url');
  assert(archive && key.length === 32, 'SQLite 跨库测试收到 MySQL 归档与密钥');
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
  assert(install.ok, 'SQLite 跨库测试安装成功');
  const report = await backupImport.importArchive(archive, { key, mode: 'replace' });
  assert(report.tables.domain?.inserted === 1, 'MySQL 归档导入 SQLite');
  const user: any = await db.queryOne('SELECT id, username FROM dnsmgr_user LIMIT 1');
  const domain: any = await db.queryOne('SELECT name FROM dnsmgr_domain LIMIT 1');
  const vault: any = await db.queryOne('SELECT salt FROM dnsmgr_user_vault WHERE uid = ?', [1000]);
  assert(user?.username === 'admin' && domain?.name === 'cross.example.com', 'SQLite 导入后用户与域名正确');
  assert(Buffer.isBuffer(vault?.salt) && vault.salt.toString() === 'cross-blob', 'SQLite 导入后 BLOB 正确');
  emit({ dir });
  await db.getDriver().close();
}

function runStage(name: string, env: Record<string, string>): Record<string, any> {
  const result = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url)], {
    env: { ...process.env, ...env, CROSS_STAGE: name },
    encoding: 'utf8',
    timeout: 180_000,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0) {
    console.error(output);
    throw new Error(`跨库测试阶段 ${name} 失败`);
  }
  const line = String(result.stdout || '')
    .split('\n')
    .reverse()
    .find((item) => item.startsWith('CROSS_RESULT '));
  if (!line) {
    console.error(output);
    throw new Error(`跨库测试阶段 ${name} 未返回结果`);
  }
  return JSON.parse(line.slice('CROSS_RESULT '.length));
}

async function main(): Promise<void> {
  if (stage === 'sqlite-export') return sqliteExport();
  if (stage === 'mysql-import') return mysqlImport();
  if (stage === 'sqlite-import') return sqliteImport();

  const host = process.env.DB_HOST || '';
  const name = process.env.DB_NAME || '';
  if (!host || !name) {
    const message = '未设置 DB_HOST / DB_NAME，跳过跨库备份自检';
    if (process.env.DNSMGR_REQUIRE_MYSQL === '1') {
      console.error('失败：' + message);
      process.exit(1);
    }
    console.log(message);
    return;
  }

  const sqliteDir = mkdtempSync(path.join(os.tmpdir(), 'dnsmgr-cross-sqlite-'));
  const mysqlDir = mkdtempSync(path.join(os.tmpdir(), 'dnsmgr-cross-mysql-'));
  const sqlite2Dir = mkdtempSync(path.join(os.tmpdir(), 'dnsmgr-cross-sqlite2-'));
  const prefix = 'cross_' + Math.random().toString(16).slice(2, 8) + '_';

  const sqliteArchive = runStage('sqlite-export', {
    CROSS_SQLITE_DIR: sqliteDir,
  });
  const mysqlArchive = runStage('mysql-import', {
    CROSS_MYSQL_DIR: mysqlDir,
    CROSS_PREFIX: prefix,
    CROSS_ARCHIVE: sqliteArchive.file,
    CROSS_KEY: sqliteArchive.key,
  });
  runStage('sqlite-import', {
    CROSS_SQLITE2_DIR: sqlite2Dir,
    CROSS_ARCHIVE: mysqlArchive.file,
    CROSS_KEY: mysqlArchive.key,
  });
  console.log('\n跨库备份自检全部通过（SQLite → MySQL → SQLite）');
}

await main();
