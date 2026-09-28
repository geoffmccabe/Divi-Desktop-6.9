#!/bin/sh
# What a game pays out, and the ceiling that stops it emptying the treasury.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-rewards-tests.mjs"
cd "$ROOT/ui"
NODE_PATH="$ROOT/ui/node_modules" npx esbuild ../contrib/rebels-room/test/gameRewards.test.ts \
  --bundle --platform=node --format=esm --alias:three=three --outfile="$OUT" --log-level=warning
node "$OUT"
