#!/bin/sh
# The node globe's drawing: instanced towers, and shaders built before use.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/globe-draw-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/globeDraw.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
