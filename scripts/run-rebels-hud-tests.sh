#!/bin/sh
# Divi Rebels: the cockpit screen in every situation, against a recording.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# ⚠ THE BUNDLE PATH IS PER-WORKTREE, and it has to be. Two worktrees share one
# $TMPDIR, so a fixed name meant BOTH sessions wrote and ran the same file: one
# session's esbuild could land between the other's esbuild and its node, and that
# session then tested the OTHER worktree's code and reported it green. Proven, not
# theorised. Do not remove the basename.
OUT="${TMPDIR:-/tmp}/$(basename "$ROOT")-rebels-hud-tests.mjs"
cd "$ROOT/ui"
# React's HTML renderer asks for Node's own stream module, which a bundle can
# only reach through a real require.
npx esbuild src/wallet/rebels/rebelsHud.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json --loader:.mp3=dataurl --loader:.webp=dataurl --loader:.png=dataurl --loader:.jpg=dataurl \
  --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
  --outfile="$OUT" --log-level=warning
node "$OUT"
