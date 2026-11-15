@echo off
title BOZZ AI - JARVIS Protocol
color 0B
mode con: cols=90 lines=35
setlocal EnableDelayedExpansion

:: ────────────────────────────────────────────────
::          BOZZ AI - JARVIS STYLE LAUNCHER
:: ────────────────────────────────────────────────

cls
echo.
echo.
echo          ██████╗  ██████╗ ███████╗███████╗
echo          ██╔══██╗██╔═══██╗╚══███╔╝╚══███╔╝
echo          ██████╔╝██║   ██║  ███╔╝   ███╔╝ 
echo          ██╔══██╗██║   ██║ ███╔╝   ███╔╝  
echo          ██████╔╝╚██████╔╝███████╗███████╗
echo          ╚═════╝  ╚═════╝ ╚══════╝╚══════╝
echo.
echo                    A I   S Y S T E M
echo.
echo ══════════════════════════════════════════════════════════════
echo.
timeout /t 1 >nul

echo  [ SYSTEM ] Initializing BOZZ Core...
timeout /t 1 >nul

echo  [ SYSTEM ] Checking environment...
timeout /t 1 >nul

set "ROOT=%~dp0"
cd /d "%ROOT%"

:: Check Python
where python >nul 2>&1
if errorlevel 1 (
    color 0C
    echo.
    echo  [ ERROR ] Python not found in PATH.
    echo  Please install Python 3.11+ and try again.
    echo.
    pause
    exit /b
)

echo  [ OK ] Python detected
timeout /t 1 >nul

:: Virtual Environment
if not exist ".venv\Scripts\python.exe" (
    echo  [ SYSTEM ] Creating virtual environment...
    python -m venv .venv >nul 2>&1
    if errorlevel 1 (
        color 0C
        echo  [ ERROR ] Failed to create virtual environment.
        pause
        exit /b
    )
)
echo  [ OK ] Virtual environment ready
timeout /t 1 >nul

:: Dependencies
echo  [ SYSTEM ] Loading neural packages...
echo.
".venv\Scripts\python.exe" -m pip install --upgrade pip >nul 2>&1
".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt --quiet
echo  [ OK ] Backend modules loaded
timeout /t 1 >nul

:: Start Backend
echo  [ SYSTEM ] Starting Backend Core...
start "BOZZ Backend" cmd /k "cd /d "%ROOT%" && title BOZZ Backend && color 0A && .venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload"
timeout /t 4 >nul
echo  [ OK ] Backend online  →  http://127.0.0.1:8000
timeout /t 1 >nul

:: Frontend check
echo  [ SYSTEM ] Checking Frontend interface...
if not exist "frontend\node_modules" (
    echo  [ SYSTEM ] Installing frontend modules (first time)...
    cd frontend
    call npm install >nul 2>&1
    cd ..
)
echo  [ OK ] Frontend ready
timeout /t 1 >nul

:: Choice
cls
echo.
echo.
echo          ██████╗  ██████╗ ███████╗███████╗
echo          ██╔══██╗██╔═══██╗╚══███╔╝╚══███╔╝
echo          ██████╔╝██║   ██║  ███╔╝   ███╔╝ 
echo          ██╔══██╗██║   ██║ ███╔╝   ███╔╝  
echo          ██████╔╝╚██████╔╝███████╗███████╗
echo          ╚═════╝  ╚═════╝ ╚══════╝╚══════╝
echo.
echo ══════════════════════════════════════════════════════════════
echo.
echo               SELECT INTERFACE MODE
echo.
echo          [1]  Browser Mode          (Normal)
echo          [2]  Electron Mini Orb     (Recommended)
echo.
echo ══════════════════════════════════════════════════════════════
echo.
set /p choice="  Enter choice (1 or 2): "

if "%choice%"=="2" (
    echo.
    echo  [ SYSTEM ] Launching Electron Mini Orb...
    start "BOZZ Electron" cmd /k "cd /d "%ROOT%frontend" && title BOZZ Electron && color 0B && npm run electron"
) else (
    echo.
    echo  [ SYSTEM ] Launching Browser Interface...
    start "BOZZ Frontend" cmd /k "cd /d "%ROOT%frontend" && title BOZZ Frontend && color 0B && npm run dev"
    timeout /t 5 >nul
    start "" "http://localhost:5173"
)

:: Final Screen
cls
echo.
echo.
echo          ██████╗  ██████╗ ███████╗███████╗
echo          ██╔══██╗██╔═══██╗╚══███╔╝╚══███╔╝
echo          ██████╔╝██║   ██║  ███╔╝   ███╔╝ 
echo          ██╔══██╗██║   ██║ ███╔╝   ███╔╝  
echo          ██████╔╝╚██████╔╝███████╗███████╗
echo          ╚═════╝  ╚═════╝ ╚══════╝╚══════╝
echo.
echo ══════════════════════════════════════════════════════════════
echo.
echo               SYSTEM STATUS : ONLINE
echo.
echo      Backend   :  http://127.0.0.1:8000
if "%choice%"=="2" (
    echo      Mode      :  Electron Mini Orb
) else (
    echo      Frontend  :  http://localhost:5173
)
echo.
echo      All systems operational.
echo      Close the other windows to shut down BOZZ.
echo.
echo ══════════════════════════════════════════════════════════════
echo.
echo  Press any key to close this launcher...
pause >nul