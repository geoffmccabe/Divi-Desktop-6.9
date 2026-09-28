#!/bin/sh
# The places a game can be played in: geometry, and a ship arriving inside it.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-places-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/rebelsPlaces.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json --loader:.mp3=dataurl --loader:.webp=dataurl --loader:.png=dataurl --loader:.jpg=dataurl \
  --outfile="$OUT" --log-level=warning
node "$OUT"
