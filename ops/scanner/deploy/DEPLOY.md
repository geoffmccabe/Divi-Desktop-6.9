# Deploying the Divi node-identity service

Target: the Divi Love Scan node (109.228.38.104, London). **Nothing here is done
yet — this is the reviewed plan. Run it only on Geoff's go-ahead.**

The service is already fronted by the same stack as the AI gateway: Caddy
(Let's Encrypt) → Cloudflare. It binds loopback only and Caddy publishes it.

## Steps (idempotent; `deploy.sh` runs 1–4)

1. **Copy the service** to `/usr/local/bin/divi-identity.py`, create
   `/var/lib/divi-identity` (mode 750, owned by the service user).
2. **Install the systemd unit** (`divi-identity.service`), `daemon-reload`,
   `enable --now`. It reuses `/etc/divi-scan.env` for the divid RPC creds
   (verifymessage needs them) — no new secret.
3. **Add the Caddy route** (`Caddyfile.snippet` → `/etc/caddy/Caddyfile`),
   `caddy reload`. Caddy provisions the cert for `nodes.divi.love`.
4. **Health check**: `curl -s https://nodes.divi.love/identity/manifest` returns
   `{"identities":[]}`.

## DNS — do BEFORE step 3 (⚠ divi.love is sensitive)

Add **`nodes.divi.love`** on Cloudflare, **proxied (orange cloud)**, pointing at
the scanner. `divi.love`'s existing `autoseeds` and A records **must not be
touched** — they are the network's live DNS seeder (see the divi.love DNS memo).
Add one record; change nothing else.

## Infra security must-dos (from the audit — do at deploy, not optional)

- **Firewall the origin to Cloudflare.** The box must accept :443 only from
  Cloudflare's published IP ranges, so no one can reach the origin directly and
  forge `CF-Connecting-IP`. (The IP is only a map display hint, never auth — but
  still worth closing.) UFW example is in `deploy.sh`, commented, off by default
  because it needs care not to lock out SSH.
- **Confirm Cloudflare strips client `CF-Connecting-IP`.** It does by default;
  verify with a test request carrying a bogus header.
- **Cloudflare rate-limiting rules** on `/identity/publish` and `/identity/media`
  in addition to the origin's own limits. Set in the Cloudflare dashboard.

## After deploy — wire the client

Set `BASE = "https://nodes.divi.love"` in
`ui/src/wallet/identityService.ts`, rebuild DD69. `enabled()` flips true and
publish/read/caching all activate. Then Phase 2 (map names + thumbnails) can be
built and tested end-to-end against real data.

## Rollback

`systemctl disable --now divi-identity`, remove the Caddy block + reload, delete
the `nodes.divi.love` DNS record. Data in `/var/lib/divi-identity` is public and
can be kept or wiped. No other service is affected.
