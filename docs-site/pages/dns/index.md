---
title: 域名与解析
categories:
  - dns
top: 100
---

# 域名与解析

域名管理负责把云厂商账户中的域名接入本地，并提供解析记录维护、批量操作、权限分配、到期提醒与劫持检测。

## 使用流程

1. 在“DNS 账户”添加服务商账户并验证。
2. 在“域名列表”点击“导入域名”，选择账户并拉取云端域名。
3. 进入域名的“解析记录”页面新增或修改记录。
4. 如需把域名交给普通用户，在“用户管理”中分配域名或子域名权限。
5. 配置到期提醒与劫持检测，形成日常巡检。

## 支持的 DNS 服务商

阿里云、腾讯云 DNSPod、华为云、百度云、火山引擎、京东云、青云、西部数码、DNSLA、NameSilo、Spaceship、Cloudflare、AWS Route 53、HE DNS、PowerDNS、Technitium、dynv6、GoEdge 智能 DNS、宝塔域名、同系统对接、阿里云 ESA、腾讯云 EdgeOne。

不同服务商支持的记录类型、线路、权重、别名与日志能力不同。界面会在对应的功能入口提示限制。

## 相关页面

- [DNS 账户](/dns/accounts)
- [域名列表](/dns/domains)
- [解析记录](/dns/records)
- [批量操作、导入、别名与权重](/dns/batch)
- [域名授权与只读权限](/dns/permissions)
- [到期提醒](/dns/expire)
- [劫持检测](/dns/check)
