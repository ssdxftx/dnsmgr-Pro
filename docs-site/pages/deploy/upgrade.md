---
title: 升级与回滚
categories:
  - deploy
top: 40
---

# 升级与回滚

## 升级前

1. 在“备份与恢复”创建一次整站备份，并确认备份成功。
2. 记录当前版本与镜像标签。
3. 确认 `/app/data` 已持久化。
4. 查看目标版本的发布说明，确认没有破坏性变更。

## Docker 升级

```bash
docker pull ssdxftx/dnsmgr-pro:1.32.0
docker stop dnsmgr-pro
docker rm dnsmgr-pro
```

重新运行容器，数据目录保持不变：

```bash
docker run -d \
  --name dnsmgr-pro \
  -p 8082:8082 \
  -v dnsmgr-pro-data:/app/data \
  --restart always \
  ssdxftx/dnsmgr-pro:1.32.0
```

也可以只修改 Compose 镜像标签后执行：

```bash
docker compose pull
docker compose up -d
```

## Compose 自建镜像升级

```bash
git pull
docker compose build --pull
docker compose up -d
```

## Kubernetes 升级

```bash
kubectl -n dnsmgr-pro set image deploy/dnsmgr-pro dnsmgr-pro=ssdxftx/dnsmgr-pro:1.32.0
kubectl -n dnsmgr-pro rollout status deploy/dnsmgr-pro
```

## 数据库迁移

启动时会自动执行迁移。已有表只补充缺失的表、列与索引，不会清空数据。升级后查看日志确认迁移完成：

```bash
docker logs --tail=200 dnsmgr-pro
```

SQLite 升级需要确保数据文件、WAL 与 SHM 文件位于同一持久化目录。升级前建议停止写入。

## 从旧 root 镜像升级

新版镜像以 `node` 用户运行。若数据目录仍由 root 拥有，需要修正权限：

```bash
docker run --rm -v dnsmgr-pro-data:/app/data alpine chown -R 1000:1000 /app/data
```

宿主机目录：

```bash
sudo chown -R 1000:1000 /path/to/dnsmgr-data
```

## 回滚

1. 停止当前容器。
2. 使用旧版本镜像启动。
3. 如果新版本已执行不兼容迁移，使用升级前的整站备份恢复。

```bash
docker run -d \
  --name dnsmgr-pro \
  -p 8082:8082 \
  -v dnsmgr-pro-data:/app/data \
  --restart always \
  ssdxftx/dnsmgr-pro:旧版本
```

回滚后检查：

```bash
curl -fsS http://127.0.0.1:8082/api/health
curl -fsS http://127.0.0.1:8082/api/ready
```

## 版本与镜像标签

- 发布标签 `vX.Y.Z` 会生成 `X.Y.Z`、`X.Y`、`X`、`latest` 与 SHA 标签。
- 推送到 `main` 且版本号变化时也会构建镜像。
- 版本号未变化时跳过镜像构建。

生产环境建议固定明确版本，不使用 `latest`。
