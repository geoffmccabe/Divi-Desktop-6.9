#!/bin/sh
# Divi Rebels: reading an NFD collection, and refusing one we should not trust.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# ⚠ THE BUNDLE PATH IS PER-WORKTREE. See run-rebels-enemytypes-tests.sh.
OUT="${TMPDIR:-/tmp}/$(basename "$ROOT")-rebels-nfd-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/nfd/nfdCatalog.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
