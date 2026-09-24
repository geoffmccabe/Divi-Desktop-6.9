#!/bin/sh
# Publish one DD69 build to https://scan.divi.love/downloads.
#
#   sh scripts/publish-release.sh <github run id> <version> "<release notes>"
#
# Waits for the build, downloads its artifacts, PROVES they are the version
# claimed, copies them into the Divilovescan site, writes the updater entry,
# pushes, and then proves the files are really being served.
#
# Written after 2026-Sep-23, when an ad-hoc version of this went on after the
# artifacts had failed to download, published an update entry with empty
# signatures pointing at files that did not exist, and reported "LIVE" because
# the site's fallback page answers every URL with 200. Every step here stops
# the moment something is not exactly right, and the final check reads the
# files' sizes, not a status code.
set -eu
RUN=${1:?run id}; V=${2:?version}; NOTES=${3:?notes}
REPO=geoffmccabe/Divi-Desktop-6.9
SITE=/Users/geoffreymccabe/Divilovescan
OUT=$SITE/public/downloads
WORK=${TMPDIR:-/tmp}/dd69-publish-$V
fail() { echo "STOP: $*" >&2; exit 1; }

# 1. The build must have finished, and succeeded.
for i in $(seq 1 120); do
  R=$(gh run view "$RUN" --repo $REPO --json status,conclusion | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['status'],d['conclusion'])")
  case "$R" in
    "completed success") break;;
    completed*) gh run view "$RUN" --repo $REPO --json jobs | python3 -c "import json,sys;[print(' ',j['name'],j['conclusion']) for j in json.load(sys.stdin)['jobs']]"; fail "build $RUN: $R";;
  esac
  sleep 30
done
[ "$R" = "completed success" ] || fail "build $RUN still not finished"

# 2. Download, and retry once: the artifacts can lag the run's own status.
rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK"
gh run download "$RUN" --repo $REPO >/dev/null 2>&1 || { sleep 60; gh run download "$RUN" --repo $REPO; }
MAC="divi-desktop-macos-latest"; WIN="divi-desktop-windows-latest"; LIN="divi-desktop-ubuntu-22.04"
DMG="$MAC/Divi Desktop 69_${V}_universal.dmg"
TGZ="$MAC/Divi Desktop 69.app.tar.gz"
EXE="$WIN/Divi Desktop 69_${V}_x64-setup.exe"
DEB="$LIN/Divi Desktop 69_${V}_amd64.deb"
for f in "$DMG" "$TGZ" "$TGZ.sig" "$EXE" "$EXE.sig" "$DEB"; do
  [ -s "$f" ] || { ls -R "$WORK" | head -40; fail "missing artifact: $f (is the product name still 'Divi Desktop 69'?)"; }
done

# 3. The version INSIDE the build must be the version claimed.
mkdir -p v && tar -xzf "$TGZ" -C v
PKG=$(plutil -extract CFBundleShortVersionString raw "v/Divi Desktop 69.app/Contents/Info.plist")
[ "$PKG" = "$V" ] || fail "update package says $PKG, not $V"
MP=$(hdiutil attach -nobrowse -readonly "$DMG" | tail -1 | awk '{for(i=3;i<=NF;i++)printf "%s%s",$i,(i<NF?" ":"")}')
DV=$(plutil -extract CFBundleShortVersionString raw "$MP/Divi Desktop 69.app/Contents/Info.plist")
hdiutil detach "$MP" -quiet
[ "$DV" = "$V" ] || fail "dmg says $DV, not $V"
M=$(cat "$TGZ.sig"); W=$(cat "$EXE.sig")
[ ${#M} -gt 100 ] && [ ${#W} -gt 100 ] || fail "a signature is empty"
echo "  verified: package $PKG, dmg $DV, signatures present"

# 4. Into the site.
cp "$DMG" "$OUT/Divi-Desktop-${V}-Universal.dmg"
cp "$TGZ" "$OUT/Divi-Desktop-${V}-macos-update.app.tar.gz"
cp "$EXE" "$OUT/Divi-Desktop-${V}-Windows-x64-setup.exe"
cp "$DEB" "$OUT/Divi-Desktop-${V}-Linux-x86_64.deb"
python3 - "$V" "$M" "$W" "$NOTES" "$OUT" <<'PY'
import json, sys, datetime
v, m, w, notes, out = sys.argv[1:6]
b = f"https://scan.divi.love/downloads/Divi-Desktop-{v}"
doc = {"version": v, "notes": notes,
       "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
       "platforms": {"darwin-aarch64": {"signature": m, "url": f"{b}-macos-update.app.tar.gz"},
                     "darwin-x86_64": {"signature": m, "url": f"{b}-macos-update.app.tar.gz"},
                     "windows-x86_64": {"signature": w, "url": f"{b}-Windows-x64-setup.exe"}}}
open(f"{out}/updater.json", "w").write(json.dumps(doc, indent=2) + "\n")
json.dump({"mac": v, "linux": v, "windows": v}, open(f"{out}/latest.json", "w"))
PY
cd "$SITE"
python3 - "$V" <<'PY'
import re, sys
v = sys.argv[1]; p = "src/walletVersion.ts"; s = open(p).read()
for k in ("WALLET_VERSION", "LINUX_VERSION", "WIN_VERSION"):
    s = re.sub(rf'({k} = ")[^"]+(")', rf'\g<1>{v}\g<2>', s)
open(p, "w").write(s)
PY
npm run build 2>&1 | tail -1
git add -A && git commit -q -m "Publish DD69 $V" && git push origin HEAD:main 2>&1 | tail -1

# 5. Proof it is being served: the real files, by size, not a status code.
for i in $(seq 1 45); do
  L=$(curl -s -H "User-Agent: Mozilla/5.0" https://scan.divi.love/downloads/latest.json | python3 -c "import json,sys;print(json.load(sys.stdin).get('mac',''))" 2>/dev/null || true)
  [ "$L" = "$V" ] && break; sleep 20
done
[ "$L" = "$V" ] || fail "latest.json still says '$L' after 15 minutes"
for f in Universal.dmg Windows-x64-setup.exe Linux-x86_64.deb macos-update.app.tar.gz; do
  local_size=$(stat -f %z "$OUT/Divi-Desktop-$V-$f")
  # A real download, not a HEAD: the CDN sends some files without a length.
  # And a few tries: the edge can still hand out the fallback page for a
  # minute after latest.json has switched (seen on 69.13.28).
  remote_size=0
  for try in 1 2 3 4 5 6; do
    remote_size=$(curl -s -o /dev/null -w '%{size_download}' -L -H "User-Agent: Mozilla/5.0" "https://scan.divi.love/downloads/Divi-Desktop-$V-$f")
    [ "$remote_size" = "$local_size" ] && break
    sleep 20
  done
  [ "$remote_size" = "$local_size" ] || fail "$f: served $remote_size bytes, built $local_size"
  echo "  served: $f ($remote_size bytes)"
done
echo "$V LIVE"
