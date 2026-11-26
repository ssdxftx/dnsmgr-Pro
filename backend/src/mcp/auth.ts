import { findUserById } from '../auth.js';
import { query, queryOne, table } from '../db.js';
import { hashApiKey, ipAllowed, parseScopes } from '../lib/apiKeys.js';
import type { McpContext } from './types.js';

export class McpAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpAuthError';
  }
}

function headerValue(value: any): string {
  if (Array.isArray(value)) return String(value[0] ?? '').trim();
  return String(value ?? '').trim();
}

function bearerToken(req: any): string {
  const auth = headerValue(req.headers?.authorization);
  if (!auth) return '';
  if (auth.slice(0, 7).toLowerCase() !== 'bearer ') return '';
  return auth.slice(7).trim();
}

async function apiKeyContext(req: any, apiKey: string, ip: string): Promise<McpContext> {
  if (!apiKey || apiKey.length > 256) throw new McpAuthError('API密钥错误');
  let keyRow: any = null;
  try {
    keyRow = await queryOne(
      `SELECT * FROM ${table('api_key')} WHERE key_hash = ? AND active = 1 AND revoked_at IS NULL LIMIT 1`,
      [hashApiKey(apiKey)],
    );
  } catch {
    keyRow = null;
  }
  if (!keyRow) throw new McpAuthError('API密钥错误或已停用');
  if (keyRow.expires_at !== null && keyRow.expires_at !== undefined && keyRow.expires_at !== '') {
    const exp = new Date(String(keyRow.expires_at).replace(' ', 'T')).getTime();
    if (!Number.isFinite(exp) || exp <= Date.now()) throw new McpAuthError('API密钥已过期');
  }
  let allowlist: string[] = [];
  try {
    const parsed = typeof keyRow.ip_allowlist === 'string' ? JSON.parse(keyRow.ip_allowlist) : keyRow.ip_allowlist;
    allowlist = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    throw new McpAuthError('API密钥的IP白名单配置无效');
  }
  if (!ipAllowed(ip, allowlist)) throw new McpAuthError('API密钥不允许从当前IP使用');
  const user: any = await findUserById(Number(keyRow.uid));
  if (!user || Number(user.status) === 0) throw new McpAuthError('API密钥错误或用户已停用');
  const id = Number(keyRow.id || 0);
  query(
    `UPDATE ${table('api_key')} SET last_used_at = NOW(), last_used_ip = ? WHERE id = ?`,
    [ip.slice(0, 64), id],
  ).catch(() => undefined);
  return {
    app: req.server,
    req,
    user,
    uid: Number(user.id),
    level: Number(user.level || 0),
    mode: 'api_key',
    scopes: parseScopes(keyRow.scopes),
    apiKey,
    apiKeyId: id,
    apiKeyName: String(keyRow.name || ''),
    ip,
    jsonrpcId: null,
    requestHeaders: req.headers || {},
  };
}

export async function authenticateMcp(req: any): Promise<McpContext> {
  const ip = String(req.ip || '');
  const xApiKey = headerValue(req.headers?.['x-api-key']);
  if (xApiKey) return apiKeyContext(req, xApiKey, ip);
  const token = bearerToken(req);
  if (!token) {
    throw new McpAuthError('缺少认证信息，请使用 X-API-Key');
  }
  // 旧版明文 user.apikey 不受作用域、有效期和 IP 白名单约束；常规 API 已停用该凭据，
  // MCP 也不再把 <uid>:<apikey> 解释为认证信息，避免绕过 X-API-Key 的全部限制。
  if (/^\d+:/.test(token)) {
    throw new McpAuthError('旧版 uid:apikey 认证已停用，请使用 X-API-Key');
  }
  return apiKeyContext(req, token, ip);
}
