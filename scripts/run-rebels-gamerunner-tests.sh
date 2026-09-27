#!/bin/sh
# The game controller: does a described game actually happen?
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-gamerunner-tests.mjs"
cd "$ROOT/ui"
NODE_PATH="$ROOT/ui/node_modules" npx esbuild ../contrib/rebels-room/test/gameRunner.test.ts \
  --bundle --platform=node --format=esm --alias:three=three --outfile="$OUT" --log-level=warning
node "$OUT"
