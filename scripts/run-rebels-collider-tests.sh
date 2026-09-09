#!/bin/sh
# Divi Rebels: does the hit shape follow the hull?
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-collider-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/shipCollider.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
