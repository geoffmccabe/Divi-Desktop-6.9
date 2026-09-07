#!/bin/sh
# Divi Rebels: does the paint shop give you the colour you asked for?
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-paint-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/shipColours.test.ts \
  --bundle --platform=node --format=esm --loader:.webp=dataurl \
  --outfile="$OUT" --log-level=warning
node "$OUT"
