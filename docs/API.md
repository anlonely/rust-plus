# Rust 工具箱 — Web API 参考文档

> 版本：v1.0.0 | 基础路径：`http://127.0.0.1:3080`

---

## 认证

除 `/api/health` 外，所有接口均需认证（默认非回环地址强制开启）。

**三种认证方式（任选其一）**：

```
# 1. Bearer Token（推荐）
Authorization: Bearer <WEB_API_TOKEN>

# 2. 自定义请求头
X-Api-Token: <WEB_API_TOKEN>

# 3. URL 参数（调试用）
GET /api/servers?token=<WEB_API_TOKEN>
```

**未认证响应**：
```json
HTTP 401
{ "error": "Unauthorized" }
```

---

## 通用响应结构

**成功**：
```json
{ "success": true, ...data }
```

**失败**：
```json
HTTP 4xx/5xx
{ "success": false, "error": "错误描述" }
```

---

## 一、系统接口

### `GET /api/health`
健康检查（无需认证）

**响应**：
```json
{
  "ok": true,
  "service": "rust-plus-web",
  "ts": 1710000000000
}
```

---

### `GET /api/bootstrap`
获取初始化数据（服务器列表 + Steam 状态）

**响应**：
```json
{
  "servers": [...],
  "steam": {
    "hasLogin": true,
    "steamId": "76561198xxxxxxxxx",
    "avatarUrl": "https://..."
  }
}
```

---

## 二、服务器管理

### `GET /api/servers`
获取所有已配对服务器列表

**响应**：
```json
{
  "servers": [
    {
      "id": "server_1710000000000",
      "name": "My Rust Server",
      "ip": "1.2.3.4",
      "port": 28082,
      "playerId": "76561198xxxxxxxxx",
      "addedAt": "2026-01-01T00:00:00.000Z",
      "lastSeen": "2026-03-15T00:00:00.000Z"
    }
  ]
}
```

---

### `POST /api/servers/connect`
连接到指定服务器

**请求体**：
```json
{ "serverId": "server_1710000000000" }
```

**成功响应**：
```json
{
  "success": true,
  "server": { "id": "...", "name": "...", "ip": "...", "port": 28082 }
}
```

**错误**：
```json
HTTP 400 - { "success": false, "error": "serverId 不能为空" }
HTTP 404 - { "success": false, "error": "服务器不存在" }
```

---

### `POST /api/servers/disconnect`
断开当前服务器连接

**响应**：
```json
{ "success": true }
```

---

### `GET /api/server/info`
获取当前连接的服务器实时信息

**响应**：
```json
{
  "connected": true,
  "info": {
    "name": "My Server",
    "players": 42,
    "maxPlayers": 200,
    "mapSize": 4250,
    "seed": 1234567,
    "gameTime": "14:32",
    "dayPhase": "day",
    "wipeTime": "2026-01-01T16:00:00Z"
  }
}
```

---

## 三、队伍管理

### `GET /api/team/members`
获取队伍成员实时状态

**响应**：
```json
{
  "connected": true,
  "members": [
    {
      "steamId": "76561198xxxxxxxxx",
      "name": "PlayerName",
      "isOnline": true,
      "isAlive": true,
      "x": -1024.5,
      "y": 2048.3
    }
  ]
}
```

---

### `GET /api/team/messages`
获取最近的队伍聊天记录（最多 120 条）

**响应**：
```json
{
  "messages": [
    {
      "ts": "2026-03-15T12:00:00.000Z",
      "name": "PlayerName",
      "message": "fwq"
    }
  ]
}
```

---

### `POST /api/team/messages`
向队伍聊天发送消息

**请求体**：
```json
{ "message": "Hello team!" }
```

**成功响应**：
```json
{ "success": true }
```

**错误**：
```json
HTTP 429 - { "success": false, "error": "请求过于频繁：每分钟最多 20 次" }
```

---

## 四、Steam

### `GET /api/steam/status`
获取 Steam 登录状态

**响应**：
```json
{
  "hasLogin": true,
  "steamId": "76561198xxxxxxxxx",
  "avatarUrl": "https://avatars.steamstatic.com/...",
  "steamProfile": {
    "steamName": "PlayerName",
    "onlineState": "online",
    "stateMessage": "In-Game"
  }
}
```

---

## 五、事件规则

### `GET /api/rules/events`
获取当前服务器的所有事件规则

