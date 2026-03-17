# Rust 工具箱 - Windows GUI 版

Windows 桌面客户端，基于 Electron 构建，提供完整的 Rust+ 智能设备管理界面。

## 系统要求

- Windows 10 / 11 (64位)
- Node.js 18+（开发/构建时需要）

## 快速开始

### 方式一：开发模式运行

```cmd
:: 1. 双击运行（自动安装依赖）
platforms\windows-gui\run.bat
```

### 方式二：构建安装包

```cmd
:: 1. 一键构建 NSIS 安装程序
platforms\windows-gui\deploy.bat

:: 2. 安装包输出在 dist\ 目录
explorer dist\
```

## 配置说明

首次启动时会自动从 `.env.example` 生成 `.env` 文件。
你也可以手动复制并编辑：

```cmd
copy platforms\windows-gui\.env.example .env
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
项目根目录\
├── electron\          # Electron 主进程 + 渲染进程
├── src\               # 核心业务逻辑（共享）
├── config\            # 运行时配置文件
├── assets\            # 图标等资源
├── platforms\
│   └── windows-gui\   # 本平台脚本
│       ├── deploy.bat # 一键构建
│       ├── run.bat    # 开发启动
│       ├── .env.example
│       └── README.md
└── dist\              # 构建产物输出
```

## 常见问题

### 启动时报"MSVCP140.dll 缺失"

需要安装 Microsoft Visual C++ Redistributable：
- 下载地址: https://aka.ms/vs/17/release/vc_redist.x64.exe

### npm install 很慢或失败

可以配置国内镜像源：

```cmd
npm config set registry https://registry.npmmirror.com
```

### 构建安装包时报错

1. 确保已安装完整的 Node.js（不是精简版）
2. 以管理员身份运行 CMD
3. 检查磁盘空间是否充足（至少 2GB）

### 安装后无法打开，提示 SmartScreen 警告

Windows SmartScreen 可能拦截未签名的应用：

1. 点击"更多信息"
2. 点击"仍要运行"

## 技术说明

- 入口文件：`electron\main.js`
- 渲染页面：`electron\renderer\index.html`
- 核心逻辑复用 `src\` 目录下的共享模块
- 构建配置在根目录 `package.json` 的 `build` 字段中
- 安装包使用 NSIS 格式，支持中文界面
