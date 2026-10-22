import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import {
  saveDbConfig,
  hasDbConfigFile,
  hasEnvDbConfig,
  isSqliteFileInsideDataDir,
  resolveSqliteFile,
  dbIdentity,
  type DbConfig,
} from './config-loader.js';
import { reinitPool, table, queryOne } from './db.js';
import { translateSchema } from './db/sqlite-dialect.js';
import { detectDataPersistence } from './lib/persistence.js';

const SCHEMA_SQL = fs.readFileSync(fileURLToPath(new URL('./sql/schema-init.sql', import.meta.url)), 'utf8');

// 数据库表前缀会拼入 SQL 标识符，必须严格白名单校验，避免安装期注入
const PREFIX_RE = /^[A-Za-z0-9_]+$/;
function validatePrefix(prefix: string): string {
  return PREFIX_RE.test(prefix) ? '' : '数据库表前缀仅支持字母、数字和下划线';
}

function isMissingTableError(e: any): boolean {
  const code = String(e?.code || '');
  const message = String(e?.message || '');
  return code === 'ER_NO_SUCH_TABLE' || /no such table/i.test(message);
}

function friendlyDbError(e: any): string {
  const code = e?.code || '';
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') return '连接数据库失败：数据库地址或端口填写错误';
  if (code === 'ER_ACCESS_DENIED_ERROR' || code === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR') return '连接数据库失败：数据库用户名或密码错误';
  if (code === 'ER_BAD_DB_ERROR') return '连接数据库失败：数据库名不存在';
  if (code === 'ER_DBACCESS_DENIED_ERROR') return '连接数据库失败：该用户无权限访问此数据库';
  if (String(code).startsWith('SQLITE_')) return 'SQLite 数据库操作失败：' + (e?.message || String(e));
  return '连接数据库失败：' + (e?.message || String(e));
}

export interface ConnTestResult {
  ok: boolean;
  initialized: boolean;
  message: string;
}

async function createConnection(cfg: DbConfig): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: cfg.db_host,
    port: Number(cfg.db_port || 3306),
    user: cfg.db_user,
    password: cfg.db_password,
    database: cfg.db_name,
    connectTimeout: 8000,
    charset: 'utf8mb4',
  });
}

function chmodSqliteFiles(file: string): void {
  if (file === ':memory:') return;
  for (const target of [file, file + '-wal', file + '-shm']) {
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      // 忽略：文件不存在或文件系统不支持 chmod
    }
  }
}

function validateSqliteTarget(cfg: DbConfig): string {
  const file = resolveSqliteFile(cfg);
  const persistence = detectDataPersistence(path.dirname(file));
  if (persistence.network) return persistence.reason || 'SQLite 不支持网络文件系统';
  if (!persistence.persistent) return persistence.reason || '未检测到持久化目录，不能使用 SQLite';
  if (!isSqliteFileInsideDataDir(cfg)) return 'SQLite 数据文件必须位于持久化数据目录内';
  return '';
}

async function sqliteInitialized(file: string, prefix: string): Promise<boolean> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
      .get(prefix + 'config');
    return !!row;
  } finally {
    db.close();
  }
}

// 测试数据库连接，并判断是否已初始化（config 表已存在即视为已安装/已绑定现有库）
export async function testConnection(cfg: DbConfig): Promise<ConnTestResult> {
  const prefix = cfg.db_prefix || 'dnsmgr_';
  const prefixErr = validatePrefix(prefix);
  if (prefixErr) return { ok: false, initialized: false, message: prefixErr };

  if (cfg.db_type === 'sqlite') {
    const targetErr = validateSqliteTarget(cfg);
    if (targetErr) return { ok: false, initialized: false, message: targetErr };
    const file = resolveSqliteFile(cfg);
    try {
      if (!fs.existsSync(file)) return { ok: true, initialized: false, message: '' };
      return { ok: true, initialized: await sqliteInitialized(file, prefix), message: '' };
    } catch (e) {
      return { ok: false, initialized: false, message: friendlyDbError(e) };
    }
  }

  let conn: mysql.Connection;
  try {
    conn = await createConnection(cfg);
  } catch (e) {
    return { ok: false, initialized: false, message: friendlyDbError(e) };
  }
  try {
    const [rows] = await conn.query('SHOW TABLES LIKE ?', [prefix + 'config']);
    return { ok: true, initialized: (rows as any[]).length > 0, message: '' };
  } catch (e) {
    return { ok: false, initialized: false, message: friendlyDbError(e) };
  } finally {
    await conn.end().catch(() => undefined);
  }
}

