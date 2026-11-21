@echo off
setlocal EnableExtensions
title BOZZ AI Launcher

:: =====================================================
:: BOZZ AI - MAIN STARTUP LAUNCHER
:: =====================================================

:: Always use the folder where this BAT file is located
set "ROOT=%~dp0"
cd /d "%ROOT%"

echo.
echo  ================================================
echo             BOZZ AI - STARTING SYSTEM
echo  ================================================
echo.
echo  [SYSTEM] Checking BOZZ installation...

:: =====================================================
:: CHECK PROJECT FILES
:: =====================================================

if not exist "%ROOT%backend\app\main.py" (
    echo.
    echo  [ERROR] Backend application not found.
    echo  Expected: backend\app\main.py
    goto ERROR
)

if not exist "%ROOT%backend\requirements.txt" (
    echo.
    echo  [ERROR] Backend requirements file not found.
    echo  Expected: backend\requirements.txt
    goto ERROR
)

if not exist "%ROOT%frontend\package.json" (
    echo.
    echo  [ERROR] Frontend package.json not found.
    echo  Expected: frontend\package.json
    goto ERROR
)

echo  [OK] Project files found.

:: =====================================================
:: CHECK PYTHON 3.13
:: =====================================================

echo.
echo  [SYSTEM] Checking Python 3.13...

py -3.13 --version >nul 2>&1

if errorlevel 1 (
    echo.
    echo  [ERROR] Python 3.13 was not found.
    echo  Please install Python 3.13 and enable the Python launcher.
    goto ERROR
)

echo  [OK] Python 3.13 detected.

:: =====================================================
:: CREATE VIRTUAL ENVIRONMENT
:: =====================================================

echo.
echo  [SYSTEM] Checking virtual environment...

if not exist "%ROOT%.venv\Scripts\python.exe" (
    echo  [SYSTEM] Creating virtual environment...

    py -3.13 -m venv "%ROOT%.venv"

    if errorlevel 1 (
        echo  [ERROR] Failed to create virtual environment.
        goto ERROR
    )
)

set "VENV_PY=%ROOT%.venv\Scripts\python.exe"

echo  [OK] Virtual environment ready.

:: =====================================================
:: INSTALL BACKEND DEPENDENCIES
:: =====================================================

echo.
echo  [SYSTEM] Checking backend dependencies...

"%VENV_PY%" -m pip install --upgrade pip

if errorlevel 1 (
    echo.
    echo  [ERROR] Could not upgrade pip.
    goto ERROR
)

echo.
echo  [SYSTEM] Installing backend requirements...

"%VENV_PY%" -m pip install -r "%ROOT%backend\requirements.txt"

if errorlevel 1 (
    echo.
    echo  [ERROR] Backend dependency installation failed.
    goto ERROR
)

echo.
echo  [OK] Backend dependencies installed.

:: =====================================================
:: CHECK NODE.JS AND NPM
:: =====================================================

echo.
echo  [SYSTEM] Checking Node.js...

where node >nul 2>&1

if errorlevel 1 (
    echo.
    echo  [ERROR] Node.js was not found.
    goto ERROR
)

where npm >nul 2>&1

if errorlevel 1 (
    echo.
    echo  [ERROR] NPM was not found.
    goto ERROR
)

echo  [OK] Node.js and NPM detected.

:: =====================================================
:: INSTALL FRONTEND DEPENDENCIES
:: =====================================================

echo.
echo  [SYSTEM] Checking frontend dependencies...

if not exist "%ROOT%frontend\node_modules" (

    echo  [SYSTEM] Installing frontend packages...

    pushd "%ROOT%frontend"

    call npm install

    if errorlevel 1 (
        popd
        echo.
        echo  [ERROR] Frontend dependency installation failed.
        goto ERROR
    )

    popd
)

echo  [OK] Frontend dependencies ready.

:: =====================================================
:: START BACKEND SERVER
:: =====================================================

echo.
echo  [SYSTEM] Starting BOZZ backend...

start "BOZZ AI - BACKEND" /D "%ROOT%backend" cmd.exe /k ""%VENV_PY%" -m uvicorn app.main:app --app-dir "%ROOT%backend" --host 127.0.0.1 --port 8000"

:: =====================================================
:: START FRONTEND SERVER
:: =====================================================

echo.
echo  [SYSTEM] Starting BOZZ frontend...

start "BOZZ AI - FRONTEND" /D "%ROOT%frontend" cmd.exe /k "npm run dev -- --host 127.0.0.1"

:: =====================================================
:: OPEN BOZZ
:: =====================================================

echo.
echo  ================================================
echo              BOZZ AI IS STARTING
echo  ================================================
echo.
echo  Backend API:
echo  http://127.0.0.1:8000
echo.
echo  Backend API Documentation:
echo  http://127.0.0.1:8000/docs
echo.
echo  Frontend:
echo  http://localhost:5173
echo.
echo  [SYSTEM] Servers launched.
echo  [SYSTEM] Wait for both servers to initialize.
echo  ================================================
echo.

timeout /t 6 /nobreak >nul

start "" "http://localhost:5173"

echo.
echo  [SYSTEM] BOZZ launcher completed.
echo.
pause
exit /b 0

:: =====================================================
:: ERROR HANDLER
:: =====================================================

:ERROR

echo.
echo  ================================================
echo                 BOZZ STARTUP FAILED
echo  ================================================
echo.
echo  Check the error message above.
echo.
pause
exit /b 1