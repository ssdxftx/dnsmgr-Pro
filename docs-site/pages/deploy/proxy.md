---
title: 反向代理与 HTTPS
categories:
  - deploy
top: 50
---

# 反向代理与 HTTPS

应用本身可以直接暴露 `8082`。生产环境建议放在 Nginx、Caddy 或云负载均衡之后，由代理终止 TLS。

## 代理必须传递的头

- `Host`
- `X-Real-IP`
- `X-Forwarded-For`
- `X-Forwarded-Proto`
- `X-Forwarded-Host`

位于受信代理之后时设置：

```bash
DNSMGR_TRUST_PROXY=true
```

更安全的做法是填写具体代理 IP 或 CIDR：

```bash
DNSMGR_TRUST_PROXY=10.0.0.0/8,172.16.0.0/12
```

不要在没有可信代理时开启，否则客户端可以伪造来源 IP 绕过限流。

## Nginx 示例

```nginx
server {
    listen 80;
    server_name dns.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name dns.example.com;

    ssl_certificate     /etc/letsencrypt/live/dns.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dns.example.com/privkey.pem;

    # 备份导入与恢复需要较大的请求体
    client_max_body_size 210m;

    location / {
        proxy_pass http://127.0.0.1:8082;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;

        # 备份、恢复、批量任务可能持续较久
        proxy_connect_timeout 30s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
        proxy_buffering off;
    }
}
```

应用已经下发 `Cache-Control`、`CDN-Cache-Control`、`Surrogate-Control`、`Edge-Control` 与 `X-Accel-Expires`。Nginx 不要配置 `proxy_ignore_headers Cache-Control Expires X-Accel-Expires`，否则会覆盖应用缓存策略。

`/api/*` 默认返回 `no-store`，不要在代理层缓存。静态资源可按应用响应头缓存。

## Caddy 示例

```caddyfile
dns.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8082 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto {scheme}
        transport http {
            read_timeout 600s
            write_timeout 600s
        }
    }
}
```

Caddy 会自动申请并续签 HTTPS 证书。

## 安全响应头

应用会自动发送：

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy`
- `Permissions-Policy`
- `Cross-Origin-*`
- HTML 的 `Content-Security-Policy`
- HTTPS 下的 `Strict-Transport-Security`

如果代理层也设置同名头，保留应用下发的值，避免重复或冲突。需要临时关闭 HSTS 时设置 `DNSMGR_HSTS=0`。

## 跨域 API

浏览器从其他域名调用 API 时设置来源白名单：

```bash
DNSMGR_ALLOWED_ORIGINS=https://console.example.com,https://ops.example.com
```

未设置时只允许同源。服务端会按 `Origin` 返回 CORS 头，并合并 `Vary`。

## CDN 前置

如果 CDN 回源到本应用：

1. CDN 遵循源站缓存头。
2. 保留 `/api/*` 的 `no-store`。
3. 回源协议使用 HTTPS。
4. 保留 `X-Forwarded-For` 与 `X-Forwarded-Proto`。
5. 设置 `DNSMGR_TRUST_PROXY` 为 CDN 回源网段。

发版后通常只需要刷新根路径 `/`。详细缓存策略见仓库 `deploy/CDN-CACHE.md`。

## 验证

```bash
curl -sI https://dns.example.com/ | grep -iE 'strict-transport|content-security|cache-control'
curl -s https://dns.example.com/api/health
```

从公网访问后，在“操作日志”中确认记录的 IP 是客户端真实 IP。
