#!/bin/bash
# Build the frontend (single self-contained file) and run Divi Desktop 6.9
# (Tauri, ~10 MB, uses the OS webview). Run from anywhere.
set -e
cd "$(dirname "$0")/.."

echo "→ building frontend (single-file)"
npm --prefix ui run build

echo "→ building app (release, embeds the UI)"
cargo build --release -p divi-desktop-69

echo "→ launching"
exec ./target/release/divi-desktop-69
