@echo off
title BOZZ launcher
rem Starts the BOZZ backend and the BOZZ frontend from wherever this folder lives.
rem Nothing here runs automatically at Windows login. Double-click it when you want BOZZ.
set "ROOT=%~dp0"

echo Starting BOZZ backend on http://127.0.0.1:8000 ...
start "BOZZ backend" cmd /k "cd /d "%ROOT%backend" && .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000"

timeout /t 4 /nobreak >nul

echo Starting BOZZ frontend on http://localhost:5173 ...
start "BOZZ frontend" cmd /k "cd /d "%ROOT%frontend" && npm run dev"

echo.
echo Two windows opened. Close them to stop BOZZ.
echo For the desktop app with the mini orb, run "npm run electron" inside the frontend folder instead.
pause
