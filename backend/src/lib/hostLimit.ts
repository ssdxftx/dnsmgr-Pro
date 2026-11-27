import { AsyncLocalStorage } from 'node:async_hooks';

// 按上游主机限制并发：多用户同时打开统计/批量任务时，避免同一云厂商 API 被本进程打爆配额。
// 账户上下文可选叠加第二道配额，避免同一厂商下某个账户占满全部主机并发。
// 只限制本进程；多副本部署仍由各厂商配额与分布式限流共同约束。

const MAX_PER_HOST = Math.max(1, Math.min(256, Number(process.env.DNSMGR_HOST_CONCURRENCY || 32) || 32));
const MAX_PER_ACCOUNT = Math.max(1, Math.min(128, Number(process.env.DNSMGR_ACCOUNT_CONCURRENCY || 8) || 8));
const QUEUE_TIMEOUT_MS = Math.max(1000, Math.min(120_000, Number(process.env.DNSMGR_HOST_QUEUE_TIMEOUT_MS || 30_000) || 30_000));
const MAX_KEYS = 2000;

interface Waiter {
  done: boolean;
  grant: () => void;
}

interface LimitState {
  active: number;
  lastUsed: number;
  queue: Waiter[];
}

const hosts = new Map<string, LimitState>();
const accounts = new Map<string, LimitState>();
const accountCtx = new AsyncLocalStorage<{ key: string; limit: number }>();

function hostOf(input: any): string {
  try {
    const raw = typeof input === 'string' ? input : input?.url ? String(input.url) : String(input);
    return new URL(raw).host.toLowerCase();
  } catch {
    return '';
  }
}

function stateOf(map: Map<string, LimitState>, key: string): LimitState {
  let rec = map.get(key);
  if (rec) {
    rec.lastUsed = Date.now();
    return rec;
  }
  if (map.size >= MAX_KEYS) {
    for (const [k, value] of map) {
      if (!value.active && !value.queue.length) map.delete(k);
      if (map.size < MAX_KEYS) break;
    }
  }
  rec = { active: 0, lastUsed: Date.now(), queue: [] };
  map.set(key, rec);
  return rec;
}

async function acquire(map: Map<string, LimitState>, key: string, limit: number): Promise<boolean> {
  const rec = stateOf(map, key);
  if (rec.active < limit) {
    rec.active++;
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const waiter: Waiter = {
      done: false,
      grant: () => undefined,
    };
    const timer = setTimeout(() => {
      if (waiter.done) return;
      waiter.done = true;
      resolve(false);
    }, QUEUE_TIMEOUT_MS);
    waiter.grant = () => {
      if (waiter.done) return;
      waiter.done = true;
      clearTimeout(timer);
      resolve(true);
    };
    rec.queue.push(waiter);
  });
}

function release(map: Map<string, LimitState>, key: string): void {
  const rec = map.get(key);
  if (!rec) return;
  while (rec.queue.length) {
    const next = rec.queue.shift()!;
    if (next.done) continue;
    next.grant();
    return;
  }
  rec.active = Math.max(0, rec.active - 1);
  rec.lastUsed = Date.now();
  if (!rec.active) map.delete(key);
}

export async function withHostLimit<T>(input: any, fn: () => Promise<T>): Promise<T> {
  const host = hostOf(input);
  if (!host) return fn();
  const account = accountCtx.getStore();
  let accountHeld = false;
  if (account?.key) {
    accountHeld = await acquire(accounts, account.key, account.limit);
    if (!accountHeld) throw new Error(`账户上游请求排队超时：${account.key}`);
  }
  try {
    const ok = await acquire(hosts, host, MAX_PER_HOST);
    if (!ok) throw new Error(`上游请求排队超时：${host}`);
    try {
      return await fn();
    } finally {
      release(hosts, host);
    }
  } finally {
    if (accountHeld && account) release(accounts, account.key);
  }
}

/**
 * 在账户上下文中执行操作：期间所有出站 HTTP 会在主机并发之外再受账户并发限制。
 * 未包在上下文里的调用保持原有仅按主机限流的行为。
 */
export function withAccountLimit<T>(key: string, fn: () => Promise<T>, limit = MAX_PER_ACCOUNT): Promise<T> {
  const normalized = String(key || '').trim();
  if (!normalized) return fn();
  const safeLimit = Math.max(1, Math.min(128, Number(limit) || MAX_PER_ACCOUNT));
  return accountCtx.run({ key: normalized, limit: safeLimit }, fn);
}
