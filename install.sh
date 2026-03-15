#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未找到 Node.js，请先安装 Node.js 18+"
  exit 1
fi

echo "[1/2] 安装依赖..."
npm install

echo "[2/2] 初始化 .env（若不存在）..."
if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
  echo "已生成 .env（可按需填写 API Key）"
fi

echo "安装完成。可运行: ./start_gui.sh"
