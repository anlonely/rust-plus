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
1. 在云端 Web UI 点击 Steam 登录，会生成一次性会话码（`RPTK-...`）。
2. 打开扩展弹窗，填写：
   - 云端地址：例如 `https://rust.anlonely.me`
   - 会话码：粘贴 Web UI 里的会话码
3. 点击「开始 Steam 登录并回传」。
4. 浏览器自动打开 Rust+ 登录页，完成 Steam 登录。
5. 扩展会自动回传 token，云端 UI 状态变为已完成。

## 常见问题
- 显示 `timeout`：登录页长时间未回传，重新发起会话并重试。
- 显示 `会话已过期`：Web 端会话默认 10 分钟，重新点击登录生成新会话码。
- 回传失败：检查云端地址是否可访问（需能访问 `/steam-bridge/ping`）。
