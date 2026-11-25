import type { FastifyInstance } from 'fastify';

export type ToolArgs = Record<string, any>;

export interface JsonSchema {
  type?: string;
  description?: string;
  enum?: any[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  [key: string]: any;
}

export interface RouteSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, any>;
  body?: any;
  headers?: Record<string, string>;
}

export interface McpContext {
  app: FastifyInstance;
  req: any;
  user: any;
  uid: number;
  level: number;
  mode: 'api_key' | 'legacy';
  scopes: string[];
  apiKey?: string;
  apiKeyId: number;
  apiKeyName: string;
  ip: string;
  jsonrpcId: string | number | null;
  requestHeaders: Record<string, any>;
}

export interface ActionDef {
  desc: string;
  level?: number;
  defaults?: ToolArgs;
  before?: (args: ToolArgs, ctx: McpContext) => ToolArgs | Promise<ToolArgs>;
  request?: (args: ToolArgs, ctx: McpContext) => RouteSpec | RouteSpec[] | Promise<RouteSpec | RouteSpec[]>;
  handler?: (args: ToolArgs, ctx: McpContext) => Promise<any> | any;
  after?: (data: any, args: ToolArgs, ctx: McpContext) => any;
  scope?: { module: string; write?: boolean; path?: string };
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  readOnly?: boolean;
  destructive?: boolean;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  actions: Record<string, ActionDef>;
}

export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpToolError';
  }
}

export function str(description: string, values: string[] = []): JsonSchema {
  const p: JsonSchema = { type: 'string', description };
  if (values.length) p.enum = values;
  return p;
}

export function int(description: string): JsonSchema {
  return { type: 'integer', description };
}

export function bool(description: string): JsonSchema {
  return { type: 'boolean', description };
}

export function obj(description: string): JsonSchema {
  return { type: 'object', description };
}

export function arr(description: string, items: JsonSchema = { type: 'string' }): JsonSchema {
  return { type: 'array', items, description };
}

export function ids(description = 'ID列表'): JsonSchema {
  return arr(description, { type: 'integer' });
}

export function paging(): Record<string, JsonSchema> {
  return {
    offset: int('分页偏移量，默认0'),
    limit: int('每页数量，默认20'),
    sortName: str('排序字段'),
    sortOrder: str('排序方向', ['asc', 'desc']),
  };
}

export function pagingDefaults(): ToolArgs {
  return { offset: 0, limit: 20 };
}

export function requireArgs(args: ToolArgs, keys: string[]): void {
  for (const key of keys) {
    const value = args[key];
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
      throw new McpToolError(`缺少必填参数：${key}`);
    }
  }
}

export function pick(args: ToolArgs, keys: string[]): ToolArgs {
  const out: ToolArgs = {};
  for (const key of keys) {
    if (args[key] !== undefined) out[key] = args[key];
  }
  return out;
}

export function boolValue(value: any): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function listResponse(body: any): any {
  if (!body || typeof body !== 'object') return body;
  const data = body.data;
  if (Array.isArray(data)) {
    const out: any = { ...body, total: body.total ?? data.length, rows: data };
    delete out.data;
    return out;
  }
  if (data && typeof data === 'object' && Array.isArray(data.list)) {
    const out: any = { ...body, total: body.total ?? data.total ?? data.list.length, rows: data.list };
    if (data.stats !== undefined) out.stats = data.stats;
    delete out.data;
    return out;
  }
  if (Array.isArray(body.rows)) {
    return { ...body, total: body.total ?? body.rows.length };
  }
  return body;
}
