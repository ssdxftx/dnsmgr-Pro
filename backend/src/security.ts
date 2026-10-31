import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const HTML_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
].join('; ');

// 浏览器侧缓存策略（Cache-Control）
const IMMUTABLE = 'public, max-age=31536000, immutable, stale-while-revalidate=86400, stale-if-error=604800';
// 根目录公开静态文件（favicon / robots / manifest 等）：内容稳定但文件名不带哈希，给 30 天
const ROOT_STATIC = 'public, max-age=2592000, stale-while-revalidate=604800, stale-if-error=604800';
// 无法识别的内容：浏览器保守 1 天，CDN 侧再放宽到 7 天
const SHORT_PUBLIC = 'public, max-age=86400, stale-while-revalidate=86400, stale-if-error=604800';
// CDN 分层关闭时的 HTML 回退策略：浏览器与共享缓存都立即校验
const REVALIDATE = 'public, max-age=0, must-revalidate';
// 文档默认策略：浏览器立即校验；同时在 Cache-Control 内写 s-maxage，
// 让只认 Cache-Control、不认 CDN-Cache-Control 的 CDN（如 CloudFront）也能缓存边缘副本
const DOCUMENT = 'public, max-age=0, s-maxage=60, must-revalidate';
const NO_STORE = 'no-store, no-cache, must-revalidate';
// Service Worker 必须每次校验，避免旧 worker 长期驻留导致发版不生效
const SERVICE_WORKER = 'no-cache, max-age=0, must-revalidate';

// CDN 边缘侧缓存策略（CDN-Cache-Control）：可独立于浏览器更长，提升边缘命中率
const CDN_IMMUTABLE = 'public, s-maxage=31536000, immutable, stale-while-revalidate=86400, stale-if-error=604800';
const CDN_ROOT_STATIC = 'public, s-maxage=2592000, stale-while-revalidate=604800, stale-if-error=604800';
const CDN_SHORT_PUBLIC = 'public, s-maxage=604800, stale-while-revalidate=86400, stale-if-error=604800';
// 文档（index.html / SPA 回退）：CDN 短缓存，并允许在回源刷新时短暂使用旧副本
const CDN_DOCUMENT = 'public, s-maxage=60, stale-while-revalidate=60, stale-if-error=300';
const CDN_NO_STORE = 'no-store';

// 无需登录即可访问、且对所有访客一致的只读接口，可交由 CDN/浏览器短时缓存
// 形如 { browser, cdn }：浏览器短缓存，CDN 边缘可缓存更久
const PUBLIC_API_CACHE: Record<string, { browser: string; cdn: string }> = {
  '/api/health': { browser: 'public, max-age=10, stale-while-revalidate=30', cdn: 'public, s-maxage=10, stale-while-revalidate=30' },
  '/api/setup/status': { browser: 'public, max-age=5, stale-while-revalidate=20', cdn: 'public, s-maxage=5, stale-while-revalidate=20' },
  '/api/register/config': { browser: 'public, max-age=60, stale-while-revalidate=300', cdn: 'public, s-maxage=300, stale-while-revalidate=900' },
};

// 只把 Vite 生成、文件名带内容哈希的产物视为不可变资源；普通 /assets/foo.js 不享受一年缓存
function isHashedAsset(url: string): boolean {
  return /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i.test(url);
}

// 根目录下内容固定的静态文件（favicon / robots / manifest / 字体等）：可较长缓存。
// 不包含 js/css/json/map，避免把根路径下未带哈希的脚本或动态文件误判为长期缓存。
const ROOT_STATIC_EXT = /\.(?:webp|avif|png|jpe?g|gif|svg|ico|bmp|wasm|woff2?|ttf|otf|eot|txt|xml|webmanifest)$/i;

function isRootStatic(url: string): boolean {
  return !url.startsWith('/assets/') && ROOT_STATIC_EXT.test(url);
}

// Service Worker 及其 workbox 运行时必须走校验，不能沿用普通 .js 的缓存策略
function isServiceWorker(url: string): boolean {
  return /^\/(?:sw|service-worker|serviceworker|firebase-messaging-sw|workbox-[^/]+)\.js$/i.test(url);
}

function isDocument(url: string): boolean {
  return url === '/' || /\.html?$/i.test(url) || !/\.[a-z0-9]{2,5}$/i.test(url);
}

// CDN 缓存优化总开关，排障时可经 DNSMGR_CDN_CACHE=0 回退为「浏览器与 CDN 同值」的旧行为
const CDN_CACHE_ENABLED = (process.env.DNSMGR_CDN_CACHE || '').trim() !== '0';

function maxAgeSeconds(value: string): number {
  const m = /\b(?:s-maxage|max-age)=(\d+)/i.exec(value);
  return m ? Number(m[1]) : 0;
}

function appendVary(reply: FastifyReply, token: string): void {
  const raw = reply.getHeader('vary');
  const value = Array.isArray(raw) ? raw.join(', ') : String(raw || '');
  if (value.trim() === '*') return;
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.some((p) => p.toLowerCase() === token.toLowerCase())) parts.push(token);
  reply.header('Vary', parts.join(', '));
}

/**
 * 写入缓存头。浏览器侧用 Cache-Control，CDN 边缘侧用 CDN-Cache-Control；
 * 两者可不同值，便于让 CDN 缓存更久而不拖长浏览器侧的陈旧时间。
 * 同时补 Surrogate-Control（Fastly/Varnish）、Edge-Control（Akamai）、
 * Expires（HTTP/1.0 代理）与 X-Accel-Expires（Nginx proxy_cache），
 * 覆盖不读取 CDN-Cache-Control 的缓存层。
 */
