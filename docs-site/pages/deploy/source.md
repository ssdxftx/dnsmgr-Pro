---
title: 宿主机运行
categories:
  - deploy
top: 70
---

# 宿主机运行

## 前置条件

- Node.js 22.13+，推荐 22.22。
- MySQL 5.7+ 或 MariaDB。
- `openssl`，用于 PFX 导出与部分部署目标。
- 可选：Nginx、Caddy 或其他反向代理。

## 安装依赖

```bash
git clone https://github.com/ssdxftx/dnsmgr-Pro.git
cd dnsmgr-Pro

cd backend
npm install

cd ../frontend
npm install
```

## 开发模式

终端一：

```bash
cd backend
npx tsx src/index.ts
```

终端二：

```bash
cd frontend
npm run dev
```

前端开发服务器默认 `5173`，会把 `/api` 代理到 `http://localhost:8082`。开发预览访问 `http://localhost:5173`。

## 生产构建

```bash
cd frontend
npm run build
```

构建产物输出到 `frontend/dist`。后端可通过 `DNSMGR_WEB_DIR` 指向该目录，由同一 Fastify 进程提供静态文件：

```bash
cd backend
DNSMGR_WEB_DIR=../frontend/dist npx tsx src/index.ts
```

也可以把 `frontend/dist` 交给 Nginx 托管，并把 `/api` 反向代理到 `127.0.0.1:8082`。

## 数据与环境变量

安装配置默认写入 `backend/data/config.json`。可用环境变量覆盖：

```bash
DNSMGR_DATA_DIR=/var/lib/dnsmgr-pro
DNSMGR_WEB_DIR=/opt/dnsmgr-pro/web
PORT=8082
TZ=Asia/Shanghai
```

数据库参数 `DB_TYPE`、`DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`、`DB_PREFIX` 可在安装页填写，安装页会覆盖环境变量。

## systemd 示例

创建运行用户并准备目录：

```bash
sudo useradd --system --home /opt/dnsmgr-pro --shell /usr/sbin/nologin dnsmgr
sudo mkdir -p /opt/dnsmgr-pro/data
sudo chown -R dnsmgr:dnsmgr /opt/dnsmgr-pro
```

`/etc/systemd/system/dnsmgr-pro.service`：

```ini
[Unit]
Description=Rainbow DNS Pro
After=network.target

[Service]
Type=simple
User=dnsmgr
WorkingDirectory=/opt/dnsmgr-pro/backend
Environment=NODE_ENV=production
Environment=PORT=8082
Environment=DNSMGR_DATA_DIR=/opt/dnsmgr-pro/data
Environment=DNSMGR_WEB_DIR=/opt/dnsmgr-pro/web
ExecStart=/usr/bin/node --import tsx src/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dnsmgr-pro
sudo systemctl status dnsmgr-pro
```

## 升级

```bash
git pull
cd backend && npm install
cd ../frontend && npm install && npm run build
sudo systemctl restart dnsmgr-pro
```

升级前先完成整站备份。启动时会自动执行数据库迁移。
