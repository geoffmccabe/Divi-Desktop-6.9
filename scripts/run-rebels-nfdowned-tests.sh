#!/bin/sh
# Divi Rebels: reading what a player owns off the chain.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# ⚠ THE BUNDLE PATH IS PER-WORKTREE. See run-rebels-enemytypes-tests.sh.
OUT="${TMPDIR:-/tmp}/$(basename "$ROOT")-rebels-nfdowned-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/nfd/nfdOwned.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
