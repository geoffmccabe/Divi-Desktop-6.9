# NFD Percs Launch Plan

**Goal:** get to the point where Geoff can upload the Percs collection JSON in the shipping DD69 app and launch the first Divi Collectibles (NFD) collection on Divi mainnet.

**Status legend:** ☐ not started · ◐ in progress · ☑ done

**Source of truth for current code state:** four-layer audit, 2026-Sep-19 (chain/nodes, DD69 backend, DD69 UI, ERC-721 bridge). This plan supersedes the "Remaining build for launch" note in the memory file, which predates the audit.

---

## MASTER LAUNCH CHECKLIST — first Perc collection on Divi (authoritative, 2026-Oct-06)

Everything needed to launch, across all systems. Owners: **[DD69]** this wallet (me), **[GoBanq]** the GoBanq Assets agent (via Geoff), **[Kinetink]** the Kinetink app (Geoff), **[Chain]** the Divi-Blockchain_6.9 repo (coordinate with the chain agent), **[Geoff]** a decision or credential only Geoff can give. Storage is modular: Arweave-via-GoBanq is the live backend; **DiviStore ships as a wired-but-off module** that turns on when it's ready.

### Phase 0 — Foundation ✅ DONE
- ☑ [DD69] Branch current with the shipping app, builds clean, tests green.
- ☑ [DD69] Wallet reads collectibles/collections/ownership from the chain (verified on regtest).
- ☑ [DD69] Reveal experience built in as a reusable module, preview-wired (layered FX, jump-scaled size+sound, forged guarantee, Ultra Rare).

### Phase 1 — The set contract + import & edit
- ◐ [Kinetink/Geoff] Extend the Kinetink export JSON to carry the sealed-pack model: sealed-pack art, the tier-art library (T1..T40), ultra-rare arts + odds/factors, and the reveal/rarity config — on top of today's flat item fields. Spec doc: `/Users/geoffreymccabe/kinetink/docs/KINETINK_LAUNCH_PACKAGE_SPEC.md` (now includes `collection.ultraRare` = `{ basicChance, progressiveFactor, count }`, the UR gate — section 2.2). Geoff is extending it; DD69 import reads this spec.
- ☐ [DD69] Import that JSON (replace the old zip importer): fetch art from the allowlisted Kinetink storage host, validate on magic bytes, build an in-memory editable set.
- ☐ [DD69] Editable review screen — edit specs only (names, description, supply, tiers, traits, rarity config, fees); **art is not editable here** (change it in Kinetink and re-import). Validate, then hand off to launch.

### Phase 2 — Storage (Arweave now; DiviStore module wired, off)
- ◐ [DD69] GoBanq Arweave backend (`gobanq`): ☑ built — ticket-based upload to `/v1/storage/uploads` with poll-for-id, local cache, gateway reads, selectable in the panel; reports "not configured" until the app key/issuer are set. ☐ Remaining: point the relay at being a ticket issuer and plug in the live devnet key.
- ☑ [DD69] **DiviStore backend module**: built as a wired-but-off backend (`DIVISTORE_READY=false`) — in the selector and `for_node` flow, shown "coming soon", refuses uploads until turned on. One flag + its put/get turns it on.
- ☑ [DD69] Selectable, persisted storage backend + a **Storage section** in the Collectibles panel (local / Arweave relay / GoBanq / DiviStore).
- ☐ [DD69] Launch upload pipeline: for each art, fetch from Kinetink → store via the selected backend → get the Arweave pointer DD69 writes on-chain; with progress + retry UI. *(Depends on Phase 1 import.)*
- ☐ [Geoff/GoBanq] Issue the NFD devnet app key + caps; decide GoBanq mainnet availability (its server move) vs. keeping the funded relay for the first mainnet launch.

