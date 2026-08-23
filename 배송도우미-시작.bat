@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0update-check.ps1"
start "" "http://localhost:8899"
node server.js
