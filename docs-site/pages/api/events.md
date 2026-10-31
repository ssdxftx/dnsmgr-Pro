---
title: 幂等、任务与事件
categories:
  - api
top: 70
---

# 幂等、任务与事件

## 幂等写请求

网络超时或客户端重试可能导致重复创建。写请求可以携带：

```http
Idempotency-Key: 8-128 位唯一字符串
```

行为：

- 首次请求正常执行并保存响应。
- 相同 Key 重复提交返回第一次的响应。
- 相同 Key 正在处理中返回 `409`。
- 不同用户、路径或方法使用相同 Key 会分别处理。

敏感响应（API Key、reauth、vault）不缓存。

示例：

```bash
curl -X POST https://dns.example.com/api/v1/domains \
  -H "X-API-Key: $DNSMGR_KEY" \
  -H "Idempotency-Key: create-domain-example-com-20261030" \
  -H "Content-Type: application/json" \
  -d '{"account_id":1,"name":"example.com"}'
```

## 异步任务

批量证书、批量部署、到期扫描等接口会返回 `job_id`。

```http
GET /api/jobs?limit=20&offset=0&type=cert&status=running
GET /api/jobs/123
Authorization: Bearer <token>
```

任务字段包含类型、状态、进度、结果、错误与时间。普通用户只能看自己的任务，管理员可以看全部或按 `uid` 筛选。

## 事件订阅

管理员可以创建事件回调。

```http
POST /api/events/subscriptions
Authorization: Bearer <token>

{
  "name": "运维平台",
  "url": "https://ops.example.com/hooks/dnsmgr",
  "events": ["cert.order.issued", "cert.deploy.failed", "backup.completed"],
  "secret": "可选的签名密钥",
  "active": 1
}
```

未提供 `secret` 时系统自动生成。密钥只在创建或重置时返回。

支持事件：

```text
cert.order.issued
cert.order.failed
cert.deploy.success
cert.deploy.failed
monitor.record.switched
backup.completed
event.test
```

`events` 使用 `*` 表示全部。

## 回调格式

请求体：

```json
{
  "event": "cert.order.issued",
  "timestamp": "2026-10-30T12:00:00.000Z",
  "data": {}
}
```

请求头：

```http
X-DNSMGR-Event: cert.order.issued
X-DNSMGR-Signature: sha256=<hex hmac>
```

签名计算：

```text
HMAC-SHA256(secret, raw_request_body)
```

接收端必须使用原始请求体验签，不要先解析再序列化。

Node.js 验签示例：

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

function verify(rawBody, signature, secret) {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(String(signature || ''))
  return a.length === b.length && timingSafeEqual(a, b)
}
```

## 投递记录与测试

```http
GET /api/events/deliveries?limit=50&sub_id=1&event=cert.order.issued
POST /api/events/subscriptions/1/test
```

投递记录包含状态、HTTP 状态码、错误、耗时与时间。失败不会阻塞主业务。

## 通知投递历史

```http
GET /api/notifications/logs
Authorization: Bearer <token>
```

管理员可以查看邮件、机器人等通知的投递结果。

## Prometheus 指标

```http
GET /api/metrics
Authorization: Bearer <token>
```

指标接口需要管理员身份。适合接入 Prometheus 抓取。

## 就绪检查

```http
GET /api/ready
```

数据库不可用或处于维护模式时返回 `503`。适合 Kubernetes readinessProbe 与负载均衡健康检查。

## 最佳实践

- 事件接收端先验签，再处理业务。
- 回调接口保持幂等，按事件 ID 或业务 ID 去重。
- 对失败投递做重试与告警。
- 幂等 Key 按业务唯一键生成，避免复用。
- 异步任务在前端或脚本中轮询到终态。
