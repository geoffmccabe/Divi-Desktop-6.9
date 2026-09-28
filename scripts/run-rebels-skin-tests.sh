#!/bin/sh
# The sealed spheres: the mandala wrapped on them, and just the tier printed.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# ⚠ THE BUNDLE PATH IS PER-WORKTREE, and it has to be. Two worktrees share one
# $TMPDIR, so a fixed name meant BOTH sessions wrote and ran the same file: one
# session's esbuild could land between the other's esbuild and its node, and that
# session then tested the OTHER worktree's code and reported it green. Proven, not
# theorised. Do not remove the basename.
OUT="${TMPDIR:-/tmp}/$(basename "$ROOT")-rebels-skin-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/rebelsMandalaSkin.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
