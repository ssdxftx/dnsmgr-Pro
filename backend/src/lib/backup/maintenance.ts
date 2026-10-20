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

export function setMaintenance(v: boolean): void {
  maintenance = v;
}

export function getRestoreStatus(): RestoreStatus {
  return { ...status };
}

export function setRestoreStatus(patch: Partial<RestoreStatus>): void {
  status = { ...status, ...patch };
}
