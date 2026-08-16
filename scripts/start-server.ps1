[CmdletBinding()]
param(
  [int]$Port = 4179
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")

function Get-LanIps {
  $lines = ipconfig | Select-String "IPv4 Address"

  foreach ($line in $lines) {
    $ip = ($line.ToString() -split ":", 2)[1].Trim()

    if ($ip -and $ip -notlike "127.*" -and $ip -notlike "169.254.*") {
      $ip
    }
  }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 22 or later is required to start Lucky 9."
}

Set-Location $Root
$env:PORT = [string]$Port

Write-Host "Lucky 9 server starting from $Root"
Write-Host "Local URL: http://localhost:$Port"

$lanIps = @(Get-LanIps | Select-Object -Unique)

foreach ($ip in $lanIps) {
  Write-Host "LAN URL:   http://${ip}:$Port"
}

Write-Host ""
Write-Host "Keep this window open while people are playing."
node server/index.js
