#!/bin/sh
# Publish one node build (divid69) from the daemon CI run to scan.divi.love,
# under versioned names, and pin its checksums in the wallet.
#
#   sh scripts/publish-daemons.sh <github run id> <node version e.g. 69.0.5> <expected suffix e.g. -dd69.3>
#
# Stops at the first thing that is not exactly right: the run must have
# succeeded, all three tarballs must be there, the macOS binary must report
# the expected version suffix when run, and the served files must match by
# size. It then rewrites DIVID69_VERSION and the three pins in
# crates/supervisor/src/install.rs; the wallet release that carries them is
# a separate step (bump, build, scripts/publish-release.sh).
set -eu
RUN=${1:?run id}; V=${2:?node version}; SUFFIX=${3:?version suffix}
REPO=geoffmccabe/Divi-Blockchain_6.9
SITE=/Users/geoffreymccabe/Divilovescan
OUT=$SITE/public/downloads
WORK=${TMPDIR:-/tmp}/divid69-publish-$V
INSTALL=/Users/geoffreymccabe/dd69-mapanim/crates/supervisor/src/install.rs
fail() { echo "STOP: $*" >&2; exit 1; }

for i in $(seq 1 120); do
  R=$(gh run view "$RUN" --repo $REPO --json status,conclusion | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['status'],d['conclusion'])")
  case "$R" in
    "completed success") break;;
    completed*) gh run view "$RUN" --repo $REPO --json jobs | python3 -c "import json,sys;[print(' ',j['name'],j['conclusion']) for j in json.load(sys.stdin)['jobs']]"; fail "daemon build $RUN: $R";;
  esac
  sleep 30
done
[ "$R" = "completed success" ] || fail "daemon build $RUN still not finished"

rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK"
gh run download "$RUN" --repo $REPO >/dev/null 2>&1 || { sleep 60; gh run download "$RUN" --repo $REPO; }
MAC=$(find . -type f -name "divid69-macos-arm64.tar.gz" | head -1)
LIN=$(find . -type f -name "divid69-linux-x86_64.tar.gz" | head -1)
WIN=$(find . -type f -name "divid69-windows-x86_64.tar.gz" | head -1)
for f in "$MAC" "$LIN" "$WIN"; do [ -n "$f" ] && [ -s "$f" ] || { find . -type f | head -20; fail "a daemon tarball is missing"; }; done

# The macOS binary must run here and report the expected version.
mkdir -p m && tar -xzf "$MAC" -C m
GOT=$(./m/divid69 -version 2>/dev/null | head -1 || true)
case "$GOT" in *"$SUFFIX"*) ;; *) fail "macOS divid69 reports '$GOT', expected suffix $SUFFIX";; esac
echo "  verified: $GOT"

cp "$MAC" "$OUT/divid69-$V-macos-arm64.tar.gz"
cp "$LIN" "$OUT/divid69-$V-linux-x86_64.tar.gz"
cp "$WIN" "$OUT/divid69-$V-windows-x86_64.tar.gz"
SM=$(shasum -a 256 "$OUT/divid69-$V-macos-arm64.tar.gz" | cut -d' ' -f1)
SL=$(shasum -a 256 "$OUT/divid69-$V-linux-x86_64.tar.gz" | cut -d' ' -f1)
SW=$(shasum -a 256 "$OUT/divid69-$V-windows-x86_64.tar.gz" | cut -d' ' -f1)
echo "  macos   $SM"; echo "  linux   $SL"; echo "  windows $SW"

# Pin in the wallet.
python3 - "$INSTALL" "$V" "$SM" "$SL" "$SW" <<'PY'
import re, sys
p, v, sm, sl, sw = sys.argv[1:6]
s = open(p).read()
s = re.sub(r'pub const DIVID69_VERSION: &str = "[^"]+";', f'pub const DIVID69_VERSION: &str = "{v}";', s)
def pin(s, plat, sha):
    pat = re.compile(r'(file: "divid69-)[^"]+(-' + re.escape(plat) + r'\.tar\.gz",\s*\n\s*sha256: ")[0-9a-f]+(")')
    s2, n = pat.subn(lambda m: m.group(1) + v + m.group(2) + sha + m.group(3), s)
    if n != 1: raise SystemExit(f"could not pin {plat}: {n} matches")
    return s2
s = pin(s, "macos-arm64", sm); s = pin(s, "linux-x86_64", sl); s = pin(s, "windows-x86_64", sw)
open(p, "w").write(s)
PY
grep -n "DIVID69_VERSION: &str\|sha256: \"" "$INSTALL" | head -4
# The wallet's own node gate names the archives too.
sed -i '' "s/divid69-[0-9.]*-\(windows-x86_64\|linux-x86_64\|macos-arm64\)\.tar\.gz/divid69-$V-\1.tar.gz/g" /Users/geoffreymccabe/dd69-mapanim/.github/workflows/build-apps.yml

cd "$SITE"
git add public/downloads/divid69-$V-*.tar.gz && git commit -q -m "Publish divid69 $V" && git push origin HEAD:main 2>&1 | tail -1

for f in macos-arm64 linux-x86_64 windows-x86_64; do
  local_size=$(stat -f %z "$OUT/divid69-$V-$f.tar.gz"); remote_size=0
  for try in $(seq 1 24); do
    remote_size=$(curl -s -o /dev/null -w '%{size_download}' -L -H "User-Agent: Mozilla/5.0" "https://scan.divi.love/downloads/divid69-$V-$f.tar.gz")
    [ "$remote_size" = "$local_size" ] && break; sleep 20
  done
  [ "$remote_size" = "$local_size" ] || fail "$f: served $remote_size bytes, built $local_size"
  echo "  served: divid69-$V-$f.tar.gz ($remote_size bytes)"
done
echo "divid69 $V PUBLISHED; wallet pins updated in $INSTALL (not yet committed)"
