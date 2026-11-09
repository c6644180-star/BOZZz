@echo off
title BOZZ Desktop AI
color 0A

echo ============================================
echo  Starting BOZZ Desktop AI...
echo ============================================

:: ============================================
:: Step 1: Start Backend (AI Brain)
:: ============================================
echo.
echo [1/2] Starting BOZZ Backend (AI)...
cd /d "%~dp0..\backend"

if exist .venv\Scripts\python.exe (
    echo Using .venv Python...
    call .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 >NUL 2>&1 &
    echo Backend PID: %!
) else (
    echo Python not found in .venv
    python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 >NUL 2>&1 &
    echo Backend PID: %!
)

:: Wait a moment for backend to start
timeout /t 3 /nobreak >nul

:: ============================================
:: Step 2: Start Frontend (Desktop Interface)
:: ============================================
echo.
echo [2/2] Starting BOZZ Frontend (Desktop)...
cd /d "%~dp0..\frontend"

echo Starting Vite development server...
npm run dev >NUL 2>&1 &
echo Frontend PID: %!

echo.
echo ============================================
echo BOZZ is now running!
echo.
echo "  Backend AI:  http://127.0.0.1:8000"
echo "  Frontend:    http://localhost:5173 (or auto-opened)"
echo.
echo "  WAKE WORD: Say 'BOZZ' to wake the AI"
echo "  MINIMIZE: Click TopBar Minimize2 button"
echo "  MINI ORB: Press Ctrl+Alt+M to toggle"
echo.
echo ============================================
echo .
echo "Press Ctrl+C to stop both servers..."
echo .

:: Wait for user to stop
:WAIT
timeout /t 15 /nobreak >nul
goto WAIT