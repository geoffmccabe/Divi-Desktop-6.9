#!/bin/sh
# Divi Rebels: joining the catalog, the chain and this game's benefits.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# ⚠ THE BUNDLE PATH IS PER-WORKTREE. See run-rebels-enemytypes-tests.sh.
OUT="${TMPDIR:-/tmp}/$(basename "$ROOT")-rebels-nfdownership-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/nfdOwnership.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
