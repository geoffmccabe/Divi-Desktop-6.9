#!/bin/sh
# Reading the games Geoff has built, and what happens when that goes wrong.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-gamesource-tests.mjs"
cd "$ROOT/ui"
NODE_PATH="$ROOT/ui/node_modules" npx esbuild ../contrib/rebels-room/test/gameSource.test.ts \
  --bundle --platform=node --format=esm --alias:three=three --outfile="$OUT" --log-level=warning
node "$OUT"
