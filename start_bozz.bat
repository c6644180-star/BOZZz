@title BOZZ Desktop AI
@echo off
color 0A

echo ============================================
echo  BOZZ Desktop AI - Starting Up
echo ============================================

:: ============================================
:: Start Backend (AI Brain)
:: ============================================
echo.
echo [1/2] Opening Backend Terminal...
start "BOZZ_Backend" cmd /k cd /d "C:\Users\Marimuthu S\Documents\GitHub\BOZZz\backend" & .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

:: Wait a moment
timeout /t 5 /nobreak >nul

:: ============================================
:: Start Frontend (Desktop Interface)
:: ============================================
echo.
echo [2/2] Opening Frontend Terminal...
start "BOZZ_Frontend" cmd /k cd /d "C:\Users\Marimuthu S\Documents\GitHub\BOZZz\frontend" & npm run dev

echo.
echo ============================================
echo  BOZZ is now running!
echo ============================================
echo.
echo  Backend AI:  http://127.0.0.1:8000
echo  Frontend:    http://localhost:5173 (opens in browser)
echo.
echo "  WAKE WORD: Say 'BOZZ' to wake the AI"
echo "  MINIMIZE: Click TopBar Minimize2 button"
echo "  MINI ORB: Press Ctrl+Alt+M to toggle"
echo.
echo  Two terminal windows just opened above.
echo.
echo  Keep these windows open - BOZZ runs in the background.
echo.
pause