**响应**：
```json
{
  "serverId": "server_1710000000000",
  "rules": [
    {
      "id": "rule_alarm_on",
      "name": "警报触发",
      "event": "alarm_on",
      "enabled": true,
      "trigger": { "cooldownMs": 30000 },
      "_meta": {
        "message": "警报已触发！",
        "actions": [{ "type": "team_chat" }]
      }
    }
  ]
}
```

---

### `POST /api/rules/events`
新增或更新事件规则

**请求体**：
```json
{
  "id": "my_rule_001",
  "name": "货船进港通知",
  "event": "cargo_ship_at_port",
  "enabled": true,
  "trigger": { "cooldownMs": 60000 },
  "_meta": {
    "message": "货船已靠港！位置：{cargo_grid}",
    "actions": [
      { "type": "team_chat" },
      { "type": "notify_discord" }
    ]
  }
}
```

**成功响应**：
```json
{ "success": true, "rule": { ...saved_rule }, "serverId": "..." }
```

---

### `POST /api/rules/events/:id/enabled`
启用或禁用指定事件规则

**URL 参数**：`id` = 规则 ID

**请求体**：
```json
{ "enabled": false }
```

**成功响应**：
```json
{ "success": true }
```

---

### `DELETE /api/rules/events/:id`
删除事件规则

**URL 参数**：`id` = 规则 ID

**成功响应**：
```json
{ "success": true }
```

---

## 六、指令规则

### `GET /api/rules/commands`
获取当前服务器的所有指令规则

**响应**：
```json
{
  "serverId": "...",
  "rules": [
    {
      "id": "ai",
      "keyword": "ai",
      "type": "ai",
      "enabled": true,
      "meta": {
        "doChat": true,
        "doNotify": false,
        "doDiscord": false
      },
      "trigger": { "cooldownMs": 3000 }
    }
  ]
}
```

---

### `POST /api/rules/commands`
新增或更新指令规则

**请求体**：
```json
{
  "id": "fwq",
  "keyword": "fwq",
  "type": "server_info",
  "enabled": true,
  "meta": { "doChat": true, "doNotify": false, "doDiscord": false },
  "trigger": { "cooldownMs": 3000 }
}
```

**指令 type 枚举**：

| type | 功能 |
|------|------|
| `ai` | AI 问答 |
| `query_vendor` | 售货机查询 (shj) |
| `server_info` | 服务器信息 (fwq) |
| `deep_sea_status` | 深海状态 (sh) |
| `translate` | 翻译 (fy) |
| `change_leader` | 换队长 (dz) |
| `switch` | 开关控制 (fk) |
| `query_cargo` | 货船位置 (hc) |
| `query_heli` | 直升机位置 (wz) |
| `cctv` | CCTV 代码查询 (jk) |
| `call_group` | 触发呼叫组 |

---

### `POST /api/rules/commands/:id/enabled`
启用或禁用指令规则

**URL 参数**：`id` = 指令关键词（如 `ai`、`fwq`）

**请求体**：
```json
{ "enabled": true }
```

---

### `DELETE /api/rules/commands/:id`
删除指令规则

**URL 参数**：`id` = 指令关键词

---

## 七、呼叫组

### `GET /api/callgroups`
获取所有呼叫组

**响应**：
```json
{
  "groups": [
    {
      "id": "group_main",
      "name": "主队紧急呼叫",
      "enabled": true,
      "members": [
        {
          "phone": "+8613800000000",
          "kook": "kook-webhook-url",
          "discord": "discord-webhook-url"
        }
      ]
    }
  ]
}
```

---

### `POST /api/callgroups`
新增或更新呼叫组

**请求体**：
```json
{
  "id": "group_main",
  "name": "主队紧急呼叫",
  "enabled": true,
  "members": [
    { "phone": "+8613800000000" }
  ]
}
```

---

### `DELETE /api/callgroups/:id`
删除呼叫组

**URL 参数**：`id` = 呼叫组 ID

---

## 八、物品搜索

### `GET /api/items/search?q=<关键词>`
模糊搜索游戏物品（用于 shj 指令自动补全）

**参数**：`q` = 搜索关键词（中文/英文均可）

**示例**：`GET /api/items/search?q=高级蓝图`

**响应**：
```json
{
  "items": [
    {
      "id": -1779183908,
      "shortName": "blueprintbase",
      "displayName": "高级蓝图"
    }
  ]
}
```

---

## 九、通用 IPC 调用

### `POST /api/ipc/invoke`
调用内部 IPC 通道（高级用法）

