# 服务器地图模块说明

本文档说明 `rust-plus` 项目里“服务器地图”模块当前是如何获取、如何计算、如何渲染的，以及当前实际拿到的数据结构是什么样。

## 1. 模块目标

服务器地图模块做 4 件事：

1. 从 Rust+ 接口获取当前服务器地图图片和基础 monument 数据
2. 从 Rust+ 接口获取实时 marker 数据，例如队友、售货机
3. 用统一几何算法把世界坐标 `(x, y)` 映射到地图图片上的像素位置
4. 在 GUI / Web 页面上叠加网格、人物、售货机、地标

## 2. 代码入口

后端入口：

- Electron 主进程：
  - [/Users/bing/Documents/openai-codex/rust-plus/electron/main.js](/Users/bing/Documents/openai-codex/rust-plus/electron/main.js)
- Web 独立服务：
  - [/Users/bing/Documents/openai-codex/rust-plus/web/server.js](/Users/bing/Documents/openai-codex/rust-plus/web/server.js)

前端桥接：

- Electron preload：
  - [/Users/bing/Documents/openai-codex/rust-plus/electron/preload.js](/Users/bing/Documents/openai-codex/rust-plus/electron/preload.js)
- Web bridge：
  - [/Users/bing/Documents/openai-codex/rust-plus/web/public/web-bridge.js](/Users/bing/Documents/openai-codex/rust-plus/web/public/web-bridge.js)

共享几何逻辑：

- [/Users/bing/Documents/openai-codex/rust-plus/assets/server-map-geometry.js](/Users/bing/Documents/openai-codex/rust-plus/assets/server-map-geometry.js)

RustMaps 补充地标逻辑：

- [/Users/bing/Documents/openai-codex/rust-plus/src/utils/rustmaps.js](/Users/bing/Documents/openai-codex/rust-plus/src/utils/rustmaps.js)

GUI / Web 页面实现：

- [/Users/bing/Documents/openai-codex/rust-plus/electron/renderer/index.html](/Users/bing/Documents/openai-codex/rust-plus/electron/renderer/index.html)
- [/Users/bing/Documents/openai-codex/rust-plus/web/public/index.html](/Users/bing/Documents/openai-codex/rust-plus/web/public/index.html)

## 3. 获取流程

### 3.1 获取地图图片

后端调用：

- `rustClient.getMap()`

封装为 IPC：

- `map:getData`

返回时会做两件额外处理：

1. 如果原始地图字段里有 `jpgImage`，转成 `imageBase64`
2. 用 RustMaps 补充 `externalMonuments`

代码位置：

