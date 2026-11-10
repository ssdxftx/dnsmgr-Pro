import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { configGet } from '../config.js';
import { isDuplicateError, query, queryOne, table } from '../db.js';
import { hitRateLimitDistributed } from './rateLimit.js';

/** v2：HMAC 绑定 method+path+参数+nonce，不可重放；v1：历史 md5(uid+timestamp+apikey)，需显式开启 */
export type LegacyAuthScheme = 'v1' | 'v2';

export type LegacyAuthResult =
  | { ok: true; user: any; body: Record<string, any>; scheme: LegacyAuthScheme }
  | { ok: false; status: number; msg: string };

export async function legacyApiEnabled(): Promise<boolean> {
  return (await configGet('legacy_api_enable', '0')) === '1';
}

/** 旧版 md5 签名不绑定请求，可在 300 秒内被重放到任意旧版接口；默认关闭，需显式开启 */
async function legacyV1Enabled(): Promise<boolean> {
  return (await configGet('legacy_api_v1_enable', '0')) === '1';
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

/** 参与 v2 签名计算时排除的字段（签名本身、一次性随机数） */
const SIGN_EXCLUDE = new Set(['sign', 'sign2', 'nonce']);

/** 参数规范化：按键名排序后拼接，避免参数顺序不同导致同一请求算出不同摘要 */
function canonicalParams(body: Record<string, any>): string {
  return Object.keys(body)
    .filter((k) => !SIGN_EXCLUDE.has(k))
    .sort()
    .map((k) => k + '=' + scalar(body[k]))
    .join('&');
}

/** v2 签名：HMAC-SHA256(apikey, method\npath\nuid\ntimestamp\nnonce\nsha256(params)) */
function signV2(
  apikey: string,
  method: string,
  path: string,
  uid: number,
  timestamp: string,
  nonce: string,
  body: Record<string, any>,
): string {
  const paramsHash = createHash('sha256').update(canonicalParams(body)).digest('hex');
  const payload = [method.toUpperCase(), path, String(uid), timestamp, nonce, paramsHash].join('\n');
  return createHmac('sha256', apikey).update(payload).digest('hex');
}

/** 落库 nonce 做一次性校验：插入冲突即视为重放。表不可用时 fail-closed。 */
async function consumeNonce(nonce: string, uid: number): Promise<boolean> {
  try {
    await query(`INSERT INTO ${table('legacy_nonce')} (nonce, uid, created_at) VALUES (?, ?, NOW())`, [nonce, uid]);
  } catch (e: any) {
    if (isDuplicateError(e)) return false;
    throw e;
  }
  // 时间窗只有 300 秒，顺手清理过期记录（1% 概率触发，避免每次请求都删表）
  if (Math.random() < 0.01) {
    await query(`DELETE FROM ${table('legacy_nonce')} WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)`).catch(() => undefined);
  }
  return true;
}

/**
 * 一次性票据（quicklogin 的签名 URL 等）：复用同一张 nonce 表，
 * 同一张签名票据只能被消费一次，重放直接拒绝。表不可用时 fail-closed。
 */
export async function consumeOneTimeTicket(key: string, uid: number): Promise<boolean> {
  const id = String(key || '').trim();
  if (!id) return false;
  return consumeNonce(`t:${id}`, uid);
}

export async function legacyApiAuth(req: any): Promise<LegacyAuthResult> {
  if (!(await legacyApiEnabled())) return { ok: false, status: 404, msg: '404 Not Found' };
  const body = legacyBody(req);
  const uid = Number(scalar(body.uid));
  const timestamp = scalar(body.timestamp);
  const sign = scalar(body.sign);
  const sign2 = scalar(body.sign2);
  const nonce = scalar(body.nonce);
  // 统一失败文案：验签前按 uid 回查用户会暴露「用户不存在/已封禁/未开 API/未设密钥」
  // 等状态，uid 自增即可批量枚举。所有认证失败一律返回同一句。
  const AUTH_FAIL = { ok: false as const, status: 403, msg: '认证失败' };
  if (!Number.isInteger(uid) || uid <= 0 || !timestamp || (!sign && !sign2)) return AUTH_FAIL;
  const ts = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || ts < now - 300 || ts > now + 300) return AUTH_FAIL;
  if (!(await hitRateLimitDistributed(`legacy-api:${req.ip || 'unknown'}`, 300, 60_000))) {
    return { ok: false, status: 429, msg: '请求过于频繁，请稍后再试' };
  }
  const user: any = await queryOne(`SELECT * FROM ${table('user')} WHERE id = ? LIMIT 1`, [uid]);
  if (!user) return AUTH_FAIL;
  if (Number(user.status) === 0) return AUTH_FAIL;
  if (Number(user.is_api) !== 1) return AUTH_FAIL;
  if (!user.apikey) return AUTH_FAIL;

  let scheme: LegacyAuthScheme;
  if (sign2) {
    if (!nonce) return AUTH_FAIL;
    if (nonce.length < 16 || nonce.length > 64) return AUTH_FAIL;
    const method = String(req.method || 'POST');
    const path = String(req.url || req.raw?.url || '').split('?')[0];
    const expected = signV2(String(user.apikey), method, path, uid, timestamp, nonce, body);
    if (!safeEqual(expected, sign2.toLowerCase())) return AUTH_FAIL;
    if (!(await consumeNonce(nonce, uid))) return AUTH_FAIL;
    scheme = 'v2';
  } else {
    // 历史 md5 签名不绑定请求路径与参数，可在时间窗内重放；默认关闭，需要旧版客户端时显式开启
    if (!(await legacyV1Enabled())) return AUTH_FAIL;
    const expected = createHash('md5').update(String(uid) + timestamp + String(user.apikey)).digest('hex');
    if (!safeEqual(expected, sign.toLowerCase())) return AUTH_FAIL;
    scheme = 'v1';
  }

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
    legacy_scheme: scheme,
    api_key_id: 0,
    api_key_name: 'legacy',
  };
  return { ok: true, user, body, scheme };
}
