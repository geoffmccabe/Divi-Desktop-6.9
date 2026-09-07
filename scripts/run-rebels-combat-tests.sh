#!/bin/sh
# Divi Rebels: bullets, fighters and the collisions between them.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-combat-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/rebelsCombat.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json --loader:.mp3=dataurl \
  --outfile="$OUT" --log-level=warning
node "$OUT"
