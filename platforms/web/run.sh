#!/usr/bin/env bash
# ─────────────────────────────────────────────
# Rust 工具箱 · Web 版 · 启动脚本
# 用途：启动 Express Web 控制台服务
# ─────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "╔══════════════════════════════════════╗"
echo "║  Rust 工具箱 · Web 控制台启动        ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── 检查环境 ──
if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未找到 Node.js，请先安装 Node.js 18+"
  exit 1
fi

# ── 检查依赖 ──
if [[ ! -d "${PROJECT_ROOT}/node_modules" ]]; then
  echo "[信息] 未检测到 node_modules，正在安装依赖..."
  cd "${PROJECT_ROOT}" && npm install --omit=dev
fi

# ── 初始化 .env ──
if [[ ! -f "${PROJECT_ROOT}/.env" ]]; then
  if [[ -f "${SCRIPT_DIR}/.env.example" ]]; then
    cp "${SCRIPT_DIR}/.env.example" "${PROJECT_ROOT}/.env"
    echo "[信息] 已自动生成 .env，请按需修改配置"
    echo "[重要] 生产环境请务必修改 WEB_API_TOKEN"
  elif [[ -f "${PROJECT_ROOT}/.env.example" ]]; then
    cp "${PROJECT_ROOT}/.env.example" "${PROJECT_ROOT}/.env"
    echo "[信息] 已自动生成 .env，请按需修改配置"
  fi
fi

# ── 启动 Web 服务 ──
echo "[信息] 正在启动 Web 控制台..."
cd "${PROJECT_ROOT}"
exec node web/server.js
