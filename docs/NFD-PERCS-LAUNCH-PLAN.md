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
- **D4 — Arweave relay hosting.** The uploader is a small always-on Node service holding a funded key. **Recommendation: Cloudflare Container (not a plain Worker) at `nfds.divi.love`.** Confirmed in Phase 3.

---

## Phase 1 — Get the branch current and building  ✅ ENGINEERING DONE (2026-Sep-19)

*Why: everything else should be built on an app that has today's features, and this sets up the final merge. Testing on a 127-commit-stale app is what made HRAs feel "old."*

- ☑ 1.1 Merged `origin/main` into `feat/nfd-collectibles`. 7 conflicts resolved by union; pin-send v1 superseded by main's HTLC v2 (no NFD loss); duplicate `getrandom` dep removed. Now 0 behind main. Merge-pulled files scanned for the payload triad — clean.
- ☑ 1.2 Clean build confirmed: the (historically missing) setup-flow file is present on current main, so the workspace builds. `cargo check -p dd69-supervisor -p divi-desktop-69` = Finished, 0 errors, 8 benign warnings.
- ☑ 1.3 UI typechecks clean (0 tsc errors after installing main's new `three`/`react-globe.gl` deps), UI production build OK, `cargo test -p dd69-supervisor` = **116 passed, 0 failed**.
- ☐ 1.4 Install the fresh build into `/Applications/DD69.app`, relaunch, confirm the "Divi Collectibles" panel appears and existing NFD flows still work on regtest. *(Deferred to a single install/relaunch once Phase 2–4 give something new worth eyeballing.)*
- **Done when:** branch builds clean, all tests green, app runs current features + NFD panel, on regtest. *(Build + tests met; in-app eyeball pending 1.4.)*

## Phase 2 — Wallet reads collectibles from the chain (the big gap)

*Why: today the wallet trusts local data on this machine for "what you own." After a reinstall or on a second device your NFDs would vanish. This is the #1 thing that would embarrass us at launch.*

- ☐ 2.1 Decide the read path: point the wallet at the node-side indexer HTTP API that already exists (`/Users/geoffreymccabe/Divi-Blockchain_6.9/contrib/dvxp-scan/src/api.rs`, endpoints `/nfd/{id}`, `/nfds?owner=…`) vs. a wallet-local scan. Recommendation: use the node indexer (it already tracks ownership, collections, reorgs).
- ☐ 2.2 Wire wallet backend functions to enumerate: NFDs owned by an address, a collection's items, and resolve a recipient's encryption key from chain.
- ☐ 2.3 Replace localStorage-as-truth in the UI with chain-derived state (keep local only as a cache).
- ☐ 2.4 Make the collectibles panel and marketplace read from the chain-backed list.
- **Done when:** mint on regtest, wipe local app data, reopen → collectibles reappear from the chain.

## Phase 3 — Arweave storage live

*Why: real art must actually be stored. Today storage defaults to a local-folder stub.*

- ☐ 3.1 Confirm `@ardrive/turbo-sdk` provenance on the npm registry; keep `ignore-scripts=true`.
- ☐ 3.2 Deploy the relay service (`/Users/geoffreymccabe/dd69-nfd/nfd-relay/server.js`) as a Cloudflare Container at `nfds.divi.love`; store the funding key as a secret; fund the Turbo balance.
- ☐ 3.3 Turn storage on in the app build (`NFD_STORAGE=relay`) pointed at the relay; the health/balance readout (`nfd_relay_status`) shows green.
- ☐ 3.4 Add a minimal upload status/retry indication in the mint/import UI (so a failed upload is visible, not silent).
- **Done when:** mint on regtest with the relay on → art is retrievable from `arweave.net`, encrypted for non-Perc content and public for Percs.

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
- **Done when:** one Perc bridges to DIVA and back.

---

## Known correctness note (carry through the phases)

The wallet can already *emit* forge (0x05) and bridge (0x07/0x08) records, but the node indexer does **not** decode them yet. Do not expose forge or bridge in the shipping UI until the node side reads the matching record — otherwise a user action would produce a transaction the network ignores. (Phases 6 and 8 close this.)

## Critical path to launch (Percs, no forging, no bridge)

Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 7. Phases 6 and 8 are fast-follows.
