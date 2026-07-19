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

const app = express();
app.disable('x-powered-by');
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
  if (TOKEN && req.get('authorization') !== `Bearer ${TOKEN}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const data = req.body;
  if (!Buffer.isBuffer(data) || data.length === 0) {
    return res.status(400).json({ error: 'empty or invalid body' });
  }
  try {
    const { id } = await turbo.uploadFile({
      fileStreamFactory: () => Readable.from(data),
      fileSizeFactory: () => data.length,
      dataItemOpts: {
        tags: [
          { name: 'App-Name', value: 'DiviCollectibles' },
          { name: 'Content-Type', value: 'application/octet-stream' },
        ],
      },
    });
    res.json({ id });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.listen(PORT, () => console.log(`NFD relay listening on :${PORT} (max ${MAX_BYTES} bytes)`));
