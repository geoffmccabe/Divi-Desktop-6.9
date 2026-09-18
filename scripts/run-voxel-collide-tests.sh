#!/bin/sh
# Spikeworld: flying into the cubes.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/voxel-collide-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/voxel/voxelCollide.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
