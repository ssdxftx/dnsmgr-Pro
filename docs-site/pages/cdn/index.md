---
title: CDN 管理
categories:
  - cdn
top: 100
---

# CDN 管理

CDN 模块负责加速域名接入、回源、缓存、HTTPS、访问控制、刷新预热与数据统计。

## 支持厂商

腾讯云 CDN、腾讯云 EdgeOne、阿里云 CDN、阿里云 ESA、火山引擎 CDN、华为云 CDN、百度云 CDN、七牛云 CDN、白山云 CDN、CDNetworks、金山云 CDN、网宿 CDN。

不同厂商支持的能力不同。站点级能力（规则引擎、源站组、负载均衡、安全、四层代理、配额）主要面向 EdgeOne 与 ESA。Cloudflare 通过 DNS 账户凭证使用规则引擎、自定义主机名与 Tunnel。

## 使用流程

1. 在“CDN 账户”添加厂商凭证并验证。
2. 在“CDN 域名”接入加速域名。
3. 配置 CNAME 与源站。
4. 设置缓存规则、HTTPS 与访问控制。
5. 按需配置证书、刷新预热、自动任务与统计。
6. 对站点型厂商进入“CDN 站点设置”配置站点级策略。

## 页面导航

- [CDN 账户](/cdn/accounts)
- [CDN 域名与接入](/cdn/domains)
- [加速域名设置](/cdn/settings)
- [缓存刷新与预热](/cdn/cache)
- [数据统计](/cdn/stats)
- [站点设置](/cdn/zones)
- [Cloudflare](/cdn/cloudflare)

## 证书方式

CDN 域名支持三种常见方式：

- 平台免费证书：由 CDN 厂商直接签发并部署。
- 项目申请证书：系统按站点申请通配符证书，自动上传并绑定，续签后自动更新。
- 不使用证书：只停用本项目的自动部署，不影响云端已有证书。

证书方式的详细流程见 [CDN 域名](/cdn/domains) 和 [证书自动续签](/cert/auto-renew)。

::: tip 先匹配 DNS
接入加速域名时，系统会尝试匹配已纳管的 DNS 域名并自动添加 CNAME。先导入根域名可以减少手工步骤。
:::
