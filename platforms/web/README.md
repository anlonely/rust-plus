# Rust 工具箱 - Web 版

基于 Express + WebSocket 的 Web 控制台，可部署在任意 Linux/macOS 服务器上，通过浏览器远程管理 Rust+ 智能设备。

## 产品定位

Web 版和桌面 GUI 不是同一种部署形态：

- Web：公网多用户服务，需要外围账号体系与用户级数据隔离
- 桌面 GUI：个人本地部署，直接登录 Steam / Rust+，不需要外围账号注册登录

详细边界见 [../../docs/PRODUCT-BOUNDARIES.md](../../docs/PRODUCT-BOUNDARIES.md)。

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
| `WEB_PUBLIC_URL` | 对外可访问的固定回传地址，扩展优先使用它 | - |
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

## 云端 Steam 登录（无图形化）

当服务器无法弹出 Chrome 时，可使用本项目自带的本机 Chrome 扩展完成登录桥接：

推荐流程：
1. 在 Web UI 点击 Steam 配对。
2. 扩展自动打开 `https://companion-rust.facepunch.com/login`。
3. 在本机浏览器完成 Steam 登录。
4. 扩展自动回传 token 到云端 `/steam-bridge/complete`。
5. 云端写入配置并自动启动配对监听。

备用手动流程：
1. 在本机 Chrome 安装扩展目录：`platforms/chrome-rustplus-bridge`。
2. 在 Web UI 发起 Steam 登录，让网页下发当前登录任务。
3. 在扩展中点击「重新接管当前登录任务」。

连通性检查：
- `GET /steam-bridge/ping` 返回 `{\"ok\":true}` 表示桥接接口可达。

## 部署架构

```
浏览器 ──→ Nginx (443/HTTPS) ──→ Express (3080)
                                    ├── REST API
                                    ├── WebSocket (实时推送)
                                    └── 静态文件 (web/public/)
```

## 多用户工作区模型

Web 公有版当前采用“每用户一个工作区”的隔离模型：

```text
config/
└── web-users/
    ├── user_xxx/
    │   ├── servers.json
    │   ├── devices.json
    │   ├── rules.json
    │   └── rustplus.config.json
    └── user_yyy/
        ├── servers.json
        ├── devices.json
        ├── rules.json
        └── rustplus.config.json
```

说明：

- 用户 A / B 的 Steam token、FCM 配对状态、服务器列表、设备、规则完全隔离
- 禁用用户时，会同步停掉该用户当前 WebSocket / Rust+ 运行时，避免账号禁用后后台仍继续工作
- 删除用户时，会同时清理该用户工作区
- 桌面 GUI 不使用这套工作区结构，仍保持本地单用户模型

## 目录结构

```
项目根目录/
├── web/               # Web 服务端 + 前端
│   ├── server.js      # Express 入口
│   ├── public/        # 前端静态文件
│   ├── ipc-invoke.js  # IPC 调用层
│   └── event-actions.js
├── src/               # 核心业务逻辑（共享）
├── config/            # 当前默认配置目录（桌面单机场景）
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

### Web 能否直接当成多人 SaaS 长期开启？

当前已经具备“每用户工作区 + 每用户 runtime 上下文”隔离能力。  
但如果后续要继续扩到多进程 / 多实例部署，仍建议继续把 `web/server.js` 中的租户上下文管理拆到独立模块，并补跨实例 session / runtime 协调。

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
