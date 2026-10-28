import mysql from 'mysql2/promise';
import type { DbConfig } from '../config-loader.js';
import type { ColumnInfo, DbDriver, LockOutcome, QueryFn } from './types.js';

export function createMysqlDriver(cfg: DbConfig): DbDriver {
  const pool = mysql.createPool({
    host: cfg.db_host,
    port: Number(cfg.db_port || 3306),
    user: cfg.db_user,
    password: cfg.db_password,
    database: cfg.db_name,
    waitForConnections: true,
    // 批量解析记录操作按并发 8 打云端，同时还有多个并发请求读库，10 条连接易被打满；
    // 适当放大到 20，兼顾并发与数据库压力
    connectionLimit: 20,
    maxIdle: 20,
    idleTimeout: 60000,
    // DB 不可达时快速失败，避免请求长时间挂起
    connectTimeout: 10000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    charset: 'utf8mb4',
    dateStrings: true,
  });
  // GROUP_CONCAT 默认上限 1024 字节，站点聚合（域名列表）会被截断；每条新连接统一放大
  pool.on('connection', (conn: any) => {
    conn.query('SET SESSION group_concat_max_len = 1048576');
  });

  async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const [rows] = await pool.query(sql, params);
    return rows as T[];
  }

  async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    const rows = await query<T>(sql, params);
    return Array.isArray(rows) ? (rows[0] as T | undefined) : undefined;
  }

  async function withTransaction<T>(fn: (q: QueryFn) => Promise<T>): Promise<T> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const q: QueryFn = async <R = any>(sql: string, params: any[] = []): Promise<R[]> => {
        const [rows] = await conn.query(sql, params);
        return rows as R[];
      };
      const result = await fn(q);
      await conn.commit();
      return result;
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
  }

  async function readSnapshot<T>(
    fn: (read: (sql: string, params?: any[]) => Promise<any[]>) => Promise<T>,
  ): Promise<T> {
    const conn = await pool.getConnection();
    // 记录并恢复会话隔离级别：连接会被放回池中复用，若不还原会把 REPEATABLE READ
    // 带到后续事务，改变服务器默认隔离语义并引入长快照读与锁等待。
    let prevIsolation = '';
    try {
      const [rows] = await conn.query('SELECT @@session.transaction_isolation AS iso');
      prevIsolation = String((rows as any[])[0]?.iso || '');
    } catch {
      // 旧版本 MySQL 无该变量，退化为固定还原
    }
    try {
      await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
      const read = async (sql: string, params: any[] = []) => {
        const [rows] = await conn.query(sql, params);
        return rows as any[];
      };
      const out = await fn(read);
      await conn.query('COMMIT');
      return out;
    } catch (e) {
      await conn.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      const restore = /SERIALIZABLE|READ COMMITTED|READ UNCOMMITTED/i.test(prevIsolation)
        ? prevIsolation.toUpperCase()
        : 'READ COMMITTED';
      await conn.query(`SET SESSION TRANSACTION ISOLATION LEVEL ${restore}`).catch(() => undefined);
      conn.release();
    }
  }

  async function withLock<T>(
    name: string,
    fn: () => Promise<T>,
    waitSeconds = 0,
  ): Promise<LockOutcome<T>> {
    let conn: mysql.PoolConnection;
    try {
      conn = await pool.getConnection();
    } catch {
      return { locked: false };
    }
    try {
      const [rows] = await conn.query('SELECT GET_LOCK(?, ?) AS ok', [name, waitSeconds]);
      const ok = Array.isArray(rows) && Number((rows[0] as any)?.ok) === 1;
      if (!ok) return { locked: false };
      try {
        return { locked: true, result: await fn() };
      } finally {
        await conn.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => undefined);
      }
    } finally {
      conn.release();
    }
  }

  async function listColumns(tableName: string, q: QueryFn = query): Promise<ColumnInfo[]> {
    return (await q<ColumnInfo>(`SHOW COLUMNS FROM ${tableName}`)) as any;
  }

  async function tableExists(tableName: string): Promise<boolean> {
    const rows = await query<any>('SHOW TABLES LIKE ?', [tableName]);
    return rows.length > 0;
  }

  async function columnExists(tableName: string, column: string): Promise<boolean> {
    const rows = await query<any>(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
      [tableName, column],
    );
    return rows.length > 0;
  }

  async function indexExists(tableName: string, indexName: string): Promise<boolean> {
    const rows = await query<any>(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
      [tableName, indexName],
    );
    return rows.length > 0;
  }

  async function uniqueIndexExists(tableName: string, column: string): Promise<boolean> {
    const rows = await query<any>(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND NON_UNIQUE = 0 LIMIT 1`,
      [tableName, column],
    );
    return rows.length > 0;
  }

  return {
    type: 'mysql',
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
      await pool.end().catch(() => undefined);
    },
    identity() {
      return String(cfg.db_name || '');
    },
  };
}
