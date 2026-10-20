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

/** 启动时恢复维护标志，避免恢复中重启后继续对外服务 */
export async function initMaintenance(): Promise<void> {
  maintenance = (await configGet('maintenance', '0')) === '1';
}

export async function setMaintenance(v: boolean): Promise<void> {
  maintenance = v;
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