function setCache(reply: FastifyReply, browser: string, cdn?: string) {
  const edge = CDN_CACHE_ENABLED && cdn ? cdn : browser;
  reply.header('Cache-Control', browser);
  reply.header('CDN-Cache-Control', edge);
  reply.header('Surrogate-Control', edge.replace(/\bs-maxage=/gi, 'max-age='));
  const sec = maxAgeSeconds(edge);
  // Akamai 使用 Edge-Control 控制边缘 TTL；其他 CDN 会忽略该头
  reply.header('Edge-Control', sec > 0 ? `max-age=${sec}` : 'no-store');
  if (sec > 0) {
    reply.header('Expires', new Date(Date.now() + sec * 1000).toUTCString());
    reply.header('X-Accel-Expires', String(sec));
  } else {
    reply.removeHeader('Expires');
    reply.header('X-Accel-Expires', '0');
  }
}

function setNoStore(reply: FastifyReply) {
  setCache(reply, NO_STORE, CDN_NO_STORE);
  reply.header('Pragma', 'no-cache');
}

export function applySecurityHeaders(app: FastifyInstance): void {
  const hsts = process.env.DNSMGR_HSTS !== '0';

  app.addHook('onSend', async (req: FastifyRequest, reply: FastifyReply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    // 保留 compress / cors 等插件已写入的 Vary，避免覆盖后把 CORS 变体混进同一份缓存
    appendVary(reply, 'accept-encoding');
    const allowOrigin = String(reply.getHeader('access-control-allow-origin') || '');
    if (allowOrigin && allowOrigin !== '*') appendVary(reply, 'Origin');
    if (hsts) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    const url = String(req.raw.url || '').split('?')[0];
    const apiUrl = url.toLowerCase();
    const contentType = String(reply.getHeader('content-type') || '');
    const isHtml = contentType.includes('text/html');
    const cacheableMethod = req.method === 'GET' || req.method === 'HEAD';

    // 域名快捷登录页内含一次性会话令牌，禁止任何浏览器/CDN 缓存
    if (apiUrl === '/quicklogin') {
      setNoStore(reply);
      reply.header('Pragma', 'no-cache');
    } else if (reply.statusCode >= 400) {
      // 错误响应一律不可缓存：避免 4xx/5xx（含未命中静态资源回退）被 CDN/浏览器缓存
      setNoStore(reply);
    } else if (apiUrl === '/api' || apiUrl.startsWith('/api/')) {
      const publicCache = cacheableMethod ? PUBLIC_API_CACHE[apiUrl] : undefined;
      if (publicCache) {
        setCache(reply, publicCache.browser, publicCache.cdn);
      } else {
        setNoStore(reply);
      }
    } else if (isServiceWorker(url)) {
      // Service Worker 不参与长缓存，否则发版后旧 worker 可能长期接管页面
      setCache(reply, SERVICE_WORKER, CDN_NO_STORE);
      reply.header('Pragma', 'no-cache');
    } else if (isHashedAsset(url)) {
      // 带哈希的构建产物：内容变更即换名，浏览器与 CDN 均可长缓一年且 immutable
      setCache(reply, IMMUTABLE, CDN_IMMUTABLE);
    } else if (isRootStatic(url)) {
      // 根目录公开静态文件：文件名不带哈希，30 天后重新校验，避免 favicon/manifest 永久陈旧
      setCache(reply, ROOT_STATIC, CDN_ROOT_STATIC);
    } else if (isHtml || isDocument(url)) {
      // 文档：浏览器立即校验；CDN 短缓存，并在 Cache-Control 中带 s-maxage 兼容只认该头的 CDN
      setCache(reply, CDN_CACHE_ENABLED ? DOCUMENT : REVALIDATE, CDN_DOCUMENT);
    } else {
      // 其余未知资源：浏览器 1 天，CDN 7 天
      setCache(reply, SHORT_PUBLIC, CDN_SHORT_PUBLIC);
    }

    if (isHtml && !reply.hasHeader('Content-Security-Policy')) {
      reply.header('Content-Security-Policy', HTML_CSP);
    }
    return payload;
  });
}

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
}

export function createRateLimit(opts: RateLimitOptions = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 30;
  // 桶数量上限，防止大量不同来源 IP 持续写入 Map 撑爆内存
  const maxBuckets = Number(process.env.DNSMGR_RATELIMIT_MAX_BUCKETS || 50_000);
  const buckets = new Map<string, { count: number; reset: number }>();
  let lastSweep = Date.now();

  return async function rateLimit(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
      lastSweep = now;
    }
    // 容量保护：超限时先清理过期项，仍超限则按插入顺序淘汰最旧项
    if (buckets.size >= maxBuckets) {
      for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
      while (buckets.size >= maxBuckets) {
        const oldest = buckets.keys().next().value;
        if (oldest === undefined) break;
        buckets.delete(oldest);
      }
    }
    const key = req.ip || 'unknown';
    let bucket = buckets.get(key);
    if (!bucket || bucket.reset <= now) {
      bucket = { count: 0, reset: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      reply.header('Retry-After', String(Math.max(1, Math.ceil((bucket.reset - now) / 1000))));
      reply.code(429).send({ code: -1, msg: '请求过于频繁，请稍后再试' });
      return reply;
    }
    return undefined;
  };
}