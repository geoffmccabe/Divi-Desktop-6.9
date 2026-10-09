#!/bin/sh
# Divi Rebels: whether a kill drops a sealed NFD pack.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# ⚠ THE BUNDLE PATH IS PER-WORKTREE. See run-rebels-enemytypes-tests.sh.
OUT="${TMPDIR:-/tmp}/$(basename "$ROOT")-rebels-nfddrop-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/nfd/nfdDrop.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
