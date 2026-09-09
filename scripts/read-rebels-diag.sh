#!/bin/sh
# What the game says it is actually doing.
#
# Divi Rebels writes a small record into the wallet's local storage every two
# seconds while it is flying: the state of the sound, how many enemies exist,
# how many of their models are visible, and anything a frame threw. A webview's
# console goes nowhere anybody can reach, so this is the channel.
#
# Play for half a minute, then run this.
set -e
DB="$HOME/Library/WebKit/io.diviproject.desktop69/WebsiteData/Default"
FILE=$(find "$DB" -name "localstorage.sqlite3" 2>/dev/null | head -1)
[ -n "$FILE" ] || { echo "no local storage found; has the wallet ever run?"; exit 1; }
TMP=$(mktemp -d)
# Copied with its write-ahead log, or the newest writes are invisible.
cp "$FILE" "$TMP/ls.sqlite3" 2>/dev/null || true
cp "$FILE-wal" "$TMP/ls.sqlite3-wal" 2>/dev/null || true
cp "$FILE-shm" "$TMP/ls.sqlite3-shm" 2>/dev/null || true
sqlite3 "$TMP/ls.sqlite3" "select hex(value) from ItemTable where key='dd69.rebels.diag';" > "$TMP/hex" 2>/dev/null || true
rm -rf "$TMP/ls.sqlite3"*
python3 - "$TMP/hex" <<'PY'
import json, sys
raw = open(sys.argv[1]).read().strip()
if not raw:
    print("nothing written yet: launch the game and fly for a few seconds")
    raise SystemExit(0)
# WebKit stores strings as UTF-16, which is why a plain read stops at the first
# character.
b = bytes.fromhex(raw)
for enc in ("utf-16-le", "utf-8"):
    try:
        print(json.dumps(json.loads(b.decode(enc)), indent=2)); break
    except Exception:
        continue
else:
    print("could not decode:", b[:120])
PY
rm -rf "$TMP"
