---
title: 旧版彩虹 DNS API 兼容
categories:
  - api
top: 90
---

# 旧版彩虹 DNS API 兼容

兼容层默认关闭。开启后，旧版彩虹 DNS 客户端可以继续调用原来的表单签名接口；新版 `/api/v1` 接口不受影响。

## 开启方式

登录管理员账号，进入“系统设置 → 旧版接口兼容”，开启“启用旧版 API”。保存该设置需要输入登录密码。

目标用户还必须满足：

- 用户状态为启用。
- 已开启 API 权限（`is_api = 1`）。
- 保留旧版 `user.apikey`。新版 API Key 存储在独立表中，不能用于旧版签名。

## 认证方式

旧版客户端通过 `application/x-www-form-urlencoded` 提交以下字段：

| 字段 | 说明 |
| --- | --- |
| `uid` | 数字用户 ID。 |
| `timestamp` | 当前 Unix 时间戳（秒），允许前后 5 分钟误差。 |
| `sign` | `md5(uid + timestamp + apikey)`，小写十六进制。 |

认证失败返回 HTTP 403 和 `{"code":-1,"msg":"..."}`。兼容层关闭时，旧版路径返回 404。

示例：

```bash
UID=1000
TS=$(date +%s)
APIKEY='旧版用户 apikey'
SIGN=$(printf '%s' "${UID}${TS}${APIKEY}" | md5sum | cut -d' ' -f1)

curl -fsS -X POST 'https://dns.example.com/api/domain' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "uid=${UID}" \
  --data-urlencode "timestamp=${TS}" \
  --data-urlencode "sign=${SIGN}" \
  --data-urlencode 'offset=0' \
  --data-urlencode 'limit=10'
```

## 兼容端点

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/domain` | POST | 域名列表，返回 `{total, rows}`。 |
| `/api/domain/:id` | POST | 域名详情、线路与最小 TTL。 |
| `/api/record/data/:id` | POST | 解析记录列表。支持 `keyword`、`subdomain`、`value`、`type`、`line`、`status`、`offset`、`limit`。 |
| `/api/record/add/:id` | POST | 添加解析记录。 |
| `/api/record/update/:id` | POST | 修改解析记录。 |
| `/api/record/delete/:id` | POST | 删除解析记录。 |
| `/api/record/status/:id` | POST | 启用或暂停解析记录。 |
| `/api/record/remark/:id` | POST | 修改解析备注。 |
| `/api/record/batch/:id` | POST | 批量启用、暂停、删除、修改备注或修改分组。 |
| `/api/cert/order` | POST | 管理员读取证书订单，返回证书、私钥与 PFX。 |
| `/cron` | GET | 旧版 `?key=` 定时触发，返回纯文本 `success!`。 |
| `/quicklogin` | GET | 域名快捷登录，签名通过后写入 2 小时有效的单域名会话并跳转解析页。 |

## 与旧版的差异

- `/cron` 只在兼容层开启时可用；新版触发地址仍是 `/api/system/cron`，推荐使用 `X-Cron-Key` 请求头。
- `/api/cert/order` 生成的 PFX 保持旧版默认口令 `123456`。如果客户端不依赖该口令，建议迁移到新版 `/api/v1/cert/orders/:id/info`。
- `/api/domain/:id` 在请求体带 `loginurl=1` 时返回 `/quicklogin` 链接。快捷登录只授予该域名的整域名权限，不继承用户的其他域名权限，令牌有效期 2 小时。
- 记录列表在管理员场景保持旧版字段；普通用户仍按当前域名/子域名授权过滤。
- 旧版接口会写入审计日志。审计中的动作带有“旧版API”标记。

## 安全建议

旧版签名使用明文 `apikey` 和 MD5，安全性低于新版 `X-API-Key`。只在迁移期开启，迁移完成后关闭兼容层，并在用户管理中轮换或清除旧版 `apikey`。

新版接口支持作用域、有效期、IP 白名单、幂等键和二次确认，见 [API 集成](/api/) 与 [API Key](/api/keys)。
