@echo off
title Fuel Run controller bridge
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is niet gevonden. Installeer het via https://nodejs.org en start dit bestand opnieuw. & pause & exit /b 1)
node fuel-run-bridge.js
pause
