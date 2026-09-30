#!/bin/sh
# Spikeworld: flying into the cubes.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# Per-worktree: two worktrees share one $TMPDIR, so a fixed name let each
# session run the other's code and report it green. Do not remove the basename.
OUT="${TMPDIR:-/tmp}/$(basename "$ROOT")-voxel-collide-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/voxel/voxelCollide.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
