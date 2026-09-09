#!/bin/sh
# Divi Rebels: which theme plays, and the fade when the ship is lost.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-music-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/rebelsMusic.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json --loader:.mp3=dataurl --loader:.webp=dataurl --loader:.png=dataurl --loader:.jpg=dataurl \
  --outfile="$OUT" --log-level=warning
node "$OUT"
