# Rust 工具箱 - Web 版

基于 Express + WebSocket 的 Web 控制台，可部署在任意 Linux/macOS 服务器上，通过浏览器远程管理 Rust+ 智能设备。

## 系统要求

- Node.js 18+
- Linux / macOS（推荐 Ubuntu 20.04+）
- 开放端口 3080（可配置）

## 快速开始

### 方式一：一键部署（推荐用于服务器）

```bash
# 非 root 模式（仅安装依赖）
bash platforms/web/deploy.sh

# root 模式（注册 systemd 服务，开机自启）
sudo bash platforms/web/deploy.sh
```

### 方式二：手动启动

```bash
# 1. 安装依赖
npm install --omit=dev

# 2. 复制并编辑配置
cp platforms/web/.env.example .env
# 编辑 .env，务必修改 WEB_API_TOKEN

# 3. 启动服务
bash platforms/web/run.sh
```

## 配置说明

首次启动时会自动从 `.env.example` 生成 `.env` 文件。

### 关键配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `WEB_HOST` | 监听地址 | `0.0.0.0` |
| `WEB_PORT` | 监听端口 | `3080` |
| `WEB_API_TOKEN` | API 访问令牌（生产必改） | `change_me_to_a_long_random_token` |
| `WEB_REQUIRE_API_TOKEN` | 是否强制鉴权 | `1` |
| `WEB_AUTO_CONNECT` | 启动时自动连接服务器 | `1` |
| `FCM_CREDENTIALS` | FCM 推送凭据 | - |
| `DISCORD_WEBHOOK_URL` | Discord 通知 Webhook | - |
| `GEMINI_API_KEY` | Gemini AI/翻译 Key | - |

### 安全建议

- **务必**修改 `WEB_API_TOKEN` 为随机字符串
- 生产环境建议启用 `WEB_REQUIRE_API_TOKEN=1`
- 建议通过反向代理 (Nginx) 添加 HTTPS
- 建议使用防火墙限制访问来源

## 部署架构

```
浏览器 ──→ Nginx (443/HTTPS) ──→ Express (3080)
                                    ├── REST API
                                    ├── WebSocket (实时推送)
                                    └── 静态文件 (web/public/)
```

## 目录结构

```
项目根目录/
├── web/               # Web 服务端 + 前端
│   ├── server.js      # Express 入口
│   ├── public/        # 前端静态文件
│   ├── ipc-invoke.js  # IPC 调用层
│   └── event-actions.js
├── src/               # 核心业务逻辑（共享）
├── config/            # 运行时配置文件
├── logs/              # 日志输出
├── platforms/
│   └── web/           # 本平台脚本
│       ├── deploy.sh  # 一键部署
│       ├── run.sh     # 启动脚本
│       ├── .env.example
│       └── README.md
```

## systemd 服务管理

如果使用 root 模式部署，服务名为 `rust-plus-web`：

```bash
# 查看状态
sudo systemctl status rust-plus-web

# 重启服务
sudo systemctl restart rust-plus-web

# 查看日志
journalctl -u rust-plus-web -f

# 停止服务
sudo systemctl stop rust-plus-web
```

## 常见问题

### 端口被占用

修改 `.env` 中的 `WEB_PORT` 为其他端口，然后重启服务。

### 无法从外网访问

1. 检查防火墙是否开放对应端口
2. 检查 `WEB_HOST` 是否设为 `0.0.0.0`（而非 `127.0.0.1`）
3. 云服务器需在安全组中放行端口

### 连接频繁断开

调整 `.env` 中的以下参数：
- `HEARTBEAT_INTERVAL`：心跳间隔（默认 60 秒）
- `MAX_RECONNECT`：最大重连次数（默认 20）
- `ACTIVITY_GRACE_MS`：活动宽限时间（默认 90000 毫秒）
