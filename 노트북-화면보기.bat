@echo off
cd /d %~dp0
set HAM_VIEW=1
start http://localhost:8899
node server.js
