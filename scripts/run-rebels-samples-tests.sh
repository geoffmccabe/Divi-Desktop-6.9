#!/bin/sh
# Divi Rebels: the sample enemies and games, and whether they are a progression.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-samples-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/sampleContent.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
