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

**Match how `ai.divi.love` already works**: it's an **A record → 109.228.38.104,
DNS-only (grey cloud)**. Caddy terminates TLS directly with Let's Encrypt.

So add **`nodes.divi.love` = A → 109.228.38.104, DNS-only (grey cloud)** — the
same shape as `ai.divi.love`. Grey cloud matters: Caddy's HTTP-01 cert challenge
needs port 80 reachable directly, which a proxied (orange) record would break.

`divi.love`'s existing `autoseeds` and A records **must not be touched** — they
are the network's live DNS seeder. Add one record; change nothing else.

## Security posture (corrected — this box is NOT behind Cloudflare's proxy)

Because it's DNS-only, there is **no Cloudflare edge** (no WAF, no edge
rate-limiting, no DDoS scrubbing) in front of this service. Consequences:

- **The origin's own rate limiting is the only automated defence** — which is
  exactly why the service ships with per-key/per-IP limits and a media quota.
- **`CF-Connecting-IP` is moot here** — with no CF proxy the header isn't set, so
  `_client_ip()` correctly uses the real socket IP. No spoofing concern in this
  mode.
- **The origin IP is already public** (same as `ai.divi.love`), so there's
  nothing to hide by firewalling — don't bother with a CF-range firewall unless
  you later switch to proxied.

**Optional later hardening (only if abuse appears):** switch `nodes.divi.love`
to proxied (orange), reconfigure Caddy to use the DNS-01 challenge or a
Cloudflare Origin cert, add Cloudflare rate-limit rules, and firewall :443 to CF
ranges. Not needed for launch.

## After deploy — wire the client

Set `BASE = "https://nodes.divi.love"` in
`ui/src/wallet/identityService.ts`, rebuild DD69. `enabled()` flips true and
publish/read/caching all activate. Then Phase 2 (map names + thumbnails) can be
built and tested end-to-end against real data.

## Rollback

`systemctl disable --now divi-identity`, remove the Caddy block + reload, delete
the `nodes.divi.love` DNS record. Data in `/var/lib/divi-identity` is public and
can be kept or wiped. No other service is affected.
