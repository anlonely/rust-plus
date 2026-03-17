#!/usr/bin/env bash
# ─────────────────────────────────────────────
# Rust 工具箱 · Mac GUI 版 · 一键部署脚本
# 用途：安装依赖 + 构建 macOS DMG/ZIP 安装包
# ─────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "╔══════════════════════════════════════╗"
echo "║  Rust 工具箱 · Mac GUI 部署          ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── 检查环境 ──
if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未找到 Node.js，请先安装 Node.js 18+"
  exit 1
fi
echo "[信息] Node.js $(node -v)"

if ! command -v npm >/dev/null 2>&1; then
  echo "[错误] 未找到 npm"
  exit 1
fi

# ── 初始化 .env ──
if [[ ! -f "${PROJECT_ROOT}/.env" ]]; then
  if [[ -f "${SCRIPT_DIR}/.env.example" ]]; then
    cp "${SCRIPT_DIR}/.env.example" "${PROJECT_ROOT}/.env"
    echo "[信息] 已从 platforms/mac-gui/.env.example 生成 .env"
  elif [[ -f "${PROJECT_ROOT}/.env.example" ]]; then
    cp "${PROJECT_ROOT}/.env.example" "${PROJECT_ROOT}/.env"
    echo "[信息] 已从项目根目录 .env.example 生成 .env"
  fi
fi

# ── 安装依赖 ──
echo ""
echo "[1/3] 安装项目依赖..."
cd "${PROJECT_ROOT}"
npm install
echo "[完成] 依赖安装成功"

# ── 创建必要目录 ──
echo ""
echo "[2/3] 初始化目录..."
mkdir -p "${PROJECT_ROOT}/config" "${PROJECT_ROOT}/logs" "${PROJECT_ROOT}/assets"
echo "[完成] 目录初始化成功"

# ── 构建 macOS 安装包 ──
echo ""
echo "[3/3] 构建 macOS 安装包 (arm64)..."
cd "${PROJECT_ROOT}"
npx electron-builder --mac --arm64
echo "[完成] 构建成功"

echo ""
echo "══════════════════════════════════════"
echo "  构建产物位于: ${PROJECT_ROOT}/dist/"
echo "  可直接安装 DMG 或解压 ZIP 使用"
echo "══════════════════════════════════════"
