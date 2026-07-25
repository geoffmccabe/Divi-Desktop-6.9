#!/usr/bin/env python3
"""Divi node-identity service — runs on the Divi Love Scan node.

The public store that turns "I set a name and picture in my wallet" into
"everyone can see it on the map." Built for review; NOT yet deployed.

WHAT IT IS
  * A node publishes its public persona (name, description, avatar) here.
  * Anyone reads the manifest to label nodes on the map.
  * Media is content-addressed (stored/served under the SHA-256 of its bytes),
    so a changed picture is a different URL and clients re-download only what
    changed. Cloudflare (already in front of this box) edge-caches each file.

WHAT IT IS NOT
  * It never holds wallet keys, funds, or anything that can move money.
  * It never serves a Kinet.ink api_key to a client. Grid characters are public
    (name + image); their keys live elsewhere, server-side, and are used only to
    mint chat embed URLs (a later phase).

AUTH — a node proves ownership by EITHER method (Geoff, 2026-Jul-25):
  * Wallet signature  — headers X-Divi-Address + X-Divi-Signature over the
    canonical record; verified with `verifymessage` on the local divid. Fully
    anonymous.
  * SSO bearer token  — Authorization: Bearer <token>; verified via the SSO
    /api/verify endpoint. Account-based.
  The admin grid (PUT /characters/grid) requires SSO role == superadmin.

ROUTES
  GET    /identity/manifest              public: [{key, ip, name, thumbHash, …}]
  GET    /identity/media/<sha256>        public: bytes, immutable, cache-forever
  POST   /identity/media                 auth:  upload media -> {hash}
  POST   /identity/publish               auth:  create/update your identity
  DELETE /identity/publish               auth:  revoke it
  GET    /characters/grid                public: the six curated characters (NO keys)
  PUT    /characters/grid/<slot>         superadmin: set a grid slot
  POST   /report                         public (rate-limited): flag abuse
  GET    /admin/reports                  superadmin: read the abuse queue
  DELETE /admin/identity/<key>           superadmin: take down any identity
  DELETE /admin/media/<sha256>           superadmin: take down + permanently block a media hash

Rate-limited (origin backstop; Cloudflare also limits at the edge): publish
10/min/key, media 30/hour/key + 20MB/key quota, report 5/hour/IP, 120 writes/
min/IP. A blocked media hash stays blocked even if re-uploaded.

Storage (all under CHAR_DIR): media/<hash>, identities.json, grid.json,
usage.json, reports.json, blocked.json. Public by design; nothing secret stored.

STILL BEFORE DEPLOY (infra, not code):
  * Firewall the origin to Cloudflare IP ranges (CF-Connecting-IP is a map
    display hint only, never auth; see _client_ip) and confirm CF strips a
    client-supplied CF-Connecting-IP.
  * Serve media from a SEPARATE cookieless subdomain if the identity origin ever
    gets cookies, so a served file can't touch same-origin auth state.
"""

import base64
import hashlib
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.environ.get("CHAR_DIR", "/var/lib/divi-identity")
MEDIA = os.path.join(ROOT, "media")
IDENTITIES = os.path.join(ROOT, "identities.json")
GRID = os.path.join(ROOT, "grid.json")
USAGE = os.path.join(ROOT, "usage.json")      # per-key media byte accounting
REPORTS = os.path.join(ROOT, "reports.json")  # abuse reports awaiting review
BLOCKED = os.path.join(ROOT, "blocked.json")  # media hashes taken down by an admin
PORT = int(os.environ.get("IDENTITY_PORT", "8772"))

# Local divid RPC (for verifymessage). Reuses the scan-proxy env if present.
RPC_URL = os.environ.get("DIVI_RPC_URL", "http://127.0.0.1:51473/")
RPC_USER = os.environ.get("DIVI_RPC_USER", "")
RPC_PASS = os.environ.get("DIVI_RPC_PASS", "")

# SSO verification.
SSO_VERIFY = os.environ.get("SSO_VERIFY_URL", "https://sso.lightningworks.io/api/verify")

