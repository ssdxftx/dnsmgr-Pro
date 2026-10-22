import { loadDbConfig, type DbConfig } from './config-loader.js';
import type { DbDriver, QueryFn } from './db/types.js';
import { createMysqlDriver } from './db/mysql.js';

let currentPrefix = 'dnsmgr_';
let driver: DbDriver;

async function buildDriver(cfg: DbConfig): Promise<DbDriver> {
  if (cfg.db_type !== 'sqlite') return createMysqlDriver(cfg);
  try {
    // 动态加载，避免仅使用 MySQL 的部署在旧 Node 22 上因缺少 node:sqlite 而无法启动
    const { createSqliteDriver } = await import('./db/sqlite.js');
    return createSqliteDriver(cfg);
  } catch (e: any) {
    const msg = String(e?.message || e);
    throw new Error(msg.startsWith('SQLite') ? msg : `SQLite 驱动加载失败：${msg}（需要 Node.js 22.13+）`);
  }
}

// 启动时用当前配置初始化驱动
const initialConfig = loadDbConfig();
driver = await buildDriver(initialConfig);
currentPrefix = initialConfig.db_prefix || 'dnsmgr_';

export function table(name: string): string {
  return currentPrefix + name;
}

export function currentPrefixValue(): string {
  return currentPrefix;
}

export function getDbType(): 'mysql' | 'sqlite' {
  return driver.type;
}

export function getDriver(): DbDriver {
  return driver;
}

// 安装向导保存配置后调用，用新数据库参数重建驱动（无需重启进程）
export async function reinitPool(cfg: DbConfig): Promise<void> {
  const old = driver;
  const next = await buildDriver(cfg);
  currentPrefix = cfg.db_prefix || 'dnsmgr_';
  driver = next;
  if (old) await old.close();
}

export function getDbConfig(): DbConfig {
  return loadDbConfig();
}

export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return driver.query<T>(sql, params);
}

export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  return driver.queryOne<T>(sql, params);
}

// 事务执行：将「先删后插」等需要原子性的多步操作包在同一连接的事务里，
// 中途失败整体回滚，避免数据半更新（权限/域名/规则部分丢失）。
export async function withTransaction<T>(fn: (q: QueryFn) => Promise<T>): Promise<T> {
  return driver.withTransaction(fn);
}

export async function readSnapshot<T>(
  fn: (read: (sql: string, params?: any[]) => Promise<any[]>) => Promise<T>,
): Promise<T> {
  return driver.readSnapshot(fn);
}

export async function withDistributedLockResult<T>(
  name: string,
  fn: () => Promise<T>,
  waitSeconds = 0,
): Promise<{ locked: boolean; result?: T }> {
  return driver.withLock(name, fn, waitSeconds);
}

export async function listColumns(tableName: string, q?: QueryFn) {
  return driver.listColumns(tableName, q);
}

export async function tableExists(tableName: string): Promise<boolean> {
  return driver.tableExists(tableName);
}

export async function columnExists(tableName: string, column: string): Promise<boolean> {
  return driver.columnExists(tableName, column);
}

export async function indexExists(tableName: string, indexName: string): Promise<boolean> {
  return driver.indexExists(tableName, indexName);
}

export async function uniqueIndexExists(tableName: string, column: string): Promise<boolean> {
  return driver.uniqueIndexExists(tableName, column);
}
