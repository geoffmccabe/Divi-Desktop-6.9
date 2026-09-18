#!/bin/sh
# Spikeworld, Phase 0: the numbers the plan needs before anything is built.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/voxel-report.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/voxel/voxelReport.run.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
