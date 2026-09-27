#!/bin/sh
# The guest's real Divi wallet: does a phrase we hand out actually restore?
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-wallet-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/web-rebels/webWallet.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
