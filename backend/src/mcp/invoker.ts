import { createHash, randomUUID } from 'node:crypto';
import { scopeAllows } from '../lib/apiKeys.js';
import type { ActionDef, McpContext, RouteSpec, ToolArgs } from './types.js';
import { McpToolError } from './types.js';

const SCOPE_PATHS: Record<string, string> = {
  dns: '/api/domains',
  cert: '/api/cert',
  deploy: '/api/deploy',
  cloudflare: '/api/cloudflare',
  monitor: '/api/dmonitor',
  optimize: '/api/optimize',
  schedule: '/api/schedule',
  users: '/api/logs',
  general: '/api/dashboard',
  audit: '/api/audit',
};

const FORWARD_HEADERS = [
  'idempotency-key',
  'x-reauth-token',
  'x-confirm-password',
  'x-confirm-password-b64',
  'x-pfx-pass',
  'x-pfx-pass-b64',
];

function scopePath(module: string): string {
  return SCOPE_PATHS[module] || `/api/${module}`;
}

export function checkActionScope(ctx: McpContext, action: ActionDef): void {
  if (ctx.mode !== 'api_key' || !action.scope) return;
  if (!ctx.scopes.length) throw new McpToolError('API Key 未配置可用的权限范围');
  const method = action.scope.write ? 'POST' : 'GET';
  if (!scopeAllows(ctx.scopes, method, scopePath(action.scope.module))) {
    throw new McpToolError('API Key 缺少该操作所需的作用域');
  }
}

function buildUrl(spec: RouteSpec): string {
  if (!spec.query) return spec.path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(spec.query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.append(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `${spec.path}${spec.path.includes('?') ? '&' : '?'}${text}` : spec.path;
}

function baseHeaders(ctx: McpContext, spec: RouteSpec): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': String(ctx.req.headers?.['user-agent'] || 'dnsmgr-mcp').slice(0, 255),
  };
  const requestId = String(ctx.req.headers?.['x-request-id'] || '').trim();
  if (/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) headers['x-request-id'] = requestId;
  for (const key of FORWARD_HEADERS) {
    const value = ctx.req.headers?.[key];
    if (value === undefined || value === null) continue;
    if (key === 'idempotency-key') {
      const base = String(Array.isArray(value) ? value[0] : value).trim();
      if (base) {
        const suffix = createHash('sha256').update(`${spec.method}\n${spec.path}`).digest('hex').slice(0, 24);
        headers[key] = `mcp-${base.slice(0, 48)}-${suffix}`;
      }
      continue;
    }
    headers[key] = String(Array.isArray(value) ? value[0] : value);
  }
  if (ctx.mode === 'api_key' && ctx.apiKey) {
    headers['x-api-key'] = ctx.apiKey;
  } else {
    const jti = `mcp:${ctx.uid}:${randomUUID()}`;
    headers.authorization = `Bearer ${(ctx.app as any).jwt.sign({
      uid: ctx.uid,
      type: 'session',
      jti,
      token_version: Number(ctx.user?.token_version || 0),
    })}`;
    ctx.req.mcpInternalJti = jti;
  }
  if (spec.headers) Object.assign(headers, spec.headers);
  if (spec.body !== undefined) headers['content-type'] = 'application/json';
  return headers;
}

export async function callRoute(ctx: McpContext, spec: RouteSpec): Promise<any> {
  const method = spec.method;
  const url = buildUrl(spec);
  const payload = spec.body === undefined ? undefined : JSON.stringify(spec.body);
  const res = await ctx.app.inject({
    method,
    url,
    headers: baseHeaders(ctx, spec),
    payload,
    remoteAddress: ctx.ip || undefined,
  } as any);
  const text = res.body || '';
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  // requestId 是 Pro API 的追踪字段，上游 MCP 响应没有；MCP 自身审计已记录请求链路
  if (data && typeof data === 'object' && !Array.isArray(data)) delete data.requestId;
  if (res.statusCode >= 500) {
    console.error(`[mcp] 内部请求失败 ${method} ${url}: HTTP ${res.statusCode} ${text.slice(0, 300)}`);
    return { code: -1, msg: '执行出错，请稍后重试' };
  }
  if (data === null) {
    if (res.statusCode === 204 || res.statusCode === 202) return { code: 0 };
    return { code: -1, msg: res.statusCode >= 400 ? '请求失败' : '响应格式错误' };
  }
  return data;
}

export async function callRoutes(ctx: McpContext, specs: RouteSpec[]): Promise<any[]> {
  const out: any[] = [];
  for (const spec of specs) out.push(await callRoute(ctx, spec));
  return out;
}

export function resultPayload(data: any, forceError = false): any {
  const isError = forceError || (data && typeof data === 'object' && data.code !== undefined && Number(data.code) !== 0);
  const text = JSON.stringify(data === undefined ? {} : data, null, 2);
  const result: any = {
    content: [{ type: 'text', text: text === undefined ? '{}' : text }],
    structuredContent: data === undefined || data === null ? {} : data,
  };
  if (isError) result.isError = true;
  return result;
}
