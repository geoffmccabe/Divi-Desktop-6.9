#!/bin/bash
# Divi Desktop 6.9 — supervisor torture tests (Phase 1 gate).
# Runs entirely against a throwaway sandbox node: never touches a real wallet.
#
# Usage: scripts/torture.sh [path-to-divid]
# If no path is given, tries to extract one from Divi Desktop 2.0's archive
# (note: resident antivirus may delete extracted divid binaries — re-run if so).
set -u
cd "$(dirname "$0")/.."

DD=./target/debug/dd69
TOOLS=./target/divi-tools
SB=./target/divi-sandbox
PASS=0; FAIL=0

check() { # check <label> <ok:0|1>
  if [ "$2" -eq 0 ]; then echo "  PASS  $1"; PASS=$((PASS+1)); else echo "  FAIL  $1"; FAIL=$((FAIL+1)); fi
}

cargo build -q || { echo "build failed"; exit 1; }

DIVID="${1:-}"
if [ -z "$DIVID" ]; then
  rm -rf "$TOOLS"; mkdir -p "$TOOLS"
  unzip -o -q "$HOME/Library/Application Support/Divi Desktop/divid/archive.zip" divi_osx/divid -d "$TOOLS"
  chmod +x "$TOOLS/divi_osx/divid"
  DIVID="$TOOLS/divi_osx/divid"
fi
[ -f "$DIVID" ] || { echo "no divid binary at $DIVID"; exit 1; }

rm -rf "$SB"; mkdir -p "$SB"
printf 'rpcuser=dd69test\nrpcpassword=%s\nrpcport=51999\nport=51998\nlisten=0\nmaxconnections=4\ndaemon=1\n' \
  "$(openssl rand -hex 16)" > "$SB/divi.conf"

echo "── A. clean lifecycle ──"
$DD start --datadir "$SB" --divid "$DIVID" >/dev/null 2>&1
check "node starts and answers RPC" $?
[ -f "$SB/divid.pid" ]; check "pid file present while running" $?
$DD stop --datadir "$SB" --yes >/dev/null 2>&1
check "safe stop completes" $?
[ ! -f "$SB/divid.pid" ]; check "pid file removed on clean stop" $?
$DD status --datadir "$SB" | grep -q "Last shutdown: clean"
check "status reports clean after clean stop" $?

echo "── B. kill -9 mid-run (the old wallet's crime) ──"
$DD start --datadir "$SB" --divid "$DIVID" >/dev/null 2>&1
check "node restarts" $?
PID=$(cat "$SB/divid.pid" 2>/dev/null)
sleep 2
kill -9 "$PID" 2>/dev/null; sleep 1
check "kill -9 delivered to pid ${PID:-?}" $?
$DD status --datadir "$SB" | grep -q "did NOT stop cleanly"
check "dirty crash detected IMMEDIATELY (stale pid heuristic)" $?

echo "── C. restart over the crash ──"
$DD start --datadir "$SB" --divid "$DIVID" >/dev/null 2>&1
check "node starts over dirty state" $?
sleep 2
$DD status --datadir "$SB" | grep -q "NOT clean"
check "daemon's own log flag says last shutdown was dirty" $?
$DD stop --datadir "$SB" --yes >/dev/null 2>&1
check "final safe stop" $?

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
