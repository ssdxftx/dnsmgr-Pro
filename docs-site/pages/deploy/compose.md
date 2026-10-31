---
title: Docker Compose
categories:
  - deploy
top: 85
---

# Docker Compose

Compose 适合需要固定端口、环境变量、内置数据库或自建镜像的场景。

## 启动

```bash
git clone https://github.com/ssdxftx/dnsmgr-Pro.git dnsmgr-pro
cd dnsmgr-pro
docker compose up -d --build
```

访问 `http://服务器IP:8082`，进入安装向导。

## 默认配置

仓库中的 `docker-compose.yml` 默认：

- 服务名 `app`，容器名 `dnsmgr-app`。
- 端口 `${APP_PORT:-8082}:8082`。
- 数据卷 `app-data:/app/data`。
- 健康检查 `/api/health`。
- 日志轮转 10 MB，保留 3 份。
- 时区 `Asia/Shanghai`。

## 修改端口

创建 `.env`：

```bash
APP_PORT=8088
```

重新启动：

```bash
docker compose up -d
```

## 使用内置 MySQL

取消 `docker-compose.yml` 中 `mysql` 服务与 `mysql-data` 卷的注释，并设置强密码：

```bash
MYSQL_ROOT_PASSWORD=请替换为强密码
```

启动：

```bash
docker compose up -d
```

安装页数据库主机填写 `mysql`，端口 `3306`，数据库名与账号按 Compose 配置填写。建议单独创建应用账号，不使用 root。

## 预置数据库连接

也可以不启用内置 MySQL，直接连接外部数据库。取消应用 `environment` 中的注释并填写：

```yaml
environment:
  DB_TYPE: mysql
  DB_HOST: mysql.example.com
  DB_PORT: "3306"
  DB_USER: dnsmgr
  DB_PASSWORD: 请替换为强密码
  DB_NAME: dnsmgr
  DB_PREFIX: dnsmgr_
```

安装页填写会覆盖环境变量。

## 数据与权限

命名卷 `app-data` 保存配置、SQLite 数据、备份与审计缓冲。容器以 UID/GID `1000` 运行。

从旧版 root 镜像升级后修正权限：

```bash
docker run --rm -v dnsmgr-pro-data:/app/data alpine chown -R 1000:1000 /app/data
```

实际卷名可能带项目前缀，可用 `docker volume ls` 查看。

## 常用命令

```bash
# 查看状态
docker compose ps

# 查看日志
docker compose logs -f --tail=200 app

# 重启
docker compose restart app

# 拉取新版本
docker compose pull
docker compose up -d

# 停止
docker compose down
```

`docker compose down` 不会删除命名卷。确认不再需要数据后再按宿主机规范清理。

## 升级

```bash
git pull
docker compose build --pull
docker compose up -d
```

升级前先做整站备份。启动时自动执行数据库迁移。

## 常见问题

### 容器启动后立即退出

查看日志。常见原因是数据目录权限、数据库连接失败或配置损坏。

### SQLite 不可用

确认 `/app/data` 已挂载。无法识别挂载信息时设置 `DNSMGR_DATA_PERSISTENT=1`。

### 端口被占用

修改 `.env` 中的 `APP_PORT`，或停止占用端口的进程。
