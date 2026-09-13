#!/bin/sh
# Divi Rebels on the web: the web door (address check, towers, price, guest).
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-web-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/web-rebels/webDoor.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json --loader:.mp3=dataurl --loader:.webp=dataurl --loader:.png=dataurl --loader:.jpg=dataurl \
  --outfile="$OUT" --log-level=warning
node "$OUT"
