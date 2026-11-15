@echo off
title Cloudflare Tunnel Auto-Updater
cd /d "%~dp0"
echo Starting Cloudflare Tunnel & Auto-Updating .env ...
backend\.venv\Scripts\python.exe start_tunnel.py
pause
