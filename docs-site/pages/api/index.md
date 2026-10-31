---
title: API 集成
categories:
  - api
top: 100
---

# API 集成

后端以 Fastify 提供 RESTful JSON API。前端与第三方脚本使用同一套接口。

## 基址

```text
https://dns.example.com/api
https://dns.example.com/api/v1
```

`/api/v1` 是推荐前缀，`/api` 作为兼容别名。两者行为一致。

## 认证方式

| 方式 | 请求头 | 说明 |
| --- | --- | --- |
| 会话令牌 | `Authorization: Bearer <token>` | 浏览器登录或 TOTP 后获得 |
| API Key | `X-API-Key: <key>` | 用户级密钥，支持作用域、有效期、IP 白名单 |

会话令牌来自 `/api/auth/login` 或 `/api/auth/totp`。API Key 在“偏好设置”中创建。

## 响应格式

成功：

```json
{ "code": 0, "msg": "可选文案", "data": {} }
```

业务失败通常仍返回 HTTP 200：

```json
{ "code": -1, "msg": "错误原因" }
```

HTTP 状态例外：

| 状态 | 场景 |
| --- | --- |
| 401 | 未登录、令牌过期、账号封禁、API Key 无效 |
| 404 | `/api/*` 路径不存在 |
| 409 | 幂等请求正在处理中 |
| 429 | 限流，响应带 `Retry-After` |
| 503 | 就绪检查失败或维护模式 |

响应头：

```text
X-Request-Id: <请求 ID>
X-API-Version: 1
```

## 敏感字段

密码、密钥、Token 等字段回显为 `**********`。更新时提交掩码或空值会保留原值。

## 权限

- `level >= 2`：管理员。
- `level < 2`：普通用户，按域名与子域名授权访问。
- API Key 作用域限制可访问模块。
- 管理员等级与域名授权会叠加校验。

## 旧版彩虹 DNS API

如果需要让旧版彩虹 DNS 客户端继续调用表单签名接口，可在“系统设置 → 旧版接口兼容”中开启兼容层。默认关闭，端点、认证方式与差异见 [旧版彩虹 DNS API 兼容](/api/legacy)。

## 文档与可观测性

| 路径 | 说明 |
| --- | --- |
| `GET /api/health` | 进程健康检查 |
| `GET /api/ready` | 就绪检查，数据库异常或维护模式返回 503 |
| `GET /api/metrics` | Prometheus 指标，管理员 |
| `GET /api/openapi.json` | OpenAPI 3.1 规范 |
| `GET /api/docs` | 内置接口列表 |

## 限流

| 路径 | 窗口 | 上限 |
| --- | --- | --- |
| `/api/setup/*` | 60 秒 | 15 |
| `/api/auth/login`、`/api/auth/totp` | 60 秒 | 20 |
| `/api/register` | 60 秒 | 10 |
| `/api/register/send-code` | 60 秒 | 5 |
| API Key | 60 秒 | `DNSMGR_API_KEY_RATE_LIMIT`，默认 600 |

超限返回 `429` 与 `Retry-After`。

## 相关页面

- [认证与二次确认](/api/auth)
- [API Key 管理](/api/keys)
- [幂等、任务与事件](/api/events)
- [调用示例](/api/examples)
