# NFD Percs Launch Plan

**Goal:** get to the point where Geoff can upload the Percs collection JSON in the shipping DD69 app and launch the first Divi Collectibles (NFD) collection on Divi mainnet.

**Status legend:** ☐ not started · ◐ in progress · ☑ done

**Source of truth for current code state:** four-layer audit, 2026-Sep-19 (chain/nodes, DD69 backend, DD69 UI, ERC-721 bridge). This plan supersedes the "Remaining build for launch" note in the memory file, which predates the audit.

---

## Where we are (one paragraph)

The forkless NFD protocol is genuinely built and proven on regtest: the chain node reads mint/transfer/collection records, enforces creator-only + max-supply, and survives reorgs; the wallet can build and fund those transactions; there is a real UI panel; encryption is done client-side. The feature is **not in the shipping app** (it lives on branch `feat/nfd-collectibles`, worktree `/Users/geoffreymccabe/dd69-nfd`, which is 47 commits ahead of `main` and 127 behind). The launch-blocking gaps are: (1) not merged/current, (2) the wallet cannot re-read your collectibles from the chain, (3) Arweave storage is off and undeployed, (4) fees/treasury are compiled off, and (5) the Percs-specific rarity/reveal pipeline is only partly built.

---

## Decisions needed from Geoff (surfaced, not blocking the early phases)

- **D1 — Percs reveal model for v1.** Percs are designed as *blind packs* (buy sealed, click Reveal, tier + ultra-rare rolled fairly at reveal). That model needs a new on-chain reveal record, sealed-pack minting, reveal UI/animation, and node-indexer resolution — a real chunk of Phase 5. The simpler alternative is to launch v1 with *fixed tiers baked in at mint* (no reveal step) and add blind-pack reveal as a fast-follow. **Recommendation: decide before Phase 5.** The roll engine (`reveal.rs`) already exists either way.
- **D2 — Is forging in the launch?** Forging math is built but has no UI and the node doesn't decode the forge record yet. **Recommendation: fast-follow, not in the launch (Phase 6, after go-live).**
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

## Critical path to launch (Percs, no forging, no bridge)

Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 7. Phases 6 and 8 are fast-follows.
