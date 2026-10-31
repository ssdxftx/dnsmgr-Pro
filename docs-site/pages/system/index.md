---
title: 系统管理
categories:
  - system
top: 100
---

# 系统管理

系统管理面向管理员，包含用户、通知、审计、系统设置与版本信息。

## 模块

- [用户管理](/system/users)：用户、等级、API、统计权限、域名授权。
- [通知设置](/system/notifications)：邮件、WxPusher、Telegram、QQ 机器人、群机器人与自定义 Webhook。
- [操作日志](/system/audit)：审计查询、变更详情与导出。
- [系统设置](/system/settings)：登录、注册、公告、代理、cron、统计缓存。
- [偏好设置与安全](/system/preferences)：语言、主题、API Key、TOTP。
- [关于与更新](/system/settings#关于与更新)：版本、运行环境、检查更新。

## 权限边界

系统设置、用户管理、备份与审计仅管理员可访问。普通用户可以访问偏好设置、TOTP、被授权的域名与个人备份。

## 安全确认

保存安全相关设置时可能需要输入登录密码。敏感 API 操作可以使用短时 `X-Reauth-Token`。
