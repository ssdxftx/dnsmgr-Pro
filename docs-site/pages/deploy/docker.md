---
title: Docker 与 Compose
categories:
  - deploy
top: 90
---

# Docker 与 Compose

## 直接拉取镜像

```bash
docker run -d \
  --name dnsmgr-pro \
  -p 8082:8082 \
  -v dnsmgr-pro-data:/app/data \
  --restart always \
  ssdxftx/dnsmgr-pro:latest
```

启动后访问：

```text
http://服务器IP:8082
```

镜像同时发布到 Docker Hub 与 GHCR。需要固定版本时使用明确标签：

```bash
docker pull ssdxftx/dnsmgr-pro:1.32.0
```

## 数据目录与权限

镜像默认以 `node` 用户（UID/GID `1000`）运行。新建命名卷会自动继承镜像内 `/app/data` 的权限。

从旧版 root 镜像升级，或使用宿主机目录挂载时，请先修正权限：

```bash
# 命名卷
docker run --rm -v dnsmgr-pro-data:/app/data alpine chown -R 1000:1000 /app/data

# 宿主机目录
sudo chown -R 1000:1000 /path/to/dnsmgr-data
```

宿主机目录挂载示例：

```bash
docker run -d \
  --name dnsmgr-pro \
  -p 8082:8082 \
  -v /opt/dnsmgr-pro/data:/app/data \
  --restart always \
  ssdxftx/dnsmgr-pro:latest
```

## 常用环境变量

| 变量 | 说明 |
| --- | --- |
| `TZ` | 时区，默认 `Asia/Shanghai` |
| `DNSMGR_DATA_DIR` | 数据目录，容器内默认 `/app/data` |
| `DNSMGR_SETUP_TOKEN` | 固定安装令牌；不设置时首次启动自动生成并打印到日志 |
| `DB_TYPE` | `sqlite` 或 `mysql`，安装页填写会覆盖 |
| `DB_FILE` | SQLite 文件名，默认 `dnsmgr.sqlite` |
| `DNSMGR_DATA_PERSISTENT` | 无法识别挂载信息时强制声明持久化目录 |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` / `DB_PREFIX` | MySQL 连接预置 |
| `DNSMGR_TRUST_PROXY` | 位于 Nginx/CDN 后时设置，使用真实客户端 IP |
| `DNSMGR_ALLOWED_ORIGINS` | 跨域 API 来源白名单，逗号分隔 |
| `DNSMGR_RATE_LIMIT` | 设为 `0` 关闭敏感接口限流 |
| `DNSMGR_API_KEY_RATE_LIMIT` | 每把 API Key 每分钟请求上限，默认 `600` |

完整列表见仓库根目录 `.env.example` 和 [系统设置](/system/settings)。

## 使用 Docker Compose

```bash
git clone https://github.com/ssdxftx/dnsmgr-Pro.git dnsmgr-pro
cd dnsmgr-pro
docker compose up -d --build
```

`docker-compose.yml` 默认只启动应用，并把数据保存到命名卷 `app-data`。如需一并启动 MySQL，取消文件中 `mysql` 服务的注释，并在安装页把数据库主机填写为 `mysql`。

创建 `.env` 可覆盖端口与数据库参数：

```bash
APP_PORT=8082
MYSQL_ROOT_PASSWORD=请替换为强密码
```

```bash
docker compose up -d
```

## 查看日志与健康状态

```bash
docker logs -f --tail=200 dnsmgr-pro
docker inspect --format '{{.State.Health.Status}}' dnsmgr-pro
```

日志出现“未安装，等待初始化”属于正常状态。首次打开页面会进入安装向导。

## 安装令牌

安装接口需要安装令牌。未设置 `DNSMGR_SETUP_TOKEN` 时，启动日志会打印一次性令牌：

```bash
docker logs dnsmgr-pro 2>&1 | grep -i setup
```

也可以启动时固定：

```bash
-e DNSMGR_SETUP_TOKEN=请替换为随机长字符串
```

## 停止与删除

```bash
docker stop dnsmgr-pro
docker rm dnsmgr-pro
```

删除容器不会删除命名卷。确认不再需要数据后，再按宿主机规范清理卷。
