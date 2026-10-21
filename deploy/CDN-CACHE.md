# CDN 缓存接入与调优

应用后端（`backend/src/security.ts`）已经按资源类型下发分层缓存头。把域名接入 CDN 并让 CDN 遵循源站缓存头，即可获得较高命中率，发版通常无需手动刷缓存。

## 一、源站下发的缓存头

| 资源类型 | 路径示例 | `Cache-Control`（浏览器） | `CDN-Cache-Control`（边缘） | `X-Accel-Expires` |
|---|---|---|---|---|
| 带内容哈希的构建产物 | `/assets/index-DVh7-0k1.js`、`/assets/vendor-charts-*.js` | `public, max-age=31536000, immutable` | `public, s-maxage=31536000, immutable` | `31536000` |
| 根目录公开静态文件 | `/favicon.webp`、`/robots.txt`、`/manifest.webmanifest` | `public, max-age=2592000` | `public, s-maxage=2592000` | `2592000` |
| HTML 文档 / SPA 回退 | `/`、`/domains`、`/dashboard` | `public, max-age=0, s-maxage=60, must-revalidate` | `public, s-maxage=60, stale-while-revalidate=60, stale-if-error=300` | `60` |
| 公开只读接口 | `/api/health`、`/api/setup/status`、`/api/register/config` | `max-age=5~60` | `s-maxage=5~300` | 对应秒数 |
| 其余业务接口 | `/api/**` | `no-store, no-cache, must-revalidate` | `no-store` | `0` |
| Service Worker | `/sw.js`、`/service-worker.js`、`/workbox-*.js` | `no-cache, max-age=0, must-revalidate` | `no-store` | `0` |

除上述响应头外，源站还会：

- 对 HTML 和静态文件发送 `ETag` / `Last-Modified`，条件请求返回 `304`；
- 对可缓存响应发送 `Surrogate-Control`（Fastly/Varnish）、`Edge-Control`（Akamai）和 `Expires`（HTTP/1.0 代理）；
- 合并 `Vary`，保留 `Accept-Encoding` 与 CORS 场景下的 `Origin`，避免压缩或跨域变体混用同一份缓存。

### 关键设计

1. **HTML 同时写入 `s-maxage`**
   `Cache-Control` 为 `public, max-age=0, s-maxage=60, must-revalidate`。浏览器忽略 `s-maxage`，每次导航都会校验；只读取 `Cache-Control` 的 CDN（例如 CloudFront）仍可按 `s-maxage=60` 缓存边缘副本。

2. **CDN 专属头覆盖不同厂商**
   - 阿里云 CDN、腾讯云 CDN、Cloudflare 读取 `CDN-Cache-Control`；
   - Fastly/Varnish 读取 `Surrogate-Control`；
   - Akamai 读取 `Edge-Control`；
   - Nginx `proxy_cache` 读取 `X-Accel-Expires`；
   - 其他 CDN 回退到 `Cache-Control` 中的 `s-maxage`。

3. **HTML 的新鲜窗口保持短**
   HTML 边缘缓存 60 秒，允许 60 秒 `stale-while-revalidate`，`stale-if-error` 300 秒。发版后最多约 2 分钟仍可能拿到旧入口；旧入口引用的哈希资源通常仍在边缘缓存中。需要立即生效时只刷新根路径 `/` 一条即可。

4. **只给真正带哈希的资源一年缓存**
   `/assets/foo.js` 这类未带内容哈希的路径不会获得一年缓存，避免文件内容变化后长期陈旧。Service Worker 单独走 `no-cache` / CDN 不缓存。

## 二、CDN 后台需要开启的开关

1. **遵循源站缓存头**
   - 阿里云 CDN：`缓存配置 → 遵循源站`，并开启 `CDN-Cache-Control` 优先级。
   - 腾讯云 CDN：`缓存配置 → 遵循源站`，勾选「遵循源站 Cache-Control」，并开启优先遵循 `CDN-Cache-Control`。
   - Cloudflare：使用下方 Cache Rules，Edge TTL 选择遵循源站。
