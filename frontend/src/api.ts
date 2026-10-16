const TOKEN_KEY = 'dnsmgr_token';
const USER_KEY = 'dnsmgr_user';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
export function getUser(): any {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}
export function setUser(u: any) {
  localStorage.setItem(USER_KEY, JSON.stringify(u));
}

export interface ApiOptions {
  /** 调用方取消信号：组件卸载 / 参数切换时中止旧请求，避免旧响应覆盖新结果 */
  signal?: AbortSignal;
  /** GET 缓存：true = 默认 5s，数字 = 指定毫秒；false / 省略 = 不缓存 */
  cache?: boolean | number;
  /** 跳过缓存读取，强制重新请求 */
  force?: boolean;
}

const GET_DEFAULT_TTL = 5000;
const getCache = new Map<string, { at: number; data: any }>();
const inflight = new Map<string, Promise<any>>();

/** 失效 GET 缓存：写操作后调用；传入前缀仅失效匹配项，省略则整体清空 */
export function invalidateApiCache(prefix?: string): void {
  if (!prefix) {
    getCache.clear();
    return;
  }
  for (const key of [...getCache.keys()]) if (key.includes(prefix)) getCache.delete(key);
}

export async function api<T = any>(method: string, url: string, body?: any, opts: ApiOptions = {}): Promise<T> {
  const upper = String(method || 'GET').toUpperCase();
  const isGet = upper === 'GET';
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;

  let fullUrl = '/api' + url;
  let payload: string | undefined;
  if (isGet && body) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    if (qs.toString()) fullUrl += (url.includes('?') ? '&' : '?') + qs.toString();
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const ttl = opts.cache === true ? GET_DEFAULT_TTL : typeof opts.cache === 'number' ? opts.cache : 0;
  const cacheKey = fullUrl;

  // 命中缓存直接返回，避免跨页重复拉取同一份数据
  if (isGet && ttl > 0 && !opts.force) {
    const hit = getCache.get(cacheKey);
    if (hit && Date.now() - hit.at < ttl) return hit.data as T;
  }
  // in-flight 去重：并发的相同 GET 共享同一个请求
  if (isGet && !opts.signal && !opts.force) {
    const running = inflight.get(cacheKey);
    if (running) return running as Promise<T>;
  }

  const doFetch = async (): Promise<T> => {
    const controller = new AbortController();
    // 避免后端僵死时 fetch 永不 settle，导致各页 loading 永久转圈
    const timer = setTimeout(() => controller.abort(), 120000);
    const onAbort = () => controller.abort();
    if (opts.signal) {
      if (opts.signal.aborted) {
        clearTimeout(timer);
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
      opts.signal.addEventListener('abort', onAbort);
    }
    let res: Response;
    try {
      res = await fetch(fullUrl, { method: upper, headers, body: payload, signal: controller.signal });
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        if (opts.signal?.aborted) throw e; // 调用方主动取消，交由调用方处理
        return { code: -1, msg: '请求超时，请稍后重试' } as T;
      }
      throw e;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
    if (res.status === 401) {
      clearToken();
      if (!location.pathname.startsWith('/login')) location.href = '/login';
      throw new Error('未登录');
    }
    const text = await res.text();
    if (!text) return {} as T;
    try {
      const json: any = JSON.parse(text);
      // 后端框架级错误（如 500）返回 { statusCode, error, message }，统一转成 { code, msg } 便于页面提示
      if (json && typeof json === 'object' && typeof json.code !== 'number') {
        const m = json.msg || json.message || json.error;
        return { code: -1, msg: m || `服务器响应异常（HTTP ${res.status}）` } as T;
      }
      return json as T;
    } catch {
      return { code: -1, msg: `服务器响应异常（HTTP ${res.status}）` } as T;
    }
  };

  const task = doFetch().then((data) => {
    if (isGet && ttl > 0 && (data as any)?.code === 0) getCache.set(cacheKey, { at: Date.now(), data });
    return data;
  });

  if (isGet && !opts.signal && !opts.force) {
    inflight.set(cacheKey, task);
    task.finally(() => inflight.delete(cacheKey)).catch(() => {});
  } else if (!isGet) {
    // 写操作成功后失效 GET 缓存，保证后续读取拿到最新数据
    task.then((data) => { if ((data as any)?.code === 0) invalidateApiCache(); }).catch(() => {});
  }
  return task;
}