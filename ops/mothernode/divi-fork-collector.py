#!/usr/bin/env python3
"""Records this node's view of chain forks, permanently.

Why it exists: getchaintips lives in the daemon's memory and starts empty at
every restart, and the daemon's tip log only survives as long as journald keeps
it. Neither can answer "are forks getting worse this month?". This writes what
we see to SQLite, which does.

Two independent sources, deliberately:
  * getchaintips  — every branch tip we know of, with its length. Tells us DEPTH.
  * UpdateTip log — the daemon prints every tip change. A height accepted twice
                    with two different hashes is a reorg we actually performed.
                    Divi never logs the word "reorg", so this is the only way to
                    see them.

Blocks seen during initial sync are excluded: catching up is not fork activity,
and counting it would wreck the rate. We only count once the tip is advancing
roughly in real time.

Read the results with:  divi-fork-stats
"""

import json
import os
import re
import sqlite3
import subprocess
import time
import urllib.request
import base64

RPC_URL = os.environ.get("DIVI_RPC_URL", "http://127.0.0.1:51473/")
RPC_USER = os.environ.get("DIVI_RPC_USER", "")
RPC_PASS = os.environ.get("DIVI_RPC_PASS", "")
DB_PATH = os.environ.get("FORK_DB", "/var/lib/divi-forks/forks.db")
POLL_SECS = int(os.environ.get("FORK_POLL_SECS", "60"))

# A tip more than this far behind wall-clock means we're still syncing, so the
# sample is not evidence about live fork behaviour.
SYNC_SLACK_SECS = 15 * 60

# Anything deeper than this on a 60-second chain is not a routine reorg. We
# refuse to record it as one rather than raise a false alarm; a real event that
# deep deserves a human looking at the log, not a number in a panel.
MAX_REORG_DEPTH = 20


def rpc(method, params=None):
    body = json.dumps({"jsonrpc": "1.0", "id": "fork", "method": method, "params": params or []}).encode()
    req = urllib.request.Request(RPC_URL, data=body, headers={"Content-Type": "text/plain"})
    auth = base64.b64encode(f"{RPC_USER}:{RPC_PASS}".encode()).decode()
    req.add_header("Authorization", f"Basic {auth}")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["result"]


def db_init():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c = sqlite3.connect(DB_PATH)
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS forks (
            height     INTEGER PRIMARY KEY,
            hash       TEXT,
            status     TEXT,
            branch_len INTEGER,
            first_seen INTEGER,
            last_seen  INTEGER
        );
        CREATE TABLE IF NOT EXISTS reorgs (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            height     INTEGER,
            depth      INTEGER,
            at         INTEGER,
            UNIQUE(height, at)
        );
        CREATE TABLE IF NOT EXISTS window (
            k TEXT PRIMARY KEY,
            v INTEGER
        );
        """
    )
    c.commit()
    return c


def note_window(c, tip):
    cur = {r[0]: r[1] for r in c.execute("SELECT k, v FROM window")}
    lo = cur.get("min_tip")
    c.execute("INSERT OR REPLACE INTO window VALUES ('min_tip', ?)", (tip if lo is None else min(lo, tip),))
    c.execute("INSERT OR REPLACE INTO window VALUES ('max_tip', ?)", (max(cur.get("max_tip", 0), tip),))
    if "started" not in cur:
        c.execute("INSERT OR REPLACE INTO window VALUES ('started', ?)", (int(time.time()),))


def collect_tips(c):
    tips = rpc("getchaintips")
    active = [t for t in tips if t.get("status") == "active"]
    tip = max((t["height"] for t in active), default=0)

    # Only trust this sample if we're actually at the chain tip.
    try:
        best = rpc("getblock", [rpc("getbestblockhash")])
        if time.time() - best.get("time", 0) > SYNC_SLACK_SECS:
            return tip, 0  # still catching up
    except Exception:
        pass

    now = int(time.time())
    n = 0
    for t in tips:
        if t.get("status") == "active":
            continue
        c.execute(
            """INSERT INTO forks (height, hash, status, branch_len, first_seen, last_seen)
               VALUES (?,?,?,?,?,?)
               ON CONFLICT(height) DO UPDATE SET
                 status=excluded.status,
                 branch_len=MAX(forks.branch_len, excluded.branch_len),
                 last_seen=excluded.last_seen""",
            (t["height"], t.get("hash", ""), t.get("status", "?"), t.get("branchlen", 1), now, now),
        )
        n += c.total_changes and 1 or 0
    note_window(c, tip)
    c.commit()
    return tip, n


TIP_RE = re.compile(r"^(\S+).*new best=(\w+)\s+height=(\d+)")


def collect_reorgs(c, since_secs=900):
    """Scan the recent journal for tip changes that went backwards."""
    try:
        out = subprocess.run(
            ["journalctl", "-u", "divid", "--no-pager", "-o", "short-iso", "--since", f"-{since_secs}s"],
            capture_output=True, text=True, timeout=60,
        ).stdout
    except Exception:
        return 0

    seq = []
    for line in out.splitlines():
        if "UpdateTip" not in line:
            continue
        m = TIP_RE.search(line)
        if m:
            seq.append((int(m.group(3)), m.group(2), m.group(1)))

    # A node restart replays the tip log from far below the tip, which naively
    # looks like an enormous rollback — the first run of this recorded a bogus
    # "81-deep reorg" that was really just divid coming back up. A genuine reorg
    # only happens when we were AT the tip and stepped back a little, so demand
    # both of those before believing it.
    found = 0
    high = 0
    for i, (h, _hash, _ts) in enumerate(seq):
        if i > 0:
            prev = seq[i - 1][0]
            depth = prev - h + 1
            at_tip = prev >= high - 2  # were we actually on the tip?
            if h <= prev and at_tip and depth <= MAX_REORG_DEPTH:
                ts = int(time.mktime(time.strptime(seq[i][2][:19], "%Y-%m-%dT%H:%M:%S")))
                try:
                    c.execute("INSERT OR IGNORE INTO reorgs (height, depth, at) VALUES (?,?,?)", (h, depth, ts))
                    found += 1
                except Exception:
                    pass
        high = max(high, h)
    c.commit()
    return found


def main():
    c = db_init()
    while True:
        try:
            tip, _ = collect_tips(c)
            collect_reorgs(c)
        except Exception as e:  # never die; a node blip is not fatal
            print(f"collector: {e}", flush=True)
        time.sleep(POLL_SECS)


if __name__ == "__main__":
    main()
