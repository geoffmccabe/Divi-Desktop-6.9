#!/bin/sh
# Spikeworld: the heart's million, and the sixty that guard it.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# Per-worktree: two worktrees share one $TMPDIR, so a fixed name let each
# session run the other's code and report it green. Do not remove the basename.
OUT="${TMPDIR:-/tmp}/$(basename "$ROOT")-voxel-heart-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/voxel/voxelHeart.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
