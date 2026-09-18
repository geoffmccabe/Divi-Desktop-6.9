#!/bin/sh
# Divi Rebels: the fight in Earth orbit stops when the last pilot leaves for Spikeworld.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-waves-tests.mjs"
cd "$ROOT/ui"
NODE_PATH="$ROOT/ui/node_modules" npx esbuild ../contrib/rebels-room/test/waves.test.ts \
  --bundle --platform=node --format=esm --alias:three=three --outfile="$OUT" --log-level=warning
node "$OUT"
