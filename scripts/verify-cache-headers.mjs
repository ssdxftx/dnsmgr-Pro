/**
 * 缓存头分层逻辑一致性校验（独立实现，与 security.ts 保持同源规则）
 * 运行：node scripts/verify-cache-headers.mjs
 */
import assert from 'node:assert/strict';

// —— 与 backend/src/security.ts 保持一致的规则常量 ——
const IMMUTABLE = 'public, max-age=31536000, immutable, stale-while-revalidate=86400, stale-if-error=604800';
const SHORT_PUBLIC = 'public, max-age=604800, stale-while-revalidate=86400, stale-if-error=604800';
const REVALIDATE = 'no-cache, must-revalidate, stale-while-revalidate=120, stale-if-error=86400';
const NO_STORE = 'no-store, no-cache, must-revalidate';
const CDN_IMMUTABLE = 'public, s-maxage=31536000, immutable, stale-while-revalidate=86400, stale-if-error=604800';
const CDN_ROOT_STATIC = 'public, s-maxage=2592000, immutable, stale-while-revalidate=604800, stale-if-error=604800';
const CDN_DOCUMENT = 'public, s-maxage=60, stale-while-revalidate=600, stale-if-error=86400';
const CDN_NO_STORE = 'no-store';

const PUBLIC_API_CACHE = {
  '/api/health': { browser: 'public, max-age=10, stale-while-revalidate=30', cdn: 'public, s-maxage=10, stale-while-revalidate=30' },
  '/api/setup/status': { browser: 'public, max-age=5, stale-while-revalidate=20', cdn: 'public, s-maxage=5, stale-while-revalidate=20' },
  '/api/register/config': { browser: 'public, max-age=60, stale-while-revalidate=300', cdn: 'public, s-maxage=300, stale-while-revalidate=900' },
};

const isHashedAsset = (u) => /^\/assets\/.+\.[a-z0-9]+$/i.test(u);
const ROOT_STATIC_EXT = /\.(?:webp|avif|png|jpe?g|gif|svg|ico|bmp|woff2?|ttf|otf|eot|txt|xml|webmanifest|json|map)$/i;
const isDocument = (u) => u === '/' || u.endsWith('.html') || !/\.[a-z0-9]{2,5}$/i.test(u);

function classify(url, method = 'GET', cdnEnabled = true) {
  const cdnCacheEnabled = cdnEnabled;
  const setCache = (browser, cdn) => ({ cacheControl: browser, cdnCacheControl: cdnCacheEnabled && cdn ? cdn : browser });
  if (url.startsWith('/api/')) {
    const pub = method === 'GET' ? PUBLIC_API_CACHE[url] : undefined;
    return pub ? setCache(pub.browser, pub.cdn) : { cacheControl: NO_STORE, cdnCacheControl: CDN_NO_STORE };
  }
  if (isHashedAsset(url) || ROOT_STATIC_EXT.test(url)) return setCache(IMMUTABLE, CDN_IMMUTABLE);
  if (isDocument(url)) return setCache(REVALIDATE, CDN_DOCUMENT);
  return setCache(SHORT_PUBLIC, CDN_ROOT_STATIC);
}

// —— 断言用例 ——
const cases = [
  // [描述, url, method, 期望 Cache-Control 包含, 期望 CDN-Cache-Control 包含]
  ['带哈希 JS 产物', '/assets/index-DPXeUccr.js', 'GET', 'max-age=31536000, immutable', 's-maxage=31536000, immutable'],
  ['带哈希 CSS 产物', '/assets/index-tWYFlDC2.css', 'GET', 'max-age=31536000, immutable', 's-maxage=31536000, immutable'],
  ['带哈希字体', '/assets/font-ChakraPetch-a1b2c3d4.woff2', 'GET', 'max-age=31536000, immutable', 's-maxage=31536000, immutable'],
  ['根静态 favicon', '/favicon.webp', 'GET', 'max-age=31536000, immutable', 's-maxage=31536000, immutable'],
  ['根静态 robots', '/robots.txt', 'GET', 'max-age=31536000, immutable', 's-maxage=31536000, immutable'],
  ['根静态 manifest', '/manifest.webmanifest', 'GET', 'max-age=31536000, immutable', 's-maxage=31536000, immutable'],
  ['首页 HTML', '/', 'GET', 'no-cache, must-revalidate', 's-maxage=60'],
  ['index.html', '/index.html', 'GET', 'no-cache, must-revalidate', 's-maxage=60'],
  ['SPA 回退路由', '/domains/12/records', 'GET', 'no-cache, must-revalidate', 's-maxage=60'],
  ['受保护业务接口', '/api/domain/list', 'GET', 'no-store', 'no-store'],
  ['公开健康检查', '/api/health', 'GET', 'max-age=10', 's-maxage=10'],
  ['非 GET 公开接口', '/api/health', 'POST', 'no-store', 'no-store'],
];

let pass = 0;
let fail = 0;

console.log('\n=== 缓存头分层校验 ===\n');
for (const [desc, url, method, wantCC, wantCDN] of cases) {
  const got = classify(url, method);
  try {
    assert.ok(got.cacheControl.includes(wantCC), `Cache-Control 期望含 "${wantCC}"，实际 "${got.cacheControl}"`);
    assert.ok(got.cdnCacheControl.includes(wantCDN), `CDN-Cache-Control 期望含 "${wantCDN}"，实际 "${got.cdnCacheControl}"`);
    pass++;
    console.log(`  ✅ ${desc.padEnd(16)} ${url}`);
    console.log(`     Cache-Control:     ${got.cacheControl}`);
    console.log(`     CDN-Cache-Control: ${got.cdnCacheControl}`);
  } catch (e) {
    fail++;
    console.log(`  ❌ ${desc.padEnd(16)} ${url}`);
    console.log(`     ${e.message}`);
  }
}

// 回退开关验证
console.log('\n=== DNSMGR_CDN_CACHE=0 回退行为 ===\n');
const off = classify('/assets/index-DPXeUccr.js', 'GET', false);
try {
  assert.equal(off.cacheControl, off.cdnCacheControl, '回退时两者应完全一致');
  console.log('  ✅ 回退后 Cache-Control 与 CDN-Cache-Control 同值（旧行为）');
  console.log(`     两者均为: ${off.cacheControl}`);
  pass++;
} catch (e) {
  fail++;
  console.log(`  ❌ ${e.message}`);
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail === 0 ? 0 : 1);
