@echo off
chcp 65001 >nul
echo.
echo ╔══════════════════════════════════════╗
echo ║     Rust 工具箱 - 启动监听           ║
echo ╚══════════════════════════════════════╝
echo.
node src/index.js listen
pause
