@echo off
REM Signed local release build (loads .env from repo root via PowerShell script).
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-release.ps1" %*
