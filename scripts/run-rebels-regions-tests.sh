#!/bin/sh
# Divi Rebels: Spikeworld as a second region, and the one million between everybody in it.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-regions-tests.mjs"
cd "$ROOT/ui"
NODE_PATH="$ROOT/ui/node_modules" npx esbuild ../contrib/rebels-room/test/regions.test.ts \
  --bundle --platform=node --format=esm --alias:three=three --outfile="$OUT" --log-level=warning
node "$OUT"
