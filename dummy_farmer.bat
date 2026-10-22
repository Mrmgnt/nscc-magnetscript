@echo off
setlocal
title NinjaSaga Bot - Dummy Account Gift Farmer
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] Node.js belum terpasang di komputer ini.
  echo   Install Node.js LTS dari: https://nodejs.org/en/download
  echo.
  pause
  exit /b 1
)

node ns_dummy_farmer.js
echo.
pause
endlocal
exit /b 0
