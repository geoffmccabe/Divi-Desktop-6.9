#!/usr/bin/env python3
"""Divi Rebels payout: the treasury's side of a cash-out.

Runs once per invocation, from a systemd timer every minute, on the London
node, which is the only machine that holds the treasury key. It asks the
room's ledger what is waiting, and for each request:

    validateaddress   the node's own check, not a regex
    reserve           the ledger takes the amount OUT of the balance first
    sendtoaddress     the coins move
    confirm           the ledger records the payment and the receipt

A failure before the send releases the reservation and the request is tried
again next round. A failure AFTER the send is the dangerous one, since the
reservation expires in ten minutes and the balance would come back: so an
unconfirmed send is written to disk and confirmed first thing next round,
and a node with one outstanding is never paid again until it is settled.

Stdlib only, like the scan proxy alongside it. Environment from
/etc/divi-scan.env (the node's RPC) and /etc/divi-rebels-payout.env (the
ledger's secret and address), both loaded by the unit.

    divi-rebels-payout.py            pay what is waiting
    divi-rebels-payout.py --dry-run  say what would be paid, move nothing
"""

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOM = os.environ.get("REBELS_ROOM_URL", "").rstrip("/")
SECRET = os.environ.get("REBELS_PAYOUT_SECRET", "")
RPC_URL = os.environ.get("DIVI_RPC_URL", "http://127.0.0.1:51473")
RPC_USER = os.environ.get("DIVI_RPC_USER", "")
RPC_PASS = os.environ.get("DIVI_RPC_PASS", "")

# ---- brakes ----
# The most this will pay out in one calendar day, in DIVI. A bug in the game
# that credits too freely, or a ledger that has been got at, is bounded by
# this rather than by the wallet's balance. Raise it in the env when the game
# earns it.
DAILY_CAP = float(os.environ.get("REBELS_DAILY_CAP", "2000"))
# Never spend the wallet down past this: it is also where purchases land and
# it has to keep a little for fees.
KEEP_BACK = float(os.environ.get("REBELS_KEEP_BACK", "5"))
# The ledger's own minimum; a request under it means the ledger is not the one
# we know, and nothing is paid.
MIN_CLAIM = 100

STATE_DIR = "/var/lib/divi-rebels"
STATE = os.path.join(STATE_DIR, "payout.json")

DRY = "--dry-run" in sys.argv


def log(msg):
    print(time.strftime("%Y-%m-%d %H:%M:%S ") + msg, flush=True)


# ---- the ledger ----

