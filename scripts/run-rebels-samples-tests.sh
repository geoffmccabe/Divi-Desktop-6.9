#!/bin/sh
# Divi Rebels: the sample enemies and games, and whether they are a progression.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# ⚠ THE BUNDLE PATH IS PER-WORKTREE, and it has to be. Two worktrees share one
# $TMPDIR, so a fixed name meant BOTH sessions wrote and ran the same file: one
# session's esbuild could land between the other's esbuild and its node, and that
# session then tested the OTHER worktree's code and reported it green. Proven, not
# theorised. Do not remove the basename.
OUT="${TMPDIR:-/tmp}/$(basename "$ROOT")-rebels-samples-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/sampleContent.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
