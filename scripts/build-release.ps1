# Local signed Windows release build.
# Loads .env from repo root, then runs sync-backend + pnpm tauri build --bundles nsis.
#
# PowerShell: .\scripts\build-release.ps1
# CMD:        scripts\build-release.cmd

param(
    [string]$EnvFile = "",
    [string]$KeyFile = "",
    [string]$Password = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

function Import-DotEnv {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return }
    Write-Host "Loading $Path"
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line.Length -eq 0 -or $line.StartsWith("#")) { return }
        $eq = $line.IndexOf("=")
        if ($eq -lt 1) { return }
        $name = $line.Substring(0, $eq).Trim()
        $value = $line.Substring($eq + 1).Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        Set-Item -Path "Env:$name" -Value $value
    }
}

if ([string]::IsNullOrWhiteSpace($EnvFile)) {
    $EnvFile = Join-Path $Root ".env"
}
Import-DotEnv $EnvFile

if ([string]::IsNullOrWhiteSpace($KeyFile)) {
    $KeyFile = Join-Path $env:USERPROFILE ".tauri\vadana-2026p.key"
}

if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY) -and (Test-Path $KeyFile)) {
    $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $KeyFile -Raw
}

if (-not [string]::IsNullOrWhiteSpace($Password)) {
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $Password
}

if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)) {
    throw "TAURI_SIGNING_PRIVATE_KEY is missing. Add it to .env or set the env var."
}

if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD)) {
    Write-Warning "TAURI_SIGNING_PRIVATE_KEY_PASSWORD is empty (ok only for passwordless keys)."
}

Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue

Write-Host "Syncing backend into Tauri resources..."
pnpm run sync-backend

Write-Host "Building signed NSIS installer..."
pnpm tauri build --bundles nsis

$version = (Get-Content package.json | ConvertFrom-Json).version
$bundle = Join-Path $Root "src-tauri\target\release\bundle\nsis\Vadana_${version}_x64-setup.exe"
$sig = "$bundle.sig"

Write-Host ""
Write-Host "Done."
Write-Host "  Installer: $bundle"
if (Test-Path $sig) {
    Write-Host "  Signature: $sig"
} else {
    Write-Warning "No .sig file found — check signing key and password in .env"
}
