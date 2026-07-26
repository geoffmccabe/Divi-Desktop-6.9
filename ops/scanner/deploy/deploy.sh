#!/bin/bash
# Deploy the Divi node-identity service to the scanner. Idempotent; safe to
# re-run. Run ONLY on Geoff's go-ahead. Does NOT touch DNS or the firewall —
# those are manual (see DEPLOY.md) so a script can't lock you out or clobber the
# sensitive divi.love records.
set -euo pipefail
HOST="${1:-root@109.228.38.104}"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "Deploying divi-identity to $HOST …"

# 1) service code + data dir
scp -q "$HERE/../divi-identity.py" "$HOST:/usr/local/bin/divi-identity.py"
ssh "$HOST" 'chmod +x /usr/local/bin/divi-identity.py; \
  mkdir -p /var/lib/divi-identity; chmod 750 /var/lib/divi-identity'

# 2) systemd unit
scp -q "$HERE/divi-identity.service" "$HOST:/etc/systemd/system/divi-identity.service"
ssh "$HOST" 'systemctl daemon-reload; systemctl enable --now divi-identity.service; sleep 2; \
  systemctl is-active divi-identity.service'

# 3) Caddy route — only append if the hostname isn't already there
ssh "$HOST" 'grep -q "nodes.divi.love" /etc/caddy/Caddyfile 2>/dev/null' \
  && echo "Caddy route already present" \
  || { scp -q "$HERE/Caddyfile.snippet" "$HOST:/tmp/nodes.caddy"; \
       ssh "$HOST" 'cat /tmp/nodes.caddy >> /etc/caddy/Caddyfile; rm /tmp/nodes.caddy; \
                    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy'; }

# 4) local health check (loopback — proves the service answers before DNS/edge)
echo "--- health (loopback) ---"
ssh "$HOST" 'curl -s --max-time 5 http://127.0.0.1:8772/identity/manifest || echo "  no answer"'

cat <<'NOTE'

Service deployed. STILL MANUAL (see DEPLOY.md), on purpose:
  * Add nodes.divi.love on Cloudflare (proxied). Touch NOTHING else on divi.love.
  * Firewall :443 to Cloudflare IPs; confirm CF strips client CF-Connecting-IP.
  * Add Cloudflare rate-limit rules on /identity/publish and /identity/media.
Then set BASE in ui/src/wallet/identityService.ts and rebuild DD69.
NOTE
