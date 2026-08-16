@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-native-prereqs.ps1" %*
