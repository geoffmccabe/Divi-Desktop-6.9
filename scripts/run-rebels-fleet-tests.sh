#!/bin/sh
# Divi Rebels: ships' names and fitted upgrades, guests' limits, where progress is kept.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-fleet-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/shipFleet.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json --loader:.mp3=dataurl --loader:.webp=dataurl --loader:.png=dataurl --loader:.jpg=dataurl \
  --outfile="$OUT" --log-level=warning
node "$OUT"
