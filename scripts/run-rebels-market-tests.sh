#!/bin/sh
# Divi Rebels: do the Ship Market's numbers hold up?
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-market-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/shipCatalog.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