2. **不要开启「忽略源站缓存头、强制按扩展名缓存」**，否则会覆盖应用侧策略。
3. **开启 Brotli / Gzip 压缩**。源站已发送 `Vary: Accept-Encoding`，压缩与缓存可以共存。
4. **回源使用 HTTPS**，与源站 HSTS 策略一致。
5. **保留源站响应头**。反向代理不要删除 `Cache-Control`、`CDN-Cache-Control`、`Surrogate-Control`、`Edge-Control`、`X-Accel-Expires`、`ETag`、`Last-Modified`、`Vary`。

## 三、Cloudflare Cache Rules（推荐）

按顺序创建：

```text
规则 1：静态哈希产物
(http.request.uri.path matches "^/assets/.*-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$")
  -> Cache Eligibility: Eligible for cache
  -> Edge TTL: Use origin cache headers
  -> Browser TTL: Use origin cache headers
  -> Cache Key: ignore query string

规则 2：根目录公开静态文件
(http.request.uri.path matches "^/(favicon\.webp|robots\.txt|manifest\.webmanifest)$")
  -> Cache Eligibility: Eligible for cache
  -> Edge TTL: Use origin cache headers
  -> Browser TTL: Use origin cache headers

规则 3：公开只读接口
(http.request.uri.path in {"/api/health" "/api/setup/status" "/api/register/config"})
  -> Cache Eligibility: Eligible for cache
  -> Edge TTL: Use origin cache headers
  -> Browser TTL: Use origin cache headers

规则 4：HTML 与 SPA 回退
(http.request.uri.path starts_with "/" and not http.request.uri.path starts_with "/api/" and not http.request.uri.path matches "\.[a-z0-9]{2,5}$")
  -> Cache Eligibility: Eligible for cache
  -> Edge TTL: Use origin cache headers
  -> Browser TTL: Use origin cache headers

规则 5：其余接口
(http.request.uri.path starts_with "/api/")
  -> Cache Eligibility: Bypass cache
```

Cloudflare 会优先读取 `CDN-Cache-Control`，因此规则中的 “Use origin cache headers” 会得到 60 秒的 HTML 边缘缓存和一年期的哈希资源缓存。

## 四、CloudFront / Fastly / Akamai / Nginx

### CloudFront

CloudFront 不读取 `CDN-Cache-Control`，会使用 `Cache-Control` 中的 `s-maxage`。配置时：

- Cache policy 选择「Use origin cache control headers」或等效的遵循源站策略；
- 开启自动压缩；
- 不要给 `/api/*` 配置长 TTL；
- 如果使用自定义 Cache Policy，HTML 的 TTL 设为 60 秒，哈希资源设为一年，并把 `Authorization`、`Cookie` 排除出缓存键（公开接口不使用它们）。

### Fastly / Varnish

源站已发送 `Surrogate-Control: max-age=...`。在 VCL 中让 `beresp` 优先读取该头，例如：

```vcl
if (beresp.http.Surrogate-Control) {
  set beresp.http.Cache-Control = beresp.http.Surrogate-Control;
}
```

### Akamai

源站已发送 `Edge-Control: max-age=...`。在 Property Manager 中允许源站 `Edge-Control` 头，并确认缓存规则没有覆盖它。

### Nginx proxy_cache

应用已发送 `X-Accel-Expires`，Nginx 默认会按它设置缓存时间。推荐配置：

