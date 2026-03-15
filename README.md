# 🎮 Rust 工具箱 v1.0

> Rust+ 智能设备管理平台 · 基于官方 Rust+ 协议 · 完整 GUI 桌面应用

---

## 🌐 Web 版（新增）

- 启动命令：`npm run start:web`
- 本地入口：`http://127.0.0.1:3080`
- Ubuntu 一键部署：见 `docs/WEB_UBUNTU_DEPLOY.md`

---

## 🚀 快速开始

### 系统要求
- **Node.js 18+** — [下载](https://nodejs.org)
- **Windows 10 / macOS 12 / Ubuntu 20+**

### 安装步骤

```bash
# macOS / Linux
./install.sh

# Windows
双击 install.bat

# 启动 GUI
./start_gui.sh
# 或双击 start_gui.bat（Windows）

# 启动 Web 版
./start_web.sh
```

---

## 📁 项目结构

```
rust-plus/
├── electron/
│   ├── main.js          # Electron 主进程
│   ├── preload.js       # 安全桥接层
│   └── renderer/
│       └── index.html   # 完整 GUI 界面
├── src/
│   ├── index.js         # CLI 主入口
│   ├── pairing/fcm.js   # FCM 配对监听
│   ├── connection/client.js  # WebSocket 管理
│   ├── events/engine.js      # 事件逻辑引擎（20+种）
│   ├── commands/parser.js    # 指令解析器（9种）
│   ├── notify/service.js     # 通知服务
│   ├── call/groups.js        # 呼叫组（互亿无线/Twilio）
│   ├── ai/client.js          # AI 问答（Gemini）
│   ├── translate/client.js   # 翻译（DeepL/MyMemory）
│   └── storage/
│       └── config.js         # 配置持久化
├── config/              # 运行时配置（自动生成）
├── logs/                # 日志文件
├── start_gui.bat        # ← GUI 启动
├── start_gui.sh         # ← GUI 启动（macOS/Linux）
├── start_pair.bat       # ← 配对模式
├── start_pair.sh        # ← 配对模式（macOS/Linux）
├── start.bat            # ← CLI 启动
├── start.sh             # ← CLI 启动（macOS/Linux）
├── status.sh            # ← 状态查看（macOS/Linux）
└── install.bat          # ← 一键安装
└── install.sh           # ← 一键安装（macOS/Linux）
```

---

## 🖥️ GUI 功能

| 页面 | 功能 |
|------|------|
| 控制台 | 连接状态、服务器信息、队伍成员、事件通知 |
| 设备配对 | 服务器配对流程、已配对服务器管理 |
| 设备管理 | 开关/警报器列表、实时控制 |
| 事件逻辑 | 20+ 种事件规则配置 |
| 指令逻辑 | 11 种团队聊天指令 |
| 呼叫组 | 紧急语音通知配置 |
| 运行日志 | 实时日志查看 |
| 帮助文档 | 指令/事件/变量完整说明 |

---

## ⚡ 支持的事件（20+ 种）

**警报器** · alarm_on / alarm_off  
**队伍** · player_online / offline / afk  
**载具** · 武装直升机 / 军用直升机 / 货船  
**商人** · 流浪商人出现/移动/停留  
**时间** · 整点报时

---

## 💬 游戏内指令

| 指令 | 功能 | 权限 |
|------|------|------|
| `fwq` | 查看服务器信息 | 所有人 |
| `hc`  | 货船位置 | 所有人 |
| `wz`  | 武装直升机位置 | 所有人 |
| `sh`  | 深海状态 | 所有人 |
| `fy <文字>` | 翻译 | 所有人 |
| `ai <问题>` | AI 问答 | 所有人 |
| `shj <物品>[/货币]` | 查询售货机，可筛最低价与其他支付方式 | 所有人 |
| `fk <开\|关\|切换> [关键词]` | 控制指令规则里绑定的一个/多个开关 | 仅队长 |
| `dz <名>` | 更改队长 | 仅队长 |
| `kk [名字]` | 随机夸赞 | 所有人 |
| `help` | 查看指令列表 | 所有人 |

补充说明：
- `shj 高级蓝图/硫磺` 可按指定货币筛选，并只显示最低价前 3 条。
- 石油事件整合默认返回方向，例如 `大石油重装已呼叫｜方向：E`。
- GUI 与 web 若同时连接同一服务器，会各自发送队伍消息。

完整变量与模板说明见 [docs/HELP.md](docs/HELP.md)

---

## 🔧 可选配置（.env）

```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
GEMINI_API_KEY=...
GEMINI_TRANSLATE_MODEL=gemini-2.5-flash
FY_TRANSLATE_RPM=15
IHUYI_VM_API_ID=VM...
IHUYI_VM_API_KEY=...
IHUYI_VM_ENDPOINT=https://api.ihuyi.com/vm/Submit.json
IHUYI_VM_FORMAT=json
# 未配置互亿无线时，可回退到 Twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1...
MAX_RECONNECT=20
HEARTBEAT_INTERVAL=60
REQUEST_TIMEOUT_MS=30000
HEARTBEAT_FAIL_RECONNECT=8
ACTIVITY_GRACE_MS=90000
WEB_HOST=127.0.0.1
WEB_PORT=3080
WEB_API_TOKEN=change_me_to_a_long_random_token
WEB_REQUIRE_API_TOKEN=1
```

---

## 开发进度

| 阶段 | 状态 | 内容 |
|------|------|------|
| P0 | ✅ | FCM 配对、配置存储 |
| P1 | ✅ | WebSocket 连接管理 |
| P2 | ✅ | 事件逻辑引擎（20+种） |
| P3 | ✅ | 指令解析（11种内置） |
| P4 | ✅ | 语音通知（互亿无线/Twilio）/ Gemini AI / 翻译 |
| P5 | ✅ | Electron GUI 完整界面 |
| P6 | ✅ | 本地部署精简（移除激活与分享入口） |
