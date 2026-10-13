param(
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$frontendRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repositoryRoot = (Resolve-Path (Join-Path $frontendRoot "..")).Path

if (-not $OutputPath) {
  $OutputPath = Join-Path $repositoryRoot "artifacts\HomeLab-TV-debug.apk"
}

$javaRoot = $env:JAVA_HOME
if (-not $javaRoot -or -not (Test-Path (Join-Path $javaRoot "bin\java.exe"))) {
  $localJava = Get-ChildItem (Join-Path $repositoryRoot ".tools\jdk17") -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName "bin\java.exe") } |
    Select-Object -First 1
  if (-not $localJava) { throw "JDK 17 was not found. Set JAVA_HOME or install the project-local JDK described in docs/fire-tv.md." }
  $javaRoot = $localJava.FullName
}

$sdkRoot = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $repositoryRoot ".tools\android-sdk" }
if (-not (Test-Path (Join-Path $sdkRoot "platforms\android-34\android.jar"))) {
  throw "Android SDK platform 34 was not found. Set ANDROID_SDK_ROOT or install the project-local SDK described in docs/fire-tv.md."
}

$env:JAVA_HOME = (Resolve-Path $javaRoot).Path
$env:ANDROID_HOME = (Resolve-Path $sdkRoot).Path
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = (New-Item -ItemType Directory -Force (Join-Path $repositoryRoot ".tools\gradle")).FullName

Push-Location $frontendRoot
try {
  & npm.cmd run android:sync
  if ($LASTEXITCODE -ne 0) { throw "Capacitor synchronization failed." }
  Push-Location (Join-Path $frontendRoot "android")
  try {
    & .\gradlew.bat assembleDebug --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "Android APK build failed." }
  } finally {
    Pop-Location
  }
} finally {
  Pop-Location
}

$apk = Join-Path $frontendRoot "android\app\build\outputs\apk\debug\app-debug.apk"
$destination = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Force ([IO.Path]::GetDirectoryName($destination)) | Out-Null
Copy-Item -LiteralPath $apk -Destination $destination -Force
$hash = Get-FileHash -LiteralPath $destination -Algorithm SHA256
Write-Output "APK: $destination"
Write-Output "SHA-256: $($hash.Hash)"
