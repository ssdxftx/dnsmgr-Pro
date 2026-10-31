---
title: 部署方式
categories:
  - deploy
top: 100
---

# 部署方式

## 运行要求

- Docker 部署：Docker 20.10+，建议分配 1 核 CPU、512 MB 以上内存。
- 宿主机部署：Node.js 22.13+，推荐 22.22；MySQL 5.7+ 或 MariaDB。
- 证书 PFX 导出与部分部署目标需要 `openssl`。
- 默认端口 `8082`。
- 持久化目录 `/app/data` 保存安装配置、SQLite 数据、备份与审计缓冲。

## 选择部署方式

| 方式 | 适合场景 | 特点 |
| --- | --- | --- |
| Docker 单容器 | 个人、小团队 | 最快，升级简单 |
| Docker Compose | 需要固定配置或内置数据库 | 可维护 compose 与环境变量 |
| Kubernetes | 集群环境、统一运维 | 内置 PVC、探针与 Ingress 清单 |
| 宿主机 | 已有 Node.js 环境、二次开发 | 便于调试与自定义进程管理 |

生产环境建议使用 MySQL，尤其是多副本或网络存储场景。SQLite 适合单实例部署。

## 网络与域名

首次启动不需要域名，直接用 `http://服务器IP:8082` 完成安装。生产环境建议在前面放 Nginx、Caddy 或云负载均衡，并启用 HTTPS。

## 部署后的检查

```bash
# 容器状态
docker ps --filter name=dnsmgr

# 健康检查
curl -fsS http://127.0.0.1:8082/api/health

# 就绪检查，数据库异常或维护模式会返回 503
curl -fsS http://127.0.0.1:8082/api/ready
```

`/api/health` 返回 `{ "code": 0, "data": "ok" }` 表示进程已启动。首次打开页面会自动进入安装向导。

## 相关页面

- [Docker 与 Compose](/deploy/docker)
- [Docker Compose 独立配置](/deploy/compose)
- [Kubernetes](/deploy/kubernetes)
- [宿主机运行](/deploy/source)
- [初始化安装](/deploy/install)
- [反向代理与 HTTPS](/deploy/proxy)
- [升级与回滚](/deploy/upgrade)
