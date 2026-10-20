// 进程内调度防重入：内嵌 interval 与外部 cron 入口共享同一份运行状态，
// 避免同一进程内同一调度任务叠加执行（上一轮未结束则跳过本轮）。
const running = new Set<string>();

export function runGuarded(key: string, fn: () => Promise<unknown>, label: string): Promise<void> {
  if (running.has(key)) return Promise.resolve();
  running.add(key);
  return (async () => {
    try {
      await fn();
    } catch (e: any) {
      console.error(label, e?.message || e);
    } finally {
      running.delete(key);
    }
  })();
}

// 与 runGuarded 共享同一份锁：供手动触发路径复用调度互斥，避免与周期任务并发执行
export function tryAcquire(key: string): boolean {
  if (running.has(key)) return false;
  running.add(key);
  return true;
}

export function release(key: string): void {
  running.delete(key);
}
