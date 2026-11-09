import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { configGet } from '../config.js';
import { isDuplicateError, query, queryOne, table } from '../db.js';

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
  if (!Number.isInteger(uid) || uid <= 0 || !timestamp || (!sign && !sign2)) {
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

  let scheme: LegacyAuthScheme;
  if (sign2) {
    if (!nonce) return { ok: false, status: 403, msg: 'v2 签名必须携带 nonce' };
    if (nonce.length < 16 || nonce.length > 64) return { ok: false, status: 403, msg: 'nonce 格式不合法' };
    const method = String(req.method || 'POST');
    const path = String(req.url || req.raw?.url || '').split('?')[0];
    const expected = signV2(String(user.apikey), method, path, uid, timestamp, nonce, body);
    if (!safeEqual(expected, sign2.toLowerCase())) return { ok: false, status: 403, msg: '签名错误' };
    if (!(await consumeNonce(nonce, uid))) return { ok: false, status: 403, msg: '重复的 nonce，请重新生成签名' };
    scheme = 'v2';
  } else {
    // 历史 md5 签名不绑定请求路径与参数，可在时间窗内重放；默认关闭，需要旧版客户端时显式开启
    if (!(await legacyV1Enabled())) {
      return { ok: false, status: 403, msg: '旧版签名已停用，请使用 v2 签名（sign2 + nonce）或开启 legacy_api_v1_enable' };
    }
    const expected = createHash('md5').update(String(uid) + timestamp + String(user.apikey)).digest('hex');
    if (!safeEqual(expected, sign.toLowerCase())) return { ok: false, status: 403, msg: '签名错误' };
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
