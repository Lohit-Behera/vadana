# Smoke test: backend WebSocket handshake + typed message pipeline.
# Requires: uv, backend deps synced. LM Studio optional (-SkipLm).
param(
    [int]$Port = 8765,
    [switch]$SkipLm
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$backend = Join-Path $root "backend"

$env:LIVE_VOICE_PORT = "$Port"
if ($SkipLm) { $env:SKIP_LM = "1" } else { Remove-Item Env:SKIP_LM -ErrorAction SilentlyContinue }

$proc = Start-Process -FilePath "uv" -ArgumentList @("run", "python", "main.py") `
    -WorkingDirectory $backend `
    -PassThru -NoNewWindow

try {
    Start-Sleep -Seconds 4
    Push-Location $backend
    uv run python scripts/smoke_client.py
    if ($LASTEXITCODE -ne 0) { throw "smoke failed" }
}
finally {
    Pop-Location -ErrorAction SilentlyContinue
    if ($proc -and -not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
}
