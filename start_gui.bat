@echo off
chcp 65001 >nul
echo.
echo ╔══════════════════════════════════════╗
echo ║     Rust 工具箱 - 启动 GUI 界面      ║
echo ╚══════════════════════════════════════╝
echo.

:: 检查 electron 是否已安装
if not exist "node_modules\electron" (
    echo [!] 未检测到 Electron，正在安装...
    npm install
    if errorlevel 1 (
        echo [错误] 安装失败，请检查网络后重试
        pause
        exit /b 1
    )
)

echo 正在启动 GUI 界面...
npx electron .
pause
