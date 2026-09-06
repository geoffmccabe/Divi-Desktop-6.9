// NFD (Divi Collectibles) Arweave upload relay — runs at nfds.divi.love.
//
// The wallet encrypts a collectible locally and POSTs the ENCRYPTED bundle here;
// this service uploads it to Arweave via ArDrive Turbo, paid from the Divi-funded
// Turbo account, and returns the permanent Arweave id. It never sees plaintext.
//
// Downloads do NOT go through here — the wallet fetches directly from a public
// Arweave gateway (arweave.net/<id>). This service is upload-only.
//
// SECURITY MODEL (see docs/NFD-MODERATION.md): this relay is the ONLY trust
// boundary. All client-side checks (thumbnail/EXIF/type in the wallet) are
// cosmetic — an attacker can POST here directly. Every byte is attacker-
// controlled and every upload is permanent, irreversible spend of our funds.
// Defenses here: fail-closed auth, a global daily spend cap, a balance-floor
// kill-switch, real magic-byte validation, per-IP + concurrency limits.
//
// Env:
//   NFD_ARWEAVE_KEY   REQUIRED — funded key file: Arweave JWK (JSON) or ETH hex.
//   NFD_UPLOAD_TOKEN  REQUIRED — bearer token; without it /upload is disabled.
//   PORT              listen port (default 8787; put TLS/nginx in front)
//   NFD_MAX_BYTES     max single bundle (default 5 MiB)
//   NFD_MAX_BYTES_PER_DAY        per-IP daily bytes (default 50 MiB)
//   NFD_MAX_UPLOADS_PER_DAY      per-IP daily count (default 50)
//   NFD_GLOBAL_MAX_BYTES_PER_DAY global daily bytes across ALL IPs (default 500 MiB)
//   NFD_MIN_BALANCE_WINC         refuse uploads below this pool balance (default 0 = off)
//   NFD_MAX_CONCURRENT           in-flight uploads (default 4)
import express from 'express';
import fs from 'fs';
import { Readable } from 'node:stream';
import { TurboFactory } from '@ardrive/turbo-sdk';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const MAX_BYTES = Number(process.env.NFD_MAX_BYTES || 5 * 1024 * 1024);
const KEY_PATH = process.env.NFD_ARWEAVE_KEY;
const TOKEN = process.env.NFD_UPLOAD_TOKEN || '';

if (!KEY_PATH) {
  console.error('FATAL: NFD_ARWEAVE_KEY must point to the funded key file.');
  process.exit(1);
}
// Fail closed: a funded, permanent-write endpoint must never run unauthenticated.
if (!TOKEN) {
  console.error('FATAL: NFD_UPLOAD_TOKEN is not set — refusing to start an open money faucet.');
  process.exit(1);
}

