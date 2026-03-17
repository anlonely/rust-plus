#!/usr/bin/env bash
# ─────────────────────────────────────────────
# Rust 工具箱 · Web 版 · 一键部署脚本
# 用途：在 Linux/macOS 服务器上部署 Web 控制台
# 支持 systemd 服务注册（需 root 权限）
# 也支持非 root 模式（仅安装依赖，手动启动）
# ─────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "╔══════════════════════════════════════╗"
echo "║  Rust 工具箱 · Web 版部署            ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── 检查环境 ──
if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未找到 Node.js，请先安装 Node.js 18+"
  echo "  Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt-get install -y nodejs"
  echo "  macOS: brew install node"
  exit 1
fi
echo "[信息] Node.js $(node -v)"

# ── 安装依赖（仅生产依赖）──
echo ""
echo "[1/4] 安装生产依赖..."
cd "${PROJECT_ROOT}"
npm install --omit=dev
echo "[完成] 依赖安装成功"

# ── 初始化目录 ──
echo ""
echo "[2/4] 初始化目录..."
mkdir -p "${PROJECT_ROOT}/config" "${PROJECT_ROOT}/logs"
echo "[完成] 目录初始化成功"

# ── 初始化 .env ──
echo ""
echo "[3/4] 初始化配置..."
if [[ ! -f "${PROJECT_ROOT}/.env" ]]; then
  if [[ -f "${SCRIPT_DIR}/.env.example" ]]; then
    cp "${SCRIPT_DIR}/.env.example" "${PROJECT_ROOT}/.env"
    echo "[信息] 已从 platforms/web/.env.example 生成 .env"
    echo "[重要] 请编辑 .env 文件，设置 WEB_API_TOKEN 等安全参数"
  elif [[ -f "${PROJECT_ROOT}/.env.example" ]]; then
    cp "${PROJECT_ROOT}/.env.example" "${PROJECT_ROOT}/.env"
    echo "[信息] 已从项目根目录 .env.example 生成 .env"
  fi
else
  echo "[信息] .env 已存在，跳过"
fi

# ── systemd 服务（可选，需 root）──
echo ""
echo "[4/4] 配置系统服务..."

SERVICE_NAME="${SERVICE_NAME:-rust-plus-web}"
WEB_PORT="${WEB_PORT:-3080}"

if [[ "${EUID:-$(id -u)}" -eq 0 ]] && command -v systemctl >/dev/null 2>&1; then
  RUN_USER="${RUN_USER:-${SUDO_USER:-root}}"
  RUN_GROUP="${RUN_GROUP:-${RUN_USER}}"

  chown -R "${RUN_USER}:${RUN_GROUP}" "${PROJECT_ROOT}"

  cat >/etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=Rust Plus Web Console
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_ROOT}
EnvironmentFile=${PROJECT_ROOT}/.env
ExecStart=$(command -v node) ${PROJECT_ROOT}/web/server.js
Restart=always
RestartSec=3
User=${RUN_USER}
Group=${RUN_GROUP}

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}"
  echo "[完成] systemd 服务已注册并启动"
  systemctl --no-pager --full status "${SERVICE_NAME}" || true
else
  echo "[信息] 非 root 模式或无 systemd，跳过服务注册"
  echo "[提示] 可使用以下命令手动启动："
  echo "  bash platforms/web/run.sh"
fi

echo ""
echo "══════════════════════════════════════"
echo "  部署完成"
echo "  访问地址: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):${WEB_PORT}"
echo "  手动启动: bash platforms/web/run.sh"
echo "  查看日志: tail -f logs/app.log"
echo "══════════════════════════════════════"
