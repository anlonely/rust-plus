#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "请用 root 执行: sudo bash scripts/deploy-web-ubuntu.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

APP_DIR="${APP_DIR:-/opt/rust-plus-web}"
SERVICE_NAME="${SERVICE_NAME:-rust-plus-web}"
NODE_MAJOR="${NODE_MAJOR:-20}"
WEB_PORT="${WEB_PORT:-3080}"
RUN_USER="${RUN_USER:-${SUDO_USER:-root}}"
RUN_GROUP="${RUN_GROUP:-${RUN_USER}}"
WEB_API_TOKEN="${WEB_API_TOKEN:-}"
WEB_REQUIRE_API_TOKEN="${WEB_REQUIRE_API_TOKEN:-1}"

if [[ "${WEB_REQUIRE_API_TOKEN}" != "0" && -z "${WEB_API_TOKEN}" ]]; then
  echo "安全保护：请设置 WEB_API_TOKEN 后再部署。"
  echo "示例：sudo WEB_API_TOKEN=\"$(openssl rand -hex 24 2>/dev/null || echo 'replace_with_random_token')\" bash scripts/deploy-web-ubuntu.sh"
  exit 1
fi

echo "[1/8] 安装系统依赖..."
apt-get update -y
apt-get install -y ca-certificates curl git rsync

if ! command -v node >/dev/null 2>&1; then
  echo "[2/8] 安装 Node.js ${NODE_MAJOR}..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
else
  echo "[2/8] Node.js 已安装: $(node -v)"
fi

echo "[3/8] 同步项目到 ${APP_DIR} ..."
mkdir -p "${APP_DIR}"
rsync -a --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "dist" \
  "${PROJECT_DIR}/" "${APP_DIR}/"

chown -R "${RUN_USER}:${RUN_GROUP}" "${APP_DIR}"

echo "[4/8] 安装生产依赖..."
sudo -u "${RUN_USER}" npm --prefix "${APP_DIR}" install --omit=dev

echo "[5/8] 写入 systemd 服务..."
cat >/etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=Rust Plus Web Console
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=WEB_PORT=${WEB_PORT}
Environment=WEB_API_TOKEN=${WEB_API_TOKEN}
Environment=WEB_REQUIRE_API_TOKEN=${WEB_REQUIRE_API_TOKEN}
ExecStart=/usr/bin/env npm run start:web
Restart=always
RestartSec=3
User=${RUN_USER}
Group=${RUN_GROUP}

[Install]
WantedBy=multi-user.target
EOF

echo "[6/8] 启动服务..."
systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"

echo "[7/8] 服务状态..."
systemctl --no-pager --full status "${SERVICE_NAME}" || true

echo "[8/8] 完成"
echo "访问地址: http://$(hostname -I | awk '{print $1}'):${WEB_PORT}"
echo "查看日志: journalctl -u ${SERVICE_NAME} -f"
