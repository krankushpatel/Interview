@echo off
title Ngrok Permanent Tunnel (Port 8001)
cd /d "%~dp0"
echo ======================================================================
echo 🚀 Starting Ngrok Permanent Tunnel...
echo Fixed Domain: https://underling-magnesium-extinct.ngrok-free.dev
echo Local Port:   http://localhost:8001
echo Webhook URL:  https://underling-magnesium-extinct.ngrok-free.dev/zoom-bot/webhook/meeting-baas
echo ======================================================================
echo.
ngrok.exe http 8001 --url https://underling-magnesium-extinct.ngrok-free.dev
pause
