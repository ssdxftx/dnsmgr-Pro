import mysql from 'mysql2/promise';
import { loadDbConfig, type DbConfig } from './config-loader.js';

let currentPrefix = 'dnsmgr_';
let pool: mysql.Pool;

function buildPool(cfg: DbConfig): mysql.Pool {
  currentPrefix = cfg.db_prefix || 'dnsmgr_';
  const pool = mysql.createPool({
    host: cfg.db_host,
    port: Number(cfg.db_port || 3306),
    user: cfg.db_user,
    password: cfg.db_password,
    database: cfg.db_name,
    waitForConnections: true,
    connectionLimit: 10,
    maxIdle: 10,
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
  return pool;
}

// 启动时用当前配置初始化连接池
pool = buildPool(loadDbConfig());

export function table(name: string): string {
  return currentPrefix + name;
}

export function currentPrefixValue(): string {
  return currentPrefix;
}

// 安装向导保存配置后调用，用新数据库参数重建连接池（无需重启进程）
export function reinitPool(cfg: DbConfig): void {
  const old = pool;
  pool = buildPool(cfg);
  if (old) old.end().catch(() => undefined);
}

export function getDbConfig(): DbConfig {
  return loadDbConfig();
}

// 供分布式锁等需要独占连接的场景使用
export function getPool(): mysql.Pool {
  return pool;
}

export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  const rows = await query<T>(sql, params);
  return rows[0];
}

// 事务执行：将「先删后插」等需要原子性的多步操作包在同一连接的事务里，
// 中途失败整体回滚，避免数据半更新（权限/域名/规则部分丢失）。
export async function withTransaction<T>(
  fn: (q: <R = any>(sql: string, params?: any[]) => Promise<R[]>) => Promise<T>,
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const q = async <R = any>(sql: string, params: any[] = []): Promise<R[]> => {
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