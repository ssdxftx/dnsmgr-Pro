import { configGet, configSet } from '../../config.js';

export interface RestoreStatus {
  running: boolean;
  stage: string;
  message: string;
  startedAt: number;
  finishedAt: number;
  ok: boolean;
  report?: any;
}

let maintenance = false;
let lastRefresh = 0;
const REFRESH_MS = 1000;
let status: RestoreStatus = {
  running: false,
  stage: '',
  message: '',
  startedAt: 0,
  finishedAt: 0,
  ok: false,
};

export function isMaintenance(): boolean {
  return maintenance;
}

/**
 * 多副本场景下维护标志必须从数据库周期刷新：模块级变量只反映本进程，
 * 否则实例 A 进入恢复时，实例 B 仍会继续执行调度/证书/备份写入。
 */
export async function refreshMaintenance(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastRefresh < REFRESH_MS) return;
  lastRefresh = now;
  try {
    // force=true 跳过 60 秒配置缓存，否则跨副本刷新仍会读到旧值
    const v = (await configGet('maintenance', '0', true)) === '1';
    if (v !== maintenance) {
      maintenance = v;
      console.log(`[backup] 维护模式已${v ? '开启' : '关闭'}（从数据库同步）`);
    }
  } catch {
    // 数据库暂不可用时保持上一次已知状态，避免误判为可写
  }
}

/** 启动时恢复维护标志，避免恢复中重启后继续对外服务 */
export async function initMaintenance(): Promise<void> {
  maintenance = (await configGet('maintenance', '0', true)) === '1';
  lastRefresh = Date.now();
}

export async function setMaintenance(v: boolean): Promise<void> {
  maintenance = v;
  lastRefresh = Date.now();
  await configSet('maintenance', v ? '1' : '0').catch((e) =>
    console.warn('[backup] 维护标志持久化失败，重启后将丢失:', e?.message || e),
  );
}

export function getRestoreStatus(): RestoreStatus {
  return { ...status };
}

export function setRestoreStatus(patch: Partial<RestoreStatus>): void {
  status = { ...status, ...patch };
}
