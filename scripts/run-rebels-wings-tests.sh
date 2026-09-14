#!/bin/sh
# Divi Rebels: the wingmen's formation and what a tier is worth.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-wings-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/rebelsWings.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json --loader:.mp3=dataurl --loader:.webp=dataurl --loader:.png=dataurl --loader:.jpg=dataurl \
  --outfile="$OUT" --log-level=warning
node "$OUT"
