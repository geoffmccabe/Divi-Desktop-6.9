#!/bin/sh
# Run the Divi Rebels Orbit flight-model tests.
#
# The model is TypeScript and imports three, so it is bundled with the esbuild
# that already comes with vite and then run in node. No renderer and no DOM are
# involved: this tests the maths, which is the part a screenshot cannot check.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# Per-worktree: two worktrees share one $TMPDIR, so a fixed name let each
# session run the other's code and report it green. Do not remove the basename.
OUT="${TMPDIR:-/tmp}/$(basename "$ROOT")-orbit-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/orbitFlight.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json --loader:.mp3=dataurl --loader:.webp=dataurl --loader:.png=dataurl --loader:.jpg=dataurl \
  --outfile="$OUT" --log-level=warning
node "$OUT"
