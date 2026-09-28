#!/bin/sh
# Divi Rebels: the game picker, and whether it can ever be a dead end.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-gamepicker-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/gamePicker.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
