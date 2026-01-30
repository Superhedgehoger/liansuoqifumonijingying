@echo off
setlocal

cd /d %~dp0

REM Dev launcher: backend API + React/Vite frontend

echo [1/3] Start backend API...
start "Backend" cmd /k "python web_run.py"

echo [2/3] Start frontend (Vite)...
start "Frontend" cmd /k "cd /d %~dp0simulator && npm install && npm run dev"

echo [3/3] Open browser...
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:3000/"

echo Done. Close the two terminal windows to stop.
endlocal
