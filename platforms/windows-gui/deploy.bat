@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo ╔══════════════════════════════════════╗
echo ║  Rust 工具箱 · Windows GUI 部署       ║
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
for /f "tokens=*" %%i in ('node -v') do echo [信息] Node.js %%i

:: ── 安装依赖 ──
echo.
echo [1/4] 安装项目依赖（含 Electron，约 200MB，请耐心等待）...
cd /d "%PROJECT_ROOT%"
npm install
if errorlevel 1 (
    echo [错误] npm install 失败，请检查网络后重试
    pause
    exit /b 1
)
echo [完成] 依赖安装成功

:: ── 初始化目录 ──
echo.
echo [2/4] 初始化目录...
if not exist "%PROJECT_ROOT%config" mkdir "%PROJECT_ROOT%config"
if not exist "%PROJECT_ROOT%logs" mkdir "%PROJECT_ROOT%logs"
if not exist "%PROJECT_ROOT%assets" mkdir "%PROJECT_ROOT%assets"
echo [完成] 目录初始化成功

:: ── 初始化 .env ──
echo.
echo [3/4] 初始化配置...
if not exist "%PROJECT_ROOT%.env" (
    if exist "%SCRIPT_DIR%.env.example" (
        copy "%SCRIPT_DIR%.env.example" "%PROJECT_ROOT%.env" >nul
        echo [信息] 已从 platforms\windows-gui\.env.example 生成 .env
    ) else if exist "%PROJECT_ROOT%.env.example" (
        copy "%PROJECT_ROOT%.env.example" "%PROJECT_ROOT%.env" >nul
        echo [信息] 已从项目根目录 .env.example 生成 .env
    )
) else (
    echo [信息] .env 已存在，跳过
)

:: ── 构建 Windows 安装包 ──
echo.
echo [4/4] 构建 Windows 安装包 (x64)...
cd /d "%PROJECT_ROOT%"
npx electron-builder --win
if errorlevel 1 (
    echo [错误] 构建失败
    pause
    exit /b 1
)
echo [完成] 构建成功

echo.
echo ══════════════════════════════════════
echo   构建产物位于: %PROJECT_ROOT%dist\
echo   可运行 NSIS 安装程序进行安装
echo ══════════════════════════════════════
echo.
pause
