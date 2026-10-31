---
title: 常见问题
categories:
  - faq
top: 100
---

# 常见问题

## 按主题

- [故障排查](/faq/troubleshooting)：安装、登录、数据库、代理、证书、CDN 与任务。
- [迁移与兼容](/faq/migration)：从彩虹 DNS 迁入、备份恢复与数据库切换。
- [安全加固](/faq/security)：管理员、TOTP、API Key、反向代理与部署权限。

## 快速检查

```bash
# 进程健康
curl -fsS http://127.0.0.1:8082/api/health

# 数据库与维护状态
curl -fsS http://127.0.0.1:8082/api/ready

# 容器日志
docker logs --tail=200 dnsmgr-pro
```

## 获取帮助前准备

1. 当前版本与镜像标签。
2. 部署方式与数据库类型。
3. 复现步骤与错误截图。
4. 相关操作日志或请求 ID。
5. 已脱敏的日志片段。

不要在工单或公开渠道粘贴密码、API Key、私钥、备份密钥或完整 Token。
