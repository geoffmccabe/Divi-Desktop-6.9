#!/bin/sh
# The cockpit shield: is it the AnamayOS mandala, three times as fast?
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-mandala-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/rebelsMandala.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
