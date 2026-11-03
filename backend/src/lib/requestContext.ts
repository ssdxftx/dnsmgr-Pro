import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  uid: number;
  /** 当前会话的 JWT jti：保险库等会话级密钥必须绑定到具体会话，而不是用户 */
  jti: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * 在 onRequest 钩子里用 storage.run() 建立请求上下文。
 *
 * 关键点：不能用 enterWith()。Fastify 的 preHandler 与 handler 运行在不同的异步资源上，
 * 在钩子里 enterWith() 只影响钩子自身的后续调用，handler 里 getStore() 恒为 undefined
 * （表现：口令模式解锁后，所有私有账户读取仍报「保险库已锁定，请先解锁」）。
 * 回调式 onRequest 里调用 done() 时整条请求链是从这里同步派生的，因此 run() 的上下文能被 handler 继承。
 *
 * 上下文对象是**可变**的：onRequest 阶段还不知道 uid/jti，由鉴权钩子回填。
 */
export function runInRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** 鉴权成功后回填当前请求的 uid/jti（写入 onRequest 阶段创建的那个对象） */
export function bindRequestContext(ctx: RequestContext): void {
  const store = storage.getStore();
  if (store) {
    store.uid = Number(ctx.uid) || 0;
    store.jti = String(ctx.jti || '');
    return;
  }
  // 没有 onRequest 包裹（例如单元测试直接调用服务层）：退化为当前异步链生效
  storage.enterWith({ uid: Number(ctx.uid) || 0, jti: String(ctx.jti || '') });
}

export function currentRequestContext(): RequestContext | undefined {
  const store = storage.getStore();
  // 未认证请求也会带一个空上下文，这里按「无上下文」返回，避免被误当成已认证会话
  if (!store || (!store.uid && !store.jti)) return undefined;
  return store;
}
