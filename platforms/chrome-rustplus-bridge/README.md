# Chrome 扩展：Rust+ Steam Bridge

用于云端 `rust-plus-web` 无图形化部署场景：
- 在本机 Chrome 完成 Steam + Rust+ 登录。
- 自动抓取 `rustplus_auth_token`。
- 回传到云端 `/steam-bridge/complete`，由云端写入配置并自动启动配对监听。

## 安装
1. 打开 Chrome：`chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本目录：`platforms/chrome-rustplus-bridge`

## 使用
1. 在云端 Web UI 点击 Steam 配对，页面会自动创建一次性会话并把回传地址发给扩展。
2. 扩展会自动打开 Rust+ / Steam 登录页。
3. 在本机浏览器完成 Steam 登录。
4. 扩展自动抓取 `rustplus_auth_token` 并回传到云端。
5. 云端写入配置后自动启动配对监听。

备用手动流程：
1. 打开扩展弹窗。
2. 确认云端地址无误，并使用网页已经下发的当前登录任务重新接管。
3. 点击「重新接管当前登录任务」。

## 常见问题
- 显示 `timeout`：登录页长时间未回传，重新发起会话并重试。
- 显示 `任务已过期`：Web 端登录任务默认 10 分钟，重新点击登录生成新任务。
- 回传失败：检查云端地址是否可访问（需能访问 `/steam-bridge/ping`）。
