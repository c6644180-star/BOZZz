@echo off
setlocal EnableExtensions
title BOZZ AI - Complete Project Launcher
color 0E

rem BOZZ launcher: backend + Vite frontend + Electron desktop shell.
rem This script uses the folder containing this BAT file; spaces in the path are supported.
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "BACKEND=%ROOT%\backend"
set "FRONTEND=%ROOT%\frontend"
set "VENV=%ROOT%\.venv"
set "VENV_PY=%VENV%\Scripts\python.exe"

cd /d "%ROOT%"

echo.
echo  ==========================================================
echo                    BOZZ AI STARTUP
echo  ==========================================================
echo  Project: "%ROOT%"
echo.

rem ---------- Verify repository layout ----------
if not exist "%BACKEND%\app\main.py" (
  echo [ERROR] Missing backend\app\main.py
  goto :fail
)
if not exist "%BACKEND%\requirements.txt" (
  echo [ERROR] Missing backend\requirements.txt
  goto :fail
)
if not exist "%FRONTEND%\package.json" (
  echo [ERROR] Missing frontend\package.json
  goto :fail
)
if not exist "%FRONTEND%\package-lock.json" (
  echo [ERROR] Missing frontend\package-lock.json
  goto :fail
)
echo [OK] Project structure found.

rem ---------- Verify Python 3.13 ----------
echo.
echo [1/6] Checking Python 3.13...
py -3.13 --version >nul 2>&1
if errorlevel 1 (
  python --version 2>nul | findstr /R /C:"Python 3\.13\." >nul
  if errorlevel 1 (
    echo [ERROR] Python 3.13 was not found.
    echo Install Python 3.13 and enable the Python Launcher.
    goto :fail
  )
  set "PY_CMD=python"
) else (
  set "PY_CMD=py -3.13"
)
echo [OK] Python 3.13 found.

rem ---------- Create isolated environment ----------
echo.
echo [2/6] Preparing backend environment...
if not exist "%VENV_PY%" (
  %PY_CMD% -m venv "%VENV%"
  if errorlevel 1 (
    echo [ERROR] Could not create the project virtual environment.
    goto :fail
  )
)
if not exist "%VENV_PY%" (
  echo [ERROR] Virtual environment Python is missing.
  goto :fail
)
"%VENV_PY%" -m pip install --disable-pip-version-check -r "%BACKEND%\requirements.txt"
if errorlevel 1 (
  echo [ERROR] Backend dependency installation failed.
  goto :fail
)
echo [OK] Backend dependencies ready.

rem ---------- Verify Node.js runtime supported by Vite 8 ----------
rem Vite 8 supports Node 20.19+ or 22.12+. Node 22.21.1 is supported.
echo.
echo [3/6] Checking Node.js and npm...
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or is not on PATH.
  goto :fail
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm is not installed or is not on PATH.
  goto :fail
)
set "NODE_VERSION="
for /f "delims=" %%V in ('node -p "process.versions.node"') do set "NODE_VERSION=%%V"
if not defined NODE_VERSION (
  echo [ERROR] Could not read the Node.js version.
  goto :fail
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);const ok=(major===20&&minor>=19)||(major===22&&minor>=12)||major>22;process.exit(ok?0:1)" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] This BOZZ frontend requires Node.js 20.19+ or 22.12+.
  echo [INFO] Detected Node.js %NODE_VERSION%.
  echo [INFO] Your Node.js version must meet the Vite 8 runtime requirement.
  goto :fail
)
echo [OK] Node.js %NODE_VERSION% is supported.
for /f "delims=" %%V in ('npm --version') do set "NPM_VERSION=%%V"
echo [OK] npm %NPM_VERSION% found.

rem ---------- Install locked frontend dependencies ----------
echo.
echo [4/6] Preparing frontend packages...
if not exist "%FRONTEND%\node_modules\vite\bin\vite.js" (
  pushd "%FRONTEND%"
  call npm ci
  if errorlevel 1 (
    popd
    echo [ERROR] Frontend dependency installation failed.
    goto :fail
  )
  popd
)
echo [OK] Frontend packages ready.

rem ---------- Start backend ----------
echo.
echo [5/6] Starting BOZZ backend...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8000/health; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>&1
if errorlevel 1 (
  start "BOZZ Backend - API" /D "%BACKEND%" cmd.exe /k ""%VENV_PY%" -m uvicorn app.main:app --app-dir "%BACKEND%" --host 127.0.0.1 --port 8000"
) else (
  echo [INFO] A BOZZ-compatible service already answers on port 8000; reusing it.
)

rem ---------- Start frontend and wait for readiness ----------
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ready=$false; for($i=0; $i -lt 35; $i++){ try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8000/health; if($r.StatusCode -eq 200){$ready=$true; break} } catch {}; Start-Sleep -Seconds 1 }; if(-not $ready){exit 1}" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Backend did not become healthy on http://127.0.0.1:8000
  echo Check the BOZZ Backend window for the error.
  goto :fail
)
echo [OK] Backend health check passed.

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:5173; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>&1
if errorlevel 1 (
  start "BOZZ Frontend - Vite" /D "%FRONTEND%" cmd.exe /k "npm run dev -- --host 127.0.0.1"
) else (
  echo [INFO] A web service already answers on port 5173; reusing it.
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ready=$false; for($i=0; $i -lt 35; $i++){ try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:5173; if($r.StatusCode -eq 200){$ready=$true; break} } catch {}; Start-Sleep -Seconds 1 }; if(-not $ready){exit 1}" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Frontend did not become ready on http://127.0.0.1:5173
  echo Check the BOZZ Frontend window for the error.
  goto :fail
)
echo [OK] Frontend health check passed.

rem ---------- Launch the Electron desktop shell ----------
echo.
echo [6/6] Launching BOZZ desktop...
start "BOZZ Desktop - Electron" /D "%FRONTEND%" cmd.exe /k "npm run electron"

echo.
echo  ==========================================================
echo                 BOZZ SERVICES ARE RUNNING
echo  ==========================================================
echo  Desktop: Electron window should open shortly.
echo  Frontend: http://127.0.0.1:5173
echo  Backend:  http://127.0.0.1:8000
echo  API docs: http://127.0.0.1:8000/docs
echo.
echo  Ollama is optional. If installed, start Ollama separately
echo  and ensure your configured local model is available.
echo.
echo  IMPORTANT:
echo  - Camera and microphone remain permission-controlled.
echo  - Offline BOZZ wake-word detection is not yet installed.
echo  - Close the BOZZ Desktop window to quit the Electron shell.
echo  ==========================================================
echo.
pause
exit /b 0

:fail
echo.
echo  BOZZ could not start. Read the error above.
echo  No project data was deleted or reset.
echo.
pause
exit /b 1
