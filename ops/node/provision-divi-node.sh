#!/usr/bin/env bash
# Build a Divi full node on a fresh Ubuntu 24.04 machine, identically every time.
#
# WHY THIS FILE EXISTS. The UK scanner box was built by hand over months and
# several things on it live nowhere but that disk. The network's base nodes
# must not be like that: each one is built by THIS script from the SAME
# published node program the wallet installs, so any of them can be rebuilt,
# and a third can be added, in minutes and without archaeology.
#
# What it does, in order:
#   1. a dedicated `divi` user -- the node never runs as root
#   2. the node program from scan.divi.love, checked against the pinned
#      SHA-256 (the same one DD69 pins) before it is trusted
#   3. divi.conf with fresh RPC credentials, loopback-only RPC, staking on
#   4. the chain snapshot from nodes.divi.love, verified against its
#      published checksum, unpacked BEFORE the node's first start
#   5. a systemd service that asks the node to stop politely and waits up to
#      twenty minutes for it -- never a force kill, which corrupts the chain
#
# Safe to run again: every step checks for its own result first.
set -euo pipefail

DIVID_URL="https://scan.divi.love/downloads/divid69-69.0.4-linux-x86_64.tar.gz"
DIVID_SHA="0b1bb3b558f5e44cf78c9674f8869f00007a696f19b23a0e47f2ec3fc9bcae3d"
SNAP_URL="https://nodes.divi.love/snapshot/DIVI-snapshot.tar.gz"

DIVI_USER="divi"
DIVI_HOME="/var/lib/divi"
DATADIR="$DIVI_HOME/data"
BIN="/usr/local/bin/divid69"

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
trap 'echo "[$(date -u +%H:%M:%S)] FAILED at line $LINENO (exit $?)"' ERR

# ── 1. user ────────────────────────────────────────────────────────────────
if ! id -u "$DIVI_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DIVI_HOME" --create-home --shell /usr/sbin/nologin "$DIVI_USER"
  log "created user $DIVI_USER"
fi
mkdir -p "$DATADIR"
chown -R "$DIVI_USER:$DIVI_USER" "$DIVI_HOME"
chmod 750 "$DIVI_HOME" "$DATADIR"

# ── 2. node program, verified ──────────────────────────────────────────────
apt-get -qq update >/dev/null
DEBIAN_FRONTEND=noninteractive apt-get -qq install -y curl tar ca-certificates >/dev/null
if [ ! -x "$BIN" ] || ! grep -q "$DIVID_SHA" /usr/local/share/divid69.installed 2>/dev/null; then
  tmp=$(mktemp -d)
  log "downloading the node program"
  curl -fsSL --retry 3 -o "$tmp/divid.tar.gz" "$DIVID_URL"
  got=$(sha256sum "$tmp/divid.tar.gz" | cut -d' ' -f1)
  if [ "$got" != "$DIVID_SHA" ]; then
    echo "REFUSING: node program checksum $got does not match the pinned $DIVID_SHA" >&2
    exit 1
  fi
  log "checksum verified"
  tar -xzf "$tmp/divid.tar.gz" -C "$tmp"
  found=$(find "$tmp" -type f -name 'divid69' | head -1)
  [ -n "$found" ] || { echo "REFUSING: archive contains no divid69" >&2; exit 1; }
  install -m 755 "$found" "$BIN"
  mkdir -p /usr/local/share && echo "$DIVID_SHA" > /usr/local/share/divid69.installed
  rm -rf "$tmp"
  log "installed $BIN"
fi

# ── 3. configuration ───────────────────────────────────────────────────────
CONF="$DATADIR/divi.conf"
if [ ! -f "$CONF" ]; then
  rpcuser="divi$(head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  rpcpass="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  cat > "$CONF" <<EOF
# Written by provision-divi-node.sh. RPC is loopback-only; nothing outside
# this machine can reach it. Staking is on; the wallet stays locked until
# a staking-only unlock is performed deliberately.
server=1
listen=1
daemon=0
staking=1
rpcuser=$rpcuser
rpcpassword=$rpcpass
rpcbind=127.0.0.1
rpcallowip=127.0.0.1
rpcport=51473
# One worker thread per kept-alive RPC connection; too few and the node
# wedges. Never below 16.
rpcthreads=64
rpcworkqueue=256
maxconnections=64
dbcache=512
# This machine has a public address of its own; no UPnP needed.
upnp=0
# Announced in the node's user agent (BIP 14 comment) so maps can name it.
uacomment=${NODE_NAME:-$(hostname)}
EOF
  chown "$DIVI_USER:$DIVI_USER" "$CONF"
  chmod 600 "$CONF"
  log "wrote divi.conf with fresh RPC credentials"
fi

# ── 4. chain snapshot, verified, before first start ────────────────────────
# A missing blocks/ folder is the normal first-run case, not an error. Under
# `set -o pipefail` a failing find would silently end the whole script here,
# which is exactly what happened on the first run of this file.
blk=0
if [ -d "$DATADIR/blocks" ]; then
  blk=$(find "$DATADIR/blocks" -maxdepth 1 -name 'blk*' | wc -l)
fi
if [ "$blk" -lt 3 ]; then
  log "no chain here yet — fetching the snapshot (this is ~5 GB)"
  snap="$DIVI_HOME/DIVI-snapshot.tar.gz"
  curl -fL --retry 5 -C - -o "$snap" "$SNAP_URL"
  want=$(curl -fsSL "$SNAP_URL.sha256" | cut -d' ' -f1)
  got=$(sha256sum "$snap" | cut -d' ' -f1)
  if [ "$got" != "$want" ]; then
    echo "REFUSING: snapshot checksum $got does not match published $want" >&2
    rm -f "$snap"; exit 1
  fi
  log "snapshot checksum verified against the published value"
  gzip -t "$snap"
  tar -xzf "$snap" -C "$DATADIR"
  # Some archives wrap everything in one folder; lift it if so.
  if [ ! -d "$DATADIR/blocks" ]; then
    inner=$(find "$DATADIR" -maxdepth 2 -type d -name blocks | head -1)
    [ -n "$inner" ] && mv "$(dirname "$inner")"/* "$DATADIR"/ 2>/dev/null || true
  fi
  [ -d "$DATADIR/blocks" ] && [ -d "$DATADIR/chainstate" ] || { echo "REFUSING: snapshot did not produce blocks/ and chainstate/" >&2; exit 1; }
  rm -f "$snap"
  chown -R "$DIVI_USER:$DIVI_USER" "$DATADIR"
  log "snapshot unpacked"
fi

# ── 5. service: polite stop, long wait, never a kill ───────────────────────
cat > /etc/systemd/system/divid.service <<EOF
[Unit]
Description=Divi node (divid69)
After=network-online.target
Wants=network-online.target

[Service]
User=$DIVI_USER
Group=$DIVI_USER
ExecStart=$BIN -datadir=$DATADIR -conf=$CONF -printtoconsole
Restart=always
RestartSec=15
# THE ONE RULE: never force-kill the node. SIGTERM asks it to stop and flush;
# on this chain that can take a quarter of an hour. Cutting it off mid-flush
# is what corrupts the block database.
KillSignal=SIGTERM
KillMode=mixed
TimeoutStopSec=1200
LimitNOFILE=8192
# Loopback RPC only; keep the process from touching what it need not.
ProtectSystem=full
ProtectHome=true
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable divid >/dev/null 2>&1
systemctl restart divid
log "divid service enabled and started"

# ── done ───────────────────────────────────────────────────────────────────
sleep 5
log "status: $(systemctl is-active divid); pid $(systemctl show -p MainPID --value divid)"
log "the node is loading the chain; it answers RPC in a few minutes. Check with:"
log "  systemctl status divid   and   journalctl -u divid -f"
