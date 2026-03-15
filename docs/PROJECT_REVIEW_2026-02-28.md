# Rust 工具箱项目梳理与代码审计（2026-02-28）

## 1. 审查范围
- 代码范围：`src/`、`electron/`、`config/`、`docs/`、`README.md`、`package.json`
- 审查方式：静态代码审查（未做黑盒渗透/压测）
- 目标：梳理架构、识别冗余、给出优化点、评估安全性

## 2. 项目简介
`rust-plus` 是一个 Node.js + Electron 的 Rust+ 本地工具箱，支持：
- Rust+ 连接与配对（FCM）
- 事件引擎（队友状态、货船、武直、商人、深海、售货机等）
- 队伍聊天指令（`fwq`/`shj`/`fk`/`fy`/`ai`/`dz` 等）
- GUI 管理（设备、规则、指令、呼叫组、日志）

## 3. 架构与模块职责
- 入口与进程
  - `electron/main.js`：主进程编排、IPC、规则持久化/迁移、服务启动
  - `electron/preload.js`：渲染层桥接 API
  - `electron/renderer/index.html`：单文件前端 UI + 业务逻辑
- 核心引擎
  - `src/connection/client.js`：Rust+ 连接管理、心跳、请求封装
  - `src/events/engine.js`：事件识别与规则触发
  - `src/commands/parser.js`：聊天指令解析与执行
- 配置与数据
  - `src/storage/config.js`：JSON 持久化（servers/devices/rules）
  - `config/item-catalog.json` + `src/utils/item-catalog.js`：物品目录与模糊匹配
- 外围能力
  - `src/pairing/fcm.js`：FCM 注册与监听
  - `src/notify/service.js`：桌面/Discord 通知
  - `src/call/groups.js`：Twilio 呼叫组
  - `src/steam/profile.js`：Steam 状态/资料

## 4. 安全审计结论（按严重级别）

### 高风险
1. 打包产物可能携带敏感信息
- 证据：`package.json:41` 将 `config/` 与 `.env` 打入构建文件。
- 风险：发布安装包时可能把本地 token、服务器信息、Webhook/API Key 一并分发。
- 建议：将运行态配置从构建文件剔除（至少移除 `.env`、`config/`），改为首次启动生成。

2. 外链打开 IPC 未做校验
- 证据：`electron/main.js:1465` 直接 `shell.openExternal(url)`。
- 风险：若渲染层被注入，可触发任意外链跳转。
- 建议：限制协议为 `https:`，并增加域名白名单。

3. 敏感 token 暴露到渲染进程
- 证据：`src/steam/profile.js:116` 返回原始 `token`；`electron/main.js:1492-1494` 直接暴露给前端。
- 风险：一旦前端注入/XSS，token 易被窃取。
- 建议：前端仅返回掩码后的 token 信息，敏感字段只在主进程可见。

### 中风险
4. 渲染层存在基于 `innerHTML` 的注入面
- 证据：`electron/renderer/index.html:2050-2051`、`2235`、`2623` 等将 ID/关键词插入 `onclick` 字符串；`esc()` 只转义 `<>&`（`3031`），不转义引号。
- 风险：若配置文件被污染，可能拼接执行脚本。
- 建议：避免内联 `onclick`，统一用 `addEventListener` + `textContent`。

5. Twilio 消息未 XML 转义
- 证据：`src/call/groups.js:31` 直接将 `message` 拼进 TwiML。
- 风险：`<`, `&` 等字符可能破坏 XML，请求失败。
- 建议：对 TwiML 文本做 XML escaping。

6. Twilio 返回 JSON 解析缺少保护
- 证据：`src/call/groups.js:57` 直接 `JSON.parse(data)`。
- 风险：非 JSON 返回会抛异常，可能影响流程稳定性。
- 建议：`try/catch` 包裹并返回可观测错误。

7. 明文存储与日志含敏感信息
- 证据：`src/storage/config.js:156` 存储 `playerToken`；`src/pairing/fcm.js:415` + `179` 持续写入原始监听内容。
- 风险：本机泄露即导致凭据泄露。
- 建议：敏感字段脱敏存储/日志脱敏，并提供“清理凭据”入口。

### 低风险
8. Steam token 解析可能错误
- 证据：`src/steam/profile.js:21` 取 `token.split('.')[0]`，通常 JWT payload 在第二段。
- 风险：`steamId/exp` 识别异常，影响状态判断。
- 建议：兼容解析两段并优先 payload 段。

## 5. 冗余与可维护性问题
1. SteamId 归一化逻辑重复
- 位置：`src/commands/parser.js:250`、`src/events/engine.js:195`、`electron/renderer/index.html:1842`
- 建议：提取为共享 util（主进程/渲染分别复用）。

2. 事件阶段映射与默认文案在主进程/渲染层重复维护
- 位置：`electron/main.js:96-136` 与 `electron/renderer/index.html:1050+`
- 风险：文案/开关行为容易漂移。
- 建议：抽成单一配置源。

3. 大文件过于臃肿
- `electron/main.js` 2100+ 行，`electron/renderer/index.html` 3000+ 行。
- 建议：按域拆分（pairing/devices/rules/commands/callgroups）。

4. 遗留目录异常
- 目录：`{src`（疑似误操作产物）
- 建议：确认无用后清理，避免误导与打包污染。

## 6. 性能与稳定性优化建议
1. 同步 IO 过多
- 位置：`src/storage/config.js`、`src/pairing/fcm.js` 多处 `readFileSync/writeFileSync/appendFileSync`
- 影响：阻塞事件循环。
- 建议：迁移到 `fs.promises` + 写入节流/批量落盘。

2. 多轮询并发可统一调度
- 位置：`electron/main.js` 的 team/server 多个 `setInterval`，`src/events/engine.js:162` 地图轮询。
- 影响：服务器负载和突发请求抖动。
- 建议：统一 scheduler + 抖动退避 + 连接态感知暂停。

3. 呼叫组缺少任务队列策略
- 位置：`src/call/groups.js:112-120` 串行拨号。
- 建议：引入并发上限、超时、重试与失败重放队列。

4. `shj` 模糊匹配可继续收敛
- 位置：`src/utils/item-catalog.js:107-124`
- 现状：召回广，可能出现“高级”匹配到非目标物品。
- 建议：加入最小分数阈值、类别优先级、同义词白名单。

## 7. 依赖与工程卫生
- `package.json` 中疑似未使用依赖：
  - `inquirer`（未在 `src/`、`electron/` 引用）
  - `lowdb`（未引用）
  - `open`（未引用）
- 建议：移除未使用依赖，降低供应链与安装体积风险。

## 8. 综合结论
- 代码主体功能完整，事件与指令链路清晰，可用性高。
- 主要短板在：
  - 安全边界（IPC、token 暴露、打包敏感文件）
  - 可维护性（大文件、重复逻辑）
  - 工程化（同步 IO、缺少测试与模块化）

## 9. 建议整改优先级
1. 立即处理（本周）
- 调整打包白名单（移除 `.env`/`config/`）
- 修复 `open:url` 白名单校验
- 前端不再接收原始 token

2. 短期处理（1-2 周）
- 渲染层去 `innerHTML + inline onclick` 的动态注入面
- Twilio TwiML escaping + JSON 解析保护
- 日志与持久化脱敏

3. 中期处理（2-4 周）
- 拆分 `main.js`/`index.html`
- 抽取共享 util，清理重复逻辑
- 补充单测（`item-catalog`、`shj`、事件过滤链路）
