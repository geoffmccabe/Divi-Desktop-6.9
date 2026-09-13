#!/bin/sh
# Divi Rebels: the game core contains nothing from the wallet or the app bridge.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
node "$ROOT/scripts/check-rebels-boundary.mjs"
