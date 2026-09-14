#!/bin/sh
# Divi Rebels on the web: the Worker that serves the page and the node list.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-web-worker-tests.mjs"
cd "$ROOT/ui"
npx esbuild ../contrib/rebels-web/test/worker.test.ts \
  --bundle --platform=node --format=esm --outfile="$OUT" --log-level=warning
node "$OUT"
