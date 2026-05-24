# Copy backend source into Tauri bundle resources (release layout).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$src = Join-Path $root "backend"
$dst = Join-Path $root "src-tauri\resources\backend"

if (-not (Test-Path $src)) {
    throw "Backend folder not found: $src"
}

New-Item -ItemType Directory -Force -Path $dst | Out-Null

$items = @("pyproject.toml", "uv.lock", "main.py", "README.md", "live_voice")
foreach ($item in $items) {
    $from = Join-Path $src $item
    if (-not (Test-Path $from)) {
        Write-Warning "Skip missing: $from"
        continue
    }
    $to = Join-Path $dst $item
    if (Test-Path $to) {
        Remove-Item -Recurse -Force $to
    }
    Copy-Item -Recurse -Force $from $to
}

Write-Host "Synced backend -> $dst"
