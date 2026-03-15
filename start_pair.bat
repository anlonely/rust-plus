@echo off
chcp 65001 >nul
echo.
echo ╔══════════════════════════════════════╗
echo ║     Rust 工具箱 - 服务器配对         ║
echo ╚══════════════════════════════════════╝
echo.
echo 配对步骤:
echo  1. 程序将打开浏览器，完成 Steam 登录
echo  2. 打开 Rust 游戏进入服务器
echo  3. 按 ESC → Rust+ → Pair with Server
echo  4. 等待配对成功...
echo.
node src/index.js pair
pause
