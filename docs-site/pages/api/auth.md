---
title: 认证与二次确认
categories:
  - api
top: 90
---

# 认证与二次确认

## 登录

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "你的密码"
}
```

成功：

```json
{
  "code": 0,
  "msg": "登录成功",
  "data": {
    "token": "<session jwt>",
    "user": {
      "id": 1000,
      "username": "admin",
      "level": 2,
      "totp_open": 0
    }
  }
}
```

后续请求携带：

```http
Authorization: Bearer <session jwt>
```

## TOTP 登录

开启 TOTP 后，登录返回：

```json
{
  "code": -1,
  "msg": "需要验证动态口令",
  "vcode": 2,
  "data": { "pre_token": "<5 分钟有效的预令牌>" }
}
```

第二步：

```http
POST /api/auth/totp
Content-Type: application/json

{
  "pre_token": "<pre_token>",
  "code": "123456"
}
```

成功返回正式会话令牌。`pre_token` 只能用于 TOTP 验证，不能访问业务接口。

## 当前用户

```http
GET /api/auth/me
Authorization: Bearer <token>
```

返回用户 ID、用户名、等级、TOTP 状态与语言等公开字段。

## 语言偏好

```http
POST /api/auth/lang
Authorization: Bearer <token>

{ "lang": "zh-CN" }
```

支持 `zh-CN` 与 `en-US`。

## 敏感操作二次确认

部分接口需要短时二次确认令牌。

第一步，用登录密码换取：

```http
POST /api/auth/reauth
Authorization: Bearer <token>

{ "password": "你的密码" }
```

返回：

```json
{
  "code": 0,
  "data": {
    "token": "<reauth token>",
    "expires_in": 300
  }
}
```

第二步，在敏感请求中携带：

```http
X-Reauth-Token: <reauth token>
```

令牌有效 5 分钟。也兼容旧的 `X-Confirm-Password` 与请求体 `password`。

敏感操作包括证书详情、系统密钥设置、备份替换、保险库销毁与 API Key 轮换等。

## 退出登录

```http
POST /api/auth/logout
Authorization: Bearer <token>
```

服务端会吊销当前令牌的 `jti`，令牌立即失效。

退出全部设备：

```http
POST /api/auth/logout-all
Authorization: Bearer <token>

{ "password": "你的密码" }
```

会自增 `token_version`，使所有已签发令牌失效。

## 错误处理

| 返回 | 处理 |
| --- | --- |
| `401` | 重新登录或检查 API Key |
| `code: -1, vcode: 2` | 进入 TOTP 验证 |
| 账号临时锁定 | 等待锁定时间结束或联系管理员 |
| 二次确认过期 | 重新调用 `/api/auth/reauth` |

## 安全建议

- 会话令牌只保存在安全存储中。
- 不要把密码或令牌写入前端源码。
- 脚本使用 API Key，不共用管理员会话。
- 管理员开启 TOTP。
- 发现令牌泄露立即退出全部设备并轮换 API Key。
