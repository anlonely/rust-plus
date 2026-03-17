#!/usr/bin/env bash
# ─────────────────────────────────────────────
# Rust 工具箱 · Mac GUI 版 · 启动脚本
# 用途：以开发模式直接启动 Electron GUI
# ─────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "╔══════════════════════════════════════╗"
echo "║  Rust 工具箱 · Mac GUI 启动          ║"
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
  cd "${PROJECT_ROOT}" && npm install
fi

# ── 初始化 .env ──
if [[ ! -f "${PROJECT_ROOT}/.env" ]]; then
  if [[ -f "${SCRIPT_DIR}/.env.example" ]]; then
    cp "${SCRIPT_DIR}/.env.example" "${PROJECT_ROOT}/.env"
    echo "[信息] 已自动生成 .env，请按需修改配置"
  elif [[ -f "${PROJECT_ROOT}/.env.example" ]]; then
    cp "${PROJECT_ROOT}/.env.example" "${PROJECT_ROOT}/.env"
    echo "[信息] 已自动生成 .env，请按需修改配置"
  fi
fi

# ── 启动 GUI ──
echo "[信息] 正在启动 Electron GUI..."
cd "${PROJECT_ROOT}"
npx electron .
