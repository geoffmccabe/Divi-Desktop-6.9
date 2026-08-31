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

WAS=$(python3 -c "import json;print(json.load(open('crates/app/tauri.conf.json'))['version'])")
case "${1:-patch}" in
  none) : ;;
  *)    python3 scripts/bump-version.py "${1:-patch}" ;;
esac

VERSION=$(python3 -c "import json;print(json.load(open('crates/app/tauri.conf.json'))['version'])")
echo "building $VERSION"

# The version has to be bumped BEFORE the interface is built, because the build
# bakes it in. So a build that then fails would burn a version number on
# something nobody ever ran. Put it back.
undo_bump() {
  if [ "$WAS" != "$VERSION" ]; then
    python3 scripts/bump-version.py "$WAS" >/dev/null
    echo "version put back to $WAS, since nothing shipped"
  fi
}

# A failed build MUST stop this. Piping cargo into grep threw its exit status
# away, so a compile error installed the PREVIOUS binary and announced success —
# which is precisely the "you were testing an hour-old build" trap this script
# exists to close, rebuilt inside the script meant to prevent it.
LOG=$(mktemp)
if ! ( cd ui && npm run build ) > "$LOG" 2>&1; then
  echo "the interface did not build, so nothing was installed:"
  tail -25 "$LOG"
  undo_bump
  exit 1
fi
if ! cargo build --release > "$LOG" 2>&1; then
  echo "the wallet did not build, so nothing was installed:"
  grep -E "^error" -A4 "$LOG" | head -30
  undo_bump
  exit 1
fi
rm -f "$LOG"

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
# CFBundleDisplayName is the one macOS actually shows in a security dialog, and
# it is a separate field from CFBundleName. Missing it meant every keychain
# prompt kept naming a version from weeks ago even after the others were fixed.
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Divi Desktop $VERSION" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string Divi Desktop $VERSION" "$PLIST"

pkill -f "divi-desktop-69" 2>/dev/null || true
pkill -f "app-builder/src/server.mjs" 2>/dev/null || true
sleep 2

cp "$BIN" "$BIN.previous" 2>/dev/null || true
cp target/release/divi-desktop-69 "$BIN"

# Belt and braces: the whole point of this script is that what he launches is
# what was just built.
if ! cmp -s target/release/divi-desktop-69 "$BIN"; then
  echo "the binary did not copy across; not launching a build you cannot trust"
  exit 1
fi
codesign --force --deep -s - "$APP" 2>/dev/null || true

# macOS caches the app's display name, so without this the OLD name keeps
# appearing in dialogs however many times the plist is corrected.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$APP" >/dev/null 2>&1 || true

open "$APP"
echo "installed and launched $VERSION"
echo "the previous binary is kept at $BIN.previous"
