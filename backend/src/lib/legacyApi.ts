import { createHash, timingSafeEqual } from 'node:crypto';
import { configGet } from '../config.js';
import { queryOne, table } from '../db.js';

export type LegacyAuthResult =
  | { ok: true; user: any; body: Record<string, any> }
  | { ok: false; status: number; msg: string };

export async function legacyApiEnabled(): Promise<boolean> {
  return (await configGet('legacy_api_enable', '0')) === '1';
}

function addValue(out: Record<string, any>, key: string, value: string): void {
  const name = key.endsWith('[]') ? key.slice(0, -2) : key;
  if (!(name in out)) {
    out[name] = value;
  } else if (Array.isArray(out[name])) {
    out[name].push(value);
  } else {
    out[name] = [out[name], value];
  }
}

function parseForm(body: string): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of new URLSearchParams(body)) addValue(out, key, value);
  return out;
}

export function legacyBody(req: any): Record<string, any> {
  // 与旧版 AuthApi 保持一致：签名参数只从 POST 请求体读取，不接收 query，
  // 避免 uid/timestamp/sign 出现在访问日志或浏览器历史中。
  if (typeof req.body === 'string') return parseForm(req.body);
  if (req.body && typeof req.body === 'object') return { ...req.body };
  return {};
}

function scalar(value: any): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value ?? '');
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function legacyApiAuth(req: any): Promise<LegacyAuthResult> {
  if (!(await legacyApiEnabled())) return { ok: false, status: 404, msg: '404 Not Found' };
  const body = legacyBody(req);
  const uid = Number(scalar(body.uid));
  const timestamp = scalar(body.timestamp);
  const sign = scalar(body.sign);
  if (!Number.isInteger(uid) || uid <= 0 || !timestamp || !sign) {
    return { ok: false, status: 403, msg: '认证参数不能为空' };
  }
  const ts = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || ts < now - 300 || ts > now + 300) {
    return { ok: false, status: 403, msg: '时间戳不合法' };
  }
  const user: any = await queryOne(`SELECT * FROM ${table('user')} WHERE id = ? LIMIT 1`, [uid]);
  if (!user) return { ok: false, status: 403, msg: '用户不存在' };
  if (Number(user.status) === 0) return { ok: false, status: 403, msg: '该用户已被封禁' };
  if (Number(user.is_api) !== 1) return { ok: false, status: 403, msg: '该用户未开启API权限' };
  if (!user.apikey) return { ok: false, status: 403, msg: '该用户未设置API密钥' };
  const expected = createHash('md5').update(String(uid) + timestamp + String(user.apikey)).digest('hex');
  if (!safeEqual(expected, sign.toLowerCase())) return { ok: false, status: 403, msg: '签名错误' };

  req.user = {
    uid: Number(user.id),
    username: user.username,
    level: Number(user.level),
    totp_open: Number(user.totp_open),
    stat_cache: Number(user.stat_cache || 0),
    email: String(user.email || ''),
    is_super: Number(user.is_super || 0),
    token_version: Number(user.token_version || 0),
    type: 'session',
    auth_type: 'legacy_api',
    api_key_id: 0,
    api_key_name: 'legacy',
  };
  return { ok: true, user, body };
}
