# Perc set shape + art lifecycle (anti-spoiler, collect-them-all)

Owner: DD69 NFD agent. Audience: all four Perc-launch agents (Kinet.ink, GoBanq,
DD69, DiviGo). Date: 2026-Oct-28. Supersedes the single-UR assumptions in
`NFD-REVEAL-UR.md` §3 (the art library / rarity config shape). The fair-roll
engine in `crates/supervisor/src/reveal.rs` is kept and generalised, not replaced.

This is a design + implementation plan, driven by Geoff's 2026-Oct-28 direction.
It exists because the art side of an NFT drop is the usual failure mode: art that
only the launcher can see, art that is trivially scraped and spoils the reveals,
and no public sense of "what is there to collect". All three are fixed here.

---

## 1. The problem, stated

Today (verified in code):
- The set JSON is an **art library + rarity config** with ONE ultra-rare
  dimension (`NFD-REVEAL-UR.md` §3). On-chain, a collection stores four numbers:
  `tier_count, ur_basic_ppm, ur_progressive_ppm, ur_count`
  (`crates/supervisor/src/nfd_record.rs:181`, encoded :182).
- The tier -> art URL map is learned **only on the launching device**, at launch,
  and saved in that browser's localStorage
  (`ui/src/wallet/CollectionImport.tsx:122` -> `setTierArtManifest`). No other
  device, buyer, gallery, or the mini-app can find the art. Everyone else sees
  colour badges.
- The launch bundle hands the **entire** art library (every tier, every UR) to
  storage at once. If that library is public, the whole set is scrapeable and
  every reveal is spoiled before anyone opens a pack.

Three things must be true instead:
1. **Discovery is the game.** Unrevealed tiers/URs are never viewable by anyone.
   The first person in the world to reveal a given tier unlocks that art for
   everyone — that is the "first to uncover" moment worth sharing.
2. **Everyone can see the whole set as placeholders** — like a video-game
   achievement grid — so collectors know what exists and can "collect them all".
3. **Fast everywhere.** Revealed art loads instantly in any app, on any device,
   without walking Arweave.

---

## 2. Three renditions of art, three homes

Per **tier** (and per UR-set tier). Percs of a tier share one artwork, so these
are per-tier, not per-item.

| Rendition | Who may see it | Where it lives | When released |
| --- | --- | --- | --- |
| **Placeholder** (sealed / "unrevealed" art) | Everyone, always | In the set manifest (see §4); cached client-side | At launch |
| **Revealed thumbnail** (lower-res WebP) | An **owner** of that tier, and anyone viewing it **listed for sale** | GoBanq (served via its own Cloudflare CDN on request); cached client-side (IndexedDB) | Stops being secret in GoBanq after the first on-chain reveal — but is only ever **shown in context** (owned, or for sale). Never auto-broadcast; the owner may choose to share it |
| **Full-size master** (an image now; a video or interactive HTML in future) | Only an **owner** of that tier | Encrypted on Arweave / DiviStorage; owner decrypts + may cache locally | Never public unless the owner shares their own copy |

Hard rules:
- The full-size master is **never** stored unencrypted, and **never** in GoBanq or
  any shared service. GoBanq only ever holds the placeholder and the lower-res
  revealed thumbnail (WebP).
- Before the chain shows a tier has been revealed at least once, nothing anywhere
  returns its art — apps show the placeholder. This is the anti-spoiler guarantee
  (§5), enforced by the release trigger, not by hoping clients behave.
- **A reveal is not a broadcast.** After the first reveal, the thumbnail simply
  stops being secret inside GoBanq; it is surfaced only where there is a reason to
  (the owner's own view, or a for-sale listing). It is NOT pushed to any open
  public gallery or feed. Telling the world is the new owner's choice.
- **A reveal changes nothing in Arweave / DiviStorage.** The encrypted master was
  stored at launch and is untouched; reveal only lets GoBanq surface the thumbnail
  it already held.
- A placeholder may be one generic sealed image for the whole set, or one per UR
  set (a distinct silhouette per set reads better in the grid). Creator's choice.

### 2.1 Per-UR-set placeholder + default generation (decided 2026-Oct-28)

Kinet.ink gives the creator a placeholder slot **per UR set** (and one for the
base set). If a UR set's placeholder is left empty, Kinet.ink auto-generates it at
export, baked into the package like all other art:

- Take the **base set's T1 image** as the subject.
- Layer it on a **grey-gold background**.
- Overlay, **centered both vertically and horizontally**, three lines of text:
  1. `ULTRA RARE`
  2. `SET [N]`  — where `[N]` is the UR set's number, shown **only when the set
     has more than one UR set** (a single-UR-set collection omits this line).
  3. `[UR SET NAME]`
- If the name is too long for one line, wrap it so the block becomes four lines;
  keep the whole block centered.

This default means every set always has a legible placeholder for every UR set,
even if the creator does nothing. The generated image is a normal placeholder
(public at launch, §2) and travels through storage like any other.

### 2.2 Selling UNREVEALED packs + the guaranteed-tier badge (Geoff, 2026-Oct-28)

Owners can list a **sealed (unrevealed)** pack for sale, not just revealed cards.
A sealed listing shows the set's **packaged art** (never any tier art — nothing is
revealed), plus:

