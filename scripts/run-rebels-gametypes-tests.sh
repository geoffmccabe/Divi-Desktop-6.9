#!/bin/sh
# Divi Rebels: the shape of a game, and today's game described in it.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-gametypes-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/gameTypes.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
