#!/bin/sh
# Spine 版本转换工具 —— 容器启动入口
#
# 职责：
#   1. 解析 DATABASE_URL 中的 SQLite 路径，相对路径统一落到 /app/data
#   2. 首次启动（库文件不存在或为空）时按 docker/init.sql 建库
#   3. exec 交接给 Next.js standalone 服务器（PID 1，正确接收信号）
set -e

DB_PATH="${DATABASE_URL#file:}"

if [ -n "$DB_PATH" ]; then
    case "$DB_PATH" in
        /*) ;;  # 绝对路径，直接使用
        *)
            DB_PATH="/app/data/$DB_PATH"
            DATABASE_URL="file:$DB_PATH"
            export DATABASE_URL
            ;;
    esac

    if [ ! -s "$DB_PATH" ]; then
        echo "[entrypoint] 数据库不存在，执行首次建库: $DB_PATH"
        mkdir -p "$(dirname "$DB_PATH")" || {
            echo "[entrypoint] 无法创建数据目录 $(dirname "$DB_PATH")，请检查卷挂载权限（需要 uid 1001 可写）" >&2
            exit 1
        }
        bun ./docker/init-db.ts
    fi
fi

echo "[entrypoint] 启动 spine-convert（端口 ${PORT:-3000}）"
exec bun server.js
