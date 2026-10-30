export interface AuditChange {
  field: string;
  from?: string;
  to?: string;
}

export interface AuditCtx {
  /** 覆盖记录中的操作者（登录成功等尚未建立会话的场景） */
  uid?: number;
  username?: string;
  module?: string;
  action?: string;
  targetType?: string;
  targetId?: string | number;
  targetName?: string;
  summary?: string;
  changes?: AuditChange[];
  detail?: Record<string, any>;
  /** true 表示这条请求不记录（如健康检查、内部探测） */
  skip?: boolean;
  /** 请求体含明文凭证时置 true，只记录 _scrubbed 标记 */
  scrubBody?: boolean;
}

export interface AuditRow {
  uid: number;
  username: string;
  auth_type: string;
  api_key_id: number;
  api_key_name: string;
  module: string;
  action: string;
  method: string;
  path: string;
  route: string;
  target_type: string;
  target_id: string;
  target_name: string;
  summary: string;
  detail: string | null;
  changes: string | null;
  result: number;
  errmsg: string;
  status: number;
  ip: string;
  ua: string;
  cost_ms: number;
  addtime: string;
}
