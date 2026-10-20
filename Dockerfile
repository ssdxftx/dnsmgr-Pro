# ---- 前端构建阶段 ----
FROM node:22-alpine AS web
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- 应用运行阶段 ----
FROM node:22-alpine
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

CMD ["npx", "tsx", "src/index.ts"]