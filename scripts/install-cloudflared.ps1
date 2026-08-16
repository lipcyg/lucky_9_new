[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$InstallDir = Join-Path $Root ".tools\cloudflared"
$CloudflaredExe = Join-Path $InstallDir "cloudflared.exe"
$DownloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

if (Test-Path $CloudflaredExe) {
  Write-Host "cloudflared already installed: $CloudflaredExe"
  & $CloudflaredExe --version
  exit 0
}

if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
  throw "curl.exe is required to download cloudflared."
}

Write-Host "Downloading cloudflared..."
Write-Host $DownloadUrl

& curl.exe -L --retry 3 --fail -o $CloudflaredExe $DownloadUrl

if ($LASTEXITCODE -ne 0 -or -not (Test-Path $CloudflaredExe)) {
  throw "cloudflared download failed."
}

Write-Host "cloudflared installed: $CloudflaredExe"
& $CloudflaredExe --version