- **Nothing opened, no guarantee:** a freshly minted sealed pack shows just
  "PACKAGED / SEALED". Its tier is unknown to everyone, including the seller.
- **Forged packs carry a guaranteed floor:** forging two tier-T cards guarantees a
  result of at least **T+1** (the halving bump is always ≥ 1, capped at 40 —
  `crates/nfd-indexer/src/lib.rs:43`). The two inputs are on-chain, so the floor is
  **trustless**: the listing (and the grid) show a badge like **"TIER 4+"** —
  guaranteed Tier 4 or higher, with a chance of Ultra Rare. This is a real,
  verifiable "this one is guaranteed rarer" hook that makes buying sealed fun.

A for-sale listing is **public**: everyone browsing that market sees the packaged
art + the floor badge (for sealed) or the revealed thumbnail (for revealed). Being
listed is what makes a revealed thumbnail visible to non-owners (§2, §5).

**DESIGN CHANGE this needs (decision for Geoff):** today a forged pack
**auto-opens** ~6 blocks (FORGE_DELAY) after forging (`resolve_due`,
`crates/nfd-indexer/src/lib.rs:1058`), so there is no lasting sealed-but-guaranteed
pack to trade. To make a forged pack a sellable good, forging must instead create
a **sealed pack that stays sealed until its owner (or the buyer after purchase)
chooses to open it**, recording the guaranteed floor (input_tier + 1) on-chain at
forge time. The fair roll then happens at that later open, committing to a future
block exactly like opening a minted pack — ungrindable, and the result is always ≥
the recorded floor. (Recommended; it is the only way the "sell a guaranteed TIER 4+
pack" mechanic can exist.)

Also required: a sealed pack must be **listable without opening it**. Today tapping
a sealed pack in the app starts a reveal; selling one needs a separate path that
never triggers the roll.

---

## 3. The public set shape (the "collect them all" spec)

The outside world must know the full shape of a set without seeing its art. A set
is:

- **Base tiers:** a count `baseTierCount` (e.g. 30) + the base rarity factor.
- **Ultra-rare sets:** an ordered list, least-rare first, each with:
  - `name` (e.g. "Gold", "Diamond", "Mythic"),
  - `tierCount` (how many tiers in that set, e.g. 12),
  - `chancePpm` (gate into this set) and `factorPpm` (the within-set halving
    curve), both parts-per-million integers.
- **Placeholder art** for base + each UR set.

So a set is fully described to a gallery as: 30 base slots + Gold[12] + Diamond[6]
+ ... Each slot is one cell in the achievement grid; a cell shows the revealed
thumbnail if that tier has been discovered, else the placeholder.

This replaces the single `ultraRare{chance,factor,count}` with an **array** of
named UR sets. A set with no URs is the array empty. One UR set reproduces today's
behaviour exactly.

---

## 4. Where the shape and art pointers live

Split by who must trust it:

- **On-chain (COLLECTION-CREATE, subtype 0x04), structural counts only** — the
  numbers the reveal/forge math needs AND that the public must be able to trust
  without asking anyone: `baseTierCount`, base factor, and for each UR set
  `(tierCount, chancePpm, factorPpm)`. Plus a 32-byte **set-manifest pointer**
  (Arweave id). This is a v2 of the record; today's four-number form is v1.
  Touches `nfd_record.rs` (encode), the indexer's collection-create parse,
  `reveal.rs` (roll), forge UR handling, and the create form + importer.
- **Set manifest (Arweave, immutable, pointed to on-chain)** — human data + art
  that is safe at launch: UR-set **names**, placeholder art URLs, and the base
  factor/labels. It does NOT contain unrevealed tier art. Anyone can read it to
  render the full placeholder grid.
- **Discovered-art index (GoBanq, live)** — a per-collection map
  `tier/UR-slot -> revealed thumbnail CDN URL`, that GROWS as the chain shows
  first-reveals. Apps read this to fill in discovered cells. GoBanq is the natural
  owner: it already watches the chain and holds the thumbnails.

Why not put the whole tier->art map on-chain or in the manifest? Because that is
the spoiler. On-chain = counts + pointer; manifest = names + placeholders;
revealed art = released over time via GoBanq.

---

## 5. The release trigger (anti-spoiler, enforced)

1. At launch, Kinet.ink hands GoBanq the full art set. GoBanq stores:
   - placeholder(s) -> public immediately (in/next to the manifest),
   - revealed thumbnails (WebP) -> **held secret**, keyed by tier / UR slot,
   - full-size masters -> **encrypted** on Arweave, owner-decryptable only (GoBanq
     keeps no plaintext and never holds the master).
2. DD69's indexer resolves a REVEAL on-chain (it already does this trustlessly).
   The resolved tier / UR-set / UR-tier is on-chain and public.
3. GoBanq watches reveals. On the **first** reveal of a tier/slot, that slot's
   thumbnail stops being secret: GoBanq will serve it, but **only in context** — to
   an owner of that tier, or on a for-sale listing of such an item. It is NOT
   published to any open gallery or feed, and Arweave is untouched.
4. The new owner may choose to show their art to the world; nothing does that
   automatically.
5. Anything never revealed stays secret forever. No endpoint and no Arweave object
   returns viewable art for an un-revealed tier.

So "first to uncover tier K / an Ultra Rare" is a real, chain-provable event, but
the art spreads only as owners choose to show it — discovery stays a social act,
not an automatic dump.

## 6. Client caching (speed)

- **Thumbnails + placeholders:** cache as blobs in **IndexedDB** per collection
  (not localStorage — these are binary and can be many MB). Key by collection +
  slot. Serve from cache first, revalidate against the discovered-art index in the
  background. Replaces the localStorage URL-only manifest for images; the small
  tier->URL map may stay in localStorage, but the bytes go to IndexedDB.
- **Owner full-size:** after an owner decrypts their tier's master, cache the
  plaintext blob in IndexedDB on that device only, so re-opening is instant. Never
  sync it anywhere.

## 7. Discovery, completeness, and (later) leaderboards

Every mint, transfer, reveal and forge is on-chain, so all of the following are
derivable with no new trust assumptions. **Build now: only the data access.**
Leaderboards/awards themselves are NOT in this round (Geoff, 2026-Oct-28); we only
make sure the data is reachable so they can be built later.
- **A holder's completeness** (build now) — distinct base tiers + UR slots owned,
  over the set shape (§3): "18 / 30 base, Gold 4 / 12". Drives the per-holder
  "collect them all" progress + grid.
- **First-revealer per slot** (data only) — the address whose reveal first
  uncovered each slot is already on-chain; just make sure the reads expose it.
  Powers future "first to uncover" credit.
- **Leaderboards / awards** (later, not now) — rank holders by completeness or
  rarest slot. The on-chain data above is all they will need.

---

## 8. Task lists by agent

Contracts that must bump + be announced in all four coordination docs: Launch
Package (Kinet.ink, #1), Normalized Collection Spec (GoBanq, #2), GoBanq facade
(#3), NFD API / chain record (DD69, #5). Do them in the §9 phase order: the set
shape is on-chain and immutable per collection, so Phase 1 (shape agreed) gates
the rest.

### 8.1 Kinet.ink task list (Launch Package, contract #1)
- [ ] K1. Add the §3 set shape to the launch package: `baseTierCount`, base rarity
  factor, and an ordered `ultraRareSets[]` of `{name, tierCount, chancePpm,
  factorPpm}` (least-rare first). Empty array = no URs; one entry = today's
  behaviour.
- [ ] K2. Add a **placeholder art slot per UR set** (and one for the base set) to
  the perc-maker UI and the export.
- [ ] K3. **Auto-generate a UR-set placeholder when the slot is empty** (§2.1):
  base-set T1 image on a grey-gold background, with centered text
  `ULTRA RARE` / `SET [N]` / `[UR SET NAME]` (the `SET [N]` line only when there is
  more than one UR set; wrap the name to a 4th line if needed). Bake it at export
  like other art (reuse the `PackagedArtPanel` canvas technique).
- [ ] K4. Mark each exported art URL by **rendition** — placeholder, revealed
  thumbnail (web-res), or full-size master — so GoBanq files each in the right
  home (§2). Flatten/composite as today.
- [ ] K5. Publish the updated v4 schema + a sample fixture in `kinetink/docs/`.

### 8.2 GoBanq task list (Normalized Spec #2, facade #3)
- [ ] G1. Carry the §3 set shape through the Normalized Collection Spec (names +
  counts + per-UR-set rarity dials).
- [ ] G2. Store the three renditions per §2: placeholders public; revealed
  thumbnails held **private** until release; full-size masters **encrypted**, with
  **no plaintext ever** kept by GoBanq.
- [ ] G3. Build the **set manifest** (Arweave, immutable): UR-set names, base
  factor, placeholder art — no unrevealed tier art. Hand its id back so DD69 can
  store the 32-byte pointer on-chain.
- [ ] G4. **Release trigger (§5):** watch DD69's on-chain reveals; on the first
  reveal of a tier/UR-slot, mark that slot's thumbnail no longer secret. Serve it
  **only in context** — to an owner of that tier, or on a for-sale listing — via
  GoBanq's own Cloudflare CDN. Do NOT publish it to any open gallery/feed, and
  leave Arweave untouched.
- [ ] G5. Expose reads for apps (data only — no leaderboard is built now, §7): per
  slot "released? + its in-context thumbnail URL", a holder-completeness read
  (holder -> slots owned over the set shape), and the on-chain first-revealer per
  slot.
- [ ] G6. For **sealed** items in the catalog / for-sale reads, include the packaged
  art + the guaranteed floor from chain (so apps can show "TIER N+"); for revealed
  for-sale items include the in-context thumbnail (§2.2).

### 8.3 DD69 task list (chain record #5 + the app) — this repo
- [ ] D1. **COLLECTION-CREATE v2 record:** base tier count + base factor + per-UR-
  set `(tierCount, chancePpm, factorPpm)` + a 32-byte set-manifest pointer. Encode
  in `crates/supervisor/src/nfd_record.rs`; keep v1 (four-number) parse for old
  records.
- [ ] D2. Indexer: parse the v2 rarity shape into the ledger
  (`crates/nfd-indexer/src/lib.rs` collection-create apply) and expose the full
  shape on the collection read (`crates/dvxp-scan/src/query.rs`,
  `crates/supervisor/src/nfd_scan.rs`).
- [ ] D3. **Generalise the reveal roll** to a cascade of named UR sets in
  `crates/supervisor/src/reveal.rs` (each set = one more gate + within-set curve;
  the one-set engine extends naturally). Update forge's UR handling to match.
- [ ] D4. Importer + create form: read/write the v2 shape and the per-UR-set
  placeholders (`crates/supervisor/src/collectibles_import.rs`,
  `ui/src/wallet/CollectionImport.tsx`, the create form in `CollectiblesPanel.tsx`).
- [ ] D5. **Art source fix:** stop depending on the launching device's local
  manifest as the only art source. Read the set manifest (shape + placeholders)
  and GoBanq's discovered-art index on load, on every device.
- [ ] D6. **Collect-them-all grid:** render the whole set (base tiers + each named
  UR set) as a placeholder achievement grid; fill a cell with real art only where
  there is a reason to (the viewer owns it, or it is for sale) — placeholder
  otherwise; show a per-holder completeness bar.
- [ ] D7. **Client cache (§6):** cache thumbnails (WebP) + placeholders as blobs in
  IndexedDB; cache an owner's decrypted full-size locally only.
- [ ] D8. Owner full-size path: decrypt + view the master (an image today; keep the
  viewer ready for video / interactive-HTML master types later) + an optional
  "share my copy" the owner triggers (the only path that shows new art to others).
- [ ] D9. **Forge produces a tradeable sealed pack** (if §2.2 is approved): stop
  auto-opening forge results; create a sealed pack that records the guaranteed
  floor (input_tier + 1) on-chain; make opening it a separate owner/buyer action
  with its own future-block roll (reuse the reveal path); result always ≥ floor
  (`crates/nfd-indexer/src/lib.rs` apply_forge + resolve_due + the reveal path).
- [ ] D10. Expose on the chain read, for a sealed pack: whether it is a forge result
  and its guaranteed minimum tier (floor) — trustless, from the forge inputs
  (`crates/dvxp-scan/src/query.rs`, `crates/supervisor/src/nfd_scan.rs`, UI
  `NfdChainItem`).
- [ ] D11. UI: list a sealed pack for sale **without opening it** (a sell path that
  never triggers the roll); show packaged art + a "TIER N+" floor badge on sealed
  listings and in the grid; confirm `apply_list` allows a not-opening sealed pack.

### 8.4 DiviGo task list (Telegram agent + mini-app)
- [ ] V1. Render the same collect-them-all placeholder grid + completeness in the
  mini-app, from GoBanq's reads (§8.2 G5) — no chain calls. Show real art only for
  what the user owns or what is for sale; placeholders otherwise.
- [ ] V2. (Optional, owner-driven) Let an owner SHARE a card they revealed into
  Telegram — the only path that shows new art to others. No automatic public
  broadcast of reveals.
- [ ] V3. Show sealed for-sale packs with packaged art + a "TIER N+" floor badge
  (and revealed ones with the thumbnail) in the mini-app (§2.2).

## 9. Phasing

1. **Spec first.** Kinet.ink + GoBanq publish the §3 shape (contract bumps).
   DD69 defines COLLECTION-CREATE v2 to match. Nothing ships until the shape is
   agreed, because it is on-chain and immutable per collection.
2. **Chain + roll.** DD69 lands v2 record + multi-UR-set roll, on regtest.
3. **Storage + release.** GoBanq lands the three-rendition storage + the
   first-reveal release trigger + the discovered-art read.
4. **Grids.** DD69 app + DiviGo render the placeholder grid, discovered fills,
   IndexedDB cache.
5. **Social.** Completeness, leaderboards, first-uncover awards.

## 10. Decisions (resolved 2026-Oct-28)

- **Placeholder:** one slot per UR set in Kinet.ink, with an auto-generated default
  (§2.1).
- **On reveal:** the thumbnail stops being secret in GoBanq, but is shown only in
  context (owner view, or for-sale listing). It is NOT broadcast publicly and does
  NOT touch Arweave; sharing it further is the new owner's choice (§2, §5).
- **Full-size master:** an image today, but may be a video or interactive HTML
  later; the thumbnail is just a lower-quality WebP (§2).
- **Leaderboards:** not built now — just make sure the on-chain data is reachable
  so they can be built later (§7).
- **Sell unrevealed packs (§2.2):** sealed packs are sellable; a forged one shows a
  trustless "TIER N+" guaranteed-floor badge. **One confirmation needed:** this
  requires forging to create a pack that stays sealed until opened (instead of
  auto-opening ~6 blocks later). Recommended; awaiting Geoff's yes.

---

## 11. Concrete set-shape record — contract #5 v2 (DD69 defines; all build to this)

The authoritative on-chain shape. v1 (today) is the four-number form in
`crates/supervisor/src/nfd_record.rs:181`. v2 adds named UR sets + a manifest
pointer. Everything here is what the roll math needs AND what the public must
trust; names and art are NOT here (they live in the manifest, §4).

**COLLECTION-CREATE (subtype 0x04) rarity payload, v2** — appended as fixed-width
hex, big-endian, in this order:

1. `version`            u8   — `02` (a record without it parses as v1).
2. `base_tier_count`    u16  — number of base tiers (e.g. 30).
3. `base_factor_ppm`    u32  — base halving factor in ppm (500000 = 0.5).
4. `ur_set_count`       u8   — number of Ultra-Rare sets (0 = none).
5. for each UR set, in order least-rare → rarest:
   - `tier_count`       u16  — tiers in this set (e.g. 12).
   - `chance_ppm`       u32  — gate probability into this set, ppm.
   - `factor_ppm`       u32  — within-set halving factor, ppm.
6. `manifest_ptr`       32 bytes — Arweave id of the set manifest (names,
   placeholders, base factor label). All-zero = no manifest yet.

Notes:
- `ur_set_count = 0` reproduces a plain tiered set; one set with the old dials
  reproduces today's single-UR behaviour exactly.
- The reveal roll (`reveal.rs`) walks the UR sets rarest-first: the first set whose
  gate hits claims the Perc, then a within-set tier is drawn on that set's factor;
  if none hit, it is a base-tier Perc. Base tier is always drawn too.
- A forged pack records its guaranteed floor (input_tier + 1) the same way a mint
  records its collection; see §2.2 / §8.3 D9.

**What each agent maps to this:**
- Kinet.ink package (#1): `baseTierCount`, base factor, and
  `ultraRareSets[]{name, tierCount, chancePpm, factorPpm}` least-rare first; names
  + placeholders go to the manifest, the four numbers per set go on-chain here.
- GoBanq Normalized Spec (#2): same fields; GoBanq writes the manifest and returns
  its id for `manifest_ptr`.
- DD69 (#5): encodes/parses this record and drives the roll from it.

---

## 12. Agreement log

- **2026-Oct-28 — Kinet.ink acked the shape.** Launch Package v5 published
  (`kinetink/docs/KINETINK_LAUNCH_PACKAGE_SPEC.md` + `launch-package-v5.sample.json`).
  §11 maps cleanly: base_tier_count <- setShape.baseTierCount, base_factor_ppm <-
  baseFactorPpm, ur sets <- ultraRareSets[] (least-rare first). Names + placeholders
  go to the manifest, not the package.
- **2026-Oct-28 — UNITS decided: ppm end-to-end.** The package carries the rarity
  dials as ppm integers (baseFactorPpm, chancePpm, factorPpm), matching §11. GoBanq
  must read ppm as-is in the Normalized Spec and DROP its old 0-1 fraction ->
  ppm conversion (would double-convert). Needs GoBanq's #2 bump + ack; Kinet.ink
  holds its live exporter at v4 until that ack, then wires v5. **Pending: GoBanq
  ack.**
- **Noted:** manifest_ptr is written by GoBanq (from Kinet.ink's names + placeholder
  URLs) and returned for DD69 to store on-chain. Early exports will carry a single
  UR set + null thumbnail/placeholder URLs until Kinet.ink's Perc-Maker UI + a
  perc_sets migration + canvas compositing land; everyone builds for N sets now.

---

## 13. Integration contract with GoBanq (2026-Oct-28; GoBanq #2/#3/#4 at 1.3.0, built)

GoBanq acked ppm units and shipped G1–G6 (gobanq-assets v0.9.0). Spec of record:
`gobanq-assets/docs/PERC_DROPS_CONTRACTS.md` v1.3.0.

- **Canonical SLOT id:** `base.<tier>` or `ur.<setIndex>.<tier>` — setIndex 0-based,
  least-rare-first (= the on-chain order), tier 1-based within its set. Every
  GoBanq read, release and art grant is keyed by this; DD69 adopts it on all reads.
- **Art is ENCRYPTED at rest** on Arweave (`StoredUri.encrypted: true`). Never point
  an `<img>` at a pointer. Public placeholder grid: read `manifest.url` from Arweave
  (no permission). Revealed / owned / for-sale art: GoBanq signed single-cell URL,
  `POST /v1/drops/:dropId/art/:slot {viewer}|{listingRef}` → `GET /v1/public/art?t=…`
  (~10 min, Cloudflare-cacheable). A master is owner-only; a listing never serves a
  master. **This supersedes the local-manifest art approach in D5/D6 — build to it.**
- **manifest_ptr:** GoBanq writes the manifest and returns `spec.manifest.pointerHex`
  (32 bytes) BEFORE createCollection; DD69's launcher fetches it first and stores it
  in the immutable record.
- **maxSupply:** DD69 supplies the sale cap at launch (non-null); the package may be
  null. GoBanq refuses a null cap.

**DD69 reads GoBanq needs (contract #5 / the adapter), priority order:**
1. **Revealed-slots — GATES ALL ART RELEASE:** `{ slots: [{ slot, firstRevealer,
   txRef?, at? }] }`. `firstRevealer` required (provable from chain). Until this
   exists, GoBanq releases no art, by design. Indexer records the first reveal per
   slot.
2. **Listings:** `{ listingRef, assetRef, seller, priceDuffs, sealed, slot?,
   floorTier?, isForgeResult? }`.
3. **Owned assets:** add `urSetIndex` (+ `floorTier`/`isForgeResult` on a sealed
   pack), or a ready-made `slot`.

**Pending Geoff (neither blocks GoBanq):**
- (§2.2) distinct `packagedArt` for a sealed pack vs reuse the cell placeholder.
- **Master decryption:** GoBanq stores NO plaintext (Arweave ciphertext + a wrapped
  key in its DB) and serves the master only to the address the chain says owns that
  cell — but GoBanq itself CAN decrypt, because something must check ownership. True
  owner-only (a wallet-held key, so even GoBanq can't read it) is a design change,
  not a bug fix (hard because one tier's art is owned by many people over time).
  Geoff to decide: ship GoBanq-mediated now, or invest in wallet-held-key E2E.

**Noted:** an anti-spoiler set cannot launch on Solana (cNFT metadata URI is public);
GoBanq refuses it. Divi-first, so fine.
