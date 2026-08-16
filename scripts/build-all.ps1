[CmdletBinding()]
param(
  [switch]$SkipTests,
  [switch]$SkipNative,
  [switch]$RequireAndroid,
  [switch]$RequireIos,
  [string]$ServerUrl,
  [switch]$AllowManualServerUrl
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Dist = Join-Path $Root "dist"
$ServerBundle = Join-Path $Dist "lucky9-server"
$WindowsZip = Join-Path $Dist "lucky9-windows-server.zip"
$AndroidOut = Join-Path $Dist "android"
$IosOut = Join-Path $Dist "ios"
$AndroidBuilt = $false
$IosBuilt = $false
$AndroidReason = "Native build skipped."
$IosReason = "Native build skipped."

function Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message"
}

function HasCommand {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-ProjectScript {
  param([string]$ScriptName)

  if (HasCommand "npm.cmd") {
    & npm.cmd run $ScriptName
    return
  }

  if (HasCommand "npm") {
    & npm run $ScriptName
    return
  }

  if (HasCommand "pnpm") {
    & pnpm $ScriptName
    return
  }

  throw "pnpm or npm is required."
}

function Copy-IfExists {
  param(
    [string]$Path,
    [string]$Destination
  )

  if (Test-Path $Path) {
    Copy-Item -LiteralPath $Path -Destination $Destination -Recurse -Force
  }
}

function Normalize-ServerUrl {
  param([AllowNull()][string]$Url)

  if ([string]::IsNullOrWhiteSpace($Url)) {
    return ""
  }

  $normalized = $Url.Trim().TrimEnd([char[]]"/")

  try {
    $uri = [Uri]$normalized
  } catch {
    throw "ServerUrl must be a valid absolute http or https URL."
  }

  if (-not $uri.IsAbsoluteUri -or ($uri.Scheme -ne "http" -and $uri.Scheme -ne "https")) {
    throw "ServerUrl must be a valid absolute http or https URL."
  }

  $host = $uri.Host.ToLowerInvariant()

  if (
    $host -eq "your-permanent-lucky9-server.com" -or
    $host -match "(^|\.)example\." -or
    $host -match "^(your-|replace-)"
  ) {
    throw "ServerUrl is still a placeholder. Replace it with your real Lucky 9 server URL."
  }

  return $normalized
}

function Write-AppConfig {
  param(
    [AllowNull()][string]$Url,
    [bool]$AllowManualUrl
  )

  $normalized = Normalize-ServerUrl $Url
  $encoded = $normalized | ConvertTo-Json -Compress
  $manual = if ($AllowManualUrl) { "true" } else { "false" }
  $configPath = Join-Path $Root "public\config.js"

@"
window.LUCKY9_CONFIG = Object.freeze({
  serverUrl: $encoded,
  allowManualServerUrl: $manual
});
"@ | Set-Content -LiteralPath $configPath -Encoding ASCII

  return $normalized
}

Set-Location $Root

$ShouldWriteServerConfig = $PSBoundParameters.ContainsKey("ServerUrl")

if (-not $ShouldWriteServerConfig -and -not [string]::IsNullOrWhiteSpace($env:LUCKY9_SERVER_URL)) {
  $ServerUrl = $env:LUCKY9_SERVER_URL
  $ShouldWriteServerConfig = $true
}

$LocalAndroidEnv = Join-Path $Root ".android-env.ps1"

if (Test-Path $LocalAndroidEnv) {
  . $LocalAndroidEnv
}

$env:GRADLE_USER_HOME = Join-Path $Root ".tools\gradle"
$env:GRADLE_OPTS = "-Dorg.gradle.daemon=false"

Step "Checking tools"
if (-not (HasCommand "node")) {
  throw "Node.js 22 or later is required."
}

node --version

if ($ShouldWriteServerConfig -or $AllowManualServerUrl) {
  Step "Writing app server config"
  $BundledServerUrl = Write-AppConfig $ServerUrl ([bool]$AllowManualServerUrl)

  if ($BundledServerUrl) {
    Write-Host "Bundled server URL: $BundledServerUrl"
  } else {
    Write-Host "Bundled server URL cleared."
  }

  Write-Host "Manual Server URL field: $(if ($AllowManualServerUrl) { "enabled" } else { "hidden" })"
}

if (-not $SkipTests) {
  Step "Running tests"
  Invoke-ProjectScript "test"
}

Step "Preparing distribution folders"
New-Item -ItemType Directory -Force -Path $Dist | Out-Null

if (Test-Path $ServerBundle) {
  Remove-Item -LiteralPath $ServerBundle -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $ServerBundle | Out-Null

Step "Copying server and web app"
Copy-Item -LiteralPath (Join-Path $Root "public") -Destination $ServerBundle -Recurse -Force
Copy-Item -LiteralPath (Join-Path $Root "server") -Destination $ServerBundle -Recurse -Force
Copy-Item -LiteralPath (Join-Path $Root "shared") -Destination $ServerBundle -Recurse -Force
Copy-Item -LiteralPath (Join-Path $Root "scripts") -Destination $ServerBundle -Recurse -Force
Copy-Item -LiteralPath (Join-Path $Root "package.json") -Destination $ServerBundle -Force
Copy-IfExists (Join-Path $Root "pnpm-lock.yaml") $ServerBundle
Copy-IfExists (Join-Path $Root "README.md") $ServerBundle
Copy-IfExists (Join-Path $Root "docs") $ServerBundle

$StartCmd = Join-Path $ServerBundle "start-lucky9-server.cmd"
@"
@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start-server.ps1"
"@ | Set-Content -LiteralPath $StartCmd -Encoding ASCII

if (Test-Path $WindowsZip) {
  Remove-Item -LiteralPath $WindowsZip -Force
}

Step "Creating Windows/server zip"
Compress-Archive -Path (Join-Path $ServerBundle "*") -DestinationPath $WindowsZip -Force

if (-not $SkipNative) {
  Step "Checking Android native build"
  New-Item -ItemType Directory -Force -Path $AndroidOut | Out-Null

  $AndroidGradle = Join-Path $Root "android\gradlew.bat"

  if (Test-Path $AndroidGradle) {
    $CapCli = Join-Path $Root "node_modules\.bin\cap.cmd"

    if (Test-Path $CapCli) {
      & $CapCli sync android

      if ($LASTEXITCODE -ne 0) {
        throw "Capacitor Android sync failed."
      }
    }

    Push-Location (Join-Path $Root "android")
    & .\gradlew.bat --no-daemon assembleDebug
    $GradleExitCode = $LASTEXITCODE
    Pop-Location

    if ($GradleExitCode -ne 0) {
      throw "Gradle Android build failed with exit code $GradleExitCode."
    }

    $ApkFiles = @(Get-ChildItem -Path (Join-Path $Root "android\app\build\outputs\apk") -Filter "*.apk" -Recurse -ErrorAction SilentlyContinue)
    $ApkFiles |
      Copy-Item -Destination $AndroidOut -Force

    $AndroidBuilt = [bool](Get-ChildItem -Path $AndroidOut -Filter "*.apk" -ErrorAction SilentlyContinue)
    $AndroidReason = if ($AndroidBuilt) {
      "APK copied to $AndroidOut."
    } else {
      "Gradle ran, but no APK was found under android\app\build\outputs\apk."
    }
  } else {
    $AndroidReason = "Android project not found. Install Android Studio/SDK, add Capacitor Android, then run this script again."
    Write-Warning $AndroidReason

    if ($RequireAndroid) {
      throw $AndroidReason
    }
  }

  Step "Checking iOS native build"
  New-Item -ItemType Directory -Force -Path $IosOut | Out-Null

  $isMac = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
    [System.Runtime.InteropServices.OSPlatform]::OSX
  )

  if (-not $isMac) {
    $IosReason = "iOS builds require macOS with Xcode. Run this script on a Mac after adding Capacitor iOS."
    Write-Warning $IosReason

    if ($RequireIos) {
      throw $IosReason
    }
  } elseif (Test-Path (Join-Path $Root "ios\App\App.xcworkspace")) {
    Push-Location $Root
    xcodebuild -workspace "ios/App/App.xcworkspace" -scheme "App" -configuration Release -archivePath "dist/ios/Lucky9.xcarchive" archive
    Pop-Location
    $IosBuilt = Test-Path (Join-Path $IosOut "Lucky9.xcarchive")
    $IosReason = if ($IosBuilt) { "Archive created under $IosOut." } else { "xcodebuild finished, but archive was not found." }
  } else {
    $IosReason = "iOS project not found. Add Capacitor iOS on a Mac, then run this script again."
    Write-Warning $IosReason

    if ($RequireIos) {
      throw $IosReason
    }
  }
}

Step "Build summary"
Write-Host "Windows/server package: $WindowsZip"
Write-Host "Server folder:          $ServerBundle"
Write-Host "Android APK:           $(if ($AndroidBuilt) { "BUILT - $AndroidOut" } else { "NOT BUILT - $AndroidReason" })"
Write-Host "iOS app/archive:       $(if ($IosBuilt) { "BUILT - $IosOut" } else { "NOT BUILT - $IosReason" })"
if ($ShouldWriteServerConfig -or $AllowManualServerUrl) {
  Write-Host "Bundled server URL:    $(if ($BundledServerUrl) { $BundledServerUrl } else { "none" })"
  Write-Host "Manual Server URL:     $(if ($AllowManualServerUrl) { "enabled" } else { "hidden" })"
}
Write-Host ""
Write-Host "Start the server with: scripts\start-server.cmd"
Write-Host "Check native tools with: scripts\check-native-prereqs.cmd"
