import { findUserById, verifyPassword } from '../auth.js';
import { hitRateLimitDistributed } from './rateLimit.js';

async function verifyReauthToken(req: any, uid: number): Promise<string | null> {
  const token = String(req?.headers?.['x-reauth-token'] || '').trim();
  if (!token) return null;
  let decoded: any;
  try {
    decoded = (req.server as any).jwt.verify(token);
  } catch {
    return '二次确认已过期，请重新验证';
  }
  if (decoded?.type !== 'reauth' || Number(decoded.uid) !== Number(uid)) {
    return '二次确认令牌无效';
  }
  const user: any = await findUserById(Number(uid));
  if (!user || Number(user.status) === 0) return '用户不存在或已禁用';
  if (Number(decoded.token_version || 0) !== Number(user.token_version || 0)) {
    return '登录状态已变更，请重新验证';
  }
  return null;
}

export async function requireLoginPassword(uid: number, password: any, req?: any): Promise<string | null> {
  const tokenResult = await verifyReauthToken(req, uid);
  if (tokenResult !== null) return tokenResult;
  if (req?.headers?.['x-reauth-token']) return null;
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
