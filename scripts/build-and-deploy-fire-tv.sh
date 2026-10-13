#!/usr/bin/env bash
set -euo pipefail

fire_tv_address="${1:-192.168.92.255}"
port="${2:-5555}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(cd -- "$script_dir/.." && pwd -P)"
frontend_root="$repository_root/frontend"
android_build="$frontend_root/android/app/build"
artifact="$repository_root/artifacts/HomeLab-TV-debug.apk"
target="${fire_tv_address}:${port}"

if [[ ! "$port" =~ ^[0-9]+$ ]] || ((port < 1 || port > 65535)); then
  echo "Port must be between 1 and 65535." >&2
  exit 2
fi

if [[ "$android_build" != "$repository_root/frontend/android/app/build" ]] ||
   [[ "$artifact" != "$repository_root/artifacts/HomeLab-TV-debug.apk" ]]; then
  echo "Refusing to modify an unexpected path." >&2
  exit 2
fi

if [[ "$fire_tv_address" == "192.168.92.255" ]]; then
  echo "WARNING: 192.168.92.255 is commonly a broadcast address on a /24 network." >&2
  echo "If ADB cannot connect, verify the Fire TV IP under Settings > My Fire TV > About > Network." >&2
fi

adb="$repository_root/.tools/android-sdk/platform-tools/adb.exe"
if [[ ! -x "$adb" ]]; then
  if command -v adb.exe >/dev/null 2>&1; then
    adb="$(command -v adb.exe)"
  elif command -v adb >/dev/null 2>&1; then
    adb="$(command -v adb)"
  else
    echo "ADB was not found. Install Android platform-tools or place the SDK under .tools/android-sdk." >&2
    exit 1
  fi
fi

java_root="${JAVA_HOME:-}"
if [[ -n "$java_root" ]]; then java_root="$(cygpath -u "$java_root" 2>/dev/null || printf '%s' "$java_root")"; fi
if [[ -z "$java_root" || ! -x "$java_root/bin/java.exe" ]]; then
  java_executable="$(find "$repository_root/.tools/jdk17" -mindepth 3 -maxdepth 3 -type f -path '*/bin/java.exe' -print -quit 2>/dev/null || true)"
  if [[ -z "$java_executable" ]]; then
    echo "JDK 17 was not found. Set JAVA_HOME or install it under .tools/jdk17." >&2
    exit 1
  fi
  java_root="$(dirname -- "$(dirname -- "$java_executable")")"
fi

sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$repository_root/.tools/android-sdk}}"
sdk_root="$(cygpath -u "$sdk_root" 2>/dev/null || printf '%s' "$sdk_root")"
if [[ ! -f "$sdk_root/platforms/android-34/android.jar" ]]; then
  echo "Android SDK platform 34 was not found. Set ANDROID_SDK_ROOT or install it under .tools/android-sdk." >&2
  exit 1
fi

export JAVA_HOME="$(cygpath -w "$java_root")"
export ANDROID_HOME="$(cygpath -w "$sdk_root")"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
mkdir -p "$repository_root/.tools/gradle" "$repository_root/artifacts"
export GRADLE_USER_HOME="$(cygpath -w "$repository_root/.tools/gradle")"

echo "Disconnecting any existing ADB session for $target..."
"$adb" disconnect "$target" || true

echo "Removing previous Android build output and stale APK..."
rm -rf -- "$android_build"
rm -f -- "$artifact"

echo "Building and synchronizing the frontend..."
cd -- "$frontend_root"
npm.cmd run android:sync

echo "Building a fresh Android APK..."
cd -- "$frontend_root/android"
./gradlew.bat assembleDebug --no-daemon

built_apk="$android_build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "$built_apk" ]]; then
  echo "The Android build completed without creating $built_apk." >&2
  exit 1
fi
cp -f -- "$built_apk" "$artifact"
apk_hash="$(sha256sum "$artifact" | awk '{print toupper($1)}')"

echo "Connecting to $target..."
if ! connect_output="$("$adb" connect "$target" 2>&1)"; then
  echo "$connect_output" >&2
  echo "ADB could not connect. Confirm the IP address and enable ADB debugging on the Fire TV." >&2
  exit 1
fi
echo "$connect_output"
if [[ "$connect_output" != *"connected to"* && "$connect_output" != *"already connected"* ]]; then
  echo "ADB did not report a successful connection to $target." >&2
  exit 1
fi

echo "Installing $artifact..."
"$adb" -s "$target" install -r "$artifact"

echo "Installed package details:"
"$adb" -s "$target" shell dumpsys package ca.olivierhamel.homelab |
  grep -E 'versionCode=|versionName=' |
  sed 's/^[[:space:]]*//'
echo "APK SHA-256: $apk_hash"
echo "Fire TV deployment complete."
