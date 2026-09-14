#!/bin/sh
# The sealed spheres: the mandala wrapped on them, and just the tier printed.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-skin-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/rebelsMandalaSkin.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
