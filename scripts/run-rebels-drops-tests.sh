#!/bin/sh
# Divi Rebels: drop charts, the found-item catalogue, and the inventory.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-drops-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/dropCharts.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json --loader:.mp3=dataurl --loader:.webp=dataurl --loader:.png=dataurl --loader:.jpg=dataurl \
  --outfile="$OUT" --log-level=warning
node "$OUT"