MAX_BYTES = 3 * 1024 * 1024  # matches the wallet's upload cap
GRID_SLOTS = 6
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
ADDR_RE = re.compile(r"^D[1-9A-HJ-NP-Za-km-z]{25,40}$")  # base58, Divi 'D' prefix
ALLOWED_TYPES = {"image/webp", "image/png", "image/jpeg", "image/gif", "video/mp4", "video/webm"}
# A signed record older than this is rejected — bounds replay of a captured sig.
SIG_WINDOW = 10 * 60

# Per-key storage quota: how much distinct media one identity may hold. Stops a
# single valid signer from filling the disk with many distinct 3MB files.
MEDIA_QUOTA_BYTES = 20 * 1024 * 1024  # 20MB per key

_lock = threading.Lock()


# ── rate limiting ────────────────────────────────────────────────────────────
# In-memory sliding window, per bucket key. Cloudflare rate-limits at the edge
# too; this is the origin's own backstop so a single valid signer (past the edge)
# still can't hammer verifymessage or the disk.
class RateLimiter:
    def __init__(self):
        self._hits: dict[str, list[float]] = {}
        self._lk = threading.Lock()

    def allow(self, bucket: str, limit: int, window: float) -> bool:
        now = time.time()
        with self._lk:
            q = [t for t in self._hits.get(bucket, []) if now - t < window]
            if len(q) >= limit:
                self._hits[bucket] = q
                return False
            q.append(now)
            self._hits[bucket] = q
            # opportunistic cleanup so the dict can't grow unbounded
            if len(self._hits) > 5000:
                for k in [k for k, v in self._hits.items() if not v or now - v[-1] > 3600]:
                    self._hits.pop(k, None)
            return True


_rl = RateLimiter()

# (limit, window seconds). Reads aren't limited here — Cloudflare caches them.
LIMITS = {
    "publish": (10, 60),      # 10 publishes/min per key (each = one verifymessage)
    "media": (30, 3600),      # 30 uploads/hour per key
    "report": (5, 3600),      # 5 reports/hour per IP
    "ip": (120, 60),          # 120 write-attempts/min per IP, any route
}


