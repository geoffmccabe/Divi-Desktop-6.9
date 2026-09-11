#!/bin/sh
# Divi Rebels: the Rear Gun window, aim and tail.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-reargun-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/rearGun.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json --loader:.mp3=dataurl --loader:.webp=dataurl --loader:.png=dataurl --loader:.jpg=dataurl \
  --outfile="$OUT" --log-level=warning
node "$OUT"
