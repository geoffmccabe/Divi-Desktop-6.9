#!/bin/sh
# Divi Rebels: the shared row layouts, and agreement with installed clients.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-wire-codec-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/rebelsWire.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
