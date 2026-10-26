import { findUserById, verifyPassword } from '../auth.js';
import { hitRateLimitDistributed } from './rateLimit.js';

export async function requireLoginPassword(uid: number, password: any): Promise<string | null> {
  if (!password) return '请输入登录密码以确认此操作';
  // 敏感操作二次确认不能成为绕过登录锁定后的在线口令爆破入口：
  // 跨实例限制每个账号 15 分钟内最多 10 次确认尝试（成功尝试也计入，避免被高频调用）。
  if (!(await hitRateLimitDistributed(`reauth:${uid}`, 10, 15 * 60_000))) {
    return '密码确认过于频繁，请稍后再试';
  }
  const user = await findUserById(Number(uid));
  if (!user) return '用户不存在';
  if (!(await verifyPassword(user.password, String(password)))) return '登录密码错误';
  return null;
}