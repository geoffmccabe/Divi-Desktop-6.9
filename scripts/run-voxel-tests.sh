#!/bin/sh
# Spikeworld: the planet's shape, its ways in, and that it stays modular.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# Per-worktree: two worktrees share one $TMPDIR, so a fixed name let each
# session run the other's code and report it green. Do not remove the basename.
OUT="${TMPDIR:-/tmp}/$(basename "$ROOT")-voxel-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/voxel/voxelField.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
