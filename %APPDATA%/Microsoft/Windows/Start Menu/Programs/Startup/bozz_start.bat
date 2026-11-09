@echo off
title BOZZ Desktop AI - Auto Start

:: ============================================
:: Start Backend (AI Brain) in background
:: ============================================
echo.
echo Starting BOZZ Backend (AI)...
start "BOZZ_Backend" cmd /k cd /d "C:\Users\Marimuthu S\Documents\GitHub\BOZZz\backend" & .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

:: Wait for backend to start
timeout /t 5 /nobreak >nul

:: ============================================
:: Start Frontend (Desktop Interface) in background
:: ============================================
echo.
echo Starting BOZZ Frontend (Desktop)..
start "BOZZ_Frontend" cmd /k cd /d "C:\Users\Marimuthu S\Documents\GitHub\BOZZz\frontend" & npm run dev

echo.
echo ============================================
echo  BOZZ will auto-start on next login!
echo ============================================
echo.
echo  Backend AI:  http://127.0.0.1:8000 (when backend window opens)
echo  Frontend:    http://localhost:5173 (opens in browser)
echo.
echo "  WAKE WORD: Say 'BOZZ' to wake the AI"
echo "  MINIMIZE: Click TopBar Minimize2 button"
echo "  MINI ORB: Press Ctrl+Alt+M to toggle"
echo.
echo  Two command windows will open on startup.
echo.
pause