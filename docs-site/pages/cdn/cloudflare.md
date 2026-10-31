---
title: Cloudflare 与 ESA
categories:
  - cdn
top: 30
---

# Cloudflare 与 ESA

## Cloudflare 规则引擎

Cloudflare 规则引擎入口位于“CDN 站点设置”的站点页面。默认复用 DNS 账户中的 Cloudflare 凭证。

规则阶段：

1. 回源。
2. 重定向。
3. URL 重写。
4. 请求头转换。
5. 响应头转换。
6. 缓存设置。
7. 防火墙。
8. 速率限制。

创建规则时填写匹配条件与动作，并设置优先级。保存后下发到 Cloudflare。

权限不足时，可以在站点页配置专用加密凭证。专用凭证只用于 Cloudflare 规则，不会暴露到前端。

## Cloudflare 自定义主机名

自定义主机名用于 Cloudflare for SaaS 场景。

常用操作：

- 批量新增主机名。
- 批量修改。
- 批量删除。
- 刷新状态。
- DCV 验证。
- 更新 Fallback Origin。
- 生成 TXT 目标。

添加主机名后按页面提示配置 DNS 与验证记录。验证通过后状态变为可用。

## Cloudflare Tunnel

Tunnel 用于把本地或内网服务安全暴露到 Cloudflare。

支持：

- 创建与删除 Tunnel。
- 查看 Token。
- 管理公共主机名。
- 管理 CIDR 路由。
- 管理主机名路由。

Token 属于敏感凭证，只在需要时查看。删除 Tunnel 会中断对应流量，执行前先切换路由。

## Cloudflare 免费证书与代理

Cloudflare DNS 账户支持代理开关。记录检测遇到代理记录时会标记为“已开启 Cloudflare 代理”，避免把代理 IP 误判为劫持。

Cloudflare 域名使用 CNAME 接入时，可以配合优选 IP 功能优化线路。优选 IP 要求域名使用其他 DNS 服务商，并通过 CNAME 指向 Cloudflare。详见 [CF 优选 IP](/ops/optimize-ip)。

## ESA 账户控制台

阿里云 ESA 账户在“CDN 账户”中接入后，可以从 CDN 域名页进入：

- ESA 账户控制台：查看站点、域名与账户级信息。
- ESA 全量 API：调用 ESA 提供的扩展能力。

站点级配置在“CDN 站点设置”中维护。ESA 还支持源站防护、开发模式与分级缓存。

## EdgeOne

腾讯云 EdgeOne 支持：

- 站点创建与启停。
- 归属校验与 NS 查询。
- 源站组与负载均衡。
- L7 规则引擎。
- 安全 IP 组、DDoS、WAF。
- 四层代理。
- 内容与刷新配额。
- 免费证书申请与证书直传。

CNAME 接入时，免费证书可能需要 DNS 委派验证记录。系统会尝试自动添加，生效后点击“检查并部署”。

## 操作建议

1. 先在测试站点验证规则与安全策略。
2. 修改规则优先级前记录原配置。
3. 删除 Tunnel、主机名或站点前确认流量已切换。
4. 对 Cloudflare 与 ESA 的云资源变更保留操作日志。

## 常见问题

### 规则保存失败

检查凭证权限、Zone ID、规则语法与套餐限制。部分规则阶段需要付费套餐。

### 自定义主机名一直待验证

检查 DCV 记录是否添加、TXT 值是否完整、DNS 是否已经生效。刷新状态后再查看。

### Tunnel 无法连接

检查 Token、cloudflared 进程、路由与公共主机名配置。确认本地服务监听地址可达。
