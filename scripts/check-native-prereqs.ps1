[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")

function HasCommand {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Show-Status {
  param(
    [string]$Name,
    [bool]$Ok,
    [string]$Details
  )

  $label = if ($Ok) { "OK" } else { "MISSING" }
  Write-Host ("{0,-22} {1,-8} {2}" -f $Name, $label, $Details)
}

$isMac = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
  [System.Runtime.InteropServices.OSPlatform]::OSX
)

Set-Location $Root

$LocalEnv = Join-Path $Root ".android-env.ps1"

if (Test-Path $LocalEnv) {
  . $LocalEnv
}

Write-Host "Lucky 9 native build prerequisites"
Write-Host ""

$nodeOk = HasCommand "node"
$javaOk = HasCommand "java"
$gradleOk = HasCommand "gradle"
$adbOk = HasCommand "adb"
$androidHome = $env:ANDROID_HOME
$androidSdkRoot = $env:ANDROID_SDK_ROOT
$androidProject = Test-Path (Join-Path $Root "android\gradlew.bat")
$iosProject = Test-Path (Join-Path $Root "ios\App\App.xcworkspace")
$xcodeOk = $isMac -and (HasCommand "xcodebuild")
$javaVersion = "Install JDK 21+"

if ($javaOk) {
  $javaVersion = cmd.exe /c "java -version 2>&1" | Select-Object -First 1
}

Show-Status "Node.js" $nodeOk $(if ($nodeOk) { (& node --version) } else { "Install Node.js 22+" })
Show-Status "Java/JDK" $javaOk $javaVersion
Show-Status "Gradle" ($gradleOk -or $androidProject) $(if ($gradleOk) { "Found on PATH" } elseif ($androidProject) { "Gradle wrapper found at android\gradlew.bat" } else { "Usually provided by android\gradlew.bat" })
Show-Status "ADB" $adbOk $(if ($adbOk) { "Found on PATH" } else { "Install Android SDK Platform Tools" })
Show-Status "ANDROID_HOME" ([bool]$androidHome) $(if ($androidHome) { $androidHome } else { "Set by Android Studio/SDK setup" })
Show-Status "ANDROID_SDK_ROOT" ([bool]$androidSdkRoot) $(if ($androidSdkRoot) { $androidSdkRoot } else { "Set by Android Studio/SDK setup" })
Show-Status "Android project" $androidProject $(if ($androidProject) { "android\gradlew.bat exists" } else { "Run Capacitor add android after installing dependencies" })
Show-Status "macOS" $isMac $(if ($isMac) { "This machine can attempt iOS builds" } else { "iOS builds require a Mac" })
Show-Status "Xcode" $xcodeOk $(if ($xcodeOk) { "xcodebuild found" } else { "Install Xcode on macOS" })
Show-Status "iOS project" $iosProject $(if ($iosProject) { "ios\App\App.xcworkspace exists" } else { "Run Capacitor add ios on a Mac" })

Write-Host ""
Write-Host "Android APK requires: JDK 21, Android SDK, and android\gradlew.bat."
Write-Host "iOS app requires: macOS, Xcode, Apple signing, and ios\App\App.xcworkspace."
