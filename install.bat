@echo off
chcp 65001 >nul
echo.
echo ╔══════════════════════════════════════╗
echo ║     Rust 工具箱 v1.0 - 安装向导      ║
echo ╚══════════════════════════════════════╝
echo.

node -v >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js！
    echo 请前往 https://nodejs.org 下载安装 Node.js 18+
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [✓] Node.js %NODE_VER%

echo.
echo [1/3] 安装依赖（含 Electron，约 200MB，请耐心等待）...
npm install
if errorlevel 1 ( echo [错误] npm install 失败 & pause & exit /b 1 )
echo [✓] 依赖安装完成

echo.
echo [2/3] 初始化配置文件...
if not exist .env ( copy .env.example .env >nul & echo [✓] 已生成 .env ) else ( echo [✓] .env 已存在 )
if not exist config mkdir config
if not exist logs  mkdir logs
if not exist assets mkdir assets
echo [✓] 目录初始化完成

echo.
echo [3/3] 安装完成！
echo.
echo ══════════════════════════════════════
echo  启动方式：
echo  [GUI 模式]  双击 start_gui.bat    ← 推荐
echo  [命令行]    双击 start.bat
echo  [配对服务]  双击 start_pair.bat
echo ══════════════════════════════════════
echo.
pause
