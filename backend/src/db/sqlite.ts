import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { resolveSqliteFile, type DbConfig } from '../config-loader.js';
import { detectDataPersistence } from '../lib/persistence.js';
import type { ColumnInfo, DbDriver, LockOutcome, QueryFn, WriteResult } from './types.js';
import { expandParams, translateSql } from './sqlite-dialect.js';

const READ_RE = /^\s*(SELECT|WITH|PRAGMA|EXPLAIN)\b/i;
const DDL_RE = /^\s*(CREATE|ALTER|DROP|VACUUM|REINDEX|ANALYZE)\b/i;

/**
 * node:sqlite 的原始错误 code 是 ERR_SQLITE_ERROR，业务层普遍按 MySQL 的
 * ER_DUP_ENTRY 判断唯一键冲突，导致 SQLite 部署下注册/建号/导入直接 500。
 * 这里把常见约束错误映射成 MySQL 兼容错误码，调用方无需感知数据库类型。
 */
function normalizeSqliteError(e: any): any {
  const msg = String(e?.message || e || '');
  if (/UNIQUE constraint failed|PRIMARY KEY must be unique/i.test(msg)) {
    const err: any = new Error(msg);
    err.code = 'ER_DUP_ENTRY';
    err.errno = 1062;
    err.cause = e;
    return err;
  }
  if (/FOREIGN KEY constraint failed/i.test(msg)) {
    const err: any = new Error(msg);
    err.code = 'ER_NO_REFERENCED_ROW_2';
    err.errno = 1452;
    err.cause = e;
    return err;
  }
  return e;
}

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(async () => {
      try {
        return await fn();
      } finally {
        release();
      }
    });
  }
}

function quoteIdent(value: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error('非法的 SQLite 标识符');
  return `\`${value}\``;
}

function normalizeRow(row: any): any {
  if (!row || typeof row !== 'object') return row;
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof Uint8Array && !Buffer.isBuffer(value) ? Buffer.from(value) : value;
  }
  return out;
}

function openDatabase(file: string, readOnly = false): DatabaseSync {
  const db = new DatabaseSync(file, { readOnly });
  db.exec('PRAGMA busy_timeout = 5000');
  if (!readOnly) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA foreign_keys = ON');
  }
  return db;
}

interface SqliteLock {
  count: number;
  token: string;
}

// 同一进程内 reinitPool 会短暂同时持有新旧驱动；按文件引用计数，最后一个驱动关闭时才释放锁。
const sqliteLocks = new Map<string, SqliteLock>();

function lockPathFor(file: string): string {
  return file + '.lock';
}

