@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-cloudflared.ps1" %*
