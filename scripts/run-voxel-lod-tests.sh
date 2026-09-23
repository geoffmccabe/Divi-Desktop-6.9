#!/bin/sh
# Spikeworld: the drawing rules, flown: no overlap, no hole, and a ceiling on what moves.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/voxel-lod-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/voxel/voxelLod.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
