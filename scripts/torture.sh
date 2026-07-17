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

check() { # check <label> <ok:0|1>  — a missing status counts as FAIL, never aborts
  local ok="${2:-1}"
  if [ "$ok" -eq 0 ]; then echo "  PASS  $1"; PASS=$((PASS+1)); else echo "  FAIL  $1"; FAIL=$((FAIL+1)); fi
}

# Kill any sandbox node holding our RPC port — from this run or an aborted one.
kill_strays() {
  lsof -nP -iTCP:51999 2>/dev/null | awk '/LISTEN/{print $2}' | while read -r p; do kill "$p" 2>/dev/null; done
  pkill -f "divi-sandbox" 2>/dev/null || true
}
trap kill_strays EXIT
kill_strays; sleep 1

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

echo "── C. auto-recovery: restart over the kill-9 corruption ──"
OUT=$($DD start --datadir "$SB" --divid "$DIVID" 2>&1)
echo "$OUT" | grep -q "Node is running"
check "node auto-recovers and starts after corruption" $?
echo "$OUT" | grep -qiE "repair|rebuild"
check "recovery was actually performed (not a silent pass)" $?
sleep 2
$DD status --datadir "$SB" | grep -q "running"
check "node is healthy after recovery" $?
$DD stop --datadir "$SB" --yes >/dev/null 2>&1
check "final safe stop" $?

echo "── D. recovery preserves the wallet keys (coins are safe) ──"
# The real invariant isn't byte-equality (the daemon rewrites its best-block
# marker every run) — it's that a key created before the crash still belongs
# to the wallet after the repair.
RPCPW=$(grep '^rpcpassword=' "$SB/divi.conf" | cut -d= -f2)
rpc() { local m="${1:-}" p="${2:-}"; curl -s --max-time 8 -u "dd69test:$RPCPW" -d "{\"method\":\"$m\",\"params\":[$p]}" http://127.0.0.1:51999/; }
jget() { python3 -c "import json,sys;print(json.load(sys.stdin)$1)" 2>/dev/null; }

$DD start --datadir "$SB" --divid "$DIVID" >/dev/null 2>&1
ADDR=$(rpc getnewaddress '' | jget "['result']")
[ -n "$ADDR" ]; check "created a test address before the crash" $?
PID=$(cat "$SB/divid.pid" 2>/dev/null); sleep 1; kill -9 "$PID" 2>/dev/null; sleep 1
$DD start --datadir "$SB" --divid "$DIVID" >/dev/null 2>&1   # auto-recovers
sleep 1
MINE=$(rpc validateaddress "\"$ADDR\"" | jget "['result']['ismine']")
[ "$MINE" = "True" ]; check "key created before crash still belongs to the wallet after repair" $?
[ -s "$SB/wallet.dat" ]; check "wallet.dat present and non-empty after repair" $?
$DD stop --datadir "$SB" --yes >/dev/null 2>&1

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
