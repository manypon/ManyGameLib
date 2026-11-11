@echo off
cd /d "%~dp0"
call npm install
start "" "node_modules\electron\dist\electron.exe" .
