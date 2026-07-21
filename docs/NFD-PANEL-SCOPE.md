# Divi Collectibles panel — build scope

Scope for the three-tab NFD panel in Divi Desktop 6.9: **My Collection**,
**Marketplace**, **NFD Builder**.

⚠ **Ownership:** the NFD workstream (session `3c492e5d`, branch
`feat/nfd-collectibles`) owns the crypto, record codec and storage. This document
scopes the *wallet UI* on top of that. Agree who builds it before anyone starts —
`CollectiblesPanel.tsx` is currently a 34-line placeholder and is the natural
seam.

---

## 0. Current state vs the three-tab target (2026-Jul-21)

The NFD workstream has built a **single working panel** on
`feat/nfd-collectibles` (~592 lines, 15 commits). It is real and proven, not a
stub. What exists, mapped onto the three-tab plan:

| Capability | Built? | Target tab |
|---|---|---|
| Mint a file → NFD | ✅ | NFD Builder |
| Create a collection + mint into it | ✅ | NFD Builder |
| View / decrypt an owned NFD | ✅ | My Collection |
| Transfer (receive-code / claim-code) | ✅ | My Collection |
| Browse a collection + trait rarity | ✅ | Marketplace (browse) |
| Public thumbnails (WebP, ≤500px, Arweave) | ✅ | all |
| Arweave relay (Phase 3) | ✅ | — |
| **Three-tab shell** (Collection / Marketplace / Builder) | ❌ | — |
| **Reusable virtualised grid + lightbox/zoom** | ❌ | all |
| **Sort / filter / favourites / drag-reorder** | ❌ | My Collection |
| **Encrypted-at-rest disk cache** (§2.3) | ❌ | all |
| **Batch mint** (needed for the 240-set) | ❌ | NFD Builder |
| **Marketplace listings + atomic trade** | ❌ | Marketplace |

So the functional flows exist; what is missing is the **presentation layer** the
user asked for — the gallery experience (grid, zoom, sort, favourites, drag) and
the tab structure that organises the existing flows into Collection / Marketplace
/ Builder — plus batch mint, the disk cache, and the marketplace trade mechanism.

**Coordination:** the existing panel is the NFD agent's. The gallery layer (§2.4,
§3 sort/filter/favourites/drag) is separable and could be built as **new,
backend-agnostic components** that the flows plug into, minimising collision. Who
builds the three-tab reorganisation vs the gallery components should be agreed
before either starts — reorganising their 592-line panel is theirs to do.

---

## 1. What already exists

| Piece | Where | State |
|---|---|---|
| Encryption core | `crypto_nfd.rs` | envelope: content AES-256-GCM under a random content key (CK); CK wrapped to owner via X25519→HKDF→AES-GCM. `rewrap()` for transfer. 8 tests. |
| Record codec | `nfd_record.rs` | DVXP type 0x02. Subtypes mint / transfer / key-announce / **collection**. Flags: `ENCRYPTED`, `HAS_THUMB`, `IN_COLLECTION`. |
| Mint + view | `collectibles.rs` | proven end-to-end on regtest |
| Storage | `nfd_storage.rs` | swappable trait; local FS stand-in today, Arweave relay drops in behind the same shape |
| Native opcode | chain `feat/opcodes` | `OP_NFD = 0xbb`, `createnfd` / `verifynfd` |
| Panel | `CollectiblesPanel.tsx` | placeholder text only |

**Three facts from that code drive every UI decision below:**

1. **Only the owner can decrypt.** Full artwork is unreachable for anything you
   don't own. Any grid showing other people's items can only ever show the
   **unencrypted thumbnail** (`FLAG_HAS_THUMB`, `thumb_ptr`).
2. **Transfers are cheap.** Only the wrapped key is re-wrapped; the ciphertext is
   never re-uploaded. Sales and reward drops are light operations.
3. **Rarity already has a home.** `traits_ptr` on a collection mint is public
   metadata — the grid can sort and filter on it without decrypting anything.

---

## 2. Shared infrastructure (build first — all three tabs need it)

**2.1 Image pipeline.** The single biggest performance decision. Never render
full-resolution encrypted art in a grid.

- Grid renders **thumbnails only** (≤500px, unencrypted, public).
- Full art is decrypted **on demand**, when an item is opened or zoomed.
- Deliver bytes to the webview through a **Tauri custom protocol**, not base64
  data URIs — base64 inflates payloads ~33% and blocks the JS thread on decode.

**2.2 Thumbnail cache.** Disk cache keyed by `thumb_ptr`, with an in-memory LRU
on top. Arweave content is immutable, so cache entries never need invalidating —
a genuinely nice property.

**2.3 Decrypted-art cache — DECIDED: cache on disk, encrypted at rest.**

Geoff's call (2026-Jul-20): cache decrypted artwork *and* the user's thumbnails
on disk, so a collection loads fast. The cache is split by what the data actually
is:

| What | Cached how | Why |
|---|---|---|
| **Thumbnails** | plain | already public on Arweave; encrypting them protects nothing and costs speed |
| **Decrypted originals** | **AES-256-GCM at rest** | keeps "only the owner can see it" true even off-machine |

The cache key is a random 256-bit value generated once per install and held in
the **OS credential store** — the `keyring` crate is already a dependency
(macOS Keychain / Windows Credential Manager / Linux Secret Service, see
`security.rs`). AES-GCM runs at gigabytes per second, so the cost is invisible
next to the disk read it replaces.

