#!/bin/sh
# Spikeworld: the heart's million, and the sixty that guard it.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/voxel-heart-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/voxel/voxelHeart.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