```nginx
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=dnsmgr:100m inactive=7d max_size=10g;

server {
    # 哈希资源：按 URI 缓存，忽略查询串，一年有效
    location ^~ /assets/ {
        proxy_pass http://127.0.0.1:8082;
        proxy_set_header Host $host;
        proxy_cache dnsmgr;
        proxy_cache_key $uri;
        proxy_cache_valid 200 365d;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        add_header X-Cache-Status $upstream_cache_status always;
    }

    # 根目录静态文件
    location ~* \.(?:webp|avif|png|jpe?g|gif|svg|ico|woff2?|ttf|otf|txt|xml|webmanifest)$ {
        proxy_pass http://127.0.0.1:8082;
        proxy_set_header Host $host;
        proxy_cache dnsmgr;
        proxy_cache_key $uri;
        proxy_cache_valid 200 30d;
        add_header X-Cache-Status $upstream_cache_status always;
    }

    # HTML 与 SPA 回退：短缓存，过期后回源校验 ETag
    location / {
        proxy_pass http://127.0.0.1:8082;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache dnsmgr;
        proxy_cache_valid 200 60s;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        add_header X-Cache-Status $upstream_cache_status always;
    }

    # Service Worker 不缓存，确保发版后立即更新
    location ~* ^/(?:sw|service-worker|serviceworker|workbox-[^/]+)\.js$ {
        proxy_pass http://127.0.0.1:8082;
        proxy_set_header Host $host;
        proxy_cache off;
    }

    # 接口默认不缓存（^~ 防止被上面的静态扩展名正则截获）
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:8082;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache off;
        proxy_no_cache 1;
        proxy_cache_bypass 1;
    }
}
```

不要配置 `proxy_ignore_headers Cache-Control Expires X-Accel-Expires`，否则会丢弃应用侧策略。经 Nginx 前置时设置 `DNSMGR_TRUST_PROXY=true`（或具体代理 IP/CIDR），让日志与限流拿到真实客户端 IP。

## 五、发版流程

```bash
git add <本次改动>
node scripts/release.mjs 1.10.2 "说明"
```

脚本会升级版本号、打标签并推送，触发镜像构建。前端产物文件名中的哈希随内容变化：

- 新版本使用全新资源 URL，旧资源可继续被边缘缓存命中；
- 新 `index.html` 最多 60 秒边缘陈旧，加载后指向新哈希文件；
- 通常无需提交 CDN 刷新任务。需要立即生效时只刷新 `/` 一条即可。

## 六、验证缓存是否生效

```bash
# 查看源站响应头
curl -sI https://your-domain/assets/index-xxxx.js | grep -iE "cache-control|cdn-cache-control|surrogate-control|edge-control|x-accel-expires|etag|vary"

# 查看 HTML 响应头
curl -sI https://your-domain/ | grep -iE "cache-control|cdn-cache-control|etag|last-modified|vary"

# 条件请求应返回 304
ETAG=$(curl -sI https://your-domain/ | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')
curl -sI -H "If-None-Match: $ETAG" https://your-domain/ | head -1

# 连续两次请求，第二次应出现 Age 头递增（说明命中边缘缓存）
curl -sI https://your-domain/ | grep -i "^age"
curl -sI https://your-domain/ | grep -i "^age"
```

期望结果：

| 路径 | 期望边缘缓存 | 期望命中 |
|---|---|---|
| `/assets/*` | `s-maxage=31536000, immutable` | 高命中 |
| `/favicon.webp` | `s-maxage=2592000` | 高命中 |
| `/` | `s-maxage=60, stale-while-revalidate=60` | 高命中，发版后最多约 2 分钟陈旧 |
| `/api/health` | `s-maxage=10` | 短缓存 |
| `/api/**`（其余） | `no-store` | 不缓存 |

## 七、排障与回退

若某个 CDN 对 `CDN-Cache-Control` 或 `Surrogate-Control` 处理异常，可临时回退为浏览器与 CDN 同值：

```bash
DNSMGR_CDN_CACHE=0
```

设置后 HTML 回退为 `public, max-age=0, must-revalidate`，不再下发 `s-maxage`；资源仍按浏览器侧 TTL 缓存。确认 CDN 行为后再恢复默认值。

检查缓存问题时优先看 `Vary`、`Age`、`X-Cache`、`X-Cache-Status`，并确认 CDN 没有开启「忽略源站缓存头」。
