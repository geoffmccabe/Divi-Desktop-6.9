#!/bin/sh
# Divi Rebels: does the third-person hull lean the way it is turning?
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-lean-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/shipLean.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json --loader:.mp3=dataurl --loader:.webp=dataurl --loader:.png=dataurl --loader:.jpg=dataurl \
  --outfile="$OUT" --log-level=warning
node "$OUT"
