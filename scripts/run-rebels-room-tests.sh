#!/bin/sh
# Divi Rebels: does the room refuse what it says it refuses?
# Bundled with esbuild and run in node. No Cloudflare runtime needed: the room
# is plain TypeScript, and the two things it touches from the platform — a
# websocket and the durable storage — are stood in for by the test.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-room-tests.mjs"
cd "$ROOT/ui"
NODE_PATH="$ROOT/ui/node_modules" npx esbuild ../contrib/rebels-room/test/room.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json --loader:.mp3=dataurl --loader:.webp=dataurl --loader:.png=dataurl --loader:.jpg=dataurl \
  --alias:three=three --outfile="$OUT" --log-level=warning
node "$OUT"
