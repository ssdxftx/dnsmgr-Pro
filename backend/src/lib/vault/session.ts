type Entry = { dek: Buffer; ttl: number; exp: number };

const sessions = new Map<string, Entry>();
const keyOf = (uid: number, jti: string) => `${uid}:${jti}`;

/** 保险库会话必须绑定令牌 jti：否则同一用户的不同会话（含管理员冒充登录）会共用内存 DEK */
export function setVaultSession(uid: number, jti: string, dek: Buffer, ttlMs = 30 * 60_000): number {
  const exp = Date.now() + ttlMs;
  sessions.set(keyOf(uid, jti), { dek, ttl: ttlMs, exp });
  // 限制内存中的保险库会话数量，避免大量登录/解锁导致 Map 无界增长
  if (sessions.size > 5000) {
    for (const [k, e] of sessions) if (e.exp <= Date.now()) sessions.delete(k);
    while (sessions.size > 5000) {
      const oldest = sessions.keys().next().value;
      if (oldest === undefined) break;
      sessions.delete(oldest);
    }
  }
  return exp;
}

export function getVaultDek(uid: number, jti?: string): Buffer | null {
  if (!jti) return null;
  const k = keyOf(uid, jti);
  const e = sessions.get(k);
  if (!e) return null;
  if (e.exp <= Date.now()) {
    sessions.delete(k);
    return null;
  }
  e.exp = Date.now() + e.ttl;
  return e.dek;
}

export function vaultSessionExpiry(uid: number, jti?: string): number | null {
  if (!jti) return null;
  const e = sessions.get(keyOf(uid, jti));
  if (!e || e.exp <= Date.now()) return null;
  return e.exp;
}

export function clearVaultSession(uid: number, jti?: string): void {
  if (jti) sessions.delete(keyOf(uid, jti));
  else for (const k of sessions.keys()) if (k.startsWith(`${uid}:`)) sessions.delete(k);
}

/** 后台任务用：取该用户任意一个活跃会话的 DEK（不创建新会话） */
export function findVaultDekByUid(uid: number): Buffer | null {
  const prefix = `${uid}:`;
  for (const [k, e] of sessions) {
    if (!k.startsWith(prefix)) continue;
    if (e.exp <= Date.now()) {
      sessions.delete(k);
      continue;
    }
    return e.dek;
  }
  return null;
}
