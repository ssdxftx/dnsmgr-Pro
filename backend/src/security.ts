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
const SHORT_PUBLIC = 'public, max-age=604800, stale-while-revalidate=86400, stale-if-error=604800';
const REVALIDATE = 'no-cache, must-revalidate, stale-while-revalidate=120, stale-if-error=86400';
const NO_STORE = 'no-store, no-cache, must-revalidate';

// CDN 边缘侧缓存策略（CDN-Cache-Control）：可独立于浏览器更长，提升边缘命中率
const CDN_IMMUTABLE = 'public, s-maxage=31536000, immutable, stale-while-revalidate=86400, stale-if-error=604800';
const CDN_ROOT_STATIC = 'public, s-maxage=2592000, immutable, stale-while-revalidate=604800, stale-if-error=604800';
// 文档（index.html / SPA 回退）：CDN 可短缓存并按 stale-while-revalidate 异步回源刷新，浏览器仍以 no-cache 强校验
const CDN_DOCUMENT = 'public, s-maxage=60, stale-while-revalidate=600, stale-if-error=86400';
const CDN_NO_STORE = 'no-store';

// 无需登录即可访问、且对所有访客一致的只读接口，可交由 CDN/浏览器短时缓存
// 形如 { browser, cdn }：浏览器短缓存，CDN 边缘可缓存更久
const PUBLIC_API_CACHE: Record<string, { browser: string; cdn: string }> = {
  '/api/health': { browser: 'public, max-age=10, stale-while-revalidate=30', cdn: 'public, s-maxage=10, stale-while-revalidate=30' },
  '/api/setup/status': { browser: 'public, max-age=5, stale-while-revalidate=20', cdn: 'public, s-maxage=5, stale-while-revalidate=20' },
  '/api/register/config': { browser: 'public, max-age=60, stale-while-revalidate=300', cdn: 'public, s-maxage=300, stale-while-revalidate=900' },
};

// 带内容哈希的构建产物目录：内容变更即换名，可安全长缓存
function isHashedAsset(url: string): boolean {
  return /^\/assets\/.+\.[a-z0-9]+$/i.test(url);
}

// 根目录下内容固定的静态文件（favicon / robots / manifest 等）：可强缓存
const ROOT_STATIC_EXT = /\.(?:webp|avif|png|jpe?g|gif|svg|ico|bmp|woff2?|ttf|otf|eot|txt|xml|webmanifest|json|map)$/i;

function isDocument(url: string): boolean {
  return url === '/' || url.endsWith('.html') || !/\.[a-z0-9]{2,5}$/i.test(url);
}

// CDN 缓存优化总开关，排障时可经 DNSMGR_CDN_CACHE=0 回退为「浏览器与 CDN 同值」的旧行为
const CDN_CACHE_ENABLED = (process.env.DNSMGR_CDN_CACHE || '').trim() !== '0';

/**
 * 写入缓存头。浏览器侧用 Cache-Control，CDN 边缘侧用 CDN-Cache-Control；
 * 两者可不同值，便于让 CDN 缓存更久而不拖长浏览器侧的陈旧时间。
 * 同时对可长缓存的响应补 Expires（供不支持 Cache-Control 的边缘/代理识别）。
 */
function setCache(reply: FastifyReply, browser: string, cdn?: string) {
  const edge = CDN_CACHE_ENABLED && cdn ? cdn : browser;
  reply.header('Cache-Control', browser);
  reply.header('CDN-Cache-Control', edge);
  const isNoStore = /no-store|no-cache|must-revalidate/.test(browser);
  if (!isNoStore) {
    const m = /(?:s-max-age|max-age)=(\d+)/.exec(browser);
    const sec = m ? Number(m[1]) : 0;
    if (sec > 0) reply.header('Expires', new Date(Date.now() + sec * 1000).toUTCString());
  }
}

export function applySecurityHeaders(app: FastifyInstance): void {
  const hsts = process.env.DNSMGR_HSTS !== '0';
  // CDN 缓存优化总开关，排障时可经 DNSMGR_CDN_CACHE=0 回退为「浏览器与 CDN 同值」的旧行为
  const cdnCacheEnabled = (process.env.DNSMGR_CDN_CACHE || '').trim() !== '0';

  app.addHook('onSend', async (req: FastifyRequest, reply: FastifyReply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    reply.header('Vary', 'Accept-Encoding');
    if (hsts) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    const url = String(req.raw.url || '').split('?')[0];
    const contentType = String(reply.getHeader('content-type') || '');
    const isHtml = contentType.includes('text/html');

    if (url.startsWith('/api/')) {
      const publicCache = req.method === 'GET' ? PUBLIC_API_CACHE[url] : undefined;
      if (publicCache) {
        setCache(reply, publicCache.browser, publicCache.cdn);
      } else {
        reply.header('Cache-Control', NO_STORE);
        reply.header('Pragma', 'no-cache');
        reply.header('CDN-Cache-Control', CDN_NO_STORE);
      }
    } else if (isHashedAsset(url) || ROOT_STATIC_EXT.test(url)) {
      // 带哈希的构建产物：内容变更即换名，浏览器与 CDN 均可长缓一年且 immutable
      setCache(reply, IMMUTABLE, CDN_IMMUTABLE);
    } else if (isHtml || isDocument(url)) {
      // 文档：浏览器强校验保证发版即时生效；CDN 边缘短缓存 + 异步回源，显著提升边缘命中率
      setCache(reply, REVALIDATE, CDN_DOCUMENT);
    } else {
      // 其余未知资源：保守地给短公共缓存，CDN 侧可较久
      setCache(reply, SHORT_PUBLIC, CDN_ROOT_STATIC);
    }

    if (isHtml) {
      reply.header('Content-Security-Policy', HTML_CSP);
    }
    return payload;
  });

  // 协商缓存：对已长缓存的带哈希资源与根静态文件返回 304，减少回源流量
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!cdnCacheEnabled) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') return;
    const url = String(req.raw.url || '').split('?')[0];
    if (url.startsWith('/api/')) return;
    if (!isHashedAsset(url) && !ROOT_STATIC_EXT.test(url)) return;
    const etag = String(reply.getHeader('etag') || '');
    const inm = String(req.headers['if-none-match'] || '');
    if (etag && inm && inm === etag) reply.code(304).send();
  });
}

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
}

export function createRateLimit(opts: RateLimitOptions = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 30;
  const buckets = new Map<string, { count: number; reset: number }>();
  let lastSweep = Date.now();

  return async function rateLimit(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
      lastSweep = now;
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