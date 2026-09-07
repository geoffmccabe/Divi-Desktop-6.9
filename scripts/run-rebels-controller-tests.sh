#!/bin/sh
# Divi Rebels: does the controller correctly fly a globe it is handed?
# Bundled with vite's esbuild and run in node. No renderer, no DOM.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-controller-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/rebelsController.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json --loader:.mp3=dataurl \
  --outfile="$OUT" --log-level=warning
node "$OUT"
