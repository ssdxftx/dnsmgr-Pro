import { table, queryOne } from '../db.js';
import type { ToolArgs } from './types.js';
import { McpToolError, requireArgs } from './types.js';

export function accountNameFromConfig(args: ToolArgs): ToolArgs {
  if (!args.name && args.config) {
    let config = args.config;
    if (typeof config === 'string') {
      try {
        config = JSON.parse(config);
      } catch {
        config = null;
      }
    }
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      const first = Object.values(config)[0];
      if (typeof first === 'string' || typeof first === 'number') args.name = String(first);
    }
  }
  return args;
}

export async function prefill(
  tableName: string,
  args: ToolArgs,
  fields: string[],
  idKey = 'id',
): Promise<ToolArgs> {
  requireArgs(args, [idKey]);
  const row: any = await queryOne(`SELECT * FROM ${table(tableName)} WHERE id = ?`, [Number(args[idKey])]);
  if (!row) throw new McpToolError(`记录不存在（ID：${args[idKey]}）`);
  for (const field of fields) {
    if (args[field] !== undefined) continue;
    if (row[field] !== null && row[field] !== undefined) args[field] = row[field];
  }
  return args;
}

export function normalizeRecords(records: any): any[] {
  if (!Array.isArray(records) || !records.length) {
    throw new McpToolError('records 不能为空，请传入 record_query(action=list) 返回的记录对象数组');
  }
  const defaults: ToolArgs = {
    RecordId: '',
    Name: '',
    Type: '',
    Value: '',
    Line: '',
    TTL: 600,
    MX: 0,
    Weight: null,
    Remark: null,
  };
  return records.map((record) => {
    if (!record || typeof record !== 'object' || !record.RecordId) {
      throw new McpToolError('records 中的每条记录必须包含 RecordId');
    }
    return { ...defaults, ...record };
  });
}

export function pagingToPage(args: ToolArgs, defaultLimit = 20): { page: number; pagesize: number } {
  const pagesize = Math.max(1, Math.min(500, Math.floor(Number(args.limit ?? defaultLimit)) || defaultLimit));
  const offset = Math.max(0, Math.floor(Number(args.offset ?? 0)) || 0);
  return { page: Math.floor(offset / pagesize) + 1, pagesize };
}
