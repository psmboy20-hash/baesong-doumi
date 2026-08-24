@echo off
cd /d "%~dp0"
rem kill old server on port 8899 so the updated code actually runs
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8899 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0update-check.ps1"
start "" "http://localhost:8899"
node server.js
