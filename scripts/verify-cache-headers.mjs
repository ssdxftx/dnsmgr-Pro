/**
 * 缓存头分层逻辑一致性校验（独立实现，与 security.ts 保持同源规则）
 * 运行：node scripts/verify-cache-headers.mjs
 */
import assert from 'node:assert/strict';

// —— 与 backend/src/security.ts 保持一致的规则常量 ——
const IMMUTABLE = 'public, max-age=31536000, immutable, stale-while-revalidate=86400, stale-if-error=604800';
const ROOT_STATIC = 'public, max-age=2592000, stale-while-revalidate=604800, stale-if-error=604800';
const SHORT_PUBLIC = 'public, max-age=86400, stale-while-revalidate=86400, stale-if-error=604800';
const REVALIDATE = 'public, max-age=0, must-revalidate';
const DOCUMENT = 'public, max-age=0, s-maxage=60, must-revalidate';
const NO_STORE = 'no-store, no-cache, must-revalidate';
const SERVICE_WORKER = 'no-cache, max-age=0, must-revalidate';
const CDN_IMMUTABLE = 'public, s-maxage=31536000, immutable, stale-while-revalidate=86400, stale-if-error=604800';
const CDN_ROOT_STATIC = 'public, s-maxage=2592000, stale-while-revalidate=604800, stale-if-error=604800';
const CDN_SHORT_PUBLIC = 'public, s-maxage=604800, stale-while-revalidate=86400, stale-if-error=604800';
const CDN_DOCUMENT = 'public, s-maxage=60, stale-while-revalidate=60, stale-if-error=300';
const CDN_NO_STORE = 'no-store';

const PUBLIC_API_CACHE = {
  '/api/health': { browser: 'public, max-age=10, stale-while-revalidate=30', cdn: 'public, s-maxage=10, stale-while-revalidate=30' },
  '/api/setup/status': { browser: 'public, max-age=5, stale-while-revalidate=20', cdn: 'public, s-maxage=5, stale-while-revalidate=20' },
  '/api/register/config': { browser: 'public, max-age=60, stale-while-revalidate=300', cdn: 'public, s-maxage=300, stale-while-revalidate=900' },
};

const isHashedAsset = (u) => /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i.test(u);
const ROOT_STATIC_EXT = /\.(?:webp|avif|png|jpe?g|gif|svg|ico|bmp|wasm|woff2?|ttf|otf|eot|txt|xml|webmanifest)$/i;
const isRootStatic = (u) => !u.startsWith('/assets/') && ROOT_STATIC_EXT.test(u);
const isServiceWorker = (u) => /^\/(?:sw|service-worker|serviceworker|firebase-messaging-sw|workbox-[^/]+)\.js$/i.test(u);
const isDocument = (u) => u === '/' || /\.html?$/i.test(u) || !/\.[a-z0-9]{2,5}$/i.test(u);

function maxAgeSeconds(value) {
  const m = /\b(?:s-maxage|max-age)=(\d+)/i.exec(value);
  return m ? Number(m[1]) : 0;
}

function classify(url, method = 'GET', cdnEnabled = true) {
  const setCache = (browser, cdn) => {
    const edge = cdnEnabled && cdn ? cdn : browser;
    const sec = maxAgeSeconds(edge);
    return {
      cacheControl: browser,
      cdnCacheControl: edge,
      surrogateControl: edge.replace(/\bs-maxage=/gi, 'max-age='),
      edgeControl: sec > 0 ? `max-age=${sec}` : 'no-store',
      hasExpires: sec > 0,
      xAccelExpires: String(sec),
    };
  };
  const noStore = () => ({ ...setCache(NO_STORE, CDN_NO_STORE), pragma: 'no-cache' });
  if (url === '/api' || url.startsWith('/api/')) {
    const pub = (method === 'GET' || method === 'HEAD') ? PUBLIC_API_CACHE[url] : undefined;
    return pub ? setCache(pub.browser, pub.cdn) : noStore();
  }
  if (isServiceWorker(url)) return { ...setCache(SERVICE_WORKER, CDN_NO_STORE), pragma: 'no-cache' };
  if (isHashedAsset(url)) return setCache(IMMUTABLE, CDN_IMMUTABLE);
  if (isRootStatic(url)) return setCache(ROOT_STATIC, CDN_ROOT_STATIC);
  if (isDocument(url)) return setCache(cdnEnabled ? DOCUMENT : REVALIDATE, CDN_DOCUMENT);
  return setCache(SHORT_PUBLIC, CDN_SHORT_PUBLIC);
}

