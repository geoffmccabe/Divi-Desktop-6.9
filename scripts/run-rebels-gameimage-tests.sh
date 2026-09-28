#!/bin/sh
# Divi Rebels: the 3:2 card picture, and the two copies of its size rule.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-gameimage-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/gameImage.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
