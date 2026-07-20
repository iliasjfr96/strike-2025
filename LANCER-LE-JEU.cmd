@echo off
setlocal
cd /d "%~dp0app"
node scripts\dev.mjs
if errorlevel 1 pause
