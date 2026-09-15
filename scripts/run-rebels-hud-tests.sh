#!/bin/sh
# Divi Rebels: the cockpit screen in every situation, against a recording.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/rebels-hud-tests.mjs"
cd "$ROOT/ui"
# React's HTML renderer asks for Node's own stream module, which a bundle can
# only reach through a real require.
npx esbuild src/wallet/rebels/rebelsHud.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json --loader:.mp3=dataurl --loader:.webp=dataurl --loader:.png=dataurl --loader:.jpg=dataurl \
  --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
  --outfile="$OUT" --log-level=warning
node "$OUT"
