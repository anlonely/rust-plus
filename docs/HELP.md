# Rust 工具箱帮助文档

## 1. 指令总览（团队聊天）

### `fwq` 服务器信息
- 功能：返回当前服务器摘要（人数、排队、游戏时间、昼夜倒计时）。
- 昼夜分界：`07:30` 天亮，`19:30` 入夜。
- 输出示例：
`Rusty Moose |US Monthly| 人数:75/200排队:[0] 时间:06:16 黑夜 - 距离天亮还有约1分58秒`

### `hc` 货船信息
- 功能：返回货船状态与坐标。
- 输出示例：
`货船航行中｜当前位置:U29`

### `wz` 武装直升机信息
- 功能：返回武装直升机状态与网格位置。

### `sh` 深海状态
- 功能：返回当前深海开启/关闭状态与倒计时。

### `fk` 开关控制（仅队长）
- 用法：`fk <开|关|切换> [开关名关键字]`
- 功能：控制指令规则中已绑定的一个或多个开关；可按关键字二次过滤。
- 输出示例：
`开关执行结果（切换）`
`- 大门总开关: 开启 -> 关闭`

### `fy <文本>` 翻译
- 功能：翻译输入文本。
- 引擎：Google Gemini 2.5 Flash。
- 限制：与 `ai` 共用频率桶，默认每分钟最多 15 次；超过后返回频率提醒。
- 输出长度：按队伍聊天单条长度限制自动截断。
- 输出前缀：`翻译结果:`

### `ai <问题>` AI问答
- 功能：调用 AI 回答。
- 引擎：与 `fy` 相同，使用 Google Gemini 2.5 Flash（同一 API key）。
- 限制：与 `fy` 共用每分钟请求上限（`FY_TRANSLATE_RPM`）。
- 输出前缀：`AI回答:`

### `shj <关键词>` 售货机查询
- 用法：
  - `shj 高级蓝图碎片`
  - `shj 高级蓝图碎片/硫磺`
  - `shj itemId:数字`
- 功能：
  - 不带货币：返回匹配卖物的网格、硫磺类最低价、其他支付方式。
  - 带货币：仅筛选指定货币购买的报价，并附加“其他支付”。
  - 全部查询默认过滤售空售货机。
- 输出规则：
  - 带货币查询只列最低价前 3 个网格。
  - 不带货币查询优先显示硫磺类报价，其他支付单独列为 `其他支付:`。
  - 位置按当前 `shj` 专用校准输出。
- 输出示例：
`[U21 - W6 - Q19]正在出售[高级蓝图/硫磺]`
`[U21 - W6]需要[硫磺矿石]*900 , [Q19]需要[硫磺矿石]*1000`
`其他支付:[U21] - [柴油]*1  |  [V11] - [高级金属]*35`

### `jk <地点关键词>` 监控代码查询
- 用法：
  - `jk 强盗营地`
  - `jk 强盗`
  - `jk 大石油`
- 功能：
  - 从本地 CCTV 代码库中按地点名称模糊匹配并返回全部监控代码。
  - 数据库为本地保存的 CCTV 清单，可离线查询。
  - 返回时会根据队伍聊天长度限制自动按整段代码换行，不会把单个代码拆开。
- 输出示例：
`强盗营地监控代码：[CASINO - 强盗营地赌场]  [TOWNWEAPONS - 强盗营地武器商人]`

### `dz <成员名>` 更改队长（仅队长）
- 功能：调用 Rust+ API `promoteToLeader` 请求转让队长。

### `kk [成员名]`
- 功能：发送随机夸赞文本（可指定对象）。

### `help` 指令帮助
- 功能：返回当前可用指令清单。

---

## 2. 事件规则

事件逻辑支持：
- 启用 / 禁用
- 编辑
- 删除
- 冷却时间
- 条件过滤（例如设备ID、成员名、物品、阈值）
- 按服务器隔离（仅作用于当前连接服务器）

常用事件类型：
- 警报：`alarm_on` / `alarm_off`
- 队伍：`player_status`（整合）/ `player_online` / `player_offline` / `player_dead` / `player_respawn` / `player_afk`
- 载具与NPC：`patrol_heli_status`（整合）/ `cargo_ship_status`（整合）/ `ch47_status`（整合）/ `vending_new` / `vendor_status`（整合）
- 油井：`oil_rig_status`（整合：大/小石油重装与解锁）
- 其他：`hourly_tick`（每4小时整点）/ `deep_sea_status`（整合：开启/关闭）/ 存储监视器相关事件
- `player_afk` 默认逻辑：队友连续 15 分钟未移动时触发（开始时触发一次）。

存储相关事件说明：
- `storage_item_change`：物品数量变化时触发。
- `storage_item_above`：物品数量达到阈值时触发。
- `storage_item_empty`：目标物品变为 0 时触发。
- `storage_container_empty`：容器从非空变为空。
- `storage_container_full`：容器达到容量上限。
- `tc_upkeep_left`：TC 维护剩余时间触发（阈值单位：分钟，触发条件为“<= 阈值”）。
- 物品匹配建议填写 `itemId:数字`（例如 `itemId:1545779598`）。

---

## 3. 变量系统（可用于事件消息模板）

在事件通知、Discord消息、团队消息模板中可使用下列变量：

