# 安静的Rust工具箱 v1.2

> Rust+ 智能设备管理平台 · 基于官方 Rust+ 协议 · 三端全覆盖

---

## 平台支持

| 平台 | 技术栈 | 启动方式 | 系统要求 |
|------|--------|----------|----------|
| **Mac 桌面版** | Electron | `bash start_gui.sh` | macOS 11+ / Apple Silicon & Intel |
| **Windows 桌面版** | Electron | 双击 `start_gui.bat` | Windows 10/11 64位 |
| **Web 版** | Express + WebSocket | `bash start_web.sh` | Node.js 18+ / Linux / macOS 服务器 |

三个版本共享 `src/` 核心业务逻辑，UI 分别位于：
- **桌面版**（Mac & Windows 共用）：`electron/renderer/index.html`
- **Web 版**：`web/public/index.html`

各平台详细部署说明见 `platforms/` 子目录 README。

---

## 快速开始

```bash
# 安装依赖
npm install
# 或
./install.sh          # macOS/Linux
双击 install.bat      # Windows

# Mac / Windows 桌面版
bash start_gui.sh     # macOS
start_gui.bat         # Windows

# Web 版
bash start_web.sh
# 浏览器访问 http://127.0.0.1:3080

# 命令行版（无 GUI）
bash start.sh

# 配对新设备
bash start_pair.sh
```

---

## 项目结构

```
rust-plus/
├── src/                        # 核心业务逻辑（三平台共享）
│   ├── index.js                # CLI 主入口
│   ├── connection/             # Rust+ WebSocket 连接管理
│   ├── map/                    # 地图数据解析与渲染
│   ├── events/                 # 事件逻辑引擎（20+ 种）
│   ├── commands/               # 聊天指令解析器（11 种）
│   ├── notify/                 # 通知推送（系统通知 / Discord / KOOK）
│   ├── call/                   # 语音呼叫告警（互亿无线 / Twilio）
│   ├── ai/                     # AI 问答（Gemini）
│   ├── translate/              # 翻译服务（DeepL / MyMemory / Gemini）
│   ├── pairing/                # FCM 配对流程
│   ├── steam/                  # Steam 资料查询
│   ├── storage/                # 数据持久化
│   ├── presets/                # 预设配置
│   ├── tools/                  # 辅助脚本（物品目录更新等）
│   └── utils/                  # 工具函数
├── electron/                   # Electron 桌面端（Mac & Windows）
│   ├── main.js                 # 主进程（窗口管理、托盘、IPC）
│   ├── preload.js              # 预加载脚本（安全桥接）
│   └── renderer/
│       └── index.html          # 桌面版 UI（单文件应用）
├── web/                        # Web 服务端
│   ├── server.js               # Express + WebSocket 入口
│   ├── public/
│   │   └── index.html          # Web 版 UI（单文件应用）
│   ├── ipc-invoke.js           # IPC 调用层
│   └── event-actions.js        # 事件处理
├── config/                     # 运行时配置（服务器、设备、规则等）
├── platforms/                  # 各平台部署脚本
│   ├── mac-gui/                # Mac 构建 & 部署
│   ├── windows-gui/            # Windows 构建 & 部署
│   └── web/                    # Web 服务器部署（含 systemd）
├── assets/                     # 应用图标资源
├── build/                      # Electron Builder 签名配置
├── docs/                       # 项目文档
├── test/                       # 测试用例
└── logs/                       # 运行日志输出
```

---

## 主题系统

内置 4 套主题，可在「系统设置」页面一键切换：

| 主题 | 风格 |
|------|------|
| **暗夜蓝** | 深蓝暗色调（默认） |
| **极简白** | 白色玻璃拟态 + 蓝紫流光动画 |
| **赛博朋克** | 深紫底色 + 电光青 / 霓虹品红脉冲 |
| **落日熔金** | 深褐暖底 + 琥珀橙 / 珊瑚红流光 |

---

## GUI 功能

| 页面 | 功能 |
|------|------|
| 控制台 | 连接状态、服务器信息、队伍成员、事件通知 |
| 服务器地图 | 实时地图渲染、标记点、售货机搜索、队友追踪 |
| 设备配对 | 服务器配对流程、已配对服务器管理 |
| 设备管理 | 开关 / 警报器列表、实时控制 |
| 事件逻辑 | 20+ 种事件规则配置 |
| 指令逻辑 | 11 种团队聊天指令 |
| 呼叫组 | 紧急语音通知配置（Discord / KOOK / 电话） |
| 运行日志 | 实时日志查看 |
| 帮助文档 | 指令 / 事件 / 变量完整说明 |
| 系统设置 | 主题切换 |

