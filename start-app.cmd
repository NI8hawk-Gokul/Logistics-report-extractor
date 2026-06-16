@echo off
setlocal
cd /d "%~dp0"

if not exist "backend\venv\Scripts\python.exe" (
  echo Backend environment was not found.
  echo Create it in backend\venv and install backend\requirements.txt.
  pause
  exit /b 1
)

echo Building the frontend...
pushd frontend
node node_modules\vite\bin\vite.js build
if errorlevel 1 (
  popd
  echo Frontend build failed.
  pause
  exit /b 1
)
popd

set DATABASE_MODE=auto
echo.
echo Smart Logistics is starting...
echo Open http://127.0.0.1:8080 in your browser.
echo Keep this window open while using the application.
echo.

pushd backend
venv\Scripts\python.exe main.py
popd
