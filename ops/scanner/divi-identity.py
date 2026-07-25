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

Storage (all under CHAR_DIR): media/<hash>, identities.json, grid.json.
Everything served here is public by design; nothing secret is stored.

BEFORE DEPLOY (security audit 2026-Jul-25, must-do at launch):
  * Firewall the origin to Cloudflare IP ranges (CF-Connecting-IP trust; see
    _client_ip) and confirm CF strips client-supplied CF-Connecting-IP.
  * Rate-limit at the Cloudflare edge AND here: per-IP + per-key caps on
    /identity/publish and /identity/media (each publish costs a verifymessage
    RPC; media writes to disk). Add a per-key media quota so one valid signer
    can't fill the disk with distinct 3MB files.
  * Avatar MODERATION / takedown path: user media is public. Provide a
    superadmin delete + a report route before public launch (ties to the NFD
    moderation model). Media here is deletable (not permanent), so this is a
    process gap, not an Arweave-style permanence problem.
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
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.environ.get("CHAR_DIR", "/var/lib/divi-identity")
MEDIA = os.path.join(ROOT, "media")
IDENTITIES = os.path.join(ROOT, "identities.json")
GRID = os.path.join(ROOT, "grid.json")
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

_lock = threading.Lock()


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

        m = re.match(r"^/identity/media/([0-9a-f]{64})$", p)
        if m:
            h = m.group(1)
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
            return self._json(200, {"hash": _store_media(raw, mime)})

        if p == "/identity/publish":
            try:
                rec = clean_record(json.loads(self._body()))
            except Exception as e:
                return self._json(400, {"error": str(e)})
            ok, key = self._authorise(rec)
            if not ok:
                return self._json(403, {"error": "signature or token invalid"})
            with _lock:
                ids = _load(IDENTITIES, {})
                ids[key] = {**rec, "ip": self._client_ip(), "auth": key.split(":", 1)[0],
                            "updated": int(time.time())}
                _save(IDENTITIES, ids)
            return self._json(200, {"ok": True, "key": key})

        return self._json(404, {"error": "no such route"})

    def do_DELETE(self):
        if self.path.split("?")[0] != "/identity/publish":
            return self._json(404, {"error": "no such route"})
        ok, key = self._authorise({"ts": int(time.time())})
        if not ok:
            return self._json(403, {"error": "auth required"})
        with _lock:
            ids = _load(IDENTITIES, {})
            ids.pop(key, None)
            _save(IDENTITIES, ids)
        return self._json(200, {"ok": True})

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
