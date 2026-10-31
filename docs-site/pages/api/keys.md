---
title: API Key 管理
categories:
  - api
top: 80
---

# API Key 管理

API Key 适合脚本、CI/CD、监控与第三方系统。每把 Key 支持作用域、有效期、IP 白名单与状态管理。

## 创建 Key

```http
POST /api/api-keys
Authorization: Bearer <session token>
Content-Type: application/json

{
  "name": "CI 部署",
  "scopes": ["dns:read", "cert:write", "deploy:write"],
  "expires_at": "2027-01-01 00:00:00",
  "ip_allowlist": ["203.0.113.10", "10.0.0.0/8"],
  "password": "你的登录密码"
}
```

字段：

| 字段 | 说明 |
| --- | --- |
| `name` | 名称，最长 64 字符 |
| `scopes` | 作用域数组，默认 `*` |
| `expires_at` | 过期时间，`YYYY-MM-DD` 或 `YYYY-MM-DD HH:mm:ss` |
| `ip_allowlist` | IP 或 CIDR 数组 |
| `password` | 登录密码，用于二次确认 |
| `uid` | 管理员可为其他用户创建 |

响应中的 `data.key` 是完整明文，只返回一次：

```json
{
  "code": 0,
  "msg": "API Key 已创建，请立即保存，明文只显示一次",
  "data": {
    "id": 12,
    "key": "dnsmgr_xxxxxxxxxxxxxxxx",
    "prefix": "dnsmgr_xxx",
    "scopes": ["dns:read", "cert:write", "deploy:write"],
    "expires_at": "2027-01-01 00:00:00",
    "ip_allowlist": ["203.0.113.10"]
  }
}
```

## 作用域

格式：

```text
*
模块
模块:read
模块:write
模块:*
```

可用模块：

```text
dns cdn cert deploy cloudflare backup monitor schedule optimize
dnscheck expire vault users system audit jobs events apikeys general
```

示例：

| 场景 | 建议作用域 |
| --- | --- |
| 只读监控 | `dns:read`、`cdn:read` |
| 证书自动化 | `cert:write`、`deploy:write` |
| CDN 刷新 | `cdn:write` |
| 备份 | `backup:write` |
| 全部权限 | `*` |

## 使用 Key

```http
GET /api/v1/domains
X-API-Key: dnsmgr_xxxxxxxxxxxxxxxx
```

API Key 请求仍受用户等级与域名授权限制。

## 列表与详情

```http
GET /api/api-keys
Authorization: Bearer <session token>
```

管理员可以查看指定用户：

```http
GET /api/api-keys?uid=1001
```

列表只返回前缀，不返回完整 Key。

## 修改 Key

```http
PATCH /api/api-keys/12
Authorization: Bearer <session token>

{
  "name": "新名称",
  "scopes": ["dns:read"],
  "expires_at": "2027-06-01",
  "ip_allowlist": ["203.0.113.0/24"],
  "active": 1,
  "password": "你的登录密码"
}
```

提交 `active: 0` 会吊销该 Key。

## 轮换

```http
POST /api/api-keys/12/rotate
Authorization: Bearer <session token>

{ "password": "你的登录密码" }
```

旧 Key 立即失效，新 Key 只在响应中返回一次。

## 吊销

```http
DELETE /api/api-keys/12
Authorization: Bearer <session token>

{ "password": "你的登录密码" }
```

吊销全部：

```http
POST /api/api-keys/revoke-all
Authorization: Bearer <session token>

{ "password": "你的登录密码" }
```

该操作也会停用旧版 `user.apikey`。

## 旧版密钥

旧版单密钥保存在 `user.apikey`。仍可通过 `X-API-Key` 使用，但无法设置作用域、有效期与 IP 白名单。

停用：

```http
DELETE /api/api-keys/legacy
Authorization: Bearer <session token>

{ "password": "你的登录密码" }
```

建议停用旧版并迁移到新 Key。

## 常见问题

### 401

检查 Key 是否完整、是否已吊销、是否过期、请求 IP 是否在白名单内。

### 403 或无权限

检查作用域是否覆盖目标模块，并检查用户是否有目标域名授权。

### 创建失败

检查登录密码、过期时间格式、作用域写法与 IP 格式。创建接口有频率限制。