---

## 支持的事件（20+ 种）

**警报器** · alarm_on / alarm_off
**队伍** · player_online / offline / afk
**载具** · 武装直升机 / 军用直升机 / 货船
**商人** · 流浪商人出现 / 移动 / 停留
**时间** · 整点报时

---

## 游戏内指令

| 指令 | 功能 | 权限 |
|------|------|------|
| `fwq` | 查看服务器信息 | 所有人 |
| `hc` | 货船位置 | 所有人 |
| `wz` | 武装直升机位置 | 所有人 |
| `sh` | 深海状态 | 所有人 |
| `fy <文字>` | 翻译 | 所有人 |
| `ai <问题>` | AI 问答 | 所有人 |
| `shj <物品>[/货币]` | 查询售货机，可筛最低价 | 所有人 |
| `fk <开\|关\|切换> [关键词]` | 控制开关设备 | 仅队长 |
| `dz <名>` | 更改队长 | 仅队长 |
| `kk [名字]` | 随机夸赞 | 所有人 |
| `help` | 查看指令列表 | 所有人 |

完整变量与模板说明见 [docs/HELP.md](docs/HELP.md)

---

## 配置（.env）

首次启动自动从 `.env.example` 生成 `.env`。

```env
# Rust+ 连接（配对后自动写入）
FCM_CREDENTIALS=...
STEAM_ID=...
PLAYER_TOKEN=...

# 通知渠道（可选）
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
GEMINI_API_KEY=...

# 语音呼叫（可选）
IHUYI_VM_API_ID=VM...
IHUYI_VM_API_KEY=...

# Web 版配置
WEB_HOST=0.0.0.0
WEB_PORT=3080
WEB_API_TOKEN=change_me_to_a_long_random_token
WEB_REQUIRE_API_TOKEN=1

# 连接参数
MAX_RECONNECT=20
HEARTBEAT_INTERVAL=60
REQUEST_TIMEOUT_MS=30000
```

---

## 开发

```bash
# 开发模式（热重载）
npm run dev

# Electron 开发模式
npm run electron:dev

# 运行测试
npm test
```

## 构建

```bash
# Mac DMG/ZIP（Apple Silicon）
npm run build:mac

# Windows NSIS 安装包
npm run build:win
```

---

## 技术栈

- **运行时**：Node.js 18+
- **桌面端**：Electron 28
- **Web 端**：Express 4 + 原生 WebSocket
- **Rust+ 协议**：rustplus.js
- **UI**：原生 HTML/CSS/JS 单文件应用（无框架依赖）

---

## 文档索引

| 文档 | 说明 |
|------|------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 系统架构、模块说明、数据流图 |
| [docs/API.md](docs/API.md) | REST API + WebSocket 完整参考 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发者指南、测试、贡献说明 |
| [docs/HELP.md](docs/HELP.md) | 指令与事件模板变量完整说明 |
| [docs/MAP_MODULE.md](docs/MAP_MODULE.md) | 地图模块技术文档 |
| [docs/WEB_UBUNTU_DEPLOY.md](docs/WEB_UBUNTU_DEPLOY.md) | Ubuntu 服务器部署指南 |
| [docs/MAC_SIGNING.md](docs/MAC_SIGNING.md) | macOS 签名与公证指南 |
| [platforms/mac-gui/README.md](platforms/mac-gui/README.md) | Mac 桌面版部署说明 |
| [platforms/windows-gui/README.md](platforms/windows-gui/README.md) | Windows 桌面版部署说明 |
| [platforms/web/README.md](platforms/web/README.md) | Web 版部署说明 |

---

## 开发进度

| 阶段 | 状态 | 内容 |
|------|------|------|
| P0 | ✅ | FCM 配对、配置存储 |
| P1 | ✅ | WebSocket 连接管理 |
| P2 | ✅ | 事件逻辑引擎（20+ 种） |
| P3 | ✅ | 指令解析（11 种内置） |
| P4 | ✅ | 语音通知 / Gemini AI / 翻译 |
| P5 | ✅ | Electron GUI 完整界面 |
| P6 | ✅ | Web 版 & 三平台部署 |
| P7 | ✅ | 4 套主题系统（暗夜蓝 / 极简白 / 赛博朋克 / 落日熔金） |

## 许可证

MIT