function readLockFile(lockPath: string): any {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

function removeLockFile(lockPath: string, token?: string): void {
  if (token) {
    const info = readLockFile(lockPath);
    if (!info || info.token !== token) return;
  }
  try {
    fs.rmSync(lockPath, { force: true });
  } catch {
    // 忽略：锁文件可能已被其他进程清理
  }
}

function acquireSqliteLock(file: string): string {
  const lockPath = lockPathFor(file);
  const held = sqliteLocks.get(lockPath);
  if (held) {
    held.count++;
    return held.token;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const token = randomBytes(12).toString('hex');
    try {
      fs.writeFileSync(
        lockPath,
        JSON.stringify({
          pid: process.pid,
          host: os.hostname(),
          started: new Date().toISOString(),
          token,
        }),
        { flag: 'wx', mode: 0o600 },
      );
      sqliteLocks.set(lockPath, { count: 1, token });
      return token;
    } catch (e: any) {
      if (e?.code !== 'EEXIST') {
        throw new Error(`SQLite 锁文件创建失败：${lockPath}（${e?.message || String(e)}）`);
      }

      const info = readLockFile(lockPath);
      if (!info) {
        throw new Error(
          `SQLite 锁文件损坏：${lockPath}。请确认没有其他实例运行后删除该文件再启动`,
        );
      }

      const pid = Number(info.pid || 0);
      const sameHost = String(info.host || '') === os.hostname();
      let alive = false;
      if (sameHost && pid > 0 && pid !== process.pid) {
        try {
          process.kill(pid, 0);
          alive = true;
        } catch (err: any) {
          // EPERM 表示进程存在但当前用户无权发送信号，仍按占用处理
          alive = err?.code === 'EPERM';
        }
      } else if (sameHost && pid === process.pid) {
        // 同一 PID 的锁可能来自重启前的进程；锁文件早于本进程启动才算遗留锁。
        // 同主机其他容器使用相同 hostname 与 PID 时，新锁文件会晚于本进程启动，按占用处理。
        try {
          const lockMtime = fs.statSync(lockPath).mtimeMs;
          const processStartedAt = Date.now() - process.uptime() * 1000;
          alive = lockMtime >= processStartedAt - 1000;
        } catch {
          alive = true;
        }
      }

      if (!sameHost) {
        throw new Error(
          `SQLite 数据库已被其他实例占用（pid ${pid || '?'}，host ${info.host || '?'}，锁文件 ${lockPath}）。` +
            'SQLite 仅支持单实例；如确认没有其他实例运行，请删除该锁文件后重试',
        );
      }
      if (alive) {
        throw new Error(
          `SQLite 数据库已被进程 ${pid} 占用（锁文件 ${lockPath}）。` +
            'SQLite 仅支持单实例；如确认没有其他实例运行，请删除该锁文件后重试',
        );
      }

      // 同主机且进程已退出（或 pid 属于当前进程的遗留锁）：清理后重试
      removeLockFile(lockPath);
    }
  }

  throw new Error(`SQLite 数据库锁获取失败：${lockPath}`);
}

function releaseSqliteLock(file: string, token: string): void {
  const lockPath = lockPathFor(file);
  const held = sqliteLocks.get(lockPath);
  if (!held || held.token !== token) return;
  held.count--;
  if (held.count > 0) return;
  sqliteLocks.delete(lockPath);
  removeLockFile(lockPath, token);
}

// process.exit / SIGTERM 走不到驱动 close 时，同步清理本进程持有的锁，避免下次启动被遗留锁阻塞。
process.once('exit', () => {
  for (const [lockPath, held] of sqliteLocks) removeLockFile(lockPath, held.token);
  sqliteLocks.clear();
});

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

function runStatement(db: DatabaseSync, sql: string, params: any[] = []): any {
  const expanded = expandParams(sql, params);
  const translated = translateSql(expanded.sql);

  try {
    if (DDL_RE.test(translated)) {
      db.exec(translated);
      return { insertId: 0, affectedRows: 0 } satisfies WriteResult;
    }

    const statement = db.prepare(translated);
    if (READ_RE.test(translated)) {
      return statement.all(...expanded.params).map(normalizeRow);
    }
    const result = statement.run(...expanded.params);
    return {
      insertId: Number(result.lastInsertRowid || 0),
      affectedRows: Number(result.changes || 0),
    } satisfies WriteResult;
  } catch (e: any) {
    throw normalizeSqliteError(e);
  }
}

export function createSqliteDriver(cfg: DbConfig): DbDriver {
  const file = resolveSqliteFile(cfg);
  // 按数据文件所在目录检测，避免 DB_FILE 指向数据目录之外的网络文件系统时漏判
  const persistence = detectDataPersistence(file === ':memory:' ? undefined : path.dirname(file));
  if (persistence.network) {
    throw new Error(`SQLite 不支持 ${persistence.fstype} 网络文件系统，请改用 MySQL 或本地持久化卷`);
  }
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  if (file !== ':memory:' && !persistence.persistent) {
    console.warn(
      `[dnsmgr-backend] SQLite 数据目录未检测为持久化（${persistence.reason}），容器重建后数据可能丢失`,
    );
  }

  const lockToken = file === ':memory:' ? '' : acquireSqliteLock(file);
  let db: DatabaseSync;
  try {
    db = openDatabase(file);
  } catch (e) {
    if (lockToken) releaseSqliteLock(file, lockToken);
    throw e;
  }
  chmodSqliteFiles(file);

  const txStore = new AsyncLocalStorage<DatabaseSync>();
  const locks = new Set<string>();
  // SQLite 只有一个写者：写入串行化，避免并发写触发 SQLITE_BUSY 阻塞事件循环
  const writeMutex = new AsyncMutex();

  async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const tx = txStore.getStore();
    if (tx) return runStatement(tx, sql, params) as T[];
    const expanded = expandParams(sql, params);
    if (READ_RE.test(translateSql(expanded.sql))) {
      return runStatement(db, sql, params) as T[];
    }
    return writeMutex.run(() => runStatement(db, sql, params)) as Promise<T[]>;
  }

  async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    const rows = await query<T>(sql, params);
    return Array.isArray(rows) ? (rows[0] as T | undefined) : undefined;
  }

  async function withTransaction<T>(fn: (q: QueryFn) => Promise<T>): Promise<T> {
    return writeMutex.run(async () => {
      const tx = openDatabase(file);
      try {
        tx.exec('BEGIN IMMEDIATE');
        const q: QueryFn = async <R = any>(sql: string, params: any[] = []): Promise<R[]> => {
          return runStatement(tx, sql, params) as R[];
        };
        const result = await txStore.run(tx, () => fn(q));
        tx.exec('COMMIT');
        return result;
      } catch (e) {
        try {
          tx.exec('ROLLBACK');
        } catch {
          // 忽略回滚失败
        }
        throw e;
      } finally {
        tx.close();
      }
    });
  }

  async function readSnapshot<T>(
    fn: (read: (sql: string, params?: any[]) => Promise<any[]>) => Promise<T>,
  ): Promise<T> {
    const snapshot = openDatabase(file, true);
    try {
      snapshot.exec('BEGIN');
      const read = async (sql: string, params: any[] = []) => runStatement(snapshot, sql, params) as any[];
      const out = await fn(read);
      snapshot.exec('COMMIT');
      return out;
    } catch (e) {
      try {
        snapshot.exec('ROLLBACK');
      } catch {
        // 忽略回滚失败
      }
      throw e;
    } finally {
      snapshot.close();
    }
  }

  async function withLock<T>(
    name: string,
    fn: () => Promise<T>,
    waitSeconds = 0,
  ): Promise<LockOutcome<T>> {
    const deadline = Date.now() + Math.max(0, waitSeconds) * 1000;
    while (locks.has(name)) {
      if (Date.now() >= deadline) return { locked: false };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    locks.add(name);
    try {
      return { locked: true, result: await fn() };
    } finally {
      locks.delete(name);
    }
  }

  async function listColumns(tableName: string, q: QueryFn = query): Promise<ColumnInfo[]> {
    const rows = await q<any>(`PRAGMA table_info(${quoteIdent(tableName)})`);
    return rows.map((row: any) => ({
      Field: String(row.name),
      Type: String(row.type || ''),
      Null: Number(row.notnull) ? 'NO' : 'YES',
      Key: Number(row.pk) ? 'PRI' : '',
      Default: row.dflt_value,
      Extra: '',
    }));
  }

  async function tableExists(tableName: string): Promise<boolean> {
    const rows = await query<any>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
      [tableName],
    );
    return rows.length > 0;
  }

  async function columnExists(tableName: string, column: string): Promise<boolean> {
    // table_info 不返回生成列，使用 table_xinfo 才能识别 cdn_domain_id 这类 VIRTUAL 列
    const rows = await query<any>(`PRAGMA table_xinfo(${quoteIdent(tableName)})`);
    return rows.some((row: any) => String(row.name) === column);
  }

  async function indexExists(tableName: string, indexName: string): Promise<boolean> {
    const rows = await query<any>(`PRAGMA index_list(${quoteIdent(tableName)})`);
    return rows.some((row: any) => String(row.name) === indexName);
  }

  async function uniqueIndexExists(tableName: string, column: string): Promise<boolean> {
    const indexes = await query<any>(`PRAGMA index_list(${quoteIdent(tableName)})`);
    for (const index of indexes) {
      if (!Number(index.unique)) continue;
      const cols = await query<any>(`PRAGMA index_info(${quoteIdent(String(index.name))})`);
      if (cols.some((row: any) => String(row.name) === column)) return true;
    }
    return false;
  }

  let closed = false;
  return {
    type: 'sqlite',
    config: cfg,
    query,
    queryOne,
    withTransaction,
    readSnapshot,
    withLock,
    listColumns,
    tableExists,
    columnExists,
    indexExists,
    uniqueIndexExists,
    async close() {
      if (closed) return;
      closed = true;
      try {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch {
        // 忽略检查点失败
      }
      try {
        db.close();
      } finally {
        chmodSqliteFiles(file);
        if (lockToken) releaseSqliteLock(file, lockToken);
      }
    },
    identity() {
      return 'sqlite:' + file;
    },
  };
}
