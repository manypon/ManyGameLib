@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ManyGameLib build

echo [1/4] Closing running ManyGameLib...
taskkill /F /IM ManyGameLib.exe >nul 2>&1

echo [2/4] Checking dependencies...
if not exist node_modules (
  call npm install
  if errorlevel 1 goto fail
)

echo [3/4] Removing old build...
if exist dist rmdir /s /q dist
if exist dist (
  echo Could not delete dist. Close Explorer windows in that folder and try again.
  goto fail
)

echo [4/4] Building...
call npm run build
if errorlevel 1 goto fail

echo.
echo Done:
echo   dist\ManyGameLib-Setup-*.exe  (installer)
echo   dist\win-unpacked\ManyGameLib.exe  (portable folder)
start "" explorer "dist"
pause
exit /b 0

:fail
echo.
echo Build failed. See the messages above.
pause
exit /b 1