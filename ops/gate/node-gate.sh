#!/usr/bin/env bash
# THE NODE GATE. Starts a REAL node with the wallet's own node-management code,
# on whatever machine this runs on, and refuses to pass unless it behaves.
#
# WHY. Between 2026-Sep-20 and 2026-Sep-21 fourteen releases went to users with
# Windows faults that only a Windows machine could show: a folder path the
# block database could not read, a process the wallet could not see, a second
# node started on top of a healthy first one. Each reached a tester in another
# country before it reached us. Nothing here is clever; it simply runs the
# thing, on the real platform, before anyone else has to.
#
# It uses the node's private test chain (regtest): no network, no 5 GB
# download, starts in seconds. Every fault above happened before the node ever
# touched the real chain, so that is enough to catch them.
#
# Usage: node-gate.sh <path-to-dd69-cli> <path-to-divid69>
set -euo pipefail
DD69="$1"; DIVID="$2"
WORK="$(mktemp -d 2>/dev/null || mktemp -d -t nodegate)"
# A folder name with a space in it, on purpose: real users have them
# ("Application Support", "C:\Users\First Last").
DATA="$WORK/node data"
mkdir -p "$DATA"
cat > "$DATA/divi.conf" <<CONF
regtest=1
server=1
listen=0
daemon=0
rpcuser=gate
rpcpassword=gate-local-only
rpcbind=127.0.0.1
rpcallowip=127.0.0.1
rpcport=51573
rpcthreads=16
CONF

pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; echo "----- node output -----"; tail -40 "$DATA/dd69-spawn.log" 2>/dev/null || true
         echo "----- node log -----"; tail -40 "$DATA/regtest/debug.log" 2>/dev/null || true; exit 1; }
count_nodes() {
  if command -v tasklist >/dev/null 2>&1; then tasklist //FI "IMAGENAME eq divid69.exe" //NH 2>/dev/null | grep -ci "divid69" || true
  else { pgrep -f "divid69.*node data" || true; } | wc -l | tr -d ' '; fi
}
cleanup() { "$DD69" stop --yes --datadir "$DATA" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'echo "  GATE SCRIPT ERROR at line $LINENO"' ERR

echo "== 1. the wallet's code starts a node, and the node answers"
"$DD69" start --datadir "$DATA" --divid "$DIVID" || fail "start returned an error"
pass "started and answered"

echo "== 2. the wallet can SEE the node it started (the Windows pid-file bug)"
OUT="$("$DD69" status --json --datadir "$DATA")" || fail "status returned an error"
echo "$OUT" | grep -q '"running":[[:space:]]*true' || fail "status says not running: $OUT"
pass "status reports it running"

echo "== 3. asking to start AGAIN reuses it, and never launches a second node"
"$DD69" start --datadir "$DATA" --divid "$DIVID" || fail "second start returned an error"
N="$(count_nodes)"
[ "$N" = "1" ] || fail "expected exactly 1 node process, found $N"
pass "still exactly one node"

echo "== 4. the node opened its databases at a sane path (the LevelDB path bug)"
LOG="$DATA/regtest/debug.log"
[ -f "$LOG" ] || fail "no node log at the expected place"
if grep -q 'Opening LevelDB in .*\\\\?\\' "$LOG"; then fail "node was handed an extended-length path"; fi
grep -q "Opened LevelDB successfully" "$LOG" || fail "node never opened its block database"
if grep -qi "Assertion failed\|Could not lock file\|Cannot obtain a lock" "$LOG" "$DATA/dd69-spawn.log" 2>/dev/null; then fail "node reported a lock or assertion failure"; fi
pass "databases opened cleanly"

echo "== 5. a polite stop works, and the node is really gone afterwards"
"$DD69" stop --yes --datadir "$DATA" || fail "stop returned an error"
sleep 2
N="$(count_nodes)"
[ "$N" = "0" ] || fail "node still running after stop ($N process)"
pass "stopped cleanly"

echo "== 6. the last shutdown was recorded as clean, and it starts again"
"$DD69" start --datadir "$DATA" --divid "$DIVID" || fail "restart after clean stop failed"
"$DD69" stop --yes --datadir "$DATA" || fail "second stop failed"
pass "restart and stop"

echo
echo "NODE GATE PASSED on $(uname -s)"
