#!/bin/sh
# Run the Divi Rebels Orbit flight-model tests.
#
# The model is TypeScript and imports three, so it is bundled with the esbuild
# that already comes with vite and then run in node. No renderer and no DOM are
# involved: this tests the maths, which is the part a screenshot cannot check.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/orbit-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/rebels/orbitFlight.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json \
  --outfile="$OUT" --log-level=warning
node "$OUT"
