# Rust 工具箱 — 开发者指南

> 适用于：本地开发、贡献代码、二次开发

---

## 一、环境要求

| 工具 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | 18.0.0 | 必须 |
| npm | 8.0.0 | 随 Node.js 附带 |
| Git | 2.30+ | 版本管理 |
| Electron | 28（自动安装） | GUI 模式 |

**验证环境**：
```bash
node --version   # v18+
npm --version    # 8+
```

---

## 二、本地启动

### 克隆与安装

```bash
git clone https://github.com/anlonely/rust-plus.git
cd rust-plus
npm install
```

### 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，至少配置以下项：
# GEMINI_API_KEY=your_key_here
# WEB_API_TOKEN=your_long_random_token
```

### 三种启动方式

```bash
# CLI 模式（命令行）
npm start                # 默认监听模式
npm run pair             # 配对模式（首次使用）
npm run status           # 查看状态

# Web 模式（推荐）
npm run start:web        # 访问 http://127.0.0.1:3080

# GUI 模式（桌面应用）
npm run start:gui        # 启动 Electron
npm run electron:dev     # 开发模式（含 DevTools）
```

---

## 三、首次配对流程

```bash
# 1. 启动配对模式
npm run pair

# 2. 打开 Rust 游戏 → ESC → Rust+ → Pair with Server
# 3. 等待推送通知（约 10-30 秒）
# 4. 配对完成后运行：
npm run start:web
```

---

## 四、目录结构（开发视角）

```
src/
├── index.js          # CLI 入口，增加 CLI 命令从这里开始
├── commands/
│   └── parser.js     # 添加新聊天指令：调用 _register() 方法
├── events/
│   └── engine.js     # 添加新事件类型：在 _processMapEvent() 中扩展
├── utils/
│   └── *.js          # 纯函数工具库，可独立测试
├── storage/
│   └── config.js     # 数据持久化，所有 I/O 都经过这里
└── notify/
    └── service.js    # 添加新通知渠道从这里扩展

web/
├── server.js         # REST API + WebSocket，新增路由在这里
├── event-actions.js  # 事件 → 动作 绑定逻辑
├── ipc-invoke.js     # IPC 通道注册
└── public/           # Web 前端（无构建，原生 JS/HTML/CSS）

electron/
└── main.js           # Electron 主进程，IPC 处理器在这里
```

---

## 五、测试

### 运行测试

```bash
# 运行所有测试
npm test

# 运行单个测试文件
node --test test/command-fk.test.js

# 运行匹配的测试文件
node --test test/event-engine-*.test.js
```

### 测试框架

使用 Node.js 18+ 内置的 `node:test` 模块，无需额外安装。

### 测试文件命名规范

```
test/<模块名>.test.js
test/command-<指令名>.test.js
test/event-engine-<功能>.test.js
```

### 编写测试示例

```javascript
const { test } = require('node:test');
const assert = require('node:assert');

test('功能描述', async (t) => {
  // 准备
  const input = { ... };

  // 执行
  const result = myFunction(input);

  // 断言
  assert.strictEqual(result, expectedValue);
});
```

### 当前已知失败测试（预存 bug）

以下 5 个测试为预存 bug，不影响主要功能：

| 文件 | 测试名 | 问题 |
|------|-------|------|
| `test/command-shj-grid-offset.test.js` | shj x/y offset 边界 | 环境变量 offset 边界未生效 |
| `test/command-wz-hc-grid.test.js` | wz grid offset | 网格计算偏差 1 格 |
| `test/command-wz-hc-grid.test.js` | hc grid offset | 网格计算偏差 1 格 |
| `test/map-grid.test.js` | R2 top-right 回归 | 边缘坐标归属 |
| `test/map-grid.test.js` | V18 bottom-right 回归 | 边缘坐标归属 |

---

## 六、添加新聊天指令

在 `src/commands/parser.js` 中，使用 `_register()` 方法注册：

```javascript
// 在 _registerBuiltins() 方法内添加
this._register({
  keyword: 'myCmd',           // 触发关键词
  type: 'my_type',            // 指令类型标识
  description: '我的新指令',   // 帮助文档显示
  cooldownMs: 5000,           // 冷却时间（毫秒）
  permission: 'all',          // 'all' | 'leader'
  handler: async (args, ctx) => {
    const { client, senderId } = ctx;
    // args = 指令后的参数字符串
    // client = RustClient 实例
    await client.sendTeamMessage(`你说了：${args}`);
  },
});
```

---

## 七、添加新事件类型

在 `src/events/engine.js` 中扩展：

```javascript
// 在 _processMapEvent() 或 _processBroadcast() 中：
if (someCondition) {
  this._fireRule('my_new_event', {
    // 传递给规则 action 的上下文
    myData: 'value',
    grid: markerToGrid(x, y, mapSize),
  });
}
```

然后在 `src/presets/index.js` 中为新事件添加预设规则。

---

## 八、添加新通知渠道

在 `src/notify/service.js` 中扩展 `notify()` 函数：

```javascript
function notify(channel, { title, message, webhookUrl, embed, myNewParam }) {
  // 现有渠道...
  if (channel === 'my_channel' || channel === 'all') {
    sendMyChannel(myNewParam, { title, message });
  }
}
```

---

## 九、数据库操作

所有数据操作通过 `src/storage/config.js` 进行：

```javascript
const {
  initDbs,          // 初始化（必须在启动时调用）
  saveServer,       // 保存服务器
  listServers,      // 获取服务器列表
  saveEventRule,    // 保存事件规则
  listEventRules,   // 获取事件规则
  // ...
} = require('./storage/config');

