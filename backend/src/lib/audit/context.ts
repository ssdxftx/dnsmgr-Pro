import type { AuditCtx } from './types.js';

/** 在路由里设置/合并审计上下文；返回同一个对象便于链式补充 */
export function audit(req: any, patch: AuditCtx): AuditCtx {
  const cur: AuditCtx = (req.audit ||= {});
  Object.assign(cur, patch);
  return cur;
}
