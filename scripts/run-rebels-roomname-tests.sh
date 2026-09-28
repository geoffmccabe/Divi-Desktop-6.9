#!/bin/sh
# Divi Rebels: reading a room's name - region, overflow room, and game.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-roomname-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/roomName.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
