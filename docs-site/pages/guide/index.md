---
title: 快速开始
categories:
  - guide
top: 100
---

# 快速开始

彩虹 DNS Pro 把多厂商 DNS、CDN、SSL 证书、自动部署、容灾切换、定时任务、备份与审计集中在一个控制台。本文档对应 `v1.32.0`。

## 推荐使用顺序

1. 阅读 [产品与模块概览](/guide/concepts)，确认账户、域名、证书与任务之间的关系。
2. 按 [Docker 部署](/deploy/docker) 或 [Docker Compose](/deploy/compose) 启动服务。
3. 打开 `http://服务器IP:8082`，完成 [初始化安装](/deploy/install)。
4. 在 DNS 账户中接入服务商，导入域名并维护解析。
5. 按需接入 CDN、申请证书、配置自动部署与容灾。
6. 配置备份、通知、用户权限与 API Key。

## 功能地图

| 模块 | 主要入口 | 适合处理 |
| --- | --- | --- |
| 仪表盘 | `/dashboard` | 查看域名、账户、CDN 与任务概况 |
| 域名管理 | `/domains` | 域名导入、分类、解析记录、批量操作 |
| DNS 账户 | `/dns-accounts` | 22 家 DNS 服务商授权 |
| 到期提醒 | `/expire-notice` | WHOIS/RDAP 到期时间与多渠道提醒 |
| 劫持检测 | `/dns-check` | 本地解析与 DoH 结果比对 |
| CDN 管理 | `/cdn-accounts`、`/cdn-domains` | 12 家 CDN 厂商接入与缓存 |
| CDN 站点设置 | `/cdn-zones` | EdgeOne、ESA、Cloudflare 站点级规则 |
| 容灾切换 | `/dm-overview`、`/dm-tasks` | 主备探测与自动切换 |
| 定时切换 | `/schedule-tasks` | 按计划修改、启用、暂停或删除解析 |
| CF 优选 IP | `/optimize-settings`、`/optimize-tasks` | 自动更新 Cloudflare 优选线路 |
| SSL 证书 | `/cert-orders` | 申请、续签、导入、导出与吊销 |
| 自动部署 | `/deploy-accounts`、`/deploy-tasks` | 把证书推送到面板、CDN 或服务器 |
| 备份与恢复 | `/backup` | 整站备份、个人备份、在线恢复与保险库 |
| 系统管理 | `/system-settings`、`/users`、`/logs` | 通知、注册、代理、用户、审计 |
| API 集成 | `/preferences`、`/api/docs` | API Key、幂等、事件回调与 OpenAPI |

## 角色与权限

系统区分三类使用者：

- 超级管理员：拥有全部模块与用户管理权限。
- 管理员：可管理 CDN、证书、部署、容灾、系统设置与用户。
- 普通用户：只能访问被授权的域名、子域名与个人数据；管理员可为单个用户开启统计查看权限。

普通用户的域名权限支持“整域名”或“指定子域名”，并可设置只读、到期时间与自由解析。服务端会在每次请求时复核权限，越权访问按对象不存在处理。

## 第一次登录后建议完成

1. 修改管理员密码，并在 [安全设置](/system/preferences) 开启 TOTP。
2. 配置 [通知通道](/system/notifications) 并发送测试消息。
3. 配置 [备份目的地与计划备份](/ops/backup)。
4. 设置 `DNSMGR_TRUST_PROXY`、HTTPS 与安全响应头，参考 [反向代理](/deploy/proxy)。
5. 为自动化脚本创建最小权限 [API Key](/api/keys)。

::: warning 生产环境
请务必挂载持久化目录 `/app/data`。SQLite 数据、安装配置、备份与审计缓冲都位于该目录。未挂载时只能使用 MySQL。
:::
