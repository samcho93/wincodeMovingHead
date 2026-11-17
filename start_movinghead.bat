@echo off
rem =====================================================================
rem  Wincode MovingHead Sim - double-click to start
rem   1) installs npm dependencies if missing
rem   2) if the server is already running, just opens the browser
rem   3) otherwise starts the server and opens the browser
rem  Closing this window stops the server.
rem =====================================================================
setlocal
cd /d "%~dp0"
title Wincode MovingHead Sim (http://127.0.0.1:7740)

where node >nul 2>&1
if errorlevel 1 (
  echo [MovingHead] Node.js is not installed. Get it from https://nodejs.org
  pause & exit /b 1
)

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:7740/api/status; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo [MovingHead] Already running - opening the browser.
  start "" http://127.0.0.1:7740
  timeout /t 2 >nul
  exit /b 0
)

if not exist node_modules\ws (
  echo [MovingHead] Installing npm dependencies...
  call npm install || (echo [MovingHead] npm install failed & pause & exit /b 1)
)

echo [MovingHead] Server: http://127.0.0.1:7740   (stop: close this window or Ctrl+C)
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:7740'"
node server\index.js
echo [MovingHead] Server stopped.
pause