### 基础变量
- `{event}`：事件类型
- `{time}`：当前本地时间
- `{entityId}`：触发设备实体ID
- `{member}`：触发成员名称
- `{player_status}`：队友状态文本（已上线/已下线/已重生/已死亡/挂机）
- `{marker_id}`：地图标记ID
- `{marker_grid}`：地图网格（如 `H12`）
- `{vending_items}`：新售货机白名单命中物品（示例：`[火箭弹][炸药]`）
- `{cargo_grid}`：货船网格
- `{cargo_harbor}`：货船停靠港口名称
- `{cargo_harbor_grid}`：货船停靠港口网格
- `{cargo_status_message}`：货船整合文案（进入/离开/航行/停靠）
- `{cargo_speed}`：货船速度（仅航行中事件）
- `{oil_rig}`：油井名称（大石油 / 小石油）
- `{oil_grid}`：石油事件网格
- `{oil_direction}`：油井方向（按最接近地图边缘判断 `N/S/W/E`）
- `{oil_stage_text}`：石油事件阶段文本
- `{oil_status_message}`：石油整合文案（大/小石油重装与解锁，默认返回方向而非网格）
- `{item_key}`：存储事件中的物品键（如 `itemId:12345`）
- `{item_qty}`：存储事件中的当前数量
- `{item_delta}`：存储事件数量变化值（可正可负）

### 服务器变量
- `{server_info}`：完整服务器摘要文案
- `{server_name}`：服务器名称（已按 `｜` 截断）
- `{server_players}`：当前在线人数
- `{server_max_players}`：服务器上限人数
- `{server_queue}`：排队人数
- `{server_map_size}`：地图大小
- `{game_time}`：游戏时间（HH:MM）
- `{day_phase}`：`白天` / `黑夜`
- `{phase_target}`：`日落` / `天亮`
- `{time_to_phase}`：距离切换剩余时间（如 `13分20秒`）

---

## 4. 推荐模板示例

### 示例1：警报通知
`[警报] {server_name} 设备:{entityId} 触发时间:{time} ({day_phase})`

### 示例2：整点播报
`{server_info}`

### 示例3：队伍上线提示
`[队伍] {member} 已上线，当前服务器 {server_players}/{server_max_players}`

### 示例4：石油事件整合
`{oil_status_message}`

说明：
- 现默认输出示例：`大石油重装已呼叫｜方向：E`
- 方向依据油井点位到地图四边的最短距离判断。

---

## 5. 指令与变量对应关系

### `fwq`
- 推荐变量：`{server_info}`、`{server_name}`、`{server_players}`、`{server_queue}`、`{game_time}`。
- 功能：服务器摘要与状态播报。

### `hc` / `shj`
- 推荐变量：`{marker_id}`。
- 功能：地图标记相关信息（货船、售货机）。

### `fk`
- 推荐变量：`{entityId}`。
- 功能：设备控制结果与最终状态反馈。

---

## 6. 服务器隔离策略

- 事件规则：按服务器隔离存储与加载，切换服务器后只显示对应规则。
- 指令规则：按服务器隔离存储与加载，切换服务器后只显示对应规则。
- 设备列表：仅显示当前连接服务器的已配对设备。
- 未连接服务器时：事件/指令新增与预设应用按钮会禁用。

---

## 7. 呼叫组 Webhook 教程

- 呼叫组里的 `KOOK 配置` 与 `Discord 配置` 当前都是 `Webhook 推送`，不是 Bot Token 模式。
- 在 `呼叫组 -> 新建呼叫组` 弹窗中，每个通道右侧都提供了 `教程` 按钮。
- Discord 教程会说明如何在 Discord 服务器里创建 Webhook 并复制 URL。
- KOOK 教程会说明如何在 KOOK 里找到 Webhook / 消息推送入口并复制 URL。
- 完成填写后，可直接点击呼叫组卡片上的 `测试呼叫` 验证消息是否到达。

---

## 8. 运行注意

- GUI 版和 web 版是两个独立系统。
- 如果两边同时连接到同一个 Rust+ 服务器，队伍聊天指令和事件通知会各自发送一次。
- 只测试 GUI 时，请停掉 `web/server.js`；只测试 web 时，请关闭 GUI。

---

## 9. 云端无图形化 Steam 登录（Chrome 插件桥接）

适用场景：`rust-plus-web` 部署在 Ubuntu 云服务器（无桌面环境，无法直接弹出浏览器登录 Steam）。

流程：
1. 在 Web 端点击 Steam 登录，生成一次性会话码（`RPTK-...`）。
2. 在本机 Chrome 安装扩展目录：`platforms/chrome-rustplus-bridge`。
3. 扩展里填写云端地址 + 会话码，点击“开始 Steam 登录并回传”。
4. 本机 Chrome 完成 Steam 登录后，扩展将 token 回传至云端 `/steam-bridge/complete`。
5. 云端自动写入 `rustplus.config.json`，并自动尝试启动配对监听。

教程页面：
- Web 内置教程：`/docs-static/tutorial-steam-bridge.html`

排错：
- 会话过期：重新在 Web 端发起一次登录获取新会话码。
- 回传失败：先访问 `<你的域名>/steam-bridge/ping`，确认返回 `{\"ok\":true}`。
