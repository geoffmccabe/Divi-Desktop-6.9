#!/bin/sh
# Divi Rebels: is the sky laid out as asked, and can every world be reached?
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-space-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/spaceEnvironment.test.ts \
  --bundle --platform=node --format=esm --loader:.webp=dataurl --loader:.mp3=dataurl \
  --outfile="$OUT" --log-level=warning
node "$OUT"
