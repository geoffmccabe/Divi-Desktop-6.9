#!/bin/sh
# Divi Rebels: the cockpit's end of a room.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-room-client-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/rebelsRoom.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json --loader:.mp3=dataurl --loader:.webp=dataurl --loader:.png=dataurl --loader:.jpg=dataurl \
  --outfile="$OUT" --log-level=warning
node "$OUT"