// 所有函数均为 async
const servers = await listServers();
const rule = await saveEventRule({ id: 'rule_1', event: 'alarm_on', ... });
```

**注意**：`JsonDb` 已使用异步 I/O，不会阻塞事件循环。每次操作都会从磁盘读取最新数据（无强缓存），并发写入通过原子 rename 保证安全。

---

## 十、日志

使用 Winston 日志，自动写入 `logs/` 目录：

```javascript
const logger = require('./utils/logger');

logger.info('正常信息');     // → logs/app.log
logger.warn('警告信息');     // → logs/app.log
logger.error('错误信息');    // → logs/error.log（同时写入 app.log）
logger.debug('调试信息');    // LOG_LEVEL=debug 时输出
```

**日志滚动**：`app.log` 超过 5MB 自动滚动，保留最近 3 个文件。

---

## 十一、构建与打包

```bash
# macOS ARM64 dmg + zip
npm run build:mac

# macOS（无签名，快速测试）
npm run build:mac:dir

# Windows x64 安装包
npm run build:win

# 查看构建输出
ls dist/
```

**打包包含的内容**（由 `package.json` → `build.files` 定义）：
- `electron/**/*`
- `src/**/*`
- `assets/`
- `config/item-catalog.json`
- `config/cctv-codes.json`
- `package.json`

**不包含**：`node_modules/`（打包时自动处理）、`config/servers.json`、`.env`

---

## 十二、更新游戏数据

```bash
# 更新物品数据库（从官方 API）
npm run update:item-catalog

# 下载物品图标
npm run download:item-icons

# 更新 CCTV 摄像头代码数据库
npm run update:cctv-codes
```

---

## 十三、环境变量完整参考

```env
# ── AI / 翻译 ──────────────────────────
GEMINI_API_KEY=                     # Google Gemini API 密钥（必须）
GEMINI_AI_MODEL=gemini-2.5-flash    # AI 问答模型
GEMINI_TRANSLATE_MODEL=gemini-2.5-flash # 翻译模型
GEMINI_TIMEOUT_MS=15000             # API 超时（毫秒）
FY_TRANSLATE_RPM=15                 # AI+翻译共享限流（每分钟）

# ── 通知渠道 ───────────────────────────
DISCORD_WEBHOOK_URL=                # Discord Webhook URL
IHUYI_VM_API_ID=                    # 互亿无线账号 ID
IHUYI_VM_API_KEY=                   # 互亿无线 API 密钥
IHUYI_VM_ENDPOINT=https://api.ihuyi.com/vm/Submit.json
IHUYI_VM_FORMAT=json                # json 或 xml
IHUYI_VM_TEMPLATE_ID=               # 语音模板 ID（可选）
TWILIO_ACCOUNT_SID=                 # Twilio 账号（回退）
TWILIO_AUTH_TOKEN=                  # Twilio Token
TWILIO_FROM_NUMBER=                 # Twilio 发起号码

# ── 连接配置 ───────────────────────────
MAX_RECONNECT=20                    # 最大重连次数
HEARTBEAT_INTERVAL=60               # 心跳间隔（秒）
REQUEST_TIMEOUT_MS=30000            # 请求超时（毫秒）
HEARTBEAT_FAIL_RECONNECT=8          # 心跳连续失败触发重连阈值
ACTIVITY_GRACE_MS=90000             # 活动宽限期（毫秒）

# ── Web 服务 ───────────────────────────
WEB_HOST=127.0.0.1                  # 监听地址（生产建议用 nginx 反代）
WEB_PORT=3080                       # 监听端口
WEB_API_TOKEN=change_me             # API 认证 Token（必须修改）
WEB_REQUIRE_API_TOKEN=1             # 1=强制认证，0=关闭
WEB_AUTO_CONNECT=1                  # 启动时自动连接上次服务器
WEB_MAX_TEAM_MESSAGES=120           # 缓存聊天消息数量

# ── 游戏配置 ───────────────────────────
RUST_TEAM_MESSAGE_MAX_CHARS=128     # 队伍消息最大字符数
RUST_SHJ_GRID_X_OFFSET=0           # shj 网格 X 轴修正
RUST_SHJ_GRID_Y_OFFSET=0           # shj 网格 Y 轴修正

# ── 调试 ───────────────────────────────
LOG_LEVEL=info                      # debug / info / warn / error
DEEP_SEA_DEBUG=0                    # 1 = 输出深海原始事件日志
```

---

## 十四、代码规范

- **缩进**：2 空格
- **引号**：单引号
- **分号**：不使用
- **命名**：camelCase（变量/函数），PascalCase（类）
- **异步**：优先 async/await，避免回调嵌套
- **错误处理**：使用 logger.error 而非 console.error
- **敏感数据**：不在日志中输出，使用 `maskSecret()` 脱敏

---

## 十五、常见问题

**Q：配对后连接失败？**
> 检查 `.env` 中是否有旧的 `PLAYER_TOKEN`，删除后重新配对。

**Q：AI 指令报错"GEMINI_API_KEY 未配置"？**
> 在 `.env` 中配置 `GEMINI_API_KEY=your_google_api_key`。

**Q：Web 界面无法访问？**
> 确认 `WEB_HOST=127.0.0.1`（本地）或正确的 IP，防火墙开放端口 `3080`。

**Q：Discord 通知不发送？**
> 确认 `.env` 中 `DISCORD_WEBHOOK_URL` 已填写，且 URL 可访问（`curl` 测试）。

**Q：设备状态不更新？**
> 确保在游戏中先用 Wire Tool 配对设备，然后在"设备管理"页面注册。
