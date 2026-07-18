# NFD relay — `nfds.divi.love`

Upload-only relay that stores **already-encrypted** Divi Collectibles bundles on
Arweave via ArDrive Turbo, paid from a Divi-funded Turbo account. The wallet's
`Relay` storage backend (`crates/supervisor/src/nfd_storage.rs`) POSTs here.

- `POST /upload` — body = raw encrypted bundle → `{ "id": "<arweave tx id>" }`
- `GET /health` — `{ ok, balanceWinc }` (watch the funded balance)
- Downloads bypass this service — the wallet fetches `https://arweave.net/<id>`.

## One-time: the funded Arweave account (Geoff)

1. Go to **https://turbo.ardrive.net** and create/download an **Arweave keyfile**
   (a `.json` JWK). **Keep it secret** — it holds the funds.
2. Buy **Turbo Credits** with a credit card (start ~$10–$25 to test). Docs:
   **https://docs.ardrive.io** (Turbo section).
3. Put the keyfile on the server (see below); never commit it.

## Deploy (server for nfds.divi.love)

```
# 1. copy this folder to the server, then:
cd nfd-relay
npm install                      # then VERIFY: npm view @ardrive/turbo-sdk, pin exact versions
export NFD_ARWEAVE_KEY=/secure/path/arweave-key.json   # chmod 600
export NFD_UPLOAD_TOKEN=<a long random secret>         # gates /upload
export PORT=8787
npm start
```

- Front it with **nginx/Caddy for TLS** on `nfds.divi.love` (proxy → :8787).
- Keep it running with systemd / pm2.
- Give me the `NFD_UPLOAD_TOKEN`; the wallet sends it (env `NFD_UPLOAD_TOKEN`),
  and I flip the wallet to relay mode (`NFD_STORAGE=relay`).

## ⚠ Before public launch — anti-abuse (required)

`/upload` spends Divi's funds. The bearer token stops casual abuse but ships
inside the wallet, so it is **not** sufficient for a public release. Before
opening minting to everyone, add real limits: per-user/day caps, a size cap
(already `NFD_MAX_BYTES`), and ideally a signed proof that the requester controls
DIVI. Until then, keep the token secret and watch `GET /health` balance.

## Security

- Verify every dependency before install (official `@ardrive/*`, `express`).
  This handles a funded key — treat the box as sensitive.
- Keyfile `chmod 600`, never in git (`.gitignore` covers `*.json` keys).
- The relay never sees plaintext; bundles are encrypted in the wallet.
