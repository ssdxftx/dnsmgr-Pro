const TOKEN_KEY = 'dnsmgr_token';
const USER_KEY = 'dnsmgr_user';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
  // 切换账号时上一账号的 GET 缓存不能复用；同时递增 epoch 阻止旧请求回写
  cacheEpoch++;
  getCache.clear();
  inflight.clear();
  abortInflightGets();
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  // 登录态变更（含登出）后清空 GET 缓存，避免把上一账号的数据带给下一账号
  cacheEpoch++;
  getCache.clear();
  inflight.clear();
  abortInflightGets();
  meAbort?.abort();
}
export function getUser(): any {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}
export function setUser(u: any) {
  const prev = getUser();
  localStorage.setItem(USER_KEY, JSON.stringify(u));
  // 角色/权限变化后旧 GET 数据可能包含越权或过期字段，立即失效缓存。
  if (prev && JSON.stringify(prev) !== JSON.stringify(u)) {
    cacheEpoch++;
    getCache.clear();
    inflight.clear();
    abortInflightGets();
  }
  // 通知 Pinia store 同步更新：否则 403/401 触发的用户刷新只改 localStorage，
  // 菜单与统计入口仍按旧身份渲染
  window.dispatchEvent(new CustomEvent('dnsmgr:user-updated', { detail: u }));
}

export interface ApiOptions {
  /** 调用方取消信号：组件卸载 / 参数切换时中止旧请求，避免旧响应覆盖新结果 */
  signal?: AbortSignal;
  /** GET 缓存：true = 默认 15s，数字 = 指定毫秒；false = 禁用；省略 = 仅参考数据默认缓存 */
  cache?: boolean | number;
  /** 跳过缓存读取，强制重新请求 */
  force?: boolean;
  /** 额外请求头（如二次确认密码） */
  headers?: Record<string, string>;
  /** 超时毫秒数；0 表示不超时（备份导出/恢复等长任务） */
  timeout?: number;
}

// 默认 GET 缓存 15s：只对参考数据生效，写操作按资源前缀失效
const GET_DEFAULT_TTL = 15000;
const GET_CACHE_MAX = 200;
const DEFAULT_CACHE_PATHS = new Set([
  '/api/cdn/providers',
  '/api/cdn/accounts',
  '/api/cdn/zones',
  '/api/cdn/domains/options',
  '/api/dns/accounts',
  '/api/cert/accounts',
]);
const getCache = new Map<string, { at: number; data: any }>();
const inflight = new Map<string, Promise<any>>();
const getControllers = new Map<AbortController, string>();
const prefixVersions = new Map<string, number>();
let cacheEpoch = 0;

function isDefaultCacheable(url: string): boolean {
  const path = url.split('?')[0];
  if (DEFAULT_CACHE_PATHS.has(path)) return true;
  return url.startsWith('/api/domains?') && /(?:^|[?&])basic=1(?:&|$)/.test(url);
}

function cacheVersion(url: string): string {
  const parts = [String(cacheEpoch)];
  for (const [prefix, version] of prefixVersions) {
    if (url.startsWith(prefix)) parts.push(`${prefix}#${version}`);
  }
  return parts.join('|');
}

// 写操作/登录态变更后中止相关 GET，避免旧响应在写完成后回写页面。
function abortInflightGets(prefix?: string): void {
  for (const [controller, key] of [...getControllers.entries()]) {
    if (prefix && !key.startsWith(prefix)) continue;
    controller.abort();
    getControllers.delete(controller);
  }
}

// 缓存超限时淘汰最旧的一批，避免无上限增长
function evictGetCache(): void {
  if (getCache.size < GET_CACHE_MAX) return;
  const drop = Math.max(1, Math.floor(GET_CACHE_MAX * 0.2));
  const entries = [...getCache.entries()].sort((a, b) => a[1].at - b[1].at);
  for (let i = 0; i < drop && i < entries.length; i++) getCache.delete(entries[i][0]);
}

/** 失效 GET 缓存：写操作后调用；传入前缀仅失效该前缀下的项，省略则整体清空。 */
export function invalidateApiCache(prefix?: string): void {
  if (!prefix) {
    cacheEpoch++;
    getCache.clear();
    inflight.clear();
    abortInflightGets();
    return;
  }
  prefixVersions.set(prefix, (prefixVersions.get(prefix) || 0) + 1);
  for (const key of [...getCache.keys()]) if (key.startsWith(prefix)) getCache.delete(key);
  for (const key of [...inflight.keys()]) if (key.startsWith(prefix)) inflight.delete(key);
  abortInflightGets(prefix);
}

function writeInvalidationPrefixes(url: string): string[] | null {
  const path = url.split('?')[0];
  if (/^\/cdn\/accounts(?:\/|$)/.test(path)) return ['/api/cdn/accounts', '/api/cdn/zones', '/api/cdn/domains'];
  if (/^\/cdn\/domains(?:\/|$)/.test(path)) return ['/api/cdn/domains', '/api/cdn/zones', '/api/domains'];
  if (/^\/cdn\/zones(?:\/|$)/.test(path)) return ['/api/cdn/zones', '/api/cdn/domains'];
  if (/^\/domains(?:\/|$)/.test(path)) return ['/api/domains'];
  if (/^\/dns\/accounts(?:\/|$)/.test(path)) return ['/api/dns/accounts', '/api/domains'];
  if (/^\/cert\/accounts(?:\/|$)/.test(path)) return ['/api/cert/accounts'];
  return null;
}

function invalidateAfterWrite(url: string): void {
  const prefixes = writeInvalidationPrefixes(url);
  if (!prefixes) {
    invalidateApiCache();
    return;
  }
  for (const prefix of prefixes) invalidateApiCache(prefix);
}

