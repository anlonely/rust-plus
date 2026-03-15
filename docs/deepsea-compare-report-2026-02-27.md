# 深海关闭前后数据对比报告（2026-02-27）

## 1. 采样说明
- 采样环境：`Rusty Moose |US Monthly|`
- 采样方式：`getMapMarkers` 单次快照，对比“关闭前”和“关闭后”
- 采样文件：
  - pre-close: `/Users/bing/Documents/openai-codex/rust-plus/config/deepsea-snapshots/deepsea-preclose-2026-02-27T21-03-16-146Z.json`
  - after-close: `/Users/bing/Documents/openai-codex/rust-plus/config/deepsea-snapshots/deepsea-afterclose-2026-02-27T21-07-47-068Z.json`

## 2. 总量对比
- 总 marker 数：`218 -> 208`（-10）
- type=1（玩家）:`4 -> 4`（0）
- type=3（售货机）:`214 -> 204`（-10）
- 其他 type（含你关注的 type=9/type=7）：两次均未出现

## 3. 深海候选对比
当前候选规则是“名称包含 deep/sea/ocean/under + type=9 + type=7 radius>0”。

- 候选数量：`2 -> 2`（无变化）
- 候选明细（前后完全一致）：
  1. `Under New Ownership`（type=3, id=4095366097）
  2. `WE OWN THE DEEPSEA`（type=3, id=4095368196）

## 4. 结论
1. 本次“深海关闭”前后，`getMapMarkers` 没有出现可直接识别“深海状态切换”的新 type（如 type=9/type=7 事件圈）。
2. 当前命中的“深海候选”是玩家售货机名称文本命中，属于噪声，不具备状态判定价值。
3. 关闭前后发生的显著变化是 type=3 售货机总量减少 10 个，但这更像普通售货机上下线/可见性波动，不足以单独作为深海状态依据。

## 5. 对现有逻辑的影响
- 依赖“名称包含 deep/sea”的判定在该服务器会误判（因为玩家自定义售货机名会命中）。
- 需要将“深海状态”从 marker 关键词匹配切换为更严格策略（例如你已采用的固定倒计时状态机），并把 marker 仅作为辅助信号。

## 6. 建议的下一步采集（提高判定置信度）
1. 在一个完整周期内每 15~30 秒连续采样（而不是单点快照），对比 marker 的生命周期。
2. 单独记录所有非 type=1/3 的 marker 明细（id/type/x/y/radius/name），重点看 type=2/7/8/9 的短时出现。
3. 若要继续用 marker 判深海，必须加“空间区域约束 + 生命周期约束 + 名称白名单/黑名单”，否则会被玩家售货机名污染。
