# Rust Plus Web 版（Ubuntu 一键部署）

## 1) 部署前提

- Ubuntu 20.04+（推荐 22.04 / 24.04）
- 可联网
- 已在项目目录（包含 `web/` 与 `scripts/deploy-web-ubuntu.sh`）

## 2) 一键部署

```bash
cd /path/to/rust-plus
sudo WEB_API_TOKEN="请替换为高强度随机令牌" bash scripts/deploy-web-ubuntu.sh
```

部署脚本会自动完成：

- 安装 Node.js 20（若未安装）
- 同步项目到 `/opt/rust-plus-web`
- 安装生产依赖
- 写入并启动 `systemd` 服务：`rust-plus-web`
- 默认启用 API Token 鉴权（未提供 Token 将拒绝部署）

## 3) 常用运维命令

```bash
sudo systemctl status rust-plus-web
sudo systemctl restart rust-plus-web
sudo journalctl -u rust-plus-web -f
```

## 4) 可选环境变量

通过执行前导出变量覆盖默认值：

```bash
sudo APP_DIR=/opt/rust-plus-web WEB_PORT=3080 RUN_USER=ubuntu WEB_API_TOKEN="请替换" bash scripts/deploy-web-ubuntu.sh
```

- `APP_DIR`：部署目录（默认 `/opt/rust-plus-web`）
- `WEB_PORT`：Web 服务端口（默认 `3080`）
- `WEB_PUBLIC_URL`：对外固定回传地址，扩展优先使用它
- `RUN_USER`：服务运行用户（默认当前 sudo 用户）
- `SERVICE_NAME`：systemd 服务名（默认 `rust-plus-web`）
- `NODE_MAJOR`：Node 主版本（默认 `20`）
- `WEB_API_TOKEN`：Web 鉴权令牌（默认必填）
- `WEB_REQUIRE_API_TOKEN`：是否强制鉴权（默认 `1`，仅内网临时调试可设 `0`）

## 5) 安全建议

- 生产环境务必保留 `WEB_REQUIRE_API_TOKEN=1`，并使用高强度 `WEB_API_TOKEN`。
- 前端首次打开后在左侧输入同一 Token 保存。
- 建议通过 Nginx 反代并启用 HTTPS。
