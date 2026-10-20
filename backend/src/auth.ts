import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query, queryOne, table } from './db.js';

export function md5(s: string): string {
  return createHash('md5').update(s).digest('hex');
}

export interface AuthUser {
  id: number;
  username: string;
  level: number;
  status: number;
}

export async function findUserByUsername(username: string): Promise<any> {
  return queryOne(`SELECT * FROM ${table('user')} WHERE username = ? LIMIT 1`, [username]);
}

export async function findUserById(id: number): Promise<any> {
  return queryOne(`SELECT * FROM ${table('user')} WHERE id = ? LIMIT 1`, [id]);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// 用户名不存在时也执行一次 bcrypt 比对，抹平“用户是否存在”的响应时间差异，防止用户名枚举
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dnsmgr-dummy-password', 10);

export function checkLevel(user: { level: number } | undefined, required: number): boolean {
  if (!user) return false;
  if (user.level >= 2) return true;
  return user.level >= required;
}

export async function checkDomainPermission(uid: number, domain: string): Promise<boolean> {
  const row = await queryOne(`SELECT * FROM ${table('permission')} WHERE uid = ? AND domain = ? LIMIT 1`, [uid, domain]);
  return !!row;
}

export interface SubPermission {
  domain: string;
  sub: string | null;
  readonly: number;
  expiretime?: string | null;
}

export async function getUserPermissions(uid: number): Promise<SubPermission[]> {
  return query<SubPermission>(
    `SELECT domain, sub, readonly, expiretime FROM ${table('permission')} WHERE uid = ? AND (expiretime IS NULL OR expiretime > NOW())`,
    [uid],
  );
}

/** DNS 名称大小写不敏感：统一比较小写并去掉末尾点 */
export function sameDomain(a: any, b: any): boolean {
  return String(a ?? '').trim().toLowerCase().replace(/\.$/, '') === String(b ?? '').trim().toLowerCase().replace(/\.$/, '');
}

/** 判断某条解析记录主机名是否落在分配的子域名范围内（sub 为空表示整域名） */
export function isRecordInScope(recordName: string, sub: string | null): boolean {
  if (!sub) return true;
  const rr = (recordName === '@' ? '' : String(recordName || '').trim()).toLowerCase().replace(/\.$/, '');
  const s = String(sub).trim().toLowerCase().replace(/\.$/, '');
  return rr === s || rr.endsWith('.' + s);
}

/** 返回 0=可写（自由解析）、1=只读、-1=无权限 */
export function matchPermission(perms: SubPermission[], domain: string, recordName: string): number {
  let best = -1;
  for (const p of perms) {
    if (!sameDomain(p.domain, domain)) continue;
    if (isRecordInScope(recordName, p.sub)) {
      if (Number(p.readonly) !== 1) return 0;
      best = 1;
    }
  }
  return best;
}