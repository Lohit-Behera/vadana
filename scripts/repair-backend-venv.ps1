# Repair backend .venv (corrupt tokenizers, locked files). Close Vadana and any `uv run` terminal first.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$backend = Join-Path $root "backend"

Get-Process python*, uv* -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Set-Location $backend
Remove-Item -Recurse -Force ".venv\Lib\site-packages\tokenizers-0.23.1.dist-info" -ErrorAction SilentlyContinue
uv sync --reinstall-package tokenizers --link-mode=copy
Write-Host "Backend venv repaired. Start Vadana again."
