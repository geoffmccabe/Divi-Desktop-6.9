#!/bin/sh
# Divi Rebels: what the room puts on the wire, weighed against a budget.
# Bundled with esbuild and run in node. No Cloudflare runtime needed: the room
# is plain TypeScript, and the two things it touches from the platform — a
# websocket and the durable storage — are stood in for by the test.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# ⚠ THE BUNDLE PATH IS PER-WORKTREE, and it has to be. Two worktrees share one
# $TMPDIR, so a fixed name meant BOTH sessions wrote and ran the same file: one
# session's esbuild could land between the other's esbuild and its node, and that
# session then tested the OTHER worktree's code and reported it green. Proven, not
# theorised. Do not remove the basename.
OUT="${TMPDIR:-/tmp}/$(basename "$ROOT")-rebels-wire-tests.mjs"
cd "$ROOT/ui"
NODE_PATH="$ROOT/ui/node_modules" npx esbuild ../contrib/rebels-room/test/wire.test.ts \
  --bundle --platform=node --format=esm --loader:.json=json --loader:.mp3=dataurl --loader:.webp=dataurl --loader:.png=dataurl --loader:.jpg=dataurl \
  --alias:three=three --outfile="$OUT" --log-level=warning
node "$OUT"
