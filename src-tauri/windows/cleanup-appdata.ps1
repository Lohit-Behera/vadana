# Runs during NSIS uninstall (before app data is removed) when "Delete application data" is checked.
$ErrorActionPreference = "SilentlyContinue"
$bundleId = "com.lohit.vadana"
$manifest = Join-Path $env:APPDATA "$bundleId\uninstall-paths.json"
if (-not (Test-Path -LiteralPath $manifest)) {
    exit 0
}
try {
    $data = Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json
    foreach ($entry in $data.paths) {
        $p = [string]$entry
        if ([string]::IsNullOrWhiteSpace($p)) { continue }
        if (Test-Path -LiteralPath $p) {
            Remove-Item -LiteralPath $p -Recurse -Force
        }
    }
} catch {
    exit 1
}
exit 0
