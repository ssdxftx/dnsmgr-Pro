---
title: 调用示例
categories:
  - api
top: 60
---

# 调用示例

## 准备环境变量

```bash
export DNSMGR_BASE="https://dns.example.com"
export DNSMGR_KEY="dnsmgr_xxxxxxxxxxxxxxxx"
```

## 健康检查

```bash
curl -fsS "$DNSMGR_BASE/api/health"
```

## 查询域名

```bash
curl -fsS "$DNSMGR_BASE/api/v1/domains" \
  -H "X-API-Key: $DNSMGR_KEY"
```

## 查询解析记录

```bash
curl -fsS "$DNSMGR_BASE/api/v1/domains/1/records" \
  -H "X-API-Key: $DNSMGR_KEY"
```

## 新增解析记录

```bash
curl -fsS -X POST "$DNSMGR_BASE/api/v1/domains/1/records" \
  -H "X-API-Key: $DNSMGR_KEY" \
  -H "Idempotency-Key: add-www-a-20261030" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "www",
    "type": "A",
    "value": "203.0.113.10",
    "line": "default",
    "ttl": 600,
    "remark": "created by api"
  }'
```

## 接入域名

```bash
curl -fsS -X POST "$DNSMGR_BASE/api/v1/domains" \
  -H "X-API-Key: $DNSMGR_KEY" \
  -H "Idempotency-Key: add-domain-example-com" \
  -H "Content-Type: application/json" \
  -d '{
    "aid": 1,
    "domain": "example.com",
    "thirdid": "",
    "recordcount": 0
  }'
```

`aid` 是 DNS 账户 ID，可在 DNS 账户列表或 `/api/accounts` 中查询。

## 刷新 CDN 缓存

```bash
curl -fsS -X POST "$DNSMGR_BASE/api/v1/cdn/purge" \
  -H "X-API-Key: $DNSMGR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://www.example.com/index.html",
      "https://www.example.com/style.css"
    ]
  }'
```

## 申请证书

```bash
curl -fsS -X POST "$DNSMGR_BASE/api/v1/cert/orders" \
  -H "X-API-Key: $DNSMGR_KEY" \
  -H "Idempotency-Key: cert-example-com-20261030" \
  -H "Content-Type: application/json" \
  -d '{
    "aid": 1,
    "keytype": "ecdsa",
    "keysize": 256,
    "domains": ["example.com", "www.example.com"]
  }'
```

`aid` 是证书账户 ID，`-1` 表示手动导入。

## 查询异步任务

```bash
curl -fsS "$DNSMGR_BASE/api/v1/jobs/123" \
  -H "X-API-Key: $DNSMGR_KEY"
```

## 获取二次确认令牌

```bash
REAUTH=$(curl -fsS -X POST "$DNSMGR_BASE/api/v1/auth/reauth" \
  -H "X-API-Key: $DNSMGR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"password":"你的登录密码"}' | node -pe 'JSON.parse(fs.readFileSync(0)).data.token')

curl -fsS -X POST "$DNSMGR_BASE/api/v1/api-keys/12/rotate" \
  -H "X-API-Key: $DNSMGR_KEY" \
  -H "X-Reauth-Token: $REAUTH" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Python 示例

```python
import os
import requests

base = os.environ["DNSMGR_BASE"]
key = os.environ["DNSMGR_KEY"]
headers = {"X-API-Key": key}

resp = requests.get(f"{base}/api/v1/domains", headers=headers, timeout=30)
resp.raise_for_status()
body = resp.json()
if body.get("code") != 0:
    raise RuntimeError(body.get("msg"))

for domain in body["data"]["list"]:
    print(domain["id"], domain["name"])
```

## 事件接收端示例

```js
import { createHmac, timingSafeEqual } from 'node:crypto'
import express from 'express'

const app = express()
app.use(express.raw({ type: 'application/json' }))

app.post('/hooks/dnsmgr', (req, res) => {
  const raw = req.body
  const secret = process.env.DNSMGR_EVENT_SECRET
  const signature = req.get('X-DNSMGR-Signature') || ''
  const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).send('bad signature')
  }

  const event = JSON.parse(raw.toString('utf8'))
  console.log(event.event, event.data)
  res.status(204).end()
})

app.listen(3000)
```

## 幂等与重试

```python
import uuid
import requests

idem = str(uuid.uuid4())
for attempt in range(3):
    resp = requests.post(
        f"{base}/api/v1/cdn/purge",
        headers={**headers, "Idempotency-Key": idem},
        json={"urls": ["https://www.example.com/index.html"]},
        timeout=30,
    )
    if resp.status_code == 409:
        time.sleep(2)
        continue
    print(resp.json())
    break
```

## 排查

| 现象 | 检查 |
| --- | --- |
| 401 | Key 是否有效、过期、IP 白名单 |
| 403 或 `code=-1` | 作用域与域名授权 |
| 409 | 幂等请求处理中，稍后重试 |
| 429 | 降低频率，读取 `Retry-After` |
| 503 | 数据库不可用或维护模式 |
