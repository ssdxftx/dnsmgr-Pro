import { findUserById, verifyPassword } from '../auth.js';
import { isTokenRevoked } from './auth/revocation.js';
import { hitRateLimitDistributed } from './rateLimit.js';

/**
 * 二次确认令牌的校验。
 *
 * 三个必须同时成立的约束（缺一个都可能让一次确认被无限期、跨操作复用）：
 * 1. 绑定到具体会话：令牌里带 `sid`（签发时的会话 jti），当前请求的 jti 必须一致，
 *    登出或换设备后旧令牌自动失效，不需要额外维护吊销列表；
 * 2. 绑定到具体操作：令牌里带 `op`，使用点传入自己期望的 op 时要求匹配；
 * 3. 进会话级吊销表：显式吊销（登出、改密）后令牌立即不可用。
 */
async function verifyReauthToken(
  req: any,
  uid: number,
  op?: string,
): Promise<{ present: boolean; error: string | null }> {
  const raw = req?.headers?.['x-reauth-token'];
  // “未携带”与“携带了但为空”必须区分：后者是攻击者常用的绕过方式，
  // 绝不能因为没有有效令牌就回退成“无需二次确认”。
  if (raw === undefined || raw === null) return { present: false, error: null };
  const token = String(Array.isArray(raw) ? raw[0] : raw).trim();
  if (!token) return { present: true, error: '二次确认令牌无效' };
  let decoded: any;
  try {
    decoded = (req.server as any).jwt.verify(token);
  } catch {
    return { present: true, error: '二次确认已过期，请重新验证' };
  }
  if (decoded?.type !== 'reauth' || Number(decoded.uid) !== Number(uid)) {
    return { present: true, error: '二次确认令牌无效' };
  }
  // 会话绑定：不同会话（含登出后重新登录）签发的令牌不能互用。
  // 缺少任意一侧的 sid 都按不匹配处理，避免 API Key 等无 jti 的请求绕过绑定。
  if (req?.user?.auth_type === 'api_key') {
    return { present: true, error: '二次确认令牌不能用于 API Key 请求' };
  }
  const sid = String(decoded.sid || '');
  const currentSid = String(req?.user?.jti || '');
  if (!sid || !currentSid || sid !== currentSid) {
    return { present: true, error: '二次确认令牌不属于当前会话，请重新验证' };
  }
  // 操作绑定：令牌只能用于签发时指定的操作。旧的 `*` 通配令牌不再接受，
// 否则一次泄露的令牌可被拿去执行任意敏感操作（例如 vault.destroy）。
  const tokenOp = String(decoded.op || '*');
  if (!tokenOp || tokenOp === '*') return { present: true, error: '二次确认令牌缺少操作范围，请重新验证' };
  if (!op || tokenOp !== op) return { present: true, error: '二次确认令牌不适用于该操作，请重新验证' };
  if (!decoded.jti || (await isTokenRevoked(String(decoded.jti)))) {
    return { present: true, error: '二次确认已失效，请重新验证' };
  }
  const user: any = await findUserById(Number(uid));
  if (!user || Number(user.status) === 0) return { present: true, error: '用户不存在或已禁用' };
  if (Number(decoded.token_version || 0) !== Number(user.token_version || 0)) {
    return { present: true, error: '登录状态已变更，请重新验证' };
  }
  return { present: true, error: null };
}

/**
 * 敏感操作的二次确认。`op` 把令牌限定到具体操作（例如 'vault.destroy'），
 * 不传则只做会话级校验（兼容既有调用点）。
 */
export async function requireLoginPassword(uid: number, password: any, req?: any, op?: string): Promise<string | null> {
  const tokenResult = await verifyReauthToken(req, uid, op);
  if (tokenResult.error) return tokenResult.error;
  // 携带了有效令牌：不再要求密码。未携带：继续走密码校验。
  if (tokenResult.present) return null;
  // HTTP 头只允许 ByteString，非 ASCII 密码无法直接放入 X-Confirm-Password；
  // 支持 UTF-8 Base64 头，前端统一用该形式，旧明文头仍然兼容。
  if (!password && req) {
    const rawB64 = req.headers?.['x-confirm-password-b64'];
    if (rawB64 !== undefined && rawB64 !== null) {
      const text = String(Array.isArray(rawB64) ? rawB64[0] : rawB64).trim();
      password = text ? Buffer.from(text, 'base64').toString('utf8') : '';
    }
  }
  if (!password) {
    return req
      ? '请输入登录密码，或先调用 /api/auth/reauth 获取 X-Reauth-Token'
      : '请输入登录密码以确认此操作';
  }
  if (!(await hitRateLimitDistributed(`reauth:${uid}`, 10, 15 * 60_000))) {
    return '密码确认过于频繁，请稍后再试';
  }
  const user = await findUserById(Number(uid));
  if (!user) return '用户不存在';
  if (!(await verifyPassword(user.password, String(password)))) return '登录密码错误';
  return null;
}