- Electron: [/Users/bing/Documents/openai-codex/rust-plus/electron/main.js#L2004](/Users/bing/Documents/openai-codex/rust-plus/electron/main.js#L2004)
- Web: [/Users/bing/Documents/openai-codex/rust-plus/web/server.js#L899](/Users/bing/Documents/openai-codex/rust-plus/web/server.js#L899)

### 3.2 获取实时 marker

后端调用：

- `rustClient.getMapMarkers()`

封装为 IPC：

- `map:getMarkers`

代码位置：

- Electron: [/Users/bing/Documents/openai-codex/rust-plus/electron/main.js#L2027](/Users/bing/Documents/openai-codex/rust-plus/electron/main.js#L2027)
- Web: [/Users/bing/Documents/openai-codex/rust-plus/web/server.js#L921](/Users/bing/Documents/openai-codex/rust-plus/web/server.js#L921)

### 3.3 前端如何刷新

前端会在地图刷新时并行拉取：

1. `getMapData()`
2. `getMapMarkers()`
3. `getTeamInfo()`
4. `getServerInfo()`

然后：

- 用 `map:getData` 的图片做底图
- 用 `map:getMarkers` 的 markers 叠加售货机、玩家等
- 用 `getTeamInfo()` 合并队友显示
- 用 `getServerInfo()` 补 `mapSize/worldSize`

代码位置：

- GUI: [/Users/bing/Documents/openai-codex/rust-plus/electron/renderer/index.html#L3714](/Users/bing/Documents/openai-codex/rust-plus/electron/renderer/index.html#L3714)
- Web: [/Users/bing/Documents/openai-codex/rust-plus/web/public/index.html#L3715](/Users/bing/Documents/openai-codex/rust-plus/web/public/index.html#L3715)

## 4. 当前实际获取到的数据

以下样例来自当前本地运行的 Bestrust 服务器，直接调用本地 web IPC 抓取，不是推测。

### 4.1 `map:getData` 实际返回结构

当前这个服务器返回的关键字段如下：

```json
{
  "width": 2749,
  "height": 2749,
  "oceanMargin": 500,
  "monuments": [
    {
      "token": "ferryterminal",
      "x": 1106.771240234375,
      "y": 353.743408203125
    },
    {
      "token": "train_tunnel_display_name",
      "x": 1122.5,
      "y": 366.5
    }
  ],
  "imageBase64": "<base64:733268 chars>"
}
```

当前这个服务器的 `map:getData` 没有返回：

- `worldSize`
- `mapSize`

但返回了：

- `width`
- `height`
- `oceanMargin`
- `monuments`
- `imageBase64`

这就是当前很多显示误差的源头之一：图片 payload 本身不总是带世界尺寸，必须再用 `server:getInfo` 补。

### 4.2 `map:getMarkers` 实际返回结构

当前这个服务器返回的顶层结构如下：

```json
{
  "mapMarkers": {
    "markers": [
      {
        "id": 27028584,
        "type": "Player",
        "x": 2104.921142578125,
        "y": 2711.213623046875,
        "steamId": "76561199886302710",
        "name": ""
      },
      {
        "id": 1380,
        "type": "VendingMachine",
        "x": 1720.02294921875,
        "y": 1726.3824462890625,
        "name": "Vehicles",
        "sellOrders": [
          {
            "itemId": 1883981801,
            "quantity": 1,
            "currencyId": -932201673,
            "costPerItem": 40,
            "amountInStock": 10
          }
        ]
      }
    ]
  },
  "seq": 123
}
```

当前 Bestrust 服务器这次抓到的 marker 数量：

- `43`

## 5. 坐标体系

### 5.1 Rust+ 世界坐标

项目内部所有 marker 的主坐标都按 Rust+ 世界坐标处理：

- `x`: 世界横向位置
- `y`: 世界纵向位置

常见来源：

- `map:getMarkers`
- `teamInfo`
- `map:getData.monuments`

### 5.2 世界坐标转图片归一化坐标

共享实现：

- [/Users/bing/Documents/openai-codex/rust-plus/assets/server-map-geometry.js#L160](/Users/bing/Documents/openai-codex/rust-plus/assets/server-map-geometry.js#L160)

核心函数：

- `worldToNormalized(x, y, mapContext)`
- `normalizedToWorld(nx, ny, mapContext)`

输出是：

- `nx`: 0 到 1
- `ny`: 0 到 1

然后前端再乘以当前图片渲染宽高，得到页面像素位置。

### 5.3 为什么需要 `mapContext`

因为图片尺寸和世界尺寸不是一回事。

例子：

- 这个服务器图片宽高是 `2749 x 2749`
- 实际服务器世界尺寸是 `3499`
- 图片还有 `oceanMargin = 500`

所以当前映射不能直接用：

- `x / width`
- `y / height`

必须先构造：

- `worldSize`
- `imageSpan`
- `offset`

由 `resolveMapContext()` 统一处理。

代码位置：

- [/Users/bing/Documents/openai-codex/rust-plus/assets/server-map-geometry.js#L76](/Users/bing/Documents/openai-codex/rust-plus/assets/server-map-geometry.js#L76)

## 6. `resolveMapContext()` 的逻辑

### 6.1 正常情况

如果图片 payload 直接带了世界尺寸：

- `payloadWorldSize`
- `worldSize`
- `mapSize`

那么上下文是：

```js
{
  coordinateSize: worldSize,
  imageSpan: worldSize,
  worldSize,
  offset: 0
}
```

### 6.2 当前 Bestrust 这种情况

如果图片 payload 没带世界尺寸，但带了 `oceanMargin`：

```js
{
  coordinateSize: worldSize + oceanMargin * 2,
  imageSpan: worldSize + oceanMargin * 2,
  worldSize,
  offset: oceanMargin,
  usesOceanMargin: true,
  calibrationRef: "oceanMarginFallback"
}
```

对当前服务器，实际等效是：

```json
{
  "worldSize": 3499,
  "oceanMargin": 500,
  "imageSpan": 4499,
  "offset": 500
}
```

也就是说图片不是只画了 `3499` 的世界区域，而是“海洋边距 + 世界 + 海洋边距”。

## 7. 网格是怎么计算的

### 7.1 共享基础网格算法

共享基础常量：

- `GRID_SIZE = 1024 / 7`
- `GRID_X_OFFSET = -1 / 3`
- `GRID_Y_OFFSET = -1 / 3`

代码位置：

- [/Users/bing/Documents/openai-codex/rust-plus/assets/server-map-geometry.js#L8](/Users/bing/Documents/openai-codex/rust-plus/assets/server-map-geometry.js#L8)

基础网格元数据：

```js
cols = ceil(worldSize / GRID_SIZE)
rows = cols
cellSize = worldSize / cols
```

代码位置：

- [/Users/bing/Documents/openai-codex/rust-plus/assets/server-map-geometry.js#L65](/Users/bing/Documents/openai-codex/rust-plus/assets/server-map-geometry.js#L65)

### 7.2 共享网格标签换算

共享基础换算函数：

- `markerToGridLabel(marker, worldSize, mapContext)`

实际做的是：

```js
colIndex = floor((x / cellSize) + GRID_X_OFFSET)
rowNumber = rows - floor((y / cellSize) + GRID_Y_OFFSET) - 1
```

然后再转成：

- `A0`
- `E2`
- `J15`

代码位置：

- [/Users/bing/Documents/openai-codex/rust-plus/assets/server-map-geometry.js#L136](/Users/bing/Documents/openai-codex/rust-plus/assets/server-map-geometry.js#L136)

## 8. GUI / Web 页面为什么和指令坐标不完全一样

这是项目当前的一个重要现实：

- `shj / wz / hc` 等指令使用的是命令侧坐标逻辑
- 服务器地图页面又叠加了一层“显示校准”

也就是说，页面不是纯粹直接画共享基础网格，而是做了额外的显示偏移。

当前页面专用参数在 GUI 和 Web 都存在：

- `SERVER_MAP_GRID_SCALE`
- `SERVER_MAP_GRID_COL_SHIFT`
- `SERVER_MAP_GRID_ROW_SHIFT`
- `SERVER_MAP_GRID_X_HALF_SHIFT`

代码位置：

- GUI: [/Users/bing/Documents/openai-codex/rust-plus/electron/renderer/index.html#L1491](/Users/bing/Documents/openai-codex/rust-plus/electron/renderer/index.html#L1491)
- Web: [/Users/bing/Documents/openai-codex/rust-plus/web/public/index.html#L1492](/Users/bing/Documents/openai-codex/rust-plus/web/public/index.html#L1492)

当前这套页面显示层参数是：

```js
SERVER_MAP_GRID_SCALE = 2 / 3
SERVER_MAP_GRID_COL_SHIFT = 1
SERVER_MAP_GRID_ROW_SHIFT = 0
SERVER_MAP_GRID_X_HALF_SHIFT = 0.5
```

含义：

- 网格尺寸缩小到原来的 `2/3`
- 再整体右移 `1` 格
- 再整体下移 `0` 格
- 再额外右移 `0.5` 格

这不是 Rust+ 原生数据，而是当前页面显示校准参数。

## 9. 页面如何把点画到图上

### 9.1 图片渲染矩形

前端会先算出图片在容器中的实际渲染区域：

- `left`
- `top`
- `width`
- `height`

然后所有点位都走：

1. `worldToNormalized()`
2. `normalizedToPixel()`

代码位置：

- GUI: [/Users/bing/Documents/openai-codex/rust-plus/electron/renderer/index.html#L2635](/Users/bing/Documents/openai-codex/rust-plus/electron/renderer/index.html#L2635)
- Web: [/Users/bing/Documents/openai-codex/rust-plus/web/public/index.html#L2636](/Users/bing/Documents/openai-codex/rust-plus/web/public/index.html#L2636)

### 9.2 页面网格覆盖层

网格覆盖层不是图片本身自带的，是前端循环画出来的 HTML。

入口：

- `buildMapGridOverlayHtml(mapContext, renderedRect)`

代码位置：

- GUI: [/Users/bing/Documents/openai-codex/rust-plus/electron/renderer/index.html#L3383](/Users/bing/Documents/openai-codex/rust-plus/electron/renderer/index.html#L3383)
- Web: [/Users/bing/Documents/openai-codex/rust-plus/web/public/index.html#L3384](/Users/bing/Documents/openai-codex/rust-plus/web/public/index.html#L3384)

它会对每一个网格单元计算：

- 左上世界坐标
- 右下世界坐标
- 中心点世界坐标

然后转成像素，生成：

- `.server-map-grid-cell`
- `.server-map-grid-cell-label`

## 10. RustMaps 在这里做了什么

Rust+ 自带 monument 信息通常比较少，或者只有 token。

所以项目额外做了：

- 根据 `mapSize + seed` 推导 RustMaps URL
- 或者按自定义 hint 指定特殊地图
- 抓取 RustMaps 页面里的 `window.pageData`
- 把 centered 坐标转成 Rust+ 坐标
- 追加为 `externalMonuments`

代码位置：

- [/Users/bing/Documents/openai-codex/rust-plus/src/utils/rustmaps.js](/Users/bing/Documents/openai-codex/rust-plus/src/utils/rustmaps.js)

例如：

- normal procedural map: `https://rustmaps.com/map/${mapSize}_${seed}`
- Hapis 等特殊图：用 hint 覆盖

## 11. 当前模块的实际问题

当前这套地图模块的主要复杂点有 3 个：

1. Rust+ `getMap()` 返回结构不稳定
2. 图片尺寸与世界尺寸不一致
3. 页面显示层又叠加了人工校准参数

所以如果“页面网格”和“游戏内地图网格”不一致，问题可能来自三层：

1. `map:getData` 没给 `worldSize`
2. `oceanMargin` 处理不对
3. 页面层的 `GRID_SCALE / COL_SHIFT / ROW_SHIFT / HALF_SHIFT` 不对

## 12. 如果要继续修，正确排查顺序

建议按这个顺序看，不要混着调：

1. 先确认 `server:getInfo.mapSize` 是不是对的
2. 再确认 `map:getData.width/height/oceanMargin` 是不是对的
3. 再确认 `resolveMapContext()` 输出的 `worldSize / imageSpan / offset`
4. 再看单个世界点经 `worldToNormalized()` 后是不是落在正确图片区域
5. 最后才调页面层：
   - `SERVER_MAP_GRID_SCALE`
   - `SERVER_MAP_GRID_COL_SHIFT`
   - `SERVER_MAP_GRID_ROW_SHIFT`
   - `SERVER_MAP_GRID_X_HALF_SHIFT`

## 13. 一句话结论

当前服务器地图模块不是“直接把 Rust+ 图片贴上去再画点”这么简单。

它实际是：

1. Rust+ 拉图
2. Rust+ 拉 marker
3. `server:getInfo` 补世界尺寸
4. `resolveMapContext()` 做图片坐标系还原
5. RustMaps 补 monument
6. GUI/Web 页面再叠一层人工网格校准

这也是为什么现在页面网格对齐问题，不能只改一个地方就结束。
