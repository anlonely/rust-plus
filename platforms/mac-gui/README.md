# Rust 工具箱 - Mac GUI 版

macOS 桌面客户端，基于 Electron 构建，提供完整的 Rust+ 智能设备管理界面。

## 系统要求

- macOS 11.0 (Big Sur) 或更高版本
- Node.js 18+（开发/构建时需要）
- Apple Silicon (arm64) 或 Intel (x64)

## 快速开始

### 方式一：开发模式运行

```bash
# 1. 启动 GUI（自动安装依赖）
bash platforms/mac-gui/run.sh
```

### 方式二：构建安装包

```bash
# 1. 一键构建 DMG/ZIP 安装包
bash platforms/mac-gui/deploy.sh

# 2. 安装包输出在 dist/ 目录
open dist/
```

## 配置说明

首次启动时会自动从 `.env.example` 生成 `.env` 文件。
你也可以手动复制并编辑：

```bash
cp platforms/mac-gui/.env.example .env
```

### 关键配置项

| 配置项 | 说明 | 必填 |
|--------|------|------|
| `FCM_CREDENTIALS` | FCM 推送凭据（配对时自动获取） | 是 |
| `STEAM_ID` | Steam 64位 ID（配对后自动写入） | 是 |
| `PLAYER_TOKEN` | Rust+ 玩家令牌（配对后自动写入） | 是 |
| `DISCORD_WEBHOOK_URL` | Discord 通知 Webhook | 否 |
| `GEMINI_API_KEY` | Gemini AI/翻译 API Key | 否 |

## 目录结构

```
项目根目录/
├── electron/          # Electron 主进程 + 渲染进程
├── src/               # 核心业务逻辑（共享）
├── config/            # 运行时配置文件
├── assets/            # 图标等资源
├── platforms/
│   └── mac-gui/       # 本平台脚本
│       ├── deploy.sh  # 一键构建
│       ├── run.sh     # 开发启动
│       ├── .env.example
│       └── README.md
└── dist/              # 构建产物输出
```

## 常见问题

### 启动时提示"无法验证开发者"

macOS Gatekeeper 可能阻止未签名的应用。解决方法：

1. 打开"系统设置" > "隐私与安全性"
2. 找到被阻止的应用，点击"仍要打开"

### 构建失败

确保已安装 Xcode Command Line Tools：

```bash
xcode-select --install
```

## 技术说明

- 入口文件：`electron/main.js`
- 渲染页面：`electron/renderer/index.html`
- 核心逻辑复用 `src/` 目录下的共享模块
- 构建配置在根目录 `package.json` 的 `build` 字段中