export async function api<T = any>(method: string, url: string, body?: any, opts: ApiOptions = {}): Promise<T> {
  const upper = String(method || 'GET').toUpperCase();
  const isGet = upper === 'GET';
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;

  let fullUrl = '/api' + url;
  let payload: string | undefined;
  if (isGet && body) {
    const qs = new URLSearchParams();
    // 参数按 key 排序生成 canonical key，避免同一组参数因对象属性顺序不同而重复请求。
    for (const [k, v] of Object.entries(body).filter(([, v]) => v !== undefined && v !== null && v !== '').sort(([a], [b]) => a.localeCompare(b))) {
      qs.set(k, String(v));
    }
    if (qs.toString()) fullUrl += (url.includes('?') ? '&' : '?') + qs.toString();
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const ttl =
    opts.cache === true
      ? GET_DEFAULT_TTL
      : typeof opts.cache === 'number'
        ? opts.cache
        : opts.cache === false
          ? 0
          : isGet && isDefaultCacheable(fullUrl)
            ? GET_DEFAULT_TTL
            : 0;
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
    // 避免后端僵死时 fetch 永不 settle，导致各页 loading 永久转圈。
    // 备份导出/恢复可能超过 2 分钟，调用方显式传 timeout: 0 关闭超时。
    const timeoutMs = opts.timeout === 0 ? 0 : (opts.timeout ?? 120000);
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : null;
    const onAbort = () => controller.abort();
    if (opts.signal) {
      if (opts.signal.aborted) {
        if (timer) clearTimeout(timer);
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
      opts.signal.addEventListener('abort', onAbort);
    }
    if (isGet) getControllers.set(controller, cacheKey);
    let res: Response;
    try {
      res = await fetch(fullUrl, { method: upper, headers, body: payload, signal: controller.signal });
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        if (opts.signal?.aborted) throw e; // 调用方主动取消，交由调用方处理
        if (timedOut) return { code: -1, msg: '请求超时，请稍后重试' } as T;
        throw e; // 写操作/登录态变更导致的中止：交给上层丢弃旧响应
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      if (isGet) getControllers.delete(controller);
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
      // 权限被后台调整后本地用户对象可能过期：403 时刷新一次用户信息，避免「能进页面但接口全 403」
      if (res.status === 403) refreshMe();
      return json as T;
    } catch {
      return { code: -1, msg: `服务器响应异常（HTTP ${res.status}）` } as T;
    }
  };

  let epochAtStart = cacheVersion(fullUrl);
  let task!: Promise<T>;
  task = (async (): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const data = await doFetch();
        // 相关资源在请求期间被写操作失效时，不把旧结果交给调用方。
        if (isGet && cacheVersion(fullUrl) !== epochAtStart) {
          const replacement = inflight.get(cacheKey);
          if (replacement && replacement !== task) return replacement;
          if (attempt < 2) {
            epochAtStart = cacheVersion(fullUrl);
            continue;
          }
          throw Object.assign(new Error('stale'), { name: 'AbortError' });
        }
        if (isGet && ttl > 0 && (data as any)?.code === 0) {
          evictGetCache();
          getCache.set(cacheKey, { at: Date.now(), data });
        }
        return data;
      } catch (e: any) {
        if (isGet && e?.name === 'AbortError') {
          const replacement = inflight.get(cacheKey);
          if (replacement && replacement !== task) return replacement;
          // 写操作会主动中止相关在途 GET：在调用方未取消的前提下自动重试新数据
          if (!opts.signal?.aborted && cacheVersion(fullUrl) !== epochAtStart && attempt < 2) {
            epochAtStart = cacheVersion(fullUrl);
            continue;
          }
        }
        throw e;
      }
    }
  })();

  if (isGet && !opts.signal && !opts.force) {
    inflight.set(cacheKey, task);
    task.finally(() => {
      // 写操作可能已清空 inflight 并加入同 key 的新请求，只删除自己这一项。
      if (inflight.get(cacheKey) === task) inflight.delete(cacheKey);
    }).catch(() => {});
  } else if (!isGet) {
    // 写操作成功后失效 GET 缓存，保证后续读取拿到最新数据
    task.then((data) => { if ((data as any)?.code === 0) invalidateAfterWrite(url); }).catch(() => {});
  }
  return task;
}

// 401/403 后刷新本地用户对象（含 level / stat_cache），使菜单与路由准入与后端一致
let meRefreshing = false;
let meAbort: AbortController | null = null;
function refreshMe(): void {
  if (meRefreshing || !getToken()) return;
  meRefreshing = true;
  const ctrl = new AbortController();
  meAbort?.abort();
  meAbort = ctrl;
  const timer = setTimeout(() => ctrl.abort(), 5000);
  fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + getToken() }, signal: ctrl.signal })
    .then((r) => (r.ok ? r.json() : null))
    .then((res) => {
      if (res && res.code === 0 && res.data) setUser(res.data);
    })
    .catch(() => undefined)
    .finally(() => {
      clearTimeout(timer);
      if (meAbort === ctrl) meAbort = null;
      meRefreshing = false;
    });
}
// 其它标签页登录/登出/切换账号：storage 事件只在非当前标签页触发，
// 清空本标签页的 GET 缓存并通知 Pinia 同步 token/user，避免旧账号数据继续渲染。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (ev: StorageEvent) => {
    if (ev.key !== TOKEN_KEY && ev.key !== USER_KEY && ev.key !== null) return;
    cacheEpoch++;
    getCache.clear();
    inflight.clear();
    abortInflightGets();
    meAbort?.abort();
    window.dispatchEvent(
      new CustomEvent('dnsmgr:auth-storage', { detail: { token: getToken(), user: getUser() } }),
    );
  });
}
