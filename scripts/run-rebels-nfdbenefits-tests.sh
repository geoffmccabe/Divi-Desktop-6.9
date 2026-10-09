#!/bin/sh
# Divi Rebels: what owning an NFD is worth, and what it does to the money.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# ⚠ THE BUNDLE PATH IS PER-WORKTREE. See run-rebels-enemytypes-tests.sh.
OUT="${TMPDIR:-/tmp}/$(basename "$ROOT")-rebels-nfdbenefits-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/nfdBenefits.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