export interface InstallResult {
  ok: boolean;
  bound: boolean;
  message: string;
  /** 安装后一次性导入令牌（10 分钟内有效，绑定数据库标识） */
  installToken?: string;
}

// 安装后导入备份的一次性令牌：内存保存，绑定数据库标识，用完即删
const installTokens = new Map<string, { identity: string; exp: number }>();

function issueInstallToken(identity: string): string {
  const token = randomBytes(24).toString('hex');
  installTokens.set(token, { identity, exp: Date.now() + 10 * 60_000 });
  return token;
}

export function consumeInstallToken(token: string, identity: string): boolean {
  const hit = installTokens.get(String(token || ''));
  if (!hit) return false;
  installTokens.delete(token);
  if (hit.exp <= Date.now() || hit.identity !== identity) return false;
  return true;
}

async function sqliteInstall(cfg: DbConfig, prefix: string, existed: boolean, adminUsername: string, adminPassword: string): Promise<void> {
  const { DatabaseSync } = await import('node:sqlite');
  const file = resolveSqliteFile(cfg);
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA foreign_keys = ON');

    // 建表与初始数据放在同一事务内：中途失败整体回滚，避免留下「有 config 表但无管理员」的半成品库
    db.exec('BEGIN IMMEDIATE');
    try {
      const schema = SCHEMA_SQL.replace(/dnsmgr_/g, prefix);
      db.exec(translateSchema(schema));

      if (!existed) {
        const initConfigs: Array<[string, string]> = [
          ['version', '1.0.0'],
          ['notice_mail', '0'],
          ['notice_wxtpl', '0'],
          ['mail_smtp', 'smtp.qq.com'],
          ['mail_port', '465'],
        ];
        const insertConfig = db.prepare(`INSERT INTO \`${prefix}config\` (\`key\`, value) VALUES (?, ?)`);
        for (const [key, value] of initConfigs) insertConfig.run(key, value);
        insertConfig.run('sys_key', randomBytes(24).toString('hex'));

        const hash = bcrypt.hashSync(adminPassword, 10);
        db.prepare(
          `INSERT INTO \`${prefix}user\` (id, username, password, is_api, apikey, level, regtime, lasttime, status, is_super)
           VALUES (1000, ?, ?, 0, '', 2, datetime('now','localtime'), datetime('now','localtime'), 1, 1)`,
        ).run(adminUsername, hash);
      } else {
        const row = db
          .prepare(`SELECT \`key\` FROM \`${prefix}config\` WHERE \`key\` = 'sys_key' LIMIT 1`)
          .get();
        if (!row) {
          db.prepare(`INSERT INTO \`${prefix}config\` (\`key\`, value) VALUES (?, ?)`).run(
            'sys_key',
            randomBytes(24).toString('hex'),
          );
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // 忽略回滚失败
      }
      throw e;
    }
  } finally {
    db.close();
    chmodSqliteFiles(file);
  }
}

async function mysqlInstall(cfg: DbConfig, prefix: string, existed: boolean, adminUsername: string, adminPassword: string): Promise<void> {
  let conn: mysql.Connection;
  try {
    conn = await createConnection(cfg);
  } catch (e) {
    throw new Error(friendlyDbError(e));
  }
  try {
    // 建表（IF NOT EXISTS：空库创建，现库跳过，均不删除已有数据）
    const statements = SCHEMA_SQL.split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await conn.query(stmt.replace(/dnsmgr_/g, prefix));
    }

    if (!existed) {
      // 全新安装：写入初始配置 + sys_key + 管理员
      const initConfigs: Array<[string, string]> = [
        ['version', '1.0.0'],
        ['notice_mail', '0'],
        ['notice_wxtpl', '0'],
        ['mail_smtp', 'smtp.qq.com'],
        ['mail_port', '465'],
      ];
      for (const [k, v] of initConfigs) {
        await conn.query(`INSERT INTO \`${prefix}config\` (\`key\`, value) VALUES (?, ?)`, [k, v]);
      }
      await conn.query(`INSERT INTO \`${prefix}config\` (\`key\`, value) VALUES (?, ?)`, ['sys_key', randomBytes(24).toString('hex')]);

      const hash = await bcrypt.hash(adminPassword, 10);
      await conn.query(
        `INSERT INTO \`${prefix}user\` (username, password, is_api, apikey, level, regtime, lasttime, status, is_super) VALUES (?, ?, 0, '', 2, NOW(), NOW(), 1, 1)`,
        [adminUsername, hash],
      );
    } else {
      // 绑定现有库（彩虹 DNS 数据）：仅补齐 sys_key，不新增管理员、不覆盖数据
      const [rows] = await conn.query(`SELECT \`key\` FROM \`${prefix}config\` WHERE \`key\` = 'sys_key'`, []);
      if ((rows as any[]).length === 0) {
        await conn.query(`INSERT INTO \`${prefix}config\` (\`key\`, value) VALUES (?, ?)`, ['sys_key', randomBytes(24).toString('hex')]);
      }
    }
  } finally {
    await conn.end().catch(() => undefined);
  }
}