// —— 断言用例 ——
// [描述, url, method, 期望 Cache-Control 包含, 期望 CDN-Cache-Control 包含, 额外断言]
const cases = [
  ['带哈希 JS 产物', '/assets/index-DPXeUccr.js', 'GET', 'max-age=31536000, immutable', 's-maxage=31536000, immutable', (r) => assert.equal(r.xAccelExpires, '31536000')],
  ['带哈希 CSS 产物', '/assets/index-tWYFlDC2.css', 'GET', 'max-age=31536000, immutable', 's-maxage=31536000, immutable', (r) => assert.match(r.surrogateControl, /max-age=31536000/)],
  ['带哈希字体', '/assets/font-ChakraPetch-a1b2c3d4.woff2', 'GET', 'max-age=31536000, immutable', 's-maxage=31536000, immutable', () => {}],
  ['根静态 favicon', '/favicon.webp', 'GET', 'max-age=2592000', 's-maxage=2592000', () => {}],
  ['根静态 robots', '/robots.txt', 'GET', 'max-age=2592000', 's-maxage=2592000', () => {}],
  ['根静态 manifest', '/manifest.webmanifest', 'GET', 'max-age=2592000', 's-maxage=2592000', () => {}],
  ['首页 HTML', '/', 'GET', 'public, max-age=0, s-maxage=60', 's-maxage=60', (r) => assert.equal(r.xAccelExpires, '60')],
  ['index.html', '/index.html', 'GET', 'public, max-age=0, s-maxage=60', 's-maxage=60', () => {}],
  ['.htm 文档', '/legacy.htm', 'GET', 'public, max-age=0, s-maxage=60', 's-maxage=60', () => {}],
  ['SPA 回退路由', '/domains/12/records', 'GET', 'public, max-age=0, s-maxage=60', 's-maxage=60', (r) => assert.match(r.surrogateControl, /max-age=60/)],
  ['Service Worker', '/sw.js', 'GET', 'no-cache, max-age=0', 'no-store', (r) => assert.equal(r.xAccelExpires, '0')],
  ['受保护业务接口', '/api/domain/list', 'GET', 'no-store', 'no-store', (r) => assert.equal(r.xAccelExpires, '0')],
  ['公开健康检查 GET', '/api/health', 'GET', 'max-age=10', 's-maxage=10', () => {}],
  ['公开健康检查 HEAD', '/api/health', 'HEAD', 'max-age=10', 's-maxage=10', () => {}],
  ['非 GET 公开接口', '/api/health', 'POST', 'no-store', 'no-store', () => {}],
  ['未哈希 /assets JS', '/assets/app.js', 'GET', 'max-age=86400', 's-maxage=604800', () => {}],
  ['根目录 JSON', '/config.json', 'GET', 'max-age=86400', 's-maxage=604800', () => {}],
];

let pass = 0;
let fail = 0;

console.log('\n=== 缓存头分层校验 ===\n');
for (const [desc, url, method, wantCC, wantCDN, extra] of cases) {
  const got = classify(url, method);
  try {
    assert.ok(got.cacheControl.includes(wantCC), `Cache-Control 期望含 "${wantCC}"，实际 "${got.cacheControl}"`);
    assert.ok(got.cdnCacheControl.includes(wantCDN), `CDN-Cache-Control 期望含 "${wantCDN}"，实际 "${got.cdnCacheControl}"`);
    extra(got);
    pass++;
    console.log(`  PASS ${desc.padEnd(20)} ${url}`);
    console.log(`       Cache-Control:     ${got.cacheControl}`);
    console.log(`       CDN-Cache-Control: ${got.cdnCacheControl}`);
    console.log(`       Surrogate-Control: ${got.surrogateControl}`);
    console.log(`       Edge-Control:      ${got.edgeControl}`);
    console.log(`       X-Accel-Expires:   ${got.xAccelExpires}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${desc.padEnd(20)} ${url}`);
    console.log(`       ${e.message}`);
  }
}

// 回退开关验证
console.log('\n=== DNSMGR_CDN_CACHE=0 回退行为 ===\n');
const offAsset = classify('/assets/index-DPXeUccr.js', 'GET', false);
const offHtml = classify('/', 'GET', false);
try {
  assert.equal(offAsset.cacheControl, offAsset.cdnCacheControl, '资源回退时两者应完全一致');
  assert.equal(offHtml.cacheControl, offHtml.cdnCacheControl, 'HTML 回退时两者应完全一致');
  assert.ok(!offHtml.cacheControl.includes('s-maxage'), 'HTML 回退不应再带 s-maxage');
  console.log('  PASS 回退后 Cache-Control 与 CDN-Cache-Control 同值（旧行为）');
  console.log(`       资源: ${offAsset.cacheControl}`);
  console.log(`       HTML: ${offHtml.cacheControl}`);
  pass++;
} catch (e) {
  fail++;
  console.log(`  FAIL ${e.message}`);
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail === 0 ? 0 : 1);
