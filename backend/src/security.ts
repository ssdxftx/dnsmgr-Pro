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

const IMMUTABLE = 'public, max-age=31536000, immutable';
const SHORT_PUBLIC = 'public, max-age=86400';
const REVALIDATE = 'no-cache';
const NO_STORE = 'no-store, no-cache, must-revalidate';

function isHashedAsset(url: string): boolean {
  return /^\/assets\/.+\.[a-z0-9]+$/i.test(url);
}

function isDocument(url: string): boolean {
  return url === '/' || url.endsWith('.html') || !/\.[a-z0-9]{2,5}$/i.test(url);
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
    if (hsts) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    const url = String(req.raw.url || '').split('?')[0];
    if (url.startsWith('/api/')) {
      reply.header('Cache-Control', NO_STORE);
      reply.header('Pragma', 'no-cache');
      reply.header('CDN-Cache-Control', 'no-store');
    } else if (isHashedAsset(url)) {
      reply.header('Cache-Control', IMMUTABLE);
      reply.header('CDN-Cache-Control', IMMUTABLE);
    } else if (isDocument(url)) {
      reply.header('Cache-Control', REVALIDATE);
      reply.header('CDN-Cache-Control', REVALIDATE);
    } else {
      reply.header('Cache-Control', SHORT_PUBLIC);
      reply.header('CDN-Cache-Control', SHORT_PUBLIC);
    }

    const contentType = String(reply.getHeader('content-type') || '');
    if (contentType.includes('text/html')) {
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