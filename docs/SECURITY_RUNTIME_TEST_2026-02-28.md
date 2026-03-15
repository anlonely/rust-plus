# 安全/运行时测试报告（2026-02-28）

## 1. 自动化测试
命令：`npm test`

结果：
- 总计：6
- 通过：6
- 失败：0
- 用时：约 58.68ms

覆盖点：
- 外链 URL 校验（协议/host allowlist）
- URL 标准化
- 敏感值掩码
- XML 转义
- 日志敏感字段脱敏

## 2. 运行时渗透验证（输入探测）
执行了 URL 与注入载荷探测：

- `javascript:alert(1)` -> BLOCK
- `file:///etc/passwd` -> BLOCK
- `data:text/html,<script>alert(1)</script>` -> BLOCK
- `http://example.com` -> BLOCK（默认仅允许 https）
- `https://example.com` -> ALLOW
- `https://user:pass@example.com/private` -> BLOCK
- `https://sub.rustplus.cn/path`（allowlist rustplus.cn）-> ALLOW

额外验证：
- TwiML/XML 字符串会被正确转义（`<`, `>`, `&`, `'`, `"`）
- Steam 状态对象不再包含 `token` 原文，仅返回 `tokenMasked`

## 3. 压测（负载基准）
对象：`src/utils/item-catalog.js` 的 `matchItems`

参数：
- 轮数：50,000
- 查询集：`高级蓝图/蓝图/基础蓝图/火箭弹/炸药/硫磺矿石/ak/m249/l96/workbench/metal ore/hqm ore`

结果：
- 总耗时：7677.06ms
- 吞吐：约 6513 QPS
- 过程无崩溃/无异常退出

## 4. 结论
- 本次修复项已通过自动化测试与运行时探测。
- 现有代码在外链、token 暴露、日志脱敏、XML 注入防护方面已显著收敛风险。
- 仍建议后续补充：Electron 端端到端 UI 安全回归（Playwright）与 IPC fuzz 测试。
