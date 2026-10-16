@echo off
title Polaris POS System
echo Polaris POS System Ba?lat?l?yor...
start /min node server.js
timeout /t 2 /nobreak >nul
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app=http://localhost:3000 --kiosk-printing --window-size=1280,800
exit
