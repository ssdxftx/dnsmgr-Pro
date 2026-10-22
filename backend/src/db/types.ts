import type { DbConfig, DbType } from '../config-loader.js';

export interface ColumnInfo {
  Field: string;
  Type: string;
  Null: 'YES' | 'NO';
  Key: string;
  Default: any;
  Extra: string;
}

export interface WriteResult {
  insertId: number;
  affectedRows: number;
}

export interface LockOutcome<T> {
  locked: boolean;
  result?: T;
}

export type QueryFn = <R = any>(sql: string, params?: any[]) => Promise<R[]>;

export interface DbDriver {
  readonly type: DbType;
  readonly config: DbConfig;
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | undefined>;
  withTransaction<T>(fn: (q: QueryFn) => Promise<T>): Promise<T>;
  readSnapshot<T>(fn: (read: (sql: string, params?: any[]) => Promise<any[]>) => Promise<T>): Promise<T>;
  withLock<T>(name: string, fn: () => Promise<T>, waitSeconds?: number): Promise<LockOutcome<T>>;
  listColumns(tableName: string, q?: QueryFn): Promise<ColumnInfo[]>;
  tableExists(tableName: string): Promise<boolean>;
  columnExists(tableName: string, column: string): Promise<boolean>;
  indexExists(tableName: string, indexName: string): Promise<boolean>;
  uniqueIndexExists(tableName: string, column: string): Promise<boolean>;
  close(): Promise<void>;
  identity(): string;
}

/** 仅识别真正的生成列；MySQL 8 的 DEFAULT_GENERATED 表示默认值表达式，仍可写入。 */
export function isGeneratedColumn(extra: unknown): boolean {
  return /\b(?:VIRTUAL|STORED|PERSISTENT)\b/i.test(String(extra || ''));
}
