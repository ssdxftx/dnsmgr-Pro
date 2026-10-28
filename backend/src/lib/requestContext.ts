import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  uid: number;
  /** 当前会话的 JWT jti：保险库等会话级密钥必须绑定到具体会话，而不是用户 */
  jti: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * 在认证钩子中写入请求上下文；Fastify 会在同一异步链中执行 preHandler 与 handler，
 * 因此 handler 及其调用的深层函数都能读到当前请求的 jti。
 */
export function enterRequestContext(ctx: RequestContext): void {
  storage.enterWith(ctx);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
