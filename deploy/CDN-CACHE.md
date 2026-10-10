# CDN 缓存接入与调优

本项目已在应用侧内置了**分层缓存响应头**，只要把域名接入 CDN 并让 CDN **遵循源站缓存头**，即可获得极高的缓存命中率，且**发版无需手动刷缓存**。

---

## 一、源站已经下发的缓存头

应用后端（`backend/src/security.ts`）会按资源类型自动下发 `Cache-Control`（面向浏览器）与 `CDN-Cache-Control`（面向 CDN 边缘）两组独立策略：

| 资源类型 | 路径示例 | `Cache-Control`（浏览器） | `CDN-Cache-Control`（CDN 边缘） |
|---|---|---|---|
| 带内容哈希的构建产物 | `/assets/index-DVh7-0k1.js`、`/assets/vendor-ui-Cl7iQ9av.js`、`*.woff2` | `max-age=31536000, immutable` | `s-maxage=31536000, immutable` |
| 根目录静态文件 | `/favicon.webp`、`/robots.txt`、`/manifest.webmanifest` | `max-age=31536000, immutable` | `s-maxage=31536000, immutable` |
| HTML 文档 / SPA 回退 | `/`、`/domains`、`/dashboard` | `no-cache, must-revalidate` | `s-maxage=60, stale-while-revalidate=600` |
| 公开只读接口 | `/api/health`、`/api/setup/status`、`/api/register/config` | `max-age=5~60` | `s-maxage=5~300` |
| 其余业务接口 | `/api/**` | `no-store` | `no-store` |

> **关键设计**：HTML 的浏览器侧仍是 `no-cache`（保证发版后用户立即拿到新版本），但 CDN 侧允许缓存 60 秒并允许 10 分钟内使用陈旧副本异步回源刷新 —— 这是把整体缓存命中率从「几乎为 0」拉到「95%+」的最大杠杆。

---

## 二、CDN 后台必须开启的开关

这几个开关决定了上面所有优化能否生效，**务必逐项确认**：

1. **遵循源站缓存头 / 优先使用 `CDN-Cache-Control`**
   - 阿里云 CDN：`缓存配置 → 遵循源站` 选择「遵循源站缓存规则」，并开启 **CDN-Cache-Control 优先级**
   - 腾讯云 CDN：`缓存配置 → 遵循源站` 勾选「遵循源站 Cache-Control」，并开启 **优先遵循 CDN-Cache-Control**
   - Cloudflare：默认遵循源站头；如需强制，用下方 Cache Rules
2. **不要开启「忽略源站缓存头、强制按扩展名缓存」**，否则会覆盖应用侧的精细策略。
3. **开启 Brotli / Gzip 压缩**（`Vary: Accept-Encoding` 已由源站下发，压缩与缓存可共存）。
4. **不要对 `/assets/` 开启「忽略参数缓存」以外的改写**；带哈希文件天然不受查询串影响。
5. **回源 Host 与协议**：回源使用 `HTTPS`，与源站 `HSTS` 策略一致。

---

## 三、Nginx 反代缓存规则（自建 CDN / Nginx 前置时）

```nginx
# 1) 带内容哈希的构建产物：命中即长缓存一年
location ~* ^/assets/.*\.[a-z0-9]+$ {
    proxy_pass http://127.0.0.1:8082;
    proxy_set_header Host $host;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header CDN-Cache-Control "public, s-maxage=31536000, immutable" always;
    access_log off;
}

# 2) 根目录静态文件
location ~* \.(?:webp|avif|png|jpe?g|gif|svg|ico|woff2?|ttf|otf)$ {
    proxy_pass http://127.0.0.1:8082;
    proxy_set_header Host $host;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    access_log off;
}

# 3) HTML 与 SPA 回退：浏览器强校验，CDN 短缓存
location / {
    proxy_pass http://127.0.0.1:8082;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # 若本层同时充当 CDN 缓存层，可放开下一行给 60 秒边缘缓存
    # proxy_cache my_cache; proxy_cache_valid 200 60s;
}

# 4) 接口一律不缓存
location /api/ {
    proxy_pass http://127.0.0.1:8082;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_cache off;
    add_header Cache-Control "no-store" always;
}
```

> 经 Nginx 前置时，记得在应用侧设置 `DNSMGR_TRUST_PROXY=true`，使日志与限流取到真实客户端 IP。

---

## 四、Cloudflare Cache Rules（推荐配置）

```
# 规则 1：静态产物长缓存
(http.request.uri.path matches "^/assets/.*\.[a-z0-9]+$")
  → Cache Eligibility: Eligible for cache
  → Edge TTL: Override origin, 1 year
  → Browser TTL: Override origin, 1 year
  → Cache Key: ignore query string

# 规则 2：HTML 短缓存 + 异步回源
(http.request.uri.path eq "/" or not http.request.uri.path matches "\.[a-z0-9]{2,5}$")
  → Cache Eligibility: Eligible for cache
  → Edge TTL: Override origin, 60 seconds
  → Browser TTL: Bypass cache（保持 no-cache 语义）

# 规则 3：接口不缓存
(http.request.uri.path starts_with "/api/")
  → Cache Eligibility: Bypass cache
```

---

## 五、发版流程（无需手动刷缓存）

```bash
git add <本次改动>
node scripts/release.mjs 1.10.2 "说明"
```

脚本会升级版本号、打 `v1.10.2` 标签并推送，触发工作流构建镜像。前端产物文件名中的哈希随内容变化，**新版本自动使用全新 URL**，因此：

- 已缓存的旧资源不受影响，可继续被老页面使用；
- 新 `index.html`（CDN 最多 60 秒陈旧）加载后指向新哈希文件，即时生效；
- **完全不需要**提交「刷新目录 / 刷新 URL」的 CDN 缓存刷新任务。

> 如需发布后立刻生效（不等 60 秒），可按需刷新根路径 `/` 一条即可，其余资源无需刷新。

---

## 六、验证缓存是否生效

```bash
# 1) 查看源站响应头
curl -sI https://your-domain/assets/index-xxxx.js | grep -iE "cache-control|cdn-cache-control|expires|etag"

# 2) 查看 CDN 边缘命中情况（阿里云/腾讯云会返回相应命中标识头）
curl -sI https://your-domain/ | grep -iE "x-cache|ali-cdn|age"

# 3) 连续两次请求，第二次应出现 Age 头递增（说明命中边缘缓存）
curl -sI https://your-domain/ | grep -i "^age"
curl -sI https://your-domain/ | grep -i "^age"
```

**期望结果**：

| 路径 | 期望 `CDN-Cache-Control` | 期望命中 |
|---|---|---|
| `/assets/*.js` | `s-maxage=31536000, immutable` | ✅ 高命中 |
| `/favicon.webp` | `s-maxage=31536000, immutable` | ✅ 高命中 |
| `/` | `s-maxage=60, stale-while-revalidate=600` | ✅ 秒级内高命中 |
| `/api/**` | `no-store` | — 不缓存（符合预期） |

---

## 七、排障：一键回退

若发现某 CDN 平台对 `CDN-Cache-Control` 处理异常，可临时回退为「浏览器与 CDN 同值」的旧行为：

```bash
DNSMGR_CDN_CACHE=0
```

设置后源站不再下发独立的分层策略，便于快速定位问题。
