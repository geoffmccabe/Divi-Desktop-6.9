#!/bin/sh
# Divi Rebels: every request to the account database, against a recording.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-account-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/rebelsAccount.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json --loader:.mp3=dataurl --loader:.webp=dataurl --loader:.png=dataurl --loader:.jpg=dataurl \
  --outfile="$OUT" --log-level=warning
node "$OUT"
