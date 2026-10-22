# ---- 前端构建阶段 ----
FROM node:22.22.0-alpine AS web
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- 应用运行阶段 ----
# Node 22.22 内置 node:sqlite（无需实验性启动参数）
FROM node:22.22.0-alpine
WORKDIR /app

# buildPfx（证书 PFX 下载 / PFX 部署）依赖 openssl CLI；unzip 用于证书包解压。
# 显式安装，避免依赖基础镜像的偶然内容（alpine 基础镜像不含 openssl）。
RUN apk add --no-cache openssl unzip

ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    PORT=8082 \
    DNSMGR_WEB_DIR=/app/web \
    DNSMGR_DATA_DIR=/app/data

# 后端依赖（含 tsx，用于运行 TypeScript 源码）
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY backend/ ./

# 前端构建产物
COPY --from=web /build/dist /app/web

RUN mkdir -p /app/data

EXPOSE 8082

# 直接用 node 加载 tsx，避免 npx -> tsx CLI -> 应用 三层进程；
# 同时保留 TypeScript 源码运行方式，不改变现有构建与数据目录布局
CMD ["node", "--import", "tsx", "src/index.ts"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8082/api/health || exit 1
