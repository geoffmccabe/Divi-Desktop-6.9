#!/bin/sh
# Build the wallet and put it where Geoff actually launches it from.
#
#   sh scripts/install-local.sh            # patch bump, build, install, relaunch
#   sh scripts/install-local.sh feature    # only when STARTING something new
#   sh scripts/install-local.sh none       # no bump (rebuilding the same version)
#
# This exists because doing it by hand kept going wrong in ways that wasted
# Geoff's time: testing an hour-old build because only the repo copy was
# rebuilt, and a macOS keychain prompt naming "69.0.18" because the app
# bundle's own Info.plist was never updated — only the binary inside it was.
#
# /Applications/DD69.app holds a REAL COPY of the binary, not a link, so
# nothing reaches him until it is copied in.
set -e
cd "$(dirname "$0")/.."

APP="/Applications/DD69.app"
BIN="$APP/Contents/MacOS/divi-desktop-69"
PLIST="$APP/Contents/Info.plist"

case "${1:-patch}" in
  none) : ;;
  *)    python3 scripts/bump-version.py "${1:-patch}" ;;
esac

VERSION=$(python3 -c "import json;print(json.load(open('crates/app/tauri.conf.json'))['version'])")
echo "building $VERSION"

( cd ui && npm run build >/dev/null 2>&1 )
cargo build --release 2>&1 | grep -E "^error|warning: unused" || true

if [ ! -d "$APP" ]; then
  echo "$APP is not there. Build the bundle once with cargo tauri build."
  exit 1
fi

# The bundle's own version is what macOS shows — in the keychain prompt, in
# Finder, in About. Leaving it stale means every permission prompt names a
# version that has not existed for weeks.
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string $VERSION" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleVersion string $VERSION" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleName Divi Desktop $VERSION" "$PLIST" 2>/dev/null || true

pkill -f "divi-desktop-69" 2>/dev/null || true
pkill -f "app-builder/src/server.mjs" 2>/dev/null || true
sleep 2

cp "$BIN" "$BIN.previous" 2>/dev/null || true
cp target/release/divi-desktop-69 "$BIN"
codesign --force --deep -s - "$APP" 2>/dev/null || true

open "$APP"
echo "installed and launched $VERSION"
echo "the previous binary is kept at $BIN.previous"
