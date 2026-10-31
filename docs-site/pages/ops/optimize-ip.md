---
title: CF 优选 IP
categories:
  - ops
top: 70
---

# CF 优选 IP

Cloudflare 官方 IP 为泛播路由，同一 IP 在不同地区和运营商可能连接到不同机房。优选 IP 功能获取测速数据并自动更新解析记录。

## 前提条件

- 域名需要开通 Cloudflare for SaaS。
- 域名使用 CNAME 方式指向 Cloudflare。
- 域名解析需要放在其他 DNS 服务商，不能直接放在 Cloudflare DNS 中做优选。
- 需要保留或删除默认线路记录，具体取决于任务类型。

## 配置优选设置

1. 打开“CF 优选 IP → 优选设置”。
2. 选择数据接口：
   - wetest.vip：支持 Cloudflare、CloudFront、EdgeOne。
   - HostMonit：仅 Cloudflare。
   - xingpingcn.top：仅 Cloudflare，免费且无需密钥。
3. 填写接口密钥。系统不再内置默认密钥。
4. 按需填写代理地址，例如 `https://ghfast.top/https://raw.githubusercontent.com/`。
5. 设置自动更新间隔。
6. 保存。

可以查询接口积分，确认剩余额度。

## 创建优选任务

1. 打开“CF 优选 IP → 任务管理”。
2. 点击“添加任务”。
3. 选择 CDN 服务商。
4. 选择解析线路类型：
   - 电信/联通/移动。
   - 默认/联通/移动。
5. 选择 IP 类型：IPv4 A 记录或 IPv6 AAAA 记录。
6. 填写每线路解析数量。
7. 选择域名与主机记录。
8. 保存。

## 两种线路类型

### 电信/联通/移动

适合已经在 Cloudflare 添加、需要优化三网访问速度的域名。所选域名需要保留一个默认线路记录指向 CDN 服务商提供的 CNAME，其他线路记录先删除。

### 默认/联通/移动

把电信优选 IP 解析到默认线路，适合给其他域名提供 CNAME 服务。所选域名需要删除全部解析记录，任务会自动添加记录。

## 执行

任务可以：

- 立即执行。
- 启停。
- 删除。
- 查看最近更新时间、成功或失败状态与错误信息。

执行时会获取优选 IP 并写入对应线路的 A 或 AAAA 记录。

## 自动更新

调度器按设置间隔自动执行启用的任务。更新频率越高，接口调用与解析变更越频繁。

## 验证

```bash
# 查看不同线路解析
dig +short www.example.com A
dig +short www.example.com A @223.5.5.5
```

也可以使用在线多地测速工具验证不同运营商结果。

## 常见问题

### xingpingcn.top 不支持 IPv6

该数据源只支持 Cloudflare IPv4。需要 IPv6 时选择其他数据源。

### 任务失败

检查接口密钥、积分、代理地址、域名解析记录状态与 Cloudflare for SaaS 配置。

### 优选后无法访问

确认默认线路或 CNAME 仍然正确，回源服务正常，且没有误删必要记录。
