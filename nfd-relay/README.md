# NFD relay — a run-anywhere Arweave uploader for Divi Collectibles

Upload-only relay that stores **already-encrypted** Divi Collectibles bundles on
Arweave via ArDrive Turbo, paid from a funded Turbo account. The wallet's
`Relay` storage backend (`crates/supervisor/src/nfd_storage.rs`) POSTs here.

- `POST /upload` — body = raw encrypted bundle → `{ "id": "<arweave tx id>" }`
- `GET /health` — `{ ok, balanceWinc }` (watch the funded balance)
- Downloads bypass this service — the wallet fetches `https://arweave.net/<id>`.

## Open-source and not a single point of failure (MIT)

**You do not have to use Divi's uploader.** This is open source (MIT) and
stateless — anyone can run their own copy anywhere. Divi runs one at
`nfds.divi.love` as a free default so minting "just works," but the wallet can be
pointed at **any** uploader URL, or a user can bring their own Arweave key.

This matters: the uploader only touches **encrypted** bundles and a **spending**
key — it can never read anyone's content or steal ownership, so it is safe for
strangers to run. And it is only needed to *mint* (save) new collectibles;
viewing and owning existing ones never touch it (they read straight from
Arweave). **If Divi's uploader ever goes away, nothing is lost** — existing
collectibles stay on Arweave forever, and anyone can stand up a new uploader in
minutes (Docker, a plain server, or Cloudflare — see below).

## One-time: the funded Turbo account (Geoff)

The Turbo wallet can be **Arweave** (a JSON JWK keyfile) or **Ethereum** (a 64-char
hex private key). The relay auto-detects which. Geoff's is an Ethereum wallet.

1. In **https://turbo.ardrive.net**, export the wallet's private key and save it
   to a file (Arweave → the JSON keyfile; Ethereum → the hex string in a `.txt`).
   **Keep it secret** — it controls the funds.
2. Buy **Turbo Credits** for that wallet with a credit card (start ~$10–$25 to
   test). Docs: **https://docs.ardrive.io** (Turbo section).
3. Put the key file on the server (see below); never commit it.

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
