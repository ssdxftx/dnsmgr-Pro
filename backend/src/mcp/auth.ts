import { timingSafeEqual } from 'node:crypto';
import { findUserById } from '../auth.js';
import { query, queryOne, table } from '../db.js';
import { hashApiKey, ipAllowed, parseScopes } from '../lib/apiKeys.js';
import { mcpLegacyEnabled } from '../lib/legacyApi.js';
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

function equalText(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

async function legacyContext(req: any, token: string, ip: string): Promise<McpContext> {
  if (!(await mcpLegacyEnabled())) {
    throw new McpAuthError('MCP 旧版兼容未开启，请在系统设置中启用，或使用 X-API-Key');
  }
  const parts = token.split(':');
  const uidText = parts[0] || '';
  const apikey = parts.slice(1).join(':');
  if (parts.length < 2 || !/^\d+$/.test(uidText) || !apikey) {
    throw new McpAuthError('认证信息格式错误，应为 <uid>:<apikey>');
  }
  const uid = Number(uidText);
  if (!Number.isSafeInteger(uid) || uid <= 0) throw new McpAuthError('认证信息格式错误，应为 <uid>:<apikey>');
  const user: any = await findUserById(uid);
  if (!user || !user.apikey || !equalText(String(user.apikey), apikey)) {
    throw new McpAuthError('用户不存在或API密钥错误');
  }
  if (Number(user.status) === 0) throw new McpAuthError('该用户已被封禁');
  if (Number(user.is_api) === 0) throw new McpAuthError('该用户未开启API权限');
  return {
    app: req.server,
    req,
    user,
    uid,
    level: Number(user.level || 0),
    mode: 'legacy',
    scopes: ['*'],
    apiKeyId: 0,
    apiKeyName: 'legacy',
    ip,
    jsonrpcId: null,
    requestHeaders: req.headers || {},
  };
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
  if (/^\d+:/.test(token)) return legacyContext(req, token, ip);
  return apiKeyContext(req, token, ip);
}
