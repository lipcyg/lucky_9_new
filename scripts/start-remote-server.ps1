[CmdletBinding()]
param(
  [int]$Port = 4179
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$CloudflaredExe = Join-Path $Root ".tools\cloudflared\cloudflared.exe"
$HealthUrl = "http://127.0.0.1:$Port/api/health"
$LocalUrl = "http://localhost:$Port"
$StartedServer = $false
$ServerProcess = $null
$OutLog = Join-Path $Root ".tmp-remote-server.out.log"
$ErrLog = Join-Path $Root ".tmp-remote-server.err.log"

function Test-LuckyServer {
  try {
    $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Wait-LuckyServer {
  param([int]$Seconds = 20)

  $deadline = (Get-Date).AddSeconds($Seconds)

  while ((Get-Date) -lt $deadline) {
    if (Test-LuckyServer) {
      return $true
    }

    Start-Sleep -Milliseconds 500
  }

  return $false
}

if (-not (Test-Path $CloudflaredExe)) {
  & (Join-Path $PSScriptRoot "install-cloudflared.ps1")
}

if (-not (Test-Path $CloudflaredExe)) {
  throw "cloudflared was not installed."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 22 or later is required to start Lucky 9."
}

Set-Location $Root

if (Test-LuckyServer) {
  Write-Host "Lucky 9 server is already running at $LocalUrl"
} else {
  Write-Host "Starting Lucky 9 server at $LocalUrl"
  $env:PORT = [string]$Port
  $NodePath = (Get-Command node).Source
  $ServerProcess = Start-Process `
    -FilePath $NodePath `
    -ArgumentList @("server/index.js") `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -WindowStyle Hidden `
    -PassThru
  $StartedServer = $true

  if (-not (Wait-LuckyServer)) {
    if ($ServerProcess -and -not $ServerProcess.HasExited) {
      Stop-Process -Id $ServerProcess.Id -Force -ErrorAction SilentlyContinue
    }

    Write-Host "Server output log: $OutLog"
    Write-Host "Server error log:  $ErrLog"
    throw "Lucky 9 server did not start on port $Port."
  }
}

Write-Host ""
Write-Host "Remote play is starting."
Write-Host "When cloudflared prints an https://*.trycloudflare.com URL, share that URL with other players."
Write-Host "Browser players can open the URL directly."
Write-Host "Android APK players should paste the URL into the Server URL field, then create or join a game."
Write-Host ""
Write-Host "Keep this window open while people are playing. Press Ctrl+C to stop the tunnel."
Write-Host ""

try {
  & $CloudflaredExe tunnel --url $LocalUrl
  $TunnelExitCode = $LASTEXITCODE

  if ($TunnelExitCode -ne 0) {
    Write-Host ""
    Write-Host "Cloudflare Tunnel stopped with exit code $TunnelExitCode."
    Write-Host "If you see 'lookup api.trycloudflare.com: no such host', Windows DNS could not resolve Cloudflare."
    Write-Host "Check that this computer has internet access and try changing the network DNS to 1.1.1.1 or 8.8.8.8."
    Write-Host "After DNS works, run scripts\start-remote-server.cmd again."
  }
} finally {
  if ($StartedServer -and $ServerProcess -and -not $ServerProcess.HasExited) {
    Stop-Process -Id $ServerProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
