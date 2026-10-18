@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 奶龙快跑 - 本机试玩
where node >nul 2>nul
if errorlevel 1 (
  echo 没有找到 Node.js，请先安装 Node.js 后重新打开。
  pause
  exit /b 1
)
if not exist "node_modules\three\build\three.module.js" (
  echo 正在恢复项目依赖，请稍候...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)
echo.
echo 奶龙快跑 - 圆胖角色试玩
echo 启动后请在浏览器打开：http://127.0.0.1:4173
echo 造型对照：http://127.0.0.1:4173/comparison.html
echo 保持这个窗口打开。关闭窗口或按 Ctrl+C 可停止服务。
echo.
node tools/server.mjs --open
if errorlevel 1 pause