**请求体**：
```json
{
  "channel": "server:getInfo",
  "args": []
}
```

**可用 IPC 通道**：

| channel | 说明 |
|---------|------|
| `server:list` | 获取服务器列表 |
| `server:connect` | 连接服务器 |
| `server:disconnect` | 断开连接 |
| `server:getInfo` | 获取服务器信息 |
| `server:getTeam` | 获取队伍信息 |
| `server:getMap` | 获取地图数据 |
| `server:addServer` | 添加服务器 |
| `server:removeServer` | 删除服务器 |
| `chat:send` | 发送聊天消息 |
| `device:list` | 获取设备列表 |
| `device:register` | 注册设备 |
| `device:remove` | 删除设备 |
| `device:toggle` | 切换开关状态 |
| `rules:list` | 获取事件规则 |
| `rules:add` | 添加事件规则 |
| `rules:remove` | 删除事件规则 |
| `rules:toggle` | 切换规则启用 |
| `commands:list` | 获取指令规则 |
| `commands:saveRule` | 保存指令规则 |
| `commands:removeRule` | 删除指令规则 |
| `commands:toggle` | 切换指令启用 |
| `callgroup:list` | 获取呼叫组 |
| `callgroup:set` | 保存呼叫组 |
| `callgroup:remove` | 删除呼叫组 |
| `steam:status` | Steam 状态 |
| `steam:logout` | Steam 登出 |
| `preset:listPresets` | 获取预设列表 |
| `preset:applyEventPreset` | 应用事件预设 |
| `preset:applyCommandPreset` | 应用指令预设 |

---

## 十、WebSocket 实时推送

**连接地址**：`ws://127.0.0.1:3080/ws`

**认证**（三种方式）：
```
# 1. 请求头
Sec-WebSocket-Protocol: auth.<base64url(token)>

# 2. URL 参数
ws://127.0.0.1:3080/ws?token=<WEB_API_TOKEN>

# 3. Authorization 头（支持代理）
Authorization: Bearer <WEB_API_TOKEN>
```

**服务端推送消息格式**：
```json
{
  "type": "event:type",
  "payload": { ...data },
  "at": 1710000000000
}
```

**推送事件类型**：

| type | 说明 | payload |
|------|------|---------|
| `server:connected` | 服务器连接成功 | `{ server }` |
| `server:disconnected` | 服务器断开 | `{ reason }` |
| `server:info` | 服务器信息更新 | 服务器快照对象 |
| `team:members` | 队伍成员更新 | `{ members: [...] }` |
| `team:message` | 新聊天消息 | `{ ts, name, message }` |
| `event:fired` | 事件规则触发 | `{ event, ruleId, name }` |
| `device:state` | 设备状态变化 | `{ entityId, state }` |
| `runtime:error` | 运行时错误 | `{ message }` |
| `pairing:received` | 配对推送接收 | `{ type, ip, port }` |

**客户端发送消息**：
```json
{ "type": "ping" }
```
服务端响应：`{ "type": "pong", "at": ... }`

---

## 附录：事件模板变量

在事件规则的 `message` 字段中可使用以下变量：

| 变量 | 适用事件 | 说明 |
|------|---------|------|
| `{member}` | player_status | 队友名称 |
| `{member_grid}` | player_status | 队友所在网格（如 C5） |
| `{heli_status_message}` | patrol_heli_status | 完整直升机状态文本 |
| `{heli_grid}` | patrol_heli_* | 直升机网格坐标 |
| `{cargo_status_message}` | cargo_ship_status | 完整货船状态文本 |
| `{cargo_grid}` | cargo_ship_* | 货船网格坐标 |
| `{ch47_status_message}` | ch47_status | 完整军运机状态文本 |
| `{oil_status_message}` | oil_rig_status | 完整石油状态文本 |
| `{oil_direction}` | oil_rig_* | 石油方向（N/S/E/W） |
| `{vendor_status_message}` | vendor_status | 完整商人状态文本 |
| `{vendor_grid}` | vendor_* | 商人网格坐标 |
| `{deep_sea_status_message}` | deep_sea_status | 完整深海状态文本 |
| `{hourly_time}` | hourly_tick | 当前游戏时间（如 14:00） |
| `{day_phase}` | hourly_tick | 当前天相（白天/夜晚） |
| `{phase_target}` | hourly_tick | 下一个天相（天黑/天亮） |
| `{time_to_phase_real}` | hourly_tick | 距下一天相的真实时间 |
