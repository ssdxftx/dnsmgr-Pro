import { ProxyAgent } from 'undici';
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
export async function getConfiguredProxyAgent(): Promise<ProxyAgent | undefined> {
  const { server, port, user, pwd, type } = await getProxySettings();
  if (!server || !port) return undefined;
  let scheme = 'http';
  if (type === 'https') scheme = 'https';
  else if (type === 'sock4' || type === 'socks4') scheme = 'socks4';
  else if (type === 'sock5' || type === 'sock5h') scheme = 'socks5';
  const authPart = user && pwd ? `${encodeURIComponent(user)}:${encodeURIComponent(pwd)}@` : '';
  return new ProxyAgent(`${scheme}://${authPart}${server}:${port}`);
}
