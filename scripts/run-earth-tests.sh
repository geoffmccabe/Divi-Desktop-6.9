#!/bin/sh
# The detailed globe: tile lookup and the country outlines.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/earth-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/earthTiles.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json --loader:.mp3=dataurl --loader:.webp=dataurl --loader:.png=dataurl --loader:.jpg=dataurl \
  --outfile="$OUT" --log-level=warning
node "$OUT"