### Phase 3 — The launch mint (sealed packs) on Divi  *(DD69 does the mint)*
- ☐ [DD69] Sealed-pack create-collection + batch-mint on Divi: mint sealed packs (reveal-aware records referencing the tier-art library + odds), not finished items.
- ☐ [DD69+Chain] Reveal on-chain record + transaction, roll seeded by a future Divi block (fair, can't be ground); wire the existing `reveal.rs` engine.
- ☐ [Chain] Teach the normative indexer to decode + apply the reveal record with a reorg-undo entry; re-vendor into DD69.
- ☐ [DD69] Swap the reveal UI's preview `run()` for the real on-chain reveal (one call site).
- ☐ [DD69/Geoff] Set the treasury address (have it) + the mint fee numbers (Geoff), mainnet-gated.
- ☐ [DD69] Add a mainnet **mint safety fence** so nothing can mint on mainnet before the launch block (lesson from the Sep-19 stray mint).

### Phase 4 — Forging (in the launch)
- ☐ [Chain] Teach the indexer to decode + apply the forge record (0x05) with reorg-undo; fix the embedded-txid byte order for forge records; re-vendor.
- ☐ [DD69] Forge command + UI; a forge produces a **sealed pack with a guaranteed minimum tier**; reveal honors the floor and uses the forge odds.
- ☐ [DD69] Tier-art registry so a revealed/forged PERC shows the right art + tier glow, sealed and revealed.

### Phase 5 — Marketplace
- ◐ [DD69] Listing: ☑ UI built — "List for sale" (price + the commission breakdown + your net) in the item viewer, and a "Your listings" group in Marketplace. ☐ Listings are local drafts; the on-chain listing record (price + listing time) + settlement is the chain step below.
- ☑ [DD69+Chain] Creator commission, **DOWN-ONLY** — DONE end-to-end (no fork): creator editor in collection details (Original/Current/New); on-chain COMMISSION-SET record (0x09, creator-only, down-only) + transfer-validity rule (a transfer is ignored unless it pays ≥ the current commission) in the normative `nfd-indexer` (re-vendored, so DD69's scanner enforces on reads); `RecordContext` gained an additive `payments` map (DMT unaffected); the wallet broadcasts the COMMISSION-SET tx and pays the toll in the same transaction as a transfer. Tested (chain crates + 120 supervisor tests).
- ☐ [DD69+Chain] Buy/sell via atomic HTLC trade (non-custodial); show price, commission, and the forged **guaranteed-minimum-tier glow + text** on sealed packs (the glow needs the forge/reveal min_tier data from Phase 4).

### Phase 6 — Ownership display (chain-agnostic)
- ☐ [DD69] Enumerate ownership across the user's multiple Divi addresses/wallets (today: one address).
- ☐ [DD69] Keep the display behind a chain-agnostic abstraction so DIVA/Solana/Base can be added later without a rewrite — **Divi only now, no other-chain code yet.**

### Phase 7 — Go-live
- ☐ [DD69] Merge `feat/nfd-collectibles` → `main`; main builds clean; cut a release.
- ☐ [Geoff] Set the mainnet launch block (NFD activation height), treasury, and sign off on the fee table.
- ☐ [GoBanq] Mainnet storage available (server move) or the relay fallback confirmed.
- ☐ [All] Full dress rehearsal end-to-end on regtest/devnet: Kinetink JSON → import → edit → store → sealed-pack mint → reveal → forge → list/sell → ownership.
- ☐ [Geoff] Launch the first Perc collection on Divi mainnet.

### Phase 9 — NFD transactions shown everywhere (Geoff, 2026-Oct-06; likely multiple sub-phases)
NFD activity should read as NFD activity — not bare DIVI transactions — everywhere people look, in both DD69 and the explorer, with a small image where there's one.
- ☐ [DD69] Activity filters: add an **"NFDs" tab** to the right of Lottery (All · Stakes · Sent · Received · Lottery · **NFDs**).
- ☐ [DD69] Detect NFD transactions in history (mint / transfer / collection-create / reveal / forge / commission) and render them as **NFD rows**: the NFD type, what it was, and a **small thumbnail** of the item when it has a public image (from the preview pointer via a gateway).
- ☐ [DD69] Surface NFD activity in **Overview, Send, Receive, and Transaction History** so an NFD move shows as an NFD, not an unexplained DIVI transfer; consistent styling/CSS for the NFD row + thumbnail.
- ☐ [scan.divi.love] Show NFD transactions in the explorer with the same NFD details + thumbnail (the overlay read-API already exposes `/tx`, `/block`, `/nfd/{id}`; the web frontend needs the NFD rendering).
- **Done when:** a mint / transfer / reveal / forge / sale reads clearly as an NFD action — with its image — in DD69's Overview/Send/Receive/History (under the NFDs tab and inline) and on scan.divi.love.

### Still needed from Geoff (inputs, not code)
Mint + marketplace fee numbers · the extended Kinetink JSON spec (you're building it) and who edits Kinetink · the GoBanq NFD devnet key · the GoBanq mainnet timing (server move) vs. relay fallback · the mainnet launch block.

---

## Architecture clarified — three-repo audit (2026-Oct-06)

A full audit of Kinetink, GoBanq and DD69, plus Geoff's decisions, fixed the division of labor. This section is authoritative; where older phases below assume "GoBanq launches," they are corrected here.

- **Kinetink makes the set JSON.** A user builds a PERC set and exports `kinetink-collection-launch` v1 (`/Users/geoffreymccabe/kinetink/src/components/perc-maker/launchPackage.ts`): a flat list of finished items, art as **public Supabase URLs** (not bytes). It carries no sealed-pack/tier-art/odds data yet.
- **DD69 is the LAUNCHER on Divi** (Geoff, 2026-Oct-06). Keep local minting in `collectibles.rs`; do NOT move the Divi mint to GoBanq. DD69 imports the JSON, gives an editable review, then mints on Divi itself (and on DIVA later).
- **GoBanq is STORAGE ONLY for NFD.** It is a Solana + Arweave service and does **not** launch on Divi/DIVA (no code, no plan). It stores the art on Arweave and returns a pointer DD69 writes on-chain. There is no separate "Divi Storage" — that is GoBanq's Arweave. ⚠ GoBanq **mainnet is frozen** until it moves to its own server, so a mainnet NFD launch either waits for that or keeps the Divi-funded relay for storage initially.
- **Percs launch as sealed packs** (Geoff, 2026-Oct-06): Kinetink's export must be **extended** to carry sealed-pack art + tier-art library + ultra-rare odds + reveal config before DD69 can build the reveal.

### DD69 work list (what's missing, ordered)
0. **Shared contract:** define the EXTENDED Kinetink→DD69 launch JSON (flat items + sealed-pack/tier-art/odds/reveal config). One spec both apps build to. Gates 1, 2, 5.
1. **Import the Kinetink JSON** (replace the `.zip` importer): fetch art from allowlisted Supabase URLs, validate on magic bytes.
2. **Editable review screen** (the heart of the new flow — unbuilt): populate the set into an editable grid; fix name/tier/traits/supply/art/rarity before launch; no immediate mint.
3. **GoBanq storage backend** (`NFD_STORAGE=gobanq`, single-use ticket): small, already designed; retire the self-funded relay. Needs the devnet app key (ask Geoff).
4. **Launch = local Divi mint**, reveal-aware (sealed-pack mint). Keep the `nfdMint`/create-collection choke point; the UTXO/funding/confirmation machinery stays (DD69 still mints).
5. **Sealed-pack reveal UI** — ☑ built into DD69 (2026-Oct-06) as a reusable, swappable module (`ui/src/wallet/reveal/`), preview-wired in the Collectibles NFD Builder tab: layered FX (spinning starburst + warp starfield + glitter from jump 6 + fireworks for UR), jump-scaled size/sound 20→100%, color ladder, forged minimum-tier shown sealed and revealed. ☐ Still backend: wire `reveal.rs` + an on-chain reveal record + chain-repo indexer decode, then swap the preview `run()` for the real on-chain reveal (one call site).
6. **Forging UI** + chain-repo indexer forge(0x05) decode.
7. **Marketplace** (listings/buy/sell — browse-only today).
8. **Ownership across multiple wallets** + DIVA display (single Divi address today).

### Product decisions — round 2 (Geoff, 2026-Oct-06)
- **#0 JSON spec: Geoff develops it first.** Geoff extends the Kinetink export (sealed-pack + tier-art + odds + reveal config) and hands DD69 the finished JSON. DD69 import (#1) is built to match that, so #1 waits on Geoff's spec.
- **#2 Editable review = specs only (numbers + text), NOT art.** Name, description, tier, traits, rarity, supply, fees etc. are editable in DD69; to change art the user edits in Kinetink and re-imports. No art upload/crop in DD69.
- **#3 Storage is modular** (pluggable backend trait). Arweave today; a distinct DiviStore is a future backend that drops into the same layer; keep it pluggable, don't hardcode one store.
- **#4 DD69 launches on Divi.** Confirmed.
- **#5 Reveal:** revealing is an **on-chain transaction**. Reveal UI lives in DD69 and should be a **modular, swappable** component reusable in DiviGo/elsewhere. Build an exciting reveal animation (Claude Design, HTML/CSS/JS) as a swappable module; prototype first for approval.
  - **Forged sealed PERCs carry a guaranteed MINIMUM TIER.** Forging two T3s → the resulting sealed pack is guaranteed T4+ (forge distribution: +1@50%, +2@25%, …, floored at min_tier). The data model for a sealed PERC must carry `min_tier` (0/none for an original pack; N for a forged one). The reveal honors the floor and uses the forge distribution. **The minimum tier must be visible while still sealed** — in the user's collection AND on the marketplace — so a sealed forged pack can be sold as "guaranteed ≥ T4". Art stays the sealed art; add the **tier-based glow effect (from Kinetink)** for the minimum tier, plus clear text (e.g. "Guaranteed T4+").
- **#6 Forging UI in DD69.** Confirmed.
- **#7 Marketplace basics:** listing, price, listing time, and a **guaranteed creator commission** on sales, plus other listing details. The creator commission is set by the collection creator and can be **changed DOWN ONLY** (a ratchet / spork-like signed record — never up): if DIVI's price rises the fixed-DIVI fee can get too high and block sales, so the creator can lower it, but can never raise it. (Builds on the existing `NFD-CREATOR-COMMISSION.md` enforce-at-transfer design.)
- **#8 Ownership display must be chain-agnostic/modular** — no hardcoded Divi-only assumptions. Only Divi is implemented now (DIVA does not exist yet). Leave the abstraction so future chains (DIVA, Solana, Base, …) that Divi may be bridged to can be added to the wallet without a rewrite. **Do not build any other-chain code now** — just keep it flexible.

---

## Where we are (one paragraph)

The forkless NFD protocol is genuinely built and proven on regtest: the chain node reads mint/transfer/collection records, enforces creator-only + max-supply, and survives reorgs; the wallet can build and fund those transactions; there is a real UI panel; encryption is done client-side. The feature is **not in the shipping app** (it lives on branch `feat/nfd-collectibles`, worktree `/Users/geoffreymccabe/dd69-nfd`, which is 47 commits ahead of `main` and 127 behind). The launch-blocking gaps are: (1) not merged/current, (2) the wallet cannot re-read your collectibles from the chain, (3) Arweave storage is off and undeployed, (4) fees/treasury are compiled off, and (5) the Percs-specific rarity/reveal pipeline is only partly built.

---

## Decisions needed from Geoff (surfaced, not blocking the early phases)

- **D1 — RESOLVED (2026-Sep-20): sealed packs you reveal.** Percs launch as *blind packs*: buy sealed, click Reveal, tier + ultra-rare rolled fairly at that moment. This is the full vision and the bigger build — Phase 5 includes a new on-chain reveal record, sealed-pack minting, reveal UI/animation, and (critically) teaching the normative chain indexer to decode + apply the reveal. The roll engine (`crates/supervisor/src/reveal.rs`) already exists.
- **D2 — RESOLVED (2026-Sep-20): forging is IN the first launch.** So Phase 6 moves into the critical path (before go-live), not a fast-follow. The forge roll math exists; the remaining work is chain-repo indexer decode/apply/undo for the forge record, a forge command + UI, and a tier-art registry.
- **D3 — ERC-721 / DIVA bridge.** Definitely post-launch (Phase 8). It does not gate the Divi launch.
- **D4 — Arweave storage: RESOLVED (2026-Sep-19) → use GoBanq Assets, not our own funded relay.** The GoBanq agent (repo `Go-Banq/Assets`, service LIVE on devnet) proposed that NFD stop running its own funded Arweave uploader and upload through GoBanq instead (write-up: `/Users/geoffreymccabe/GOBANQ-ASSETS-FOR-NFD-AGENT.md`). This matches Geoff's ecosystem decision that everything creating/storing tokens+NFTs moves to GoBanq (the Money-Transmitter-License holder). It is a small change (our storage layer has three operations; upload maps to one GoBanq call; reads are unchanged), removes the funded key and the heavy `@ardrive/turbo-sdk` dependency from our side, and keeps all our encryption and our on-chain pointer format identical. **Accepted.** Details now drive Phase 3 below.

---

## Phase 1 — Get the branch current and building  ✅ ENGINEERING DONE (2026-Sep-19)

*Why: everything else should be built on an app that has today's features, and this sets up the final merge. Testing on a 127-commit-stale app is what made HRAs feel "old."*

- ☑ 1.1 Merged `origin/main` into `feat/nfd-collectibles`. 7 conflicts resolved by union; pin-send v1 superseded by main's HTLC v2 (no NFD loss); duplicate `getrandom` dep removed. Now 0 behind main. Merge-pulled files scanned for the payload triad — clean.
- ☑ 1.2 Clean build confirmed: the (historically missing) setup-flow file is present on current main, so the workspace builds. `cargo check -p dd69-supervisor -p divi-desktop-69` = Finished, 0 errors, 8 benign warnings.
- ☑ 1.3 UI typechecks clean (0 tsc errors after installing main's new `three`/`react-globe.gl` deps), UI production build OK, `cargo test -p dd69-supervisor` = **116 passed, 0 failed**.
- ☐ 1.4 Install the fresh build into `/Applications/DD69.app`, relaunch, confirm the "Divi Collectibles" panel appears and existing NFD flows still work on regtest. *(Deferred to a single install/relaunch once Phase 2–4 give something new worth eyeballing.)*
- **Done when:** branch builds clean, all tests green, app runs current features + NFD panel, on regtest. *(Build + tests met; in-app eyeball pending 1.4.)*

## Phase 2 — Wallet reads collectibles from the chain (the big gap)  ✅ DONE + VERIFIED (2026-Sep-20)

*Why: today the wallet trusts local data on this machine for "what you own." After a reinstall or on a second device your NFDs would vanish. This is the #1 thing that would embarrass us at launch.*

**Verified on regtest** (`crates/supervisor/examples/nfd_scan_readback.rs`): mint → read back "what I own", look up one item, and a collection's full membership, all purely from the chain (no local storage); a stranger owns none. A byte-order bug was found and fixed along the way (see 2.6).

- ☑ 2.1 **DECIDED (2026-Sep-19): in-process chain scan, mirroring the Names feature (`crates/supervisor/src/names.rs`).** Vendor the already-built `nfd-indexer` crate (ownership + collection membership + reorg undo, all tested in the chain repo) into DD69, drive it from the wallet's own node connection, persist a local index that survives restarts, and scan from an NFD activation height (not genesis). This matches the chain team's explicit 2026-Sep-06 decision (wallet stays server-independent and rule-identical to the explorer) and reuses the shipping Names pattern. Rejected: the hosted read-API (breaks self-custody; its persistent store is unfinished) and a bundled indexer subprocess (no doc calls for it; the crate is shaped to embed as a library). Tradeoff accepted: a second lightweight scan loop beside Names, rather than a risky refactor to unify them now (unify post-launch).
- ☑ 2.2 Backend module `crates/supervisor/src/nfd_scan.rs` + commands `nfd_owned` / `nfd_get` / `nfd_collection_members` / `nfd_sync_state`: enumerate owned NFDs, a collection's items, and one item, from the chain.
- ☑ 2.3 UI now merges chain state (authoritative existence + ownership) with local metadata; local storage is only a cache and a just-minted item not yet scanned.
- ☑ 2.4 Collectibles panel reads the chain-backed list; collection browse shows the full on-chain membership; a "reading the chain" indicator shows while catching up.
- ☑ 2.5 Verified end-to-end on regtest (see above).
- ☑ 2.6 **Bug found + fixed:** the wallet wrote embedded txid references (a mint's collection id, a transfer's target) in display order, but the indexer keys by internal order, so collection membership and transfers did not register. Fixed in `crates/supervisor/src/nfd_record.rs` (`swap_txid_order` on encode/decode). Forge/bridge carry the same latent issue and are noted in-code to fix when they are wired to the indexer (Phases 6/8).
- **Done when:** mint on regtest, wipe local app data, reopen → collectibles reappear from the chain. *(Met: the chain-read path that powers this is proven; the in-app wipe-and-reopen is part of the single app dress-rehearsal in 1.4/Phase 7.)*
- ☐ 2.7 (deferred, post-launch) Persist the scanned state so a restart need not rescan from the activation height. Fine for launch (small window); grows over time.

## Phase 3 — Arweave storage live (via GoBanq Assets)

*Why: real art must actually be stored. Today storage defaults to a local-folder stub. Per D4 we store through GoBanq (which holds the funded key and pays) instead of running our own uploader.*

**What stays exactly as built:** all NFD encryption (`crates/supervisor/src/crypto_nfd.rs` — GoBanq only ever sees opaque bytes, never a key or plaintext); transfer = re-wrap-the-key, no re-upload; the on-chain `arweave_ptr` (same 32-byte ANS-104 id GoBanq returns); reads (`get()` fetches from a public gateway directly, so **viewing a collectible never depends on GoBanq being up** — GoBanq is only in the write path); the local cache.

- ☐ 3.1 (Geoff, prerequisite) Ask Geoff to get us a GoBanq devnet app key for NFD + the base URL (and an SSH tunnel to `127.0.0.1:3894` until `assets-devnet.gobanq.com` DNS exists), with caps: content types `application/octet-stream, application/json, image/png, image/jpeg, image/webp`; per-upload size (propose 10 MB); a daily spend cap. Route the request through Geoff (GoBanq agent builds it).
- ☐ 3.2 Add a third storage backend (`NFD_STORAGE=gobanq`) beside the local stub and the old relay, in `crates/supervisor/src/nfd_storage.rs`. Upload = one `POST /v1/storage/uploads` with our encrypted bytes; take GoBanq's offered **`?wait=1` synchronous upload** so our Rust makes one blocking call and gets the pointer back (no polling loop, no status proxy). Keep the old relay path for one release as rollback.
- ☐ 3.3 Auth via **single-use upload tickets**: reduce our existing relay (`nfds.divi.love`) from an uploader to a **ticket issuer** — it keeps our current gate (so it stays our moderation choke point) and hands out a short-lived, single-use, size-capped ticket; it no longer holds any funded key. (Later simplification, GoBanq phase 6: GoBanq issues tickets straight to a wallet that signs a Divi challenge, removing our issuer entirely — deferred, needs a signature-scheme decision.)
- ☐ 3.4 Add a minimal upload status/retry indication in the mint/import UI, and handle GoBanq's error codes (`BAD_TICKET` → new ticket + retry once; `TOO_LARGE`/`TYPE_NOT_ALLOWED` → don't retry; `DAILY_STORAGE_CAP`/`STORAGE_UNFUNDED` → back off).
- ☐ 3.5 Prove the round trip on devnet: encrypted bundle → GoBanq pointer → on-chain mint → read back through the gateway → decrypt; confirm the pointer is byte-identical in form to what the old relay produced. Then switch the default to `gobanq`.
- **Done when:** a mint stores its art through GoBanq and the collectible reads back and decrypts from a public gateway, with our own funded key retired. Rollback at any point = `NFD_STORAGE=relay`; nothing on chain changes.

**Honest tradeoff:** minting now depends on GoBanq being up (viewing does not). That is acceptable and is better custody than us holding a funded key; rollback is a one-setting change.

## Phase 4 — Treasury and fees

*Why: fees must flow to the right wallet from day one.*

- ☐ 4.1 Set the NFD treasury address to **`DPtYkMbNBLRr4B9nSHT9mvWjKQU8QETGuE`** in the single fee-config location (`/Users/geoffreymccabe/dd69-nfd/crates/supervisor/src/fees.rs`), gated so it only applies on mainnet.
- ☐ 4.2 Set the launch fee values (mint fee; marketplace/forge/commission fees may start at 0 and be raised later). Geoff signs off on the numbers.
- ☐ 4.3 Verify on regtest that a mint pays the fee output to the treasury address.
- **Done when:** a regtest mint deposits the fee to the treasury address and change returns to the owner.

## Phase 5 — Percs collection pipeline (upload-JSON-and-go)

*Why: this is the actual "upload my Percs JSON and launch" experience. Percs are a special collection type (art-library + rarity config, not one-image-per-item).*

- ☐ 5.1 Resolve **D1** (blind-pack reveal vs fixed-tier v1).
- ☐ 5.2 Finalize the Percs JSON upload format (art library: tier arts T1..T40, optional ultra-rare arts + factors, sealed-pack art, rarity config). Document it so Geoff knows exactly what to produce.
- ☐ 5.3 If reveal model (D1 = blind pack): add the reveal on-chain record + node-indexer decoding + sealed-pack mint + reveal UI/animation. The roll engine (`/Users/geoffreymccabe/dd69-nfd/crates/supervisor/src/reveal.rs`) already exists.
- ☐ 5.4 Rarity is resolved and displayed consistently (tier + any ultra-rare), sourced from the JSON, not free-typed.
- ☐ 5.5 Add the "upload Percs JSON → create collection → batch-mint the set" flow to the UI (extends the existing Kinet.ink import path).
- **Done when:** on regtest, Geoff uploads the Percs JSON, the collection is created and the set is minted, rarity/reveal works, and items display correctly.

## Phase 6 — Forging (fast-follow, pending D2)

- ☐ 6.1 Teach the node indexer to decode + apply the forge record (0x05) with a reorg-undo entry.
- ☐ 6.2 Expose forge as a wallet command + build the forge UI.
- ☐ 6.3 Tier-art registry so a forged upgrade shows the right art.
- **Done when:** forge two same-tier Percs on regtest → upgrade registers in node state and shows in the app.

## Phase 7 — Merge to main and ship

- ☐ 7.1 Merge `feat/nfd-collectibles` → `main`; get `main` building from clean; coordinate with other lanes.
- ☐ 7.2 Cut a release build; confirm the shipping app from `main` has working NFD.
- ☐ 7.3 Set mainnet launch parameters; final regtest dress rehearsal of the whole Percs flow.
- **Done when:** Geoff uploads the Percs JSON in the shipping app on **mainnet** and the collection is live.

## Phase 8 — ERC-721 / DIVA bridge (post-launch)

*Why: lets NFDs move to DIVA and appear on EVM NFT marketplaces. Does not gate the Divi launch.*

- ☐ 8.1 Add a standard ERC-721 metadata JSON (name, image, attributes/traits, rarity) so bridged NFDs feel familiar on marketplaces (today `tokenURI` returns only a thumbnail).
- ☐ 8.2 Deploy `NFDBridge721.sol` to DIVA devnet.
- ☐ 8.3 Build the coordinator process (watch Divi for lock → mint on DIVA; watch DIVA for release → unlock on Divi).
- ☐ 8.4 Wire the chain indexer to process bridge records 0x07/0x08 with reorg-undo.
- ☐ 8.5 Prove one Perc round-trip regtest-Divi ↔ devnet-DIVA.
- ☐ 8.6 (Note) If the bridge ever needs to mint a **Solana**-side NFT, GoBanq already runs the Solana cNFT stack (Bubblegum V2 / MPL Core) and can do it — call GoBanq rather than building a minting path. Same option for a future DiviStore Arweave mirror.
- **Done when:** one Perc bridges to DIVA and back.

---

## Launch-safety note (found 2026-Sep-19)

The chain **reader** is fenced off mainnet until launch (`MAINNET_ACTIVATION = None`), but the **mint/transfer/collection** path is NOT — it will act on whichever node it is connected to. On 2026-Sep-19 a regtest test that mistakenly resolved to the live mainnet node broadcast one stray (harmless, ~0.0001 DIVI) NFD mint on mainnet. Two things to do before launch: (a) add a mainnet fence on the write path too, so nothing can mint on main until the launch block; (b) headless tests must build the regtest `NodeConfig` by hand (port 51799), never `NodeConfig::load()` (its active profile can be the live mainnet daemon). Memory: `feedback_nfd_tests_never_use_nodeconfig_load`.

## Known correctness note (carry through the phases)

The wallet can already *emit* forge (0x05) and bridge (0x07/0x08) records, but the node indexer does **not** decode them yet. Do not expose forge or bridge in the shipping UI until the node side reads the matching record — otherwise a user action would produce a transaction the network ignores. (Phases 6 and 8 close this.)

## Critical path to launch (per Geoff's 2026-Sep-20 decisions: sealed-pack reveal + forging both in launch)

Phase 1 ✅ → Phase 2 ✅ → Phase 4 (treasury/fees) → Phase 3 (GoBanq storage) → **Phase 5 (Percs sealed-pack reveal + ultra-rares)** → **Phase 6 (forging)** → Phase 7 (merge to main + launch). Phase 8 (DIVA bridge) remains post-launch.

**Scope reality (honest):** Phases 5 and 6 are the large remaining builds, and both need work in the chain repo `/Users/geoffreymccabe/Divi-Blockchain_6.9/contrib/nfd-indexer` (the normative index must learn to decode + apply the new reveal record and the forge record, each with a reorg-undo entry), which is then re-vendored into DD69 via `scripts/sync-divi-crates.sh`. That is cross-repo and likely needs coordination with the chain agent. This is a multi-step effort, not a single sitting.
