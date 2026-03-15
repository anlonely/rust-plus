# macOS 签名与公证

项目已启用 Electron Builder 的 macOS 签名与公证配置。

## 本地未签名打包

```bash
npm run build:mac
```

如果当前机器没有可用的 `Developer ID Application` 证书，构建会继续完成，但产物为未签名版本。

## 签名与公证所需环境变量

使用 Apple ID 模式时，至少需要：

```bash
export CSC_NAME="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID"
```

然后执行：

```bash
npm run build:mac:signed
```

## 产物

- `dist/*.dmg`
- `dist/*.zip`
- `dist/mac-arm64/*.app`

## 运行时数据目录

打包版应用会把可写文件保存到：

```text
~/Library/Application Support/Rust 工具箱/
```

其中包含：

- `config/`
- `logs/`
