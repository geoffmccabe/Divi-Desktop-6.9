#!/bin/sh
# Divi Rebels: enemies Geoff can define, and today's enemies in the same shape.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-enemytypes-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/enemyTypes.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
