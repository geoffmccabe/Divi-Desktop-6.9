#!/bin/sh
# Divi Rebels: the DFlow collector and its report.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-dflow-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/rebelsDflow.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
