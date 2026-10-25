import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export function fmtDateTime(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtTimestamp(ts: number): string {
  if (!ts) return '未运行';
  return fmtDateTime(new Date(ts * 1000));
}

// 仅检查对象自身属性，避免 Object.prototype 上的成员（如 constructor/toString）被当作合法键
export function hasOwn(obj: Record<string, any>, key: any): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// 转义 LIKE 通配符，配合 SQL 中的 ESCAPE '!' 使用，避免用户输入的 % / _ / ! 改变匹配语义
export function escapeLike(s: string): string {
  return String(s).replace(/[!%_]/g, (m) => '!' + m);
}

// 分页参数归一化：limit 限制在 [1, max]，非法值回退默认；offset 非负
export function clampLimit(v: any, def = 10, max = 200): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

export function clampOffset(v: any): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// 证书/部署任务日志 ID 白名单：该值会拼入文件路径，必须拒绝路径分隔符与 .. 等字符
export const SAFE_PROCESS_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export function safeProcessId(value: any): string | null {
  const id = String(value ?? '').trim();
  return SAFE_PROCESS_ID_RE.test(id) ? id : null;
}

// 面向客户端返回的错误信息：去除换行/制表等控制符并限制长度，避免泄露多行堆栈等内部细节
export function clientMessage(e: any, fallback = '操作失败'): string {
  const raw = typeof e === 'string' ? e : e && e.message ? String(e.message) : '';
  const cleaned = raw.replace(/[\r\n\t]+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 200) : fallback;
}

// 异步串行追加日志：避免 appendFileSync 阻塞事件循环；按文件串行保证写入顺序，目录只建一次
const logDirReady = new Set<string>();
const logChains = new Map<string, Promise<unknown>>();
export function appendLog(file: string, line: string): void {
  const dir = dirname(file);
  const ensureDir =
    dir && !logDirReady.has(dir)
      ? mkdir(dir, { recursive: true })
          .then(() => {
            logDirReady.add(dir);
          })
          .catch(() => undefined)
      : Promise.resolve();
  const prev = logChains.get(file) || Promise.resolve();
  const next = Promise.all([prev, ensureDir])
    .then(() => appendFile(file, line))
    .catch(() => undefined);
  logChains.set(file, next);
  void next.finally(() => {
    if (logChains.get(file) === next) logChains.delete(file);
  });
}

/** 有界并发映射：保持结果与输入同序，用于云厂商批量只读请求，避免串行 N+1 或无上限 Promise.all */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(Math.max(1, limit), items.length)).fill(0).map(async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
