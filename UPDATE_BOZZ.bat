@echo off
setlocal EnableExtensions
title BOZZ AI - Safe Repository Updater
color 0E
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

echo.
echo ==========================================================
echo              BOZZ AI - SAFE REPOSITORY UPDATE
echo ==========================================================
echo This updater fetches the latest integrated main branch.
echo It does NOT reset, clean, or delete your project data.
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git was not found on PATH. Install Git for Windows first.
  goto :fail
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [ERROR] This folder is not a Git repository.
  goto :fail
)

for /f "delims=" %%B in ('git branch --show-current') do set "CURRENT_BRANCH=%%B"
echo Current branch: %CURRENT_BRANCH%
echo.

git status --short
if errorlevel 1 goto :fail
git status --porcelain > "%TEMP%\bozz_git_status.txt"
for %%F in ("%TEMP%\bozz_git_status.txt") do if %%~zF GTR 0 (
  echo [STOP] Your repository has local changes.
  echo Commit or safely back up your work before updating.
  del "%TEMP%\bozz_git_status.txt" >nul 2>&1
  goto :fail
)
del "%TEMP%\bozz_git_status.txt" >nul 2>&1

echo.
echo [SAFETY] Local data folders such as data, .venv and node_modules are not deleted.
echo [SAFETY] The updater will switch to main only after confirming a clean Git tree.
set /p "CONFIRM=Update this repository from origin/main now? (Y/N): "
if /I not "%CONFIRM%"=="Y" (
  echo Update cancelled. No files changed.
  exit /b 0
)

echo.
echo [1/4] Fetching origin...
git fetch origin
if errorlevel 1 goto :fail

echo.
echo [2/4] Switching to main...
git show-ref --verify --quiet refs/heads/main
if errorlevel 1 (
  git switch --track -c main origin/main
) else (
  git switch main
)
if errorlevel 1 goto :fail

echo.
echo [3/4] Fast-forwarding main...
git pull --ff-only origin main
if errorlevel 1 (
  echo [ERROR] Main could not be fast-forwarded. Resolve repository history manually.
  goto :fail
)

echo.
echo [4/4] Refreshing local dependencies...
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r "backend\requirements.txt"
  if errorlevel 1 goto :fail
) else (
  echo [INFO] .venv not found. START_BOZZ.bat will create it.
)
if exist "frontend\package-lock.json" (
  pushd "frontend"
  call npm ci
  if errorlevel 1 (
    popd
    goto :fail
  )
  popd
) else (
  echo [ERROR] frontend\package-lock.json is missing.
  goto :fail
)

echo.
echo ==========================================================
echo             BOZZ REPOSITORY UPDATE COMPLETE
echo ==========================================================
echo Updated branch: main
echo Run START_BOZZ.bat to launch BOZZ.
echo Your data and local model folders were not intentionally removed.
echo.
pause
exit /b 0

:fail
echo.
echo [STOP] Update did not complete.
echo No git reset or git clean was run. Review the message above.
echo If a branch switch already occurred, your local data folders remain untouched.
echo.
pause
exit /b 1
