# Rust 工具箱 / Rust Toolbox

[中文](./README.md) | [English](./README.en.md)

Rust 工具箱是一个围绕 **Rust+** 构建的管理系统，覆盖三种使用形态：

- `Web 公有版`：部署在云服务器，支持多用户注册登录、各自绑定 Steam / Rust+、各自管理自己的服务器
- `macOS 桌面版`：个人本地部署，直接登录 Steam / Rust+ 使用
- `Windows 桌面版`：个人本地部署，直接登录 Steam / Rust+ 使用

## 一、版本边界

### Web 公有版

- 适合云端长期运行
- 使用邮箱账号登录
- 每个用户拥有独立工作区
- 工作区默认位于 `config/web-users/<userId>/`
- 隔离数据：
  - `servers.json`
  - `devices.json`
  - `rules.json`
  - `rustplus.config.json`

### macOS / Windows 桌面版

- 适合个人本地部署
- 不使用外围邮箱账号体系
- 直接登录 Steam / Rust+
- 继续使用单用户本地配置模型

详细边界说明见：
- [产品边界](/Users/bing/Documents/openai-codex/rust-plus/docs/PRODUCT-BOUNDARIES.md)

## 二、核心能力

- Steam / Rust+ 登录与状态恢复
- 服务器配对与设备绑定
- 队伍聊天指令
- 事件逻辑与系统预设
- 售货机搜索与地图展示
- CCTV 监控代码查询
- 队伍消息发送节流控制
- 呼叫组联动
  - 团队聊天
  - 电话
  - KOOK
  - Discord
- Web 管理后台
  - 用户管理
  - 启用 / 禁用
  - Steam 绑定摘要查看

## 三、快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动桌面版

macOS:

```bash
bash start_gui.sh
```

Windows:

```bat
start_gui.bat
```

### 3. 启动 Web 版

```bash
bash start_web.sh
```

默认地址：

- `http://127.0.0.1:3080`

生产部署说明见：

- [Web 部署文档](/Users/bing/Documents/openai-codex/rust-plus/platforms/web/README.md)

## 四、Web 登录说明

Web 版部署在云端时，Steam 登录通过本机 Chrome 插件桥接完成：

1. 用户先登录 Web 账号
2. Web 端创建一次性 Steam 登录会话码
3. 本机 Chrome 扩展打开 Rust+ 登录页
4. 扩展捕获 `rustplus_auth_token`
5. 回传到云端 `/steam-bridge/complete`
6. 云端写入当前用户自己的 `rustplus.config.json`
7. 云端继续开始配对监听

相关文件：

- [插件目录](/Users/bing/Documents/openai-codex/rust-plus/platforms/chrome-rustplus-bridge)
- [插件教程](/Users/bing/Documents/openai-codex/rust-plus/docs/static/tutorial-steam-bridge.html)

## 五、项目结构

```text
rust-plus/
├── src/
│   ├── ai/                     # AI 问答
│   ├── auth/                   # Web 账号、会话、用户工作区
│   ├── call/                   # 呼叫组与语音通知
│   ├── commands/               # 队伍聊天指令
│   ├── connection/             # Rust+ WebSocket 连接
│   ├── events/                 # 事件引擎
│   ├── map/                    # 地图处理
│   ├── notify/                 # 通知服务
│   ├── pairing/                # 配对与 FCM
│   ├── presets/                # 系统预设
│   ├── steam/                  # Steam / Rust+ 登录状态
│   ├── storage/                # 持久化存储
│   ├── tools/                  # 辅助脚本
│   ├── translate/              # 翻译能力
│   ├── utils/                  # 公共工具
│   └── index.js                # CLI 入口
├── electron/                   # macOS / Windows 桌面端
├── web/                        # Web 服务端与 Web 前端
├── platforms/                  # 各平台部署与打包脚本
├── docs/                       # 项目文档
├── assets/                     # 静态资源
├── config/                     # 运行时配置
└── test/                       # 自动化测试
```

更详细的结构说明见：

- [架构文档](/Users/bing/Documents/openai-codex/rust-plus/docs/ARCHITECTURE.md)
- [文档索引](/Users/bing/Documents/openai-codex/rust-plus/docs/README.md)

## 六、重要文档

- [文档索引](/Users/bing/Documents/openai-codex/rust-plus/docs/README.md)
- [帮助文档](/Users/bing/Documents/openai-codex/rust-plus/docs/HELP.md)
- [开发文档](/Users/bing/Documents/openai-codex/rust-plus/docs/DEVELOPMENT.md)
- [地图模块说明](/Users/bing/Documents/openai-codex/rust-plus/docs/MAP_MODULE.md)
- [HTTP / WebSocket API](/Users/bing/Documents/openai-codex/rust-plus/docs/API.md)

## 七、开发与验证

开发：

```bash
npm run dev
```

测试：

```bash
npm test
```

桌面打包：

```bash
npm run build:mac
npm run build:win
```

## 八、安全说明

- `.env`
- `config/auth-users.json`
- `config/root-admin-credentials.txt`
- `config/rustplus.config.json`
- `config/web-users/*`
- `logs/*`

这些都属于运行时数据或敏感信息，不应提交到仓库。

