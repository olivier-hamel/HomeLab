#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: build-and-deploy-fire-tv-ubuntu.sh FIRE_TV_IP [PORT]

Build a fresh HomeLab APK and install it on a Fire TV using ADB (port 5555).
Run without sudo, from any directory. Enable ADB debugging on the Fire TV.

Requires Node.js 24, JDK 17, and Android SDK Platform / Build Tools 34.
JAVA_HOME and ANDROID_SDK_ROOT (or ANDROID_HOME) override automatic discovery.
See docs/fire-tv.md for Ubuntu setup instructions.
EOF
}

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

if [[ "${1:-}" == --help || "${1:-}" == -h ]]; then
  usage
  exit 0
fi
if (( $# < 1 || $# > 2 )); then
  usage >&2
  exit 2
fi

fire_tv_address="$1"
port="${2:-5555}"
[[ -n "$fire_tv_address" && "$fire_tv_address" != -* && "$fire_tv_address" != *:* && "$fire_tv_address" != *[[:space:]]* ]] ||
  fail 'Provide the Fire TV IP or hostname separately from the port.'
if [[ ! "$port" =~ ^[1-9][0-9]{0,4}$ ]] || (( port > 65535 )); then
  fail 'Port must be between 1 and 65535.'
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(cd -- "$script_dir/.." && pwd -P)"
frontend_root="$repository_root/frontend"
artifact="$repository_root/artifacts/HomeLab-TV-debug.apk"
target="${fire_tv_address}:${port}"

for required_command in node npm sha256sum; do
  command -v "$required_command" >/dev/null 2>&1 || fail "Required command not found: $required_command. See docs/fire-tv.md."
done
[[ "$(node --version)" == v24.* ]] || fail 'Node.js 24 is required. Activate it before running this script.'

is_jdk17() {
  local version
  [[ -x "$1/bin/java" && -x "$1/bin/javac" ]] || return 1
  version="$("$1/bin/java" -version 2>&1)" || return 1
  [[ "$version" =~ version[[:space:]]+\"17(\.|\"|-) ]]
}

java_root="${JAVA_HOME:-}"
if [[ -n "$java_root" ]]; then
  is_jdk17 "$java_root" || fail 'JAVA_HOME must point to a JDK 17 installation containing bin/java and bin/javac.'
else
  for candidate in "$repository_root/.tools/jdk17" "$repository_root"/.tools/jdk17/* /usr/lib/jvm/java-17-openjdk-*; do
    if is_jdk17 "$candidate"; then
      java_root="$candidate"
      break
    fi
  done
  if [[ -z "$java_root" ]] && command -v javac >/dev/null 2>&1; then
    candidate="$(dirname -- "$(dirname -- "$(readlink -f -- "$(command -v javac)")")")"
    if is_jdk17 "$candidate"; then java_root="$candidate"; fi
  fi
  [[ -n "$java_root" ]] || fail 'JDK 17 was not found. Install it with: sudo apt install openjdk-17-jdk'
fi

sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "$sdk_root" ]]; then
  for candidate in "$repository_root/.tools/android-sdk" "$HOME/Android/Sdk" /usr/lib/android-sdk; do
    if [[ -f "$candidate/platforms/android-34/android.jar" ]]; then
      sdk_root="$candidate"
      break
    fi
  done
fi
[[ -n "$sdk_root" && -f "$sdk_root/platforms/android-34/android.jar" ]] ||
  fail 'Android SDK Platform 34 was not found. Install it using the Android SDK Manager and set ANDROID_SDK_ROOT. See docs/fire-tv.md.'
[[ -x "$sdk_root/build-tools/34.0.0/aapt2" ]] ||
  fail 'Android SDK Build Tools 34.0.0 were not found. Install them using the Android SDK Manager. See docs/fire-tv.md.'

adb="$sdk_root/platform-tools/adb"
if [[ ! -x "$adb" ]]; then
  adb="$(command -v adb || true)"
  [[ -n "$adb" ]] || fail 'ADB was not found. Install Android SDK Platform Tools or run: sudo apt install adb'
fi

export JAVA_HOME="$(cd -- "$java_root" && pwd -P)"
export ANDROID_HOME="$(cd -- "$sdk_root" && pwd -P)"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$repository_root/.tools/gradle}"
mkdir -p -- "$GRADLE_USER_HOME" "$repository_root/artifacts"

echo 'Installing frontend dependencies, building, and synchronizing Capacitor...'
cd -- "$frontend_root"
npm ci --no-audit --no-fund
npm run android:sync

echo 'Building a fresh Android APK...'
cd -- "$frontend_root/android"
# The checked-in Gradle wrapper does not need its executable bit set.
bash ./gradlew clean assembleDebug --no-daemon

built_apk="$frontend_root/android/app/build/outputs/apk/debug/app-debug.apk"
[[ -f "$built_apk" ]] || fail "The Android build did not create $built_apk."
cp -f -- "$built_apk" "$artifact"

echo "Connecting to $target..."
"$adb" connect "$target" || fail 'ADB connection failed. Check the Fire TV IP and network connection.'
# adb connect can exit successfully even when the device is unavailable.
"$adb" -s "$target" get-state >/dev/null 2>&1 ||
  fail 'Fire TV is not available to ADB. Enable ADB debugging, accept the authorization prompt on the TV, then rerun this script.'

echo "Installing $artifact..."
"$adb" -s "$target" install -r "$artifact"

echo 'Installed package details:'
"$adb" -s "$target" shell dumpsys package ca.olivierhamel.homelab |
  awk '/versionCode=|versionName=/ { sub(/^[[:space:]]*/, ""); print }'
sha256sum "$artifact"
echo 'Fire TV deployment complete.'
