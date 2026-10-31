---
title: Kubernetes
categories:
  - deploy
top: 80
---

# Kubernetes 部署

仓库内置 `deploy/kubernetes.yaml`，包含 Namespace、PVC、Deployment、Service 与 Ingress。

## 部署

```bash
kubectl apply -f deploy/kubernetes.yaml
kubectl -n dnsmgr-pro get pods,svc,pvc
```

查看日志：

```bash
kubectl -n dnsmgr-pro logs deploy/dnsmgr-pro -f
```

临时访问：

```bash
kubectl -n dnsmgr-pro port-forward svc/dnsmgr-pro 8082:8082
```

然后打开 `http://127.0.0.1:8082`。也可以修改 Ingress 中的 `host` 后通过域名访问。

## 清单要点

- `replicas: 1`：默认单副本。SQLite 只能单实例运行；多副本请改用 MySQL。
- PVC `dnsmgr-pro-data` 挂载到 `/app/data`，保存配置、SQLite 数据与备份。
- 容器以 UID/GID `1000` 运行，`fsGroup: 1000`，根文件系统只读。
- `/tmp` 使用 `emptyDir`，满足运行时临时文件写入。
- 启动、就绪、存活探针均访问 `/api/health`。
- 资源请求 `100m CPU / 256Mi`，内存上限 `512Mi`。数据量大时按实际监控调整。
- Ingress 默认允许 10 MB 请求体。导入大型备份时按需调大 `proxy-body-size`。

## 使用外部 MySQL

在 Deployment 的 `env` 中预置数据库连接，或保留注释并在安装页填写：

```yaml
env:
  - name: DB_TYPE
    value: mysql
  - name: DB_HOST
    value: mysql.database.svc
  - name: DB_PORT
    value: "3306"
  - name: DB_USER
    value: dnsmgr
  - name: DB_PASSWORD
    value: 请替换为强密码
  - name: DB_NAME
    value: dnsmgr
  - name: DB_PREFIX
    value: dnsmgr_
```

## 使用私有镜像

如果使用 GHCR 私有镜像，需要创建 `imagePullSecrets` 并在 Pod 模板中引用。默认清单使用 Docker Hub 公开镜像 `ssdxftx/dnsmgr-pro`。

## 升级

```bash
kubectl -n dnsmgr-pro set image deploy/dnsmgr-pro dnsmgr-pro=ssdxftx/dnsmgr-pro:1.32.0
kubectl -n dnsmgr-pro rollout status deploy/dnsmgr-pro
```

升级前请先做整站备份，并确认 PVC 已正确挂载。