// The funded account may be an Arweave keyfile (JSON JWK) or an Ethereum
// private key (hex). Auto-detect so either works.
const rawKey = fs.readFileSync(KEY_PATH, 'utf-8').trim();
let turbo;
try {
  const jwk = JSON.parse(rawKey); // Arweave keyfile
  turbo = TurboFactory.authenticated({ privateKey: jwk });
  console.log('auth: Arweave keyfile');
} catch {
  const pk = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`; // Ethereum hex key
  turbo = TurboFactory.authenticated({ privateKey: pk, token: 'ethereum' });
  console.log('auth: Ethereum key');
}

// ── Per-IP daily quota ───────────────────────────────────────────────────────
const MAX_UPLOADS_PER_DAY = Number(process.env.NFD_MAX_UPLOADS_PER_DAY || 50);
const MAX_BYTES_PER_DAY = Number(process.env.NFD_MAX_BYTES_PER_DAY || 50 * 1024 * 1024);
const MAX_BUCKETS = 50000;
const DAY_MS = 24 * 60 * 60 * 1000;
const buckets = new Map(); // ip -> { count, bytes, resetAt }

function evictExpired(now) {
  for (const [ip, b] of buckets) if (now >= b.resetAt) buckets.delete(ip);
}
function rateOk(ip, size) {
  const now = Date.now();
  if (buckets.size > MAX_BUCKETS) evictExpired(now);
  // Never clear everyone (that resets attackers too). If still full, fail closed
  // for NEW ips; existing ones keep their counters.
  if (buckets.size > MAX_BUCKETS && !buckets.has(ip)) return false;
  let b = buckets.get(ip);
  if (!b || now >= b.resetAt) {
    b = { count: 0, bytes: 0, resetAt: now + DAY_MS };
    buckets.set(ip, b);
  }
  if (b.count >= MAX_UPLOADS_PER_DAY || b.bytes + size > MAX_BYTES_PER_DAY) return false;
  b.count += 1;
  b.bytes += size;
  return true;
}

// ── Global daily spend cap (bounds worst case across all IPs) ─────────────────
const GLOBAL_MAX_BYTES_PER_DAY = Number(process.env.NFD_GLOBAL_MAX_BYTES_PER_DAY || 500 * 1024 * 1024);
let globalDay = { bytes: 0, resetAt: Date.now() + DAY_MS };
function globalOk(size) {
  const now = Date.now();
  if (now >= globalDay.resetAt) globalDay = { bytes: 0, resetAt: now + DAY_MS };
  if (globalDay.bytes + size > GLOBAL_MAX_BYTES_PER_DAY) return false;
  globalDay.bytes += size;
  return true;
}

// ── Balance-floor kill-switch (cached; refreshed at most once a minute) ───────
const MIN_BALANCE_WINC = BigInt(process.env.NFD_MIN_BALANCE_WINC || '0');
let balCache = { winc: null, at: 0 };
async function balanceWinc() {
  const now = Date.now();
  if (balCache.winc !== null && now - balCache.at < 60000) return balCache.winc;
  const { winc } = await turbo.getBalance();
  balCache = { winc: BigInt(winc), at: now };
  return balCache.winc;
}

// ── Concurrency limit (each in-flight upload is real money + memory) ──────────
const MAX_CONCURRENT = Number(process.env.NFD_MAX_CONCURRENT || 4);
let inFlight = 0;

function tokenOk(header) {
  const expected = `Bearer ${TOKEN}`;
  const got = header || '';
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

// Validate ACTUAL bytes against the declared type — the header is attacker-
// controlled, so the whitelist alone proves nothing. octet-stream is the opaque
// encrypted bundle (nothing to validate, and never displayed).
const MAX_JSON_BYTES = 64 * 1024;
function bytesValid(contentType, buf) {
  if (contentType === 'application/octet-stream') return true;
  if (contentType === 'image/webp') {
    // RIFF....WEBP container header.
    return buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  }
  if (contentType === 'application/json') {
    if (buf.length > MAX_JSON_BYTES) return false;
    try { JSON.parse(buf.toString('utf8')); return true; } catch { return false; }
  }
  return false;
}

const app = express();
app.disable('x-powered-by');
// Trust exactly ONE proxy hop (our nginx), which MUST overwrite X-Forwarded-For
// with the real client IP. `true` would trust an attacker-supplied XFF and
// defeat the per-IP limit entirely.
app.set('trust proxy', 1);
app.use(express.raw({ type: '*/*', limit: MAX_BYTES }));

// Liveness only. Balance is sensitive (it sizes a drain) — gate it behind auth.
app.get('/health', async (req, res) => {
  if (!tokenOk(req.get('authorization'))) return res.json({ ok: true });
  try {
    const winc = await balanceWinc();
    res.json({ ok: true, balanceWinc: winc.toString() });
  } catch {
    res.status(500).json({ ok: false });
  }
});

app.post('/upload', async (req, res) => {
  if (!tokenOk(req.get('authorization'))) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (inFlight >= MAX_CONCURRENT) {
    return res.status(503).json({ error: 'busy' });
  }
  const data = req.body;
  if (!Buffer.isBuffer(data) || data.length === 0) {
    return res.status(400).json({ error: 'empty or invalid body' });
  }
  const contentType = req.get('content-type') || 'application/octet-stream';
  const ALLOWED_TYPES = new Set(['application/octet-stream', 'image/webp', 'application/json']);
  if (!ALLOWED_TYPES.has(contentType)) {
    return res.status(415).json({ error: 'unsupported content-type' });
  }
  if (!bytesValid(contentType, data)) {
    return res.status(415).json({ error: 'content does not match its declared type' });
  }
  // Spend guards: per-IP, then global daily cap, then balance floor.
  if (!rateOk(req.ip, data.length)) {
    return res.status(429).json({ error: 'rate limit exceeded' });
  }
  if (!globalOk(data.length)) {
    return res.status(429).json({ error: 'daily capacity reached' });
  }
  if (MIN_BALANCE_WINC > 0n) {
    try {
      if ((await balanceWinc()) < MIN_BALANCE_WINC) return res.status(503).json({ error: 'temporarily unavailable' });
    } catch {
      return res.status(503).json({ error: 'temporarily unavailable' });
    }
  }
  inFlight += 1;
  try {
    const { id } = await turbo.uploadFile({
      fileStreamFactory: () => Readable.from(data),
      fileSizeFactory: () => data.length,
      dataItemOpts: {
        tags: [
          { name: 'App-Name', value: 'DiviCollectibles' },
          { name: 'Content-Type', value: contentType },
        ],
      },
    });
    balCache.winc = null; // invalidate; balance changed
    res.json({ id });
  } catch (e) {
    console.error('upload failed:', e); // detail stays server-side
    res.status(500).json({ error: 'upload failed' });
  } finally {
    inFlight -= 1;
  }
});

app.listen(PORT, () => console.log(`NFD relay listening on :${PORT} (max ${MAX_BYTES} bytes)`));
