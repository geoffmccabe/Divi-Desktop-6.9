#!/bin/sh
# The probe scheduler: three states, patient retries, daily recheck, names.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/probe-tests.mjs"
cd "$ROOT/ui"
npx esbuild src/wallet/probeSchedule.test.ts --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
