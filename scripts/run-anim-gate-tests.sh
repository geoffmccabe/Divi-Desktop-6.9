#!/bin/sh
# The map's animation gate: idle in the background, animate in front.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/anim-gate-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/animGate.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
