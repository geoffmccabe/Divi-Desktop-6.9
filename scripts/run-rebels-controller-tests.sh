#!/bin/sh
# Divi Rebels: does the controller correctly fly a globe it is handed?
# Bundled with vite's esbuild and run in node. No renderer, no DOM.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-controller-tests.mjs"
cd "$ROOT/ui"
NODE_PATH="$ROOT/ui/node_modules" npx esbuild src/wallet/rebels/rebelsController.test.ts \
  --bundle --platform=node --format=esm --alias:three=three --loader:.json=json --loader:.mp3=dataurl --loader:.webp=dataurl --loader:.png=dataurl --loader:.jpg=dataurl \
  --outfile="$OUT" --log-level=warning
node "$OUT"