This matters because plaintext art on disk leaks through paths the user never
thinks about: Time Machine and other backups, cloud-synced folders, a stolen or
resold drive, and any other process on the machine. Encrypting at rest keeps the
product's central claim honest at effectively zero performance cost. Cache is
disposable — on any key or decrypt failure, delete and re-fetch.

**Web version (IndexedDB).** Same split: thumbnails plain, originals encrypted.
A browser has no OS keychain, but it has a good equivalent — a **WebCrypto
`CryptoKey` created with `extractable: false` and stored in IndexedDB**. It
persists across sessions and can decrypt, yet its key material can never be read
back out by JavaScript, so an XSS or a rogue extension cannot exfiltrate it.
Use that rather than keeping raw key bytes in IndexedDB or localStorage.

**2.4 Grid component.** One reusable virtualised grid used by all three tabs:
selectable tiles, keyboard navigation, lazy image loading, skeleton placeholders,
and a lightbox for zoom (fit / 1:1 / pinch, arrow-key paging). Virtualise from
the start — 240 is comfortable, a marketplace is not.

**2.5 Local, chain-free state** (localStorage, no fees): favourites, sort
preference, view density, custom ordering. Namespace `dd69.nfd.*`.

---

## 3. Tab: MY COLLECTION

The only tab that can show real artwork, and the only one with no external
blockers. **Build this first.**

- Grid of owned NFDs from the ownership index, thumbnails first.
- **Sort:** acquired date, mint date, name, rarity (from `traits_ptr`),
  favourites first.
- **Filter:** collection, rarity tier, favourites, "has thumbnail".
- **Favourite** toggle on each tile (local only).
- **Drag and drop to reorder** into a custom arrangement, persisted locally.
- **Detail view:** full decrypted art, traits, mint block/time, provenance chain
  (mint → transfers, read from the chain), Arweave pointer, content hash, and
  the verification result — the decrypted content must hash to the on-chain
  `content_hash`, and the UI should show that check passing.
- **Empty state** that explains how to get one (Lovenode rewards, minting).

**Depends on:** ownership index (exists in v1 as signed records replayed by an
indexer), thumbnails (in flight now).

---

## 4. Tab: NFD BUILDER

Creating NFDs. Moderate size, but **blocked on the Arweave relay** (Phase 3,
needs funding/credentials from Geoff). Everything else can be built against the
local-filesystem storage stand-in.

- **Drag a file in** (or picker). Show dimensions, size, type.
- **Auto-generate the thumbnail** — resize to ≤500px longest edge, strip EXIF by
  default (it can carry GPS; the thumbnail is *public*). Preview it and make
  clear this is the part everyone can see.
- **Metadata:** title, description, traits (key/value, feeding rarity).
- **Collection mode:** create a collection record (subtype 0x04) with
  `max_supply`, then mint into it. This is what a 240-piece set needs, including
  **batch minting** — do not make anyone mint 240 items one at a time.
- **Cost preview** before committing: chain fee + storage bytes.
- **Progress + resumability.** A 240-item batch will fail partway at some point;
  it must resume rather than restart.

**Honest constraint to surface in the UI:** the thumbnail is public forever, and
the encrypted original is permanent and cannot be deleted. Say so before minting.

---

## 5. Tab: MARKETPLACE

**By far the largest, and the only one blocked on things that do not exist yet.**
Do not start here.

**The hard problem is atomicity.** A sale means the seller hands over a re-wrapped
content key while the buyer hands over DIVI. Without a mechanism, someone must go
first and can be cheated. Three options, in order of preference:

1. **Hash-locked (HTLC).** Divi already has a `TX_HTLC` standard template. The
   seller publishes a listing committing to `hash(wrapped_key)`; the buyer pays
   into an HTLC redeemable by revealing the preimage; revealing it to claim the
   money is what delivers the key. Close to atomic, no trusted third party.
   **Recommended — and it uses a template the chain already has.**
2. **Covenant/escrow opcode.** `OP_CTV` is on the chain roadmap but not built.
   Cleaner long-term, blocked today.
3. **Trusted relay escrow.** Simplest, and it reintroduces exactly the custodian
   the project exists to avoid. Only as a stopgap, and label it plainly.

Also required, none of which exists yet:

- **A listing record** (a new DVXP subtype) and node-side or indexer enumeration.
- **A marketplace index** — browsing other people's NFDs means enumerating mints
  and transfers across the whole chain, i.e. real indexer work.
- **Price display** in DIVI and fiat (`divi_prices` exists; note the ~4.5×
  source disagreement documented in the integration guide).

**Suggested staging:** v1 **browse-only** (thumbnails, collections, rarity, owner
address, "not for sale") → v2 listings visible → v3 actual atomic trading.
Browse-only is genuinely useful, ships early, and needs no escrow.

---

## 6. Build order

1. Shared image pipeline + thumbnail cache + grid component (§2)
2. **My Collection** (§3) — real value, no external blockers
3. **NFD Builder** minus upload, against the storage stand-in (§4)
4. Arweave relay lands → Builder goes live *(blocked on Geoff)*
5. **Marketplace** browse-only (§5 v1)
6. Listings, then HTLC trading (§5 v2/v3)

---

## 7. Open questions

1. **Collection exhaustion** — what happens after the 240th reward is claimed?
2. **Rarity schema** — the exact `traits_ptr` shape the grid sorts on. Needs to
   be fixed before the collection is produced, since it is baked into the mints.
3. **Marketplace fee**, if any, and who receives it.
4. **Does the wallet need to show NFDs it can see but not decrypt** (someone
   else's, via thumbnail) outside the marketplace tab?