# ── storage ──────────────────────────────────────────────────────────────────
def _load(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def _save(path, obj):
    os.makedirs(ROOT, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=2)
    os.replace(tmp, path)  # atomic: a crash mid-write can't corrupt the file


def _store_media(raw: bytes, mime: str) -> str:
    h = hashlib.sha256(raw).hexdigest()
    if h in set(_load(BLOCKED, [])):
        # A blocked hash stays blocked even if someone re-uploads the same bytes.
        raise ValueError("this content has been removed")
    os.makedirs(MEDIA, exist_ok=True)
    path = os.path.join(MEDIA, h)
    if not os.path.exists(path):  # identical bytes stored once, ever
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(raw)
        os.replace(tmp, path)
        with open(path + ".type", "w") as f:
            f.write(mime)
    return h


def _media_type(h: str) -> str:
    try:
        with open(os.path.join(MEDIA, h + ".type")) as f:
            return f.read().strip() or "application/octet-stream"
    except Exception:
        return "application/octet-stream"


# ── auth ─────────────────────────────────────────────────────────────────────
def _rpc(method, params):
    body = json.dumps({"jsonrpc": "1.0", "id": "id", "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC_URL, data=body, headers={"Content-Type": "text/plain"})
    auth = base64.b64encode(f"{RPC_USER}:{RPC_PASS}".encode()).decode()
    req.add_header("Authorization", f"Basic {auth}")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r).get("result")


def verify_divi(address: str, signature: str, message: str) -> bool:
    """True iff `signature` is a valid Divi signature of `message` by `address`."""
    if not (address and signature and ADDR_RE.match(address)):
        return False
    try:
        return bool(_rpc("verifymessage", [address, signature, message]))
    except Exception:
        return False


def verify_sso(bearer: str):
    """Returns the SSO user profile dict, or None."""
    if not bearer:
        return None
    try:
        req = urllib.request.Request(
            SSO_VERIFY,
            data=json.dumps({"token": bearer}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.load(r)
        return data.get("user") if data.get("valid") else None
    except Exception:
        return None


def canonical(record: dict) -> str:
    """Stable text a client signs / the server verifies. Only the fields that
    define the identity, sorted, plus the timestamp — never the media bytes.

    ensure_ascii=False is REQUIRED: JavaScript's JSON.stringify emits raw UTF-8,
    while Python would otherwise escape non-ASCII to \\uXXXX. Without this, any
    accented character or emoji in a name would make the two canonical forms
    differ and every signature would fail to verify."""
    fields = {k: record.get(k) for k in ("name", "description", "mediaHash", "chatter", "ts")}
    return json.dumps(fields, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


# ── the identity record ──────────────────────────────────────────────────────
def clean_record(body: dict) -> dict:
    ts = int(body.get("ts", 0))
    if abs(time.time() - ts) > SIG_WINDOW:
        raise ValueError("stale or missing timestamp")
    mh = str(body.get("mediaHash", "")) if body.get("mediaHash") else ""
    if mh and not HASH_RE.match(mh):
        raise ValueError("bad mediaHash")
    return {
        "name": str(body.get("name", ""))[:64],
        "description": str(body.get("description", ""))[:1000],
        "mediaHash": mh,
        "chatter": max(0, min(255, int(body.get("chatter", 128)))),
        "ts": ts,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "DiviIdentity/1"

    def log_message(self, fmt, *a):
        print(f"{self.address_string()} {fmt % a}", flush=True)

    def _json(self, code, obj, extra=None):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def _body(self):
        n = int(self.headers.get("Content-Length", "0") or 0)
        if n <= 0 or n > MAX_BYTES * 2:
            raise ValueError("bad body size")
        return self.rfile.read(n)

    def _client_ip(self):
        # NOTE: this IP is a DISPLAY HINT for the map only — nothing authenticates
        # on it (identity is proven by signature/token). So spoofing CF-Connecting-IP
        # can at worst mislabel a node's map location, not impersonate an identity.
        # DEPLOY REQUIREMENT: firewall this origin to Cloudflare's IP ranges so the
        # header can't be forged by hitting the origin directly; CF overwrites any
        # client-supplied CF-Connecting-IP.
        return self.headers.get("CF-Connecting-IP") or self.client_address[0]

    def _authorise(self, record):
        """Returns (ok, key) where key identifies the owner: 'divi:<addr>' or
        'sso:<userid>'. record must already be canonicalised."""
        addr = self.headers.get("X-Divi-Address", "")
        sig = self.headers.get("X-Divi-Signature", "")
        if addr and sig:
            if verify_divi(addr, sig, canonical(record)):
                return True, f"divi:{addr}"
            return False, None
        bearer = (self.headers.get("Authorization", "") or "").removeprefix("Bearer ").strip()
        user = verify_sso(bearer)
        if user and user.get("id"):
            return True, f"sso:{user['id']}"
        return False, None

    # ── reads ────────────────────────────────────────────────────────────────
    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/identity/manifest":
            with _lock:
                ids = _load(IDENTITIES, {})
            # Only public fields reach the client.
            out = [
                {"key": k, "ip": v.get("ip"), "name": v.get("name"),
                 "mediaHash": v.get("mediaHash"), "chatter": v.get("chatter"),
                 "updated": v.get("updated")}
                for k, v in ids.items()
            ]
            return self._json(200, {"identities": out}, {"Cache-Control": "no-cache"})

        if p == "/characters/grid":
            with _lock:
                grid = _load(GRID, {})
            # NEVER include api keys. grid.json holds only public character data.
            return self._json(200, {"grid": grid, "slots": GRID_SLOTS})

        if p == "/admin/reports":
            # Superadmin: read the abuse queue.
            if not self._superadmin():
                return self._json(403, {"error": "superadmin required"})
            with _lock:
                return self._json(200, {"reports": _load(REPORTS, [])})

        m = re.match(r"^/identity/media/([0-9a-f]{64})$", p)
        if m:
            h = m.group(1)
            if h in set(_load(BLOCKED, [])):  # taken down by an admin — gone for good
                return self._json(410, {"error": "removed"})
            path = os.path.join(MEDIA, h)
            if not os.path.isfile(path):
                return self._json(404, {"error": "not found"})
            raw = open(path, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", _media_type(h))
            # nosniff: a client can upload bytes that are really HTML while
            # claiming Content-Type image/webp. Without this, a browser may sniff
            # and render it as HTML — stored XSS on the scanner's own origin.
            self.send_header("X-Content-Type-Options", "nosniff")
            # Belt and braces: force download/isolation semantics for media.
            self.send_header("Content-Disposition", "inline")
            self.send_header("Content-Security-Policy", "default-src 'none'; sandbox")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            self.send_header("ETag", f'"{h}"')
            self.end_headers()
            return self.wfile.write(raw)

        return self._json(404, {"error": "no such route"})

    # ── writes ───────────────────────────────────────────────────────────────
    def _limited(self, bucket, key) -> bool:
        """True if this request is over a limit (caller should 429)."""
        lim, win = LIMITS[bucket]
        il, iw = LIMITS["ip"]
        return not (_rl.allow(f"ip:{self._client_ip()}", il, iw) and _rl.allow(f"{bucket}:{key}", lim, win))

    def do_POST(self):
        p = self.path.split("?")[0]

        if p == "/identity/media":
            # Upload media; auth required so anonymous randoms can't fill the disk.
            try:
                mime = self.headers.get("Content-Type", "")
                if mime not in ALLOWED_TYPES:
                    return self._json(400, {"error": "unsupported media type"})
                raw = self._body()
                if len(raw) > MAX_BYTES:
                    return self._json(400, {"error": "media exceeds 3MB"})
            except Exception as e:
                return self._json(400, {"error": str(e)})
            # A signature over an empty record still proves address ownership;
            # media upload only needs "a real owner", not a specific record.
            ok, key = self._authorise({"ts": int(time.time())})
            if not ok:
                return self._json(403, {"error": "auth required"})
            if self._limited("media", key):
                return self._json(429, {"error": "too many uploads, slow down"})
            # Per-key storage quota — one signer can't fill the disk.
            with _lock:
                usage = _load(USAGE, {})
                have = usage.get(key, {}).get("bytes", 0)
                if have + len(raw) > MEDIA_QUOTA_BYTES:
                    return self._json(413, {"error": "storage quota reached for this identity"})
                try:
                    h = _store_media(raw, mime)  # raises if the hash is blocked
                except ValueError as e:
                    return self._json(410, {"error": str(e)})
                slot = usage.setdefault(key, {"bytes": 0, "hashes": []})
                if h not in slot["hashes"]:  # content-addressed: charge distinct bytes once
                    slot["bytes"] = have + len(raw)
                    slot["hashes"].append(h)
                    _save(USAGE, usage)
            return self._json(200, {"hash": h})

        if p == "/identity/publish":
            try:
                rec = clean_record(json.loads(self._body()))
            except Exception as e:
                return self._json(400, {"error": str(e)})
            ok, key = self._authorise(rec)
            if not ok:
                return self._json(403, {"error": "signature or token invalid"})
            if self._limited("publish", key):
                return self._json(429, {"error": "too many updates, slow down"})
            with _lock:
                ids = _load(IDENTITIES, {})
                ids[key] = {**rec, "ip": self._client_ip(), "auth": key.split(":", 1)[0],
                            "updated": int(time.time())}
                _save(IDENTITIES, ids)
            return self._json(200, {"ok": True, "key": key})

        if p == "/report":
            # Anyone can flag an identity/media for review. Rate-limited by IP.
            if not _rl.allow(f"report:{self._client_ip()}", *LIMITS["report"]):
                return self._json(429, {"error": "too many reports"})
            try:
                body = json.loads(self._body())
            except Exception:
                return self._json(400, {"error": "bad body"})
            with _lock:
                reports = _load(REPORTS, [])
                reports.append({
                    "target": str(body.get("target", ""))[:200],
                    "reason": str(body.get("reason", ""))[:500],
                    "ip": self._client_ip(),
                    "ts": int(time.time()),
                })
                _save(REPORTS, reports[-2000:])  # keep the last 2000
            return self._json(200, {"ok": True})

        return self._json(404, {"error": "no such route"})

    def _superadmin(self):
        bearer = (self.headers.get("Authorization", "") or "").removeprefix("Bearer ").strip()
        user = verify_sso(bearer)
        return bool(user and user.get("role") == "superadmin")

    def do_DELETE(self):
        p = self.path.split("?")[0]

        # A node revoking its OWN identity (signature or token proves ownership).
        if p == "/identity/publish":
            ok, key = self._authorise({"ts": int(time.time())})
            if not ok:
                return self._json(403, {"error": "auth required"})
            with _lock:
                ids = _load(IDENTITIES, {})
                ids.pop(key, None)
                _save(IDENTITIES, ids)
            return self._json(200, {"ok": True})

        # ── Moderation (superadmin) — take down anyone's identity or a media hash.
        m = re.match(r"^/admin/identity/(.+)$", p)
        if m:
            if not self._superadmin():
                return self._json(403, {"error": "superadmin required"})
            target = urllib.parse.unquote(m.group(1))
            with _lock:
                ids = _load(IDENTITIES, {})
                existed = ids.pop(target, None) is not None
                _save(IDENTITIES, ids)
            return self._json(200, {"ok": True, "removed": existed})

        m = re.match(r"^/admin/media/([0-9a-f]{64})$", p)
        if m:
            if not self._superadmin():
                return self._json(403, {"error": "superadmin required"})
            h = m.group(1)
            with _lock:
                blocked = set(_load(BLOCKED, []))
                blocked.add(h)  # tombstone: never served again, even if re-uploaded
                _save(BLOCKED, sorted(blocked))
                for suffix in ("", ".type"):
                    try:
                        os.remove(os.path.join(MEDIA, h + suffix))
                    except OSError:
                        pass
            return self._json(200, {"ok": True})

        return self._json(404, {"error": "no such route"})

    def do_PUT(self):
        m = re.match(r"^/characters/grid/(\d+)$", self.path.split("?")[0])
        if not m:
            return self._json(404, {"error": "no such route"})
        slot = int(m.group(1))
        if not 0 <= slot < GRID_SLOTS:
            return self._json(400, {"error": f"slot 0-{GRID_SLOTS - 1}"})
        # Grid is superadmin-only, SSO.
        bearer = (self.headers.get("Authorization", "") or "").removeprefix("Bearer ").strip()
        user = verify_sso(bearer)
        if not user or user.get("role") != "superadmin":
            return self._json(403, {"error": "superadmin required"})
        try:
            body = json.loads(self._body())
            ch = {
                "name": str(body.get("name", ""))[:64],
                "description": str(body.get("description", ""))[:1000],
                "mediaHash": str(body.get("mediaHash", "")) if body.get("mediaHash") else "",
            }
            if ch["mediaHash"] and not HASH_RE.match(ch["mediaHash"]):
                raise ValueError("bad mediaHash")
        except Exception as e:
            return self._json(400, {"error": str(e)})
        with _lock:
            grid = _load(GRID, {})
            grid[str(slot)] = ch  # public only; the api_key lives elsewhere
            _save(GRID, grid)
        return self._json(200, {"ok": True, "slot": slot})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers",
                         "Content-Type, Authorization, X-Divi-Address, X-Divi-Signature")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()


if __name__ == "__main__":
    os.makedirs(MEDIA, exist_ok=True)
    print(f"divi-identity on 127.0.0.1:{PORT}, data in {ROOT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
