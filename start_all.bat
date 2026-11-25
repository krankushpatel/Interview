@echo off
setlocal EnableDelayedExpansion
title Interview App - Launcher
cd /d "%~dp0"

echo ======================================================================
echo   Starting Interview Platform (Backend + Frontend + Ngrok Tunnel)
echo ======================================================================

:: 1. Pre-flight checks
if not exist "backend\.venv\Scripts\activate.bat" (
    echo [ERROR] Python virtual environment not found at backend\.venv
    echo         Run setup first: cd backend ^&^& python -m venv .venv ^&^& .venv\Scripts\activate ^&^& pip install -r requirements.txt
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [ERROR] node_modules not found in root folder.
    echo         Run setup first: npm install
    pause
    exit /b 1
)

if not exist "backend\.env" (
    echo [ERROR] backend\.env not found.
    echo         Copy .env.example to backend\.env and configure your keys.
    pause
    exit /b 1
)

:: 2. Read PUBLIC_BASE_URL from backend\.env
set "PUBLIC_BASE_URL="
for /f "usebackq tokens=1,* delims==" %%A in ("backend\.env") do (
    set "KEY=%%A"
    set "VAL=%%B"
    if /i "!KEY!"=="PUBLIC_BASE_URL" (
        set "VAL=!VAL:"=!"
        set "VAL=!VAL:'=!"
        for /f "tokens=* delims= " %%V in ("!VAL!") do set "PUBLIC_BASE_URL=%%V"
    )
)

:: 3. Terminal 1: Backend (Port 8001)
echo [1/3] Launching Backend on http://localhost:8001 ...
start "Backend (Port 8001)" cmd /k "cd /d "%~dp0backend" && call .venv\Scripts\activate.bat && uvicorn main:app --reload --host 0.0.0.0 --port 8001"

:: 4. Terminal 2: Frontend (Port 3000)
echo [2/3] Launching Frontend on http://localhost:3000 ...
start "Frontend (Port 3000)" cmd /k "cd /d "%~dp0" && npm run dev"

:: 5. Terminal 3: Ngrok Tunnel
set "NGROK_CMD="
if exist "%~dp0ngrok.exe" (
    set "NGROK_CMD=%~dp0ngrok.exe"
) else (
    where ngrok >nul 2>nul
    if !errorlevel! equ 0 set "NGROK_CMD=ngrok"
)

if defined PUBLIC_BASE_URL (
    if defined NGROK_CMD (
        echo [3/3] Launching Ngrok Tunnel for !PUBLIC_BASE_URL! ...
        start "Ngrok Tunnel (Port 8001)" cmd /k "cd /d "%~dp0" && "!NGROK_CMD!" http 8001 --url !PUBLIC_BASE_URL!"
    ) else (
        echo [WARN] PUBLIC_BASE_URL is set, but ngrok.exe / ngrok was not found. Skipping Terminal 3.
    )
) else (
    echo [INFO] PUBLIC_BASE_URL is empty in backend\.env. Skipping Ngrok Tunnel.
)

echo ======================================================================
echo   All terminals launched!
echo   Frontend : http://localhost:3000
echo   Backend  : http://localhost:8001
if defined PUBLIC_BASE_URL echo   Tunnel   : !PUBLIC_BASE_URL!
echo ======================================================================
timeout /t 3 >nul
