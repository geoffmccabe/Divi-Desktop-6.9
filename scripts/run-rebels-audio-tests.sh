#!/bin/sh
# Divi Rebels: does the game actually make a noise?
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-audio-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/rebelsAudio.test.ts \
  --bundle --platform=node --format=esm --loader:.mp3=dataurl \
  --outfile="$OUT" --log-level=warning
node "$OUT"
