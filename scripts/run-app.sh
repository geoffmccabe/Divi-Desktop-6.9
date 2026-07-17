#!/bin/bash
# Build the frontend, embed it, and run Divi Desktop 6.9 as a real app
# (serves the embedded UI — no dev server). Run from anywhere.
set -e
cd "$(dirname "$0")/.."

echo "→ building frontend"
npm --prefix ui run build

echo "→ building app (release, embeds the UI)"
cargo build --release -p divi-desktop-69

echo "→ launching"
exec ./target/release/divi-desktop-69
