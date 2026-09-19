# Community Apps: manifest and permission catalogue

The contract between a community app and the wallet. Written before the code so
the surface is designed once rather than grown by accident.

Companion to `docs/COMMUNITY-APPS-SCOPE.md`. Read section 2 of that document
first; this is the detail underneath it.

---

## 1. What an app is

A directory containing a manifest and a set of files, packaged and signed by us:

```
manifest.json      required, the declaration below
index.html         required, the entry point
*.js / *.css       optional, must be local, no remote references
assets/            optional, images/audio/video used by the app
```

Rules the packager enforces, not suggestions:

- Every reference must be relative and inside the bundle. No absolute URLs, no
  protocol-relative URLs, no CDN.
- No inline event handler attributes (`onclick=` and friends).
- Total bundle size cap, per file and overall.
- The manifest must parse, validate, and match the files actually present.

The bundle is hashed and signed. The wallet verifies the signature before a
single byte is rendered, so an app that we did not sign cannot run, and revoking
a signature disables an app everywhere at once.

---

## 2. The manifest

```json
{
  "schema": 1,
  "id": "com.example.staking-calculator",
  "name": "Staking Calculator",
  "version": "1.2.0",
  "author": { "name": "Alice", "address": "D..." },
  "description": "Work out staking returns over time.",
  "permissions": ["balance.read", "staking.read"],
  "network": [],
  "display": { "immersive": "on-demand", "minWidth": 640 },
  "media": {
    "thumbnail": "assets/thumb.webp",
    "showcase": { "type": "slideshow", "images": ["assets/1.webp", "assets/2.webp"] }
  },
  "price": { "model": "free" }
}
```

| Field | Required | Notes |
|---|---|---|
| `schema` | yes | Integer. Currently `1`. The wallet refuses anything it does not know. |
| `id` | yes | Reverse-domain, lowercase, stable forever. Identity for storage, entitlements and revocation. |
| `name` | yes | Shown in the store. Length capped. |
| `version` | yes | Semver. Must increase on republish. |
| `author.address` | yes | A Divi address. This is the developer's identity and the payout destination. |
| `permissions` | yes | Array from the catalogue below. Empty array is valid and encouraged. |
| `network` | yes | Array of hostnames. Empty array means no network at all, which is the default and the common case. |
| `display.immersive` | no | `never` (default), `on-demand`, or `always`. |
| `media` | yes | See section 5. |
| `price` | yes | See section 6. |

Anything not in this table is rejected. Unknown fields are an error, not a
warning, so a future field cannot be smuggled past an older wallet.

---

## 3. The permission catalogue

Each permission is one line of plain English shown to the user at install time.
The wording below is the wording they see. If a permission cannot be explained in
one honest sentence, it does not belong in the catalogue.

### Read permissions

| Key | Shown to the user | Actually returns |
|---|---|---|
| `balance.read` | "See your DIVI balance" | Spendable, staking, pending and immature totals. No addresses. |
| `addresses.read` | "See your receiving addresses" | The user's own addresses and their labels. No keys. |
| `history.read` | "See your transaction history" | Transactions with amounts, dates, categories and confirmations. |
| `staking.read` | "See your staking and lottery status" | Staking state, per-address stake counts, lottery timing and past wins. |
| `collectibles.read` | "See the collectibles you own" | Owned NFDs: names, traits, tiers, thumbnails. Never the decryption key. |
| `tokens.read` | "See your Divi Meta Token balances" | Token balances and metadata. Stubbed until the DMT indexer exists. |
| `network.read` | "See the Divi network map" | Peer and node data the wallet already displays publicly. |
| `chain.read` | "See recent blocks and chain status" | Block height, recent blocks, sync state. |

### Capability permissions

| Key | Shown to the user | What actually happens |
|---|---|---|
| `storage` | "Save data for this app" | A private key-value store, namespaced per app, size-capped. One app can never read another's. |
| `payment.request` | "Ask you to pay DIVI" | The app requests an amount and a reason. The **wallet** draws a native confirmation outside the app frame and performs the send. The app is told only "paid" or "not paid". Never sees a key, never sees an address it was not given. |
| `network` | "Connect to the internet" | Only the hostnames listed in `network`. Brokered through the host so every request is logged and can be revoked. |
| `clipboard.write` | "Copy things to your clipboard" | Write only. An app can never read the clipboard. |
| `notify` | "Show you notifications" | In-app only, rate limited. |

### Not in the catalogue, and never will be

Private keys, the seed phrase, WIF export, the wallet passphrase, unlocking or
locking, raw node RPC, node start/stop/config, the filesystem, arbitrary sends
without confirmation, another app's storage, our service credentials, and the
user's real IP address.

These are not "not yet". There is no manifest value that produces them.

---

## 4. How an app talks to the wallet

The app never sees Tauri. Inside the frame it gets one object with one method,
which returns a promise:

```js
const balance = await divi.request("balance.read");
const ok = await divi.request("payment.request", { amount: 5, reason: "Unlock pro" });
```

On the host side the broker:

1. Checks the app is signed and currently allowed to run.
2. Checks the method is in the catalogue.
3. Checks the app declared that permission and the user granted it.
4. Applies rate and size limits for that method.
5. Executes it, and logs the call with app id, method, timestamp and outcome.

A call that fails any check is rejected with a reason. There is no path from a
frame message to a Tauri command that does not pass through those five steps.

**Payment is deliberately awkward.** `payment.request` does not send anything. It
raises a confirmation the wallet draws itself, outside the frame, showing the
amount, the recipient and which app asked. The user confirms or refuses. Per-app
and per-day caps apply on top, and every request is recorded whether or not it
was approved.

---

## 5. Media

The store card is 3:2. One of:

| `showcase.type` | Fields | Notes |
|---|---|---|
| `image` | `image` | A single WebP. |
| `slideshow` | `images[]` | WebP frames, cross-faded, paused when off-screen. |
| `video` | `video` | MP4 or WebM, hard cap 20 MB, muted, loops, plays only while visible. |
| `youtube` | `youtubeId` | Click to load. Nothing is fetched from Google until the user presses play. |

`thumbnail` is always required and always local to the bundle, so the grid can
render with no network at all.

---

## 6. Price

| `price.model` | Fields | Meaning |
|---|---|---|
| `free` | none | No charge. |
| `purchase` | `amount` | One-time DIVI purchase, unlocks permanently for that address. |
| `in-app` | none | Free to install; the app charges through `payment.request`. |

An app declaring `purchase` or `in-app` must also declare `payment.request` in
its permissions, and the store shows the price before install, not after.

Entitlements are recorded against the buyer's address and verified by us. An app
asking "has this person paid" is answered by the wallet, never by the app's own
claim.

---

## 7. Versioning and revocation

- `schema` gates the whole format. An unknown schema is refused outright.
- A new `version` is a new signature and a new review.
- A permission added in an update requires fresh consent. Silent escalation is
  not possible, because the granted set is stored per app and compared on load.
- Revocation is a signed denylist the wallet honours before running anything,
  the same pattern already used for collectibles moderation.
