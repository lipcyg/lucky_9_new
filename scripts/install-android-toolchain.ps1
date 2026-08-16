[CmdletBinding()]
param(
  [string]$SdkRoot = "",
  [string]$JdkRoot = "",
  [string]$AndroidPlatform = "android-35",
  [string]$BuildToolsVersion = "35.0.0"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Tools = Join-Path $Root ".tools"
$Downloads = Join-Path $Tools "downloads"

if (-not $SdkRoot) {
  $SdkRoot = Join-Path $Tools "android-sdk"
}

if (-not $JdkRoot) {
  $JdkRoot = Join-Path $Tools "jdk-21"
}

$JdkZip = Join-Path $Downloads "temurin-jdk21.zip"
$CmdlineZip = Join-Path $Downloads "android-commandlinetools.zip"
$JdkUrl = "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk"
$CmdlineToolsUrl = "https://dl.google.com/android/repository/commandlinetools-win-14742923_latest.zip"

function Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message"
}

function Download-IfMissing {
  param(
    [string]$Url,
    [string]$OutputPath
  )

  if ((Test-Path $OutputPath) -and (Test-Zip $OutputPath)) {
    Write-Host "Using existing $OutputPath"
    return
  }

  if (Test-Path $OutputPath) {
    Write-Host "Removing incomplete or corrupt $OutputPath"
    Remove-Item -LiteralPath $OutputPath -Force
  }

  Write-Host "Downloading $Url"

  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe -L --retry 3 --fail -o $OutputPath $Url
  } else {
    Invoke-WebRequest -Uri $Url -OutFile $OutputPath
  }

  if (-not (Test-Zip $OutputPath)) {
    throw "Downloaded file is not a valid zip: $OutputPath"
  }
}

function Test-Zip {
  param([string]$Path)

  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    $zip.Dispose()
    return $true
  } catch {
    return $false
  }
}

function Get-JavaExe {
  param([string]$RootPath)

  $candidate = Get-ChildItem -Path $RootPath -Filter "java.exe" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like "*\bin\java.exe" } |
    Select-Object -First 1

  if (-not $candidate) {
    throw "java.exe was not found under $RootPath"
  }

  return $candidate.FullName
}

function Ensure-CleanDir {
  param([string]$Path)

  if (Test-Path $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }

  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

Set-Location $Root

Step "Preparing folders"
New-Item -ItemType Directory -Force -Path $Tools, $Downloads, $SdkRoot | Out-Null

Step "Downloading JDK 21"
Download-IfMissing $JdkUrl $JdkZip

if (-not (Test-Path $JdkRoot)) {
  Step "Extracting JDK"
  Ensure-CleanDir $JdkRoot
  Expand-Archive -LiteralPath $JdkZip -DestinationPath $JdkRoot -Force
}

$JavaExe = Get-JavaExe $JdkRoot
$JavaHome = Split-Path (Split-Path $JavaExe -Parent) -Parent

Step "Downloading Android command-line tools"
Download-IfMissing $CmdlineToolsUrl $CmdlineZip

$CmdlineRoot = Join-Path $SdkRoot "cmdline-tools"
$LatestRoot = Join-Path $CmdlineRoot "latest"
$SdkManager = Join-Path $LatestRoot "bin\sdkmanager.bat"

if (-not (Test-Path $SdkManager)) {
  Step "Extracting Android command-line tools"
  Ensure-CleanDir $LatestRoot
  $TempTools = Join-Path $Downloads "cmdline-tools-expanded"
  Ensure-CleanDir $TempTools
  Expand-Archive -LiteralPath $CmdlineZip -DestinationPath $TempTools -Force
  Copy-Item -Path (Join-Path $TempTools "cmdline-tools\*") -Destination $LatestRoot -Recurse -Force
}

$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:Path = "$JavaHome\bin;$SdkRoot\platform-tools;$LatestRoot\bin;$env:Path"

Step "Accepting Android SDK licenses"
"y`ny`ny`ny`ny`ny`ny`ny`ny`ny`n" | & $SdkManager "--sdk_root=$SdkRoot" --licenses

Step "Installing Android SDK packages"
& $SdkManager "--sdk_root=$SdkRoot" "platform-tools" "platforms;$AndroidPlatform" "build-tools;$BuildToolsVersion"

Step "Writing local Android environment file"
$EnvFile = Join-Path $Root ".android-env.ps1"
@"
`$env:JAVA_HOME = "$JavaHome"
`$env:ANDROID_HOME = "$SdkRoot"
`$env:ANDROID_SDK_ROOT = "$SdkRoot"
`$env:GRADLE_USER_HOME = "$Tools\gradle"
`$env:Path = "`$env:JAVA_HOME\bin;`$env:ANDROID_HOME\platform-tools;`$env:ANDROID_HOME\cmdline-tools\latest\bin;`$env:Path"
"@ | Set-Content -LiteralPath $EnvFile -Encoding ASCII

Step "Installed"
Write-Host "JAVA_HOME=$JavaHome"
Write-Host "ANDROID_HOME=$SdkRoot"
Write-Host ""
Write-Host "Before building Android in a new terminal, run:"
Write-Host ". .\.android-env.ps1"
