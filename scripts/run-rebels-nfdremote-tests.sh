#!/bin/sh
# Divi Rebels: getting NFD collections in and out of the database.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# ⚠ THE BUNDLE PATH IS PER-WORKTREE. See run-rebels-enemytypes-tests.sh.
OUT="${TMPDIR:-/tmp}/$(basename "$ROOT")-rebels-nfdremote-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/nfd/nfdRemote.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
