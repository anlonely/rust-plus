@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo ╔══════════════════════════════════════╗
echo ║  Rust 工具箱 · Windows GUI 启动       ║
echo ╚══════════════════════════════════════╝
echo.

:: ── 定位项目根目录 ──
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%\..\..\") do set "PROJECT_ROOT=%%~fI"

:: ── 检查 Node.js ──
node -v >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js！
    echo 请前往 https://nodejs.org 下载安装 Node.js 18+
    pause
    exit /b 1
)

:: ── 检查依赖 ──
if not exist "%PROJECT_ROOT%node_modules\electron" (
    echo [信息] 未检测到 Electron，正在安装依赖...
    cd /d "%PROJECT_ROOT%"
    npm install
    if errorlevel 1 (
        echo [错误] 安装失败，请检查网络后重试
        pause
        exit /b 1
    )
)

:: ── 初始化 .env ──
if not exist "%PROJECT_ROOT%.env" (
    if exist "%SCRIPT_DIR%.env.example" (
        copy "%SCRIPT_DIR%.env.example" "%PROJECT_ROOT%.env" >nul
        echo [信息] 已自动生成 .env，请按需修改配置
    ) else if exist "%PROJECT_ROOT%.env.example" (
        copy "%PROJECT_ROOT%.env.example" "%PROJECT_ROOT%.env" >nul
        echo [信息] 已自动生成 .env，请按需修改配置
    )
)

:: ── 启动 GUI ──
echo [信息] 正在启动 Electron GUI...
cd /d "%PROJECT_ROOT%"
npx electron .
pause
