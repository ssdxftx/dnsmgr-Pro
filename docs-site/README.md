# 彩虹 DNS Pro 使用文档

本目录是彩虹 DNS Pro 的完整使用文档站点，基于 [Valaxy](https://github.com/YunYouJun/valaxy) 与 `valaxy-theme-press` 构建，页面组织方式参考 OpenList-Docs。

## 内容范围

- 部署与升级：Docker、Compose、Kubernetes、宿主机、初始化、反向代理、升级回滚
- 域名与解析：账户、域名、记录、批量操作、授权、到期提醒、劫持检测
- CDN：账户、接入、设置、缓存、统计、站点规则、Cloudflare 与 ESA
- 证书与部署：证书账户、订单、CNAME 代理、自动部署、自动续签
- 运维：容灾切换、定时切换、CF 优选 IP、备份恢复、凭证保险库
- 系统：用户、通知、审计、系统设置、偏好与 TOTP
- API：认证、API Key、幂等、异步任务、事件回调、调用示例
- 常见问题：故障排查、迁移、安全加固

## 本地开发

```bash
cd docs-site
npm install
npm run dev
```

默认访问 `http://localhost:4859`。

## 构建

```bash
npm run build
```

静态产物输出到 `docs-site/dist`。构建使用 SSG，每个页面都会生成独立的 `index.html`。

## 预览构建产物

```bash
npm run preview -- --host 0.0.0.0 --port 4859
```

## 静态托管

把 `dist` 目录交给 Nginx、Caddy 或对象存储静态托管。使用 Nginx 时建议配置目录索引与 SPA 回退：

```nginx
server {
    listen 80;
    server_name docs.example.com;
    root /var/www/dnsmgr-pro-docs;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## 目录结构

```text
docs-site/
├── pages/                 # Markdown 文档
│   ├── guide/             # 使用指南
│   ├── deploy/            # 部署与升级
│   ├── dns/               # 域名与解析
│   ├── cdn/               # CDN
│   ├── cert/              # 证书与部署
│   ├── ops/               # 运维与自动化
│   ├── system/            # 系统管理
│   ├── api/               # API 集成
│   └── faq/               # 常见问题
├── layouts/home.vue       # 首页布局
├── locales/zh-CN.yml      # 分类中文名
├── public/                # 站点图标
├── valaxy.config.ts       # Valaxy 配置
└── preview.config.ts      # 本地预览 Host 配置
```

## 写作约定

- 每页使用 `title` 与 `categories` frontmatter。
- `top` 控制侧边栏排序，数值越大越靠前。
- 使用 `::: tip`、`::: warning`、`::: danger` 提示块。
- 操作步骤按“入口 → 字段 → 保存 → 验证”组织。
- 涉及危险操作时说明影响范围与回滚方式。