// 执行安装：全新空库则建表+初始数据+创建管理员；检测到已有表（彩虹 DNS 现库）则直接绑定、补齐 sys_key，不破坏现有数据。
export async function performInstall(cfg: DbConfig, adminUsername: string, adminPassword: string): Promise<InstallResult> {
  const prefix = cfg.db_prefix || 'dnsmgr_';
  const prefixErr = validatePrefix(prefix);
  if (prefixErr) return { ok: false, bound: false, message: prefixErr };
  if (cfg.db_type === 'sqlite') {
    const targetErr = validateSqliteTarget(cfg);
    if (targetErr) return { ok: false, bound: false, message: targetErr };
  }

  const test = await testConnection(cfg);
  if (!test.ok) return { ok: false, bound: false, message: test.message };

  const existed = test.initialized;
  if (!existed && (!adminUsername || !adminPassword)) {
    return { ok: false, bound: false, message: '全新安装需要设置管理员账号和密码' };
  }
  if (!existed && adminPassword.length < 8) {
    return { ok: false, bound: false, message: '管理员密码长度至少为 8 位' };
  }

  try {
    if (cfg.db_type === 'sqlite') {
      await sqliteInstall(cfg, prefix, existed, adminUsername, adminPassword);
    } else {
      await mysqlInstall(cfg, prefix, existed, adminUsername, adminPassword);
    }
  } catch (e: any) {
    return { ok: false, bound: false, message: '初始化失败：' + (e?.message || String(e)) };
  }

  try {
    saveDbConfig(cfg);
    await reinitPool(cfg);
  } catch (e: any) {
    return { ok: false, bound: existed, message: '保存数据库配置失败：' + (e?.message || String(e)) };
  }
  markInstalled();
  // 补齐 TS 版新增字段与表（email、注册验证码/注册码），幂等
  try {
    const { migrate } = await import('./migrate.js');
    await migrate();
  } catch {
    // 忽略：迁移会在下次启动时再次尝试
  }
  return {
    ok: true,
    bound: existed,
    message: existed ? '已绑定现有数据库，可直接用原管理员账号登录' : '安装完成',
    installToken: issueInstallToken(dbIdentity(cfg)),
  };
}

let installedFlag: boolean | null = null;
let installInProgress = false;

export function markInstalled(): void {
  installedFlag = true;
}

// 安装互斥：避免并发安装请求在标记完成前重复初始化
export function beginInstall(): boolean {
  if (installInProgress) return false;
  installInProgress = true;
  return true;
}

export function endInstall(): void {
  installInProgress = false;
}

// 安装状态探测：区分「确认已安装 / 确认未安装 / 无法确认（数据库异常）」。
// 只有确认未安装时才允许走安装接口；数据库不可用时 fail-closed，避免瞬时故障把安装接口错误开放。
export type InstallState = 'installed' | 'not_installed' | 'unknown';

export async function getInstallState(): Promise<InstallState> {
  if (installedFlag === true) return 'installed';
  try {
    const one = await queryOne(`SELECT 1 FROM ${table('config')} LIMIT 1`);
    if (one) {
      installedFlag = true;
      return 'installed';
    }
    return 'not_installed';
  } catch (e: any) {
    // 配置文件存在：说明本实例已配置过，连接失败或表缺失属「无法确认」，不能开放安装入口。
    if (hasDbConfigFile()) return 'unknown';
    // 环境变量指向的空库（config 表尚未创建）仍属首次安装；SQLite 首次启动就是这种状态。
    if (isMissingTableError(e)) return 'not_installed';
    // 其余环境变量配置（如连接失败）fail-closed，避免瞬时故障把安装接口错误开放。
    return hasEnvDbConfig() ? 'unknown' : 'not_installed';
  }
}

// 兼容旧调用：仅在确认已安装时返回 true
export async function isInstalled(): Promise<boolean> {
  return (await getInstallState()) === 'installed';
}