def ledger(path, body=None):
    if not ROOM or not SECRET:
        raise RuntimeError("REBELS_ROOM_URL / REBELS_PAYOUT_SECRET not set")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{ROOM}/ledger/{path}", data=data, method="POST" if data else "GET",
        headers={
            "Authorization": f"Bearer {SECRET}", "Content-Type": "application/json",
            # Cloudflare answers the stock Python agent string with a 403
            # before the worker ever sees the request. Say who this is.
            "User-Agent": "divi-rebels-payout/1 (London treasury)",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


# ---- the node ----

def rpc(method, params=None):
    req = urllib.request.Request(
        RPC_URL, data=json.dumps({"jsonrpc": "1.0", "id": "payout", "method": method, "params": params or []}).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Basic " + base64.b64encode(f"{RPC_USER}:{RPC_PASS}".encode()).decode(),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            out = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            out = json.loads(e.read().decode())
        except Exception:
            raise RuntimeError(f"rpc {method}: http {e.code}")
    if out.get("error"):
        raise RuntimeError(f"rpc {method}: {out['error']}")
    return out.get("result")


# ---- what has happened so far ----

def load_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except Exception:
        return {"day": "", "paid_today": 0.0, "unconfirmed": [], "attention": []}


def save_state(st):
    if DRY:
        return
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(st, f, indent=1)
    os.replace(tmp, STATE)


def today():
    return time.strftime("%Y-%m-%d")


# ---- the round ----

def settle_unconfirmed(st):
    """Sends that went out but were never confirmed. Tried again before
    anything new is paid; if the ledger no longer knows the claim (the hold
    expired), it is a hand job and is parked where a person will see it."""
    still = []
    for u in st.get("unconfirmed", []):
        try:
            r = ledger("confirm", {"node": u["node"], "ref": u["ref"], "txid": u["txid"]})
        except Exception as e:
            log(f"confirm retry failed for {u['node']}: {e}")
            still.append(u)
            continue
        if r.get("ok"):
            log(f"confirmed late: {u['amount']} DIVI to {u['to']} ({u['node']}) tx {u['txid']}")
        else:
            log(f"ATTENTION: paid {u['amount']} DIVI to {u['to']} for {u['node']} tx {u['txid']} "
                f"but the ledger says '{r.get('why')}'. The balance may have been restored. Needs a person.")
            st.setdefault("attention", []).append(u)
    st["unconfirmed"] = still


def pay_one(st, row, balance):
    node, to, amount = row["node"], row["to"], float(row["amount"])
    if amount < MIN_CLAIM:
        log(f"skip {node}: {amount} is under the minimum, which the ledger should never offer")
        return balance
    if any(a["node"] == node for a in st.get("attention", [])):
        log(f"skip {node}: an earlier payout needs a person before this one is touched")
        return balance
    if st["paid_today"] + amount > DAILY_CAP:
        log(f"hold {node}: {amount} DIVI would pass the daily cap of {DAILY_CAP} ({st['paid_today']} paid today)")
        return balance
    if balance - amount < KEEP_BACK:
        log(f"hold {node}: treasury has {balance:.2f}, not enough for {amount} plus {KEEP_BACK} kept back")
        return balance

    v = rpc("validateaddress", [to])
    if not (isinstance(v, dict) and v.get("isvalid")):
        log(f"reject {node}: {to} is not a valid address")
        if not DRY:
            ledger("reject", {"node": node, "why": "the treasury node says that address is not valid"})
        return balance

    if DRY:
        log(f"would pay {amount} DIVI to {to} for {node} ({row.get('name') or 'unnamed'})")
        return balance - amount

    ref = str(uuid.uuid4())
    r = ledger("reserve", {"node": node, "ref": ref})
    if not r.get("ok"):
        log(f"reserve refused for {node}: {r.get('why')}")
        return balance
    amount = float(r["amount"])
    # Paid to what the LEDGER holds as the claim, which is what the player
    # asked the room for, and to nothing this script was told any other way.
    if r.get("to") != to:
        log(f"release {node}: the ledger's address {r.get('to')} is not the one listed {to}")
        ledger("release", {"node": node, "ref": ref})
        return balance

    try:
        txid = rpc("sendtoaddress", [to, amount])
    except Exception as e:
        log(f"send failed for {node}: {e}; released, will retry")
        try:
            ledger("release", {"node": node, "ref": ref})
        except Exception as e2:
            log(f"and the release failed too: {e2}; the hold expires on its own")
        return balance

    log(f"sent {amount} DIVI to {to} for {node} tx {txid}")
    st["paid_today"] += amount
    balance -= amount
    # From here the money has moved. Confirm, and keep trying if it fails.
    try:
        c = ledger("confirm", {"node": node, "ref": ref, "txid": txid})
        if not c.get("ok"):
            raise RuntimeError(c.get("why"))
    except Exception as e:
        log(f"confirm failed for {node} ({e}); recorded, will confirm next round")
        st.setdefault("unconfirmed", []).append(
            {"node": node, "ref": ref, "txid": txid, "amount": amount, "to": to, "at": time.time()})
    save_state(st)
    return balance


def main():
    st = load_state()
    if st.get("day") != today():
        st["day"], st["paid_today"] = today(), 0.0
    settle_unconfirmed(st)
    save_state(st)

    rows = ledger("pending").get("rows", [])
    if not rows:
        log("nothing waiting")
        return
    balance = float(rpc("getbalance"))
    log(f"{len(rows)} waiting; treasury holds {balance:.2f} DIVI")
    for row in rows:
        try:
            balance = pay_one(st, row, balance)
        except Exception as e:
            log(f"error on {row.get('node')}: {e}")
    save_state(st)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"round failed: {e}")
        sys.exit(1)
