# syntax=docker/dockerfile:1

# ---------- 构建阶段：安装依赖 + 生产构建 ----------
FROM oven/bun:1 AS builder
WORKDIR /app

# prisma migrate diff 解析 schema 时要求 DATABASE_URL 存在，提供占位值（不连库）
ENV DATABASE_URL="file:./build-placeholder.db"

# 先复制依赖清单，充分利用层缓存
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# 复制源码（.dockerignore 已排除 .env / node_modules / research / db 等）
COPY . .

# 生成 Prisma Client（类型检查与构建需要）
RUN bun run db:generate

# 生成首次启动建库 SQL（运行时由 bun 内置 SQLite 执行，镜像无需携带 Prisma CLI 与引擎）
RUN bunx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > docker-init.sql

# 生产构建（next build + standalone 组装，见 package.json 的 build 脚本）
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# ---------- 运行阶段：仅携带 standalone 产物 ----------
FROM oven/bun:1-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL="file:/app/data/prod.db"

# 使用镜像自带的 bun 用户（uid/gid 1000，slim 变体无 adduser/addgroup 脚本）
RUN mkdir -p /app/data \
 && chown -R bun:bun /app/data

# standalone 产物（server.js + 精简 node_modules + .next/static + public，约 76MB）
COPY --from=builder --chown=bun:bun /app/.next/standalone ./

# 容器辅助脚本 + 建库 SQL
COPY --chown=bun:bun docker/ ./docker/
COPY --from=builder --chown=bun:bun /app/docker-init.sql ./docker/init.sql

USER bun
VOLUME /app/data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD bun /app/docker/healthcheck.ts

ENTRYPOINT ["/bin/sh", "/app/docker/entrypoint.sh"]
