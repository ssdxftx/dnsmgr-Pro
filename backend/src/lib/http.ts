import { fetch as undiciFetch } from 'undici';
import { getConfiguredProxyAgent } from './proxy.js';

/**
 * 带系统代理的 fetch 封装。
 * 未配置代理时沿用 undici 全局 dispatcher；配置后显式传入 ProxyAgent。
 * 调用方自带 dispatcher 时保持调用方选择（例如监控强制直连/IP 绑定）。
 */
export async function fetchWithProxy(input: any, init: any = {}): Promise<Response> {
  const dispatcher = init?.dispatcher ?? (await getConfiguredProxyAgent());
  const opts: any = { ...(init || {}) };
  if (dispatcher) opts.dispatcher = dispatcher;
  // 调用方未显式设置超时时给 60s 兜底，避免上游无响应导致连接和请求上下文长期悬挂。
  // 需要更长时限的调用方仍可自行传入 signal 覆盖。
  if (!opts.signal) opts.signal = AbortSignal.timeout(60_000);
  return (await undiciFetch(input, opts)) as unknown as Response;
}
