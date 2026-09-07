#!/bin/sh
# Divi Rebels: is the sky the real sky, and the right way round?
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-sky-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/starfield.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
