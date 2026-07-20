// NFD (Divi Collectibles) Arweave upload relay — runs at nfds.divi.love.
//
// The wallet encrypts a collectible locally and POSTs the ENCRYPTED bundle here;
// this service uploads it to Arweave via ArDrive Turbo, paid from the Divi-funded
// Turbo account, and returns the permanent Arweave id. It never sees plaintext.
//
// Downloads do NOT go through here — the wallet fetches directly from a public
// Arweave gateway (arweave.net/<id>). This service is upload-only.
//
// Env:
//   NFD_ARWEAVE_KEY   REQUIRED — path to the funded key file: either an Arweave
//                     JWK keyfile (JSON) or an Ethereum private key (hex).
//   PORT              listen port (default 8787; put TLS/nginx in front)
//   NFD_MAX_BYTES     max bundle size (default 5 MiB)
//   NFD_UPLOAD_TOKEN  if set, require `Authorization: Bearer <token>` on /upload
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
  console.error('NFD_ARWEAVE_KEY must point to the Arweave JWK keyfile.');
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

// ── Abuse protection: per-IP daily quota over the funded pool ────────────────
const MAX_UPLOADS_PER_DAY = Number(process.env.NFD_MAX_UPLOADS_PER_DAY || 50);
const MAX_BYTES_PER_DAY = Number(process.env.NFD_MAX_BYTES_PER_DAY || 50 * 1024 * 1024);
const DAY_MS = 24 * 60 * 60 * 1000;
const buckets = new Map(); // ip -> { count, bytes, resetAt }
function rateOk(ip, size) {
  const now = Date.now();
  if (buckets.size > 50000) buckets.clear(); // crude cap; resets counters
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
function tokenOk(header) {
  if (!TOKEN) return true;
  const expected = `Bearer ${TOKEN}`;
  const got = header || '';
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // behind the TLS reverse proxy: use the real client IP
app.use(express.raw({ type: '*/*', limit: MAX_BYTES }));

// Liveness + remaining balance (so we can watch the funded pool).
app.get('/health', async (_req, res) => {
  try {
    const { winc } = await turbo.getBalance();
    res.json({ ok: true, balanceWinc: winc });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/upload', async (req, res) => {
  if (!tokenOk(req.get('authorization'))) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const data = req.body;
  if (!Buffer.isBuffer(data) || data.length === 0) {
    return res.status(400).json({ error: 'empty or invalid body' });
  }
  if (!rateOk(req.ip, data.length)) {
    return res.status(429).json({ error: 'rate limit exceeded' });
  }
  // Whitelist content types. Thumbnails are WebP-only and bundles are opaque;
  // anything else (e.g. image/svg+xml, text/html) could be served by a gateway
  // as executable content and run script in a viewer — reject it.
  // octet-stream = encrypted bundle; image/webp = preview; application/json =
  // public collection/traits metadata. JSON is not executable, so it's safe.
  const ALLOWED_TYPES = new Set(['application/octet-stream', 'image/webp', 'application/json']);
  const contentType = req.get('content-type') || 'application/octet-stream';
  if (!ALLOWED_TYPES.has(contentType)) {
    return res.status(415).json({ error: 'unsupported content-type' });
  }
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
    res.json({ id });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.listen(PORT, () => console.log(`NFD relay listening on :${PORT} (max ${MAX_BYTES} bytes)`));
