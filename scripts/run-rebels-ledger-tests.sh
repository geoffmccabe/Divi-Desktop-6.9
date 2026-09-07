#!/bin/sh
# Divi Rebels: can the ledger be made to pay twice?
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-ledger-tests.mjs"
cd "$ROOT/ui"
npx esbuild ../contrib/rebels-room/test/ledger.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
