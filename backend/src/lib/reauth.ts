import { findUserById, verifyPassword } from '../auth.js';

export async function requireLoginPassword(uid: number, password: any): Promise<string | null> {
  if (!password) return '请输入登录密码以确认此操作';
  const user = await findUserById(Number(uid));
  if (!user) return '用户不存在';
  if (!(await verifyPassword(user.password, String(password)))) return '登录密码错误';
  return null;
}