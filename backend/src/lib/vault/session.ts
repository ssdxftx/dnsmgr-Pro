type Entry = { dek: Buffer; ttl: number; exp: number; abs: number; epoch: number };

const sessions = new Map<string, Entry>();
const keyOf = (uid: number, jti: string) => `${uid}:${jti}`;

/** 空闲超时 30 分钟；绝对上限 8 小时——滑动续期不能无限延长同一个解锁状态 */
const IDLE_TTL_MS = 30 * 60_000;
const ABS_TTL_MS = 8 * 3600_000;
const MAX_SESSIONS = 5000;
let lastSweep = 0;

/** 删除会话并清零明文 DEK：锁屏/登出后密钥不应继续留在进程堆里 */
function drop(key: string, keepDek?: Buffer): void {
  const e = sessions.get(key);
  if (!e) return;
  sessions.delete(key);
  if (e.dek !== keepDek) {
    try {
      e.dek.fill(0);
    } catch {
      // Buffer 已被转移或释放时忽略
    }
  }
}

function sweep(now: number): void {
  for (const [k, e] of sessions) {
    if (e.exp <= now || e.abs <= now) drop(k);
  }
  lastSweep = now;
}

/** 保险库会话必须绑定令牌 jti：否则同一用户的不同会话（含管理员冒充登录）会共用内存 DEK */
export function setVaultSession(uid: number, jti: string, dek: Buffer, ttlMs = IDLE_TTL_MS, epoch = 0): number {
  const now = Date.now();
  const key = keyOf(uid, jti);
  const prev = sessions.get(key);
  // 绝对上限按「首次解锁」计算，后续 set 不重置，避免长期在线把解锁状态永久续下去
  const abs = prev ? Math.min(prev.abs, now + ABS_TTL_MS) : now + ABS_TTL_MS;
  const exp = Math.min(now + ttlMs, abs);
  sessions.set(key, { dek, ttl: ttlMs, exp, abs, epoch: Number(epoch) || 0 });
  if (prev && prev.dek !== dek) {
    try {
      prev.dek.fill(0);
    } catch {
      // ignore
    }
  }
  // 限制内存中的保险库会话数量，避免大量登录/解锁导致 Map 无界增长
  if (sessions.size > MAX_SESSIONS || now - lastSweep > 60_000) sweep(now);
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    drop(oldest);
  }
  return exp;
}

export function getVaultDek(uid: number, jti?: string, epoch?: number): Buffer | null {
  if (!jti) return null;
  const k = keyOf(uid, jti);
  const e = sessions.get(k);
  if (!e) return null;
  if (epoch !== undefined && Number(e.epoch) !== Number(epoch)) {
    // 旧请求可能携带递增前的 epoch：只拒绝，不删除当前新会话，否则会把刚完成改密的会话踢掉。
    return null;
  }
  const now = Date.now();
  if (e.exp <= now || e.abs <= now) {
    drop(k);
    return null;
  }
  // 滑动续期不得越过绝对上限
  e.exp = Math.min(now + e.ttl, e.abs);
  return e.dek;
}

export function vaultSessionExpiry(uid: number, jti?: string, epoch?: number): number | null {
  if (!jti) return null;
  const e = sessions.get(keyOf(uid, jti));
  if (!e) return null;
  if (epoch !== undefined && Number(e.epoch) !== Number(epoch)) return null;
  const now = Date.now();
  if (e.exp <= now || e.abs <= now) return null;
  return e.exp;
}

/** 清除该用户除当前 jti 之外的所有保险库会话（改口令/恢复/升级时使用，保留当前会话继续工作）。 */
export function clearOtherVaultSessions(uid: number, jti: string): void {
  const keep = keyOf(uid, jti);
  for (const k of [...sessions.keys()]) {
    if (k.startsWith(`${uid}:`) && k !== keep) drop(k);
  }
}

export function clearVaultSession(uid: number, jti?: string): void {
  if (jti) {
    drop(keyOf(uid, jti));
    return;
  }
  for (const k of [...sessions.keys()]) if (k.startsWith(`${uid}:`)) drop(k);
}
