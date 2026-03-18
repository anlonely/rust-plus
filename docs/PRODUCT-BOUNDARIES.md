# Rust 工具箱 — 产品边界与重构基线

> 这份文档只回答一个问题：`Web 公有版` 和 `桌面版` 到底是不是同一种产品。答案是否定的。

## 1. 产品线划分

### 桌面版（Mac / Windows GUI）

- 定位：个人本地部署、单用户、自有机器
- 认证方式：直接登录 Steam / Rust+，不需要外围邮箱账号体系
- 数据边界：本机本地配置，天然单租户
- 运行方式：一个 GUI 进程对应一个 Rust+ 运行时
- 允许共享的内容：`src/` 下的纯业务逻辑、地图算法、事件解析、指令解析

### Web 公有版（云端 Express）

- 定位：公网服务、多个注册用户并发使用
- 认证方式：外围邮箱账号登录 + 各自绑定自己的 Steam / Rust+ token
- 数据边界：必须按用户隔离，不能共享服务器列表、设备、规则、Steam token、FCM 配对状态
- 运行方式：每个用户至少拥有独立的“配置工作区 + Rust+ 运行时上下文”
- 允许共享的内容：`src/` 下无状态纯函数、只读目录、公共资源文件

## 2. 非谈判边界

以下规则必须长期成立：

1. 桌面版不引入外围账号注册/登录壳层。
2. Web 公有版不允许使用全局共享的 `config/servers.json`、`config/devices.json`、`config/rules.json`、`rustplus.config.json` 作为多用户运行时存储。
3. Web 公有版的 Rust+ 连接、队伍消息、事件引擎、配对监听、最后连接服务器状态，都必须按用户隔离。
4. GUI 的 UI 调整不能把 Web 的租户模型复杂度带回桌面端。

## 3. 当前代码基线

当前仓库可以分成三层：

### A. 可共享核心

- `src/commands/*`
- `src/events/*`
- `src/utils/*`
- `src/presets/*`
- `src/notify/*`

这一层应该继续保持“尽量无状态 + 可复用”。

### B. 桌面单机场景层

- `electron/*`
- `src/index.js`
- `src/storage/config.js` 当前默认实现

这层默认就是单用户本地模型，问题不大。

### C. Web 公有场景层

- `web/server.js`
- `web/public/*`
- `src/auth/*`
- `src/steam/remote-auth.js`

这层现在已经有了“账号壳层 + 按用户工作区”的基础能力，但 Web runtime manager 仍主要收敛在 `web/server.js` 中，后续还需要继续下沉模块化。

## 4. 当前最关键的结构债

### 债 1：Web Runtime Manager 仍集中在单文件

当前已经支持按用户上下文隔离 `runtime / rustClient / eventEngine / cmdParser`，但实现仍主要堆叠在 `web/server.js`。  
后续需要继续拆出独立的 `tenant/runtime manager`，降低维护成本。

### 债 2：Web 与桌面仍共享部分默认模块入口

`src/storage/config.js` 当前已经支持“默认桌面单机 store + Web scoped store”双模式，但默认导出仍面向桌面。  
新 Web 代码必须坚持只通过用户工作区工厂访问存储，不能回退到默认全局 store。

### 债 3：多租户生命周期治理还要继续补强

目前已经支持每用户独立 `rustplus.config.json`，并在禁用/删除用户时停掉该用户运行时。  
但服务重启恢复、长期后台任务治理、跨进程扩展仍需要继续补强。

## 5. 建议目录演进

建议逐步收敛为下面的结构，而不是继续让 `web/server.js` 同时承担 HTTP、用户态、运行时、存储协调四类职责：

```text
src/
├── core/                    # 与平台无关的纯业务逻辑
├── desktop/                 # 桌面单机运行时
├── web/
│   ├── auth/                # Web 账号体系
│   ├── tenant/              # Web 租户上下文/工作区
│   ├── runtime/             # 每用户 Rust+ runtime manager
│   └── api/                 # HTTP / WS 路由
├── storage/
│   ├── desktop-config.js    # 桌面单机配置
│   └── web-workspace.js     # Web 每用户工作区配置
└── shared/                  # 公共工具
```

## 6. 推荐重构顺序

### Phase 1：明确边界，不再继续混写

- 保持桌面版继续走当前单机配置
- Web 新功能不再直接依赖全局 `config/*.json`
- Web 所有新增接口都要求经过账号上下文

### Phase 2：抽出 Web 用户工作区

- 为每个 Web 用户建立独立配置目录
- 把 `servers/devices/rules/callGroups/rustplus.config` 拆到用户工作区
- 把当前全局 `config.js` 抽象成“默认桌面仓库 + Web scoped 仓库”

当前状态：

- 已完成。工作区落在 `config/web-users/<userId>/`
- 每个用户拥有独立的 `servers.json / devices.json / rules.json / rustplus.config.json`

### Phase 3：抽出 Web Runtime Manager

- 每个用户一份 `rustClient/eventEngine/cmdParser`
- WebSocket 广播按用户房间/租户分发
- 配对监听与自动重连按用户隔离

当前状态：

- 已完成“按用户上下文隔离”的运行时行为
- 待完成“从 `web/server.js` 继续拆分为独立模块”

### Phase 4：补齐多租户验证

- 并发两用户连接不同服务器的集成测试
- 两用户同时登录 Steam、同时配对、同时发团队消息的回归测试
- 禁止任何跨用户数据泄漏

## 7. 交付标准

只有同时满足下面几点，Web 公有版才算真正可作为多人 SaaS 运行：

1. 两个账号可同时绑定不同 Steam token，互不覆盖。
2. 两个账号可同时连接不同 Rust 服务器，互不串线。
3. 两个账号的设备、规则、聊天记录、地图状态完全隔离。
4. 服务重启后，按用户恢复各自工作区，而不是恢复单个全局状态。

在达到这个标准之前，桌面版与 Web 公有版必须被视为两条不同产品线，而不是“同一套配置换个壳”。
