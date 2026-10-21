import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici';
import { configGet } from '../config.js';

export interface ProxySettings {
  server: string;
  port: number;
  user: string;
  pwd: string;
  type: string;
}

export async function getProxySettings(): Promise<ProxySettings> {
  return {
    server: String((await configGet('proxy_server', '')) || '').trim(),
    port: Number((await configGet('proxy_port', '')) || 0),
    user: String((await configGet('proxy_user', '')) || '').trim(),
    pwd: String((await configGet('proxy_pwd', '')) || '').trim(),
    type: String((await configGet('proxy_type', '')) || 'http').trim(),
  };
}

// 读取系统设置里的代理服务器配置，未配置时返回 undefined（调用方自行决定直连或报错）
// 按配置串缓存 Agent，复用连接（配置变化时自动重建）
let cachedProxyUrl = '';
let cachedProxyAgent: ProxyAgent | undefined;
let directAgent: Agent | undefined;
export async function getConfiguredProxyAgent(): Promise<ProxyAgent | undefined> {
  const { server, port, user, pwd, type } = await getProxySettings();
  if (!server || !port) {
    if (cachedProxyAgent) {
      cachedProxyAgent.close().catch(() => undefined);
      cachedProxyAgent = undefined;
      cachedProxyUrl = '';
    }
    return undefined;
  }
  let scheme = 'http';
  if (type === 'https') scheme = 'https';
  else if (type === 'sock4' || type === 'socks4') scheme = 'socks4';
  else if (type === 'sock5' || type === 'sock5h') scheme = 'socks5';
  const authPart = user && pwd ? `${encodeURIComponent(user)}:${encodeURIComponent(pwd)}@` : '';
  const url = `${scheme}://${authPart}${server}:${port}`;
  if (cachedProxyUrl !== url) {
    cachedProxyAgent?.close().catch(() => undefined);
    cachedProxyAgent = new ProxyAgent(url);
    cachedProxyUrl = url;
  }
  return cachedProxyAgent;
}

/**
 * 把系统代理应用到 undici 全局 dispatcher。
 * 直接调用 fetch() 的客户端无需逐个改代码即可走代理；显式传入 dispatcher 的请求仍以自身为准。
 * 保存系统设置后调用本函数可立即生效，无需重启进程。
 */
export async function refreshGlobalProxyDispatcher(): Promise<void> {
  if (!directAgent) directAgent = new Agent();
  const proxy = await getConfiguredProxyAgent();
  setGlobalDispatcher(proxy ?? directAgent);
}
