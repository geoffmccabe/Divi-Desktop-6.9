# Perc → NFD Launch: Coordination Doc (DD69 / Divi agent)

Audit date: 2026-Oct-27. Shared across four repos (kinetink, gobanq-assets, divigo-ai-agents, dd69-nfd); each has its own `docs/PERC_LAUNCH_COORDINATION.md`.

**Work in `/Users/geoffreymccabe/dd69-nfd`** (git worktree of Divi-Desktop-6.9, branch `feat/nfd-collectibles` — the advanced NFD branch). Plain `Divi-Desktop-6.9` is the less-complete main checkout; use `dd69-nfd` for all NFD work.

---

## Shared goal
Launch a Perc collection (trading cards with on-chain forging) as **NFDs on the Divi chain**, buyable / giftable / forgeable from the DiviGo Telegram agent + mini-app and the DD69 app. Build it so the same Perc set can later launch on **Solana cNFT or EVM** via a chain adapter, with no change to the product layer or the agents.

## Default decisions (Geoff to confirm)
- **D1 Forging = your existing Divi-native mechanic** (SUB_FORGE `0x05`, `apply_forge` in `crates/nfd-indexer/src/lib.rs:910`): burn two same-tier → sealed upgrade with provably-fair reveal + creator forge fee. Keep it; expose it to GoBanq as a single `forge` verb.
- **D2 Recipient = custodial Divi address** for non-desktop users; the custodian (DiviGo gateway) signs the overlay records your API builds. Self-custody later.
- **D3 Chains = Divi first.** You are the Divi backend behind GoBanq's adapter.

## The seven contracts (the ONLY interfaces)
1. Launch Package v4 — Kinet.ink. 2. Normalized Collection Spec — GoBanq. 3. GoBanq facade APIs — GoBanq. 4. **Chain Adapter interface** — GoBanq (you implement its Divi side). 5. **NFD API Service contract** — **you (DD69)**. 6. GoBanq client-kit — GoBanq. 7. Recipient/identity — DiviGo gateway.

## What's already built (big: this is NOT greenfield)
Confirmed in the audit — the Divi NFD stack is largely done and tested on regtest/devnet:
- Mint (`nfd-indexer/src/lib.rs:447`, public buyer-paid mint `app/src/main.rs:2383`), transfer (`lib.rs:519`), owner-read (`owned_by` `lib.rs:263`, `nfd_owned_wallet` `app/src/main.rs:2630`).
- **Forge** (`apply_forge` `lib.rs:910`, Tauri `nfd_forge` `app/src/main.rs:2285`, fee get/set `2305/2322`) and **reveal** (SUB_REVEAL, `apply_reveal` `lib.rs:860`, provably-fair via future block hash).
- Marketplace list/cancel/buy (`lib.rs:732/774/801`) + on-chain creator commission.
- Storage: pluggable `StorageBackend` (`supervisor/src/nfd_storage.rs`) with **GoBanq as the primary backend** (devnet); the self-funded `nfds.divi.love` relay is retired.
- DD69 app three-tab panel (Collection / Marketplace / Builder) — `ui/src/wallet/CollectiblesPanel.tsx`, reveal UI in `ui/src/wallet/reveal/`.
- Master plan: `docs/NFD-PERCS-LAUNCH-PLAN.md` (most chain/UI phases DONE).

## Known bugs / duplication from the audit (your fixes)
- **A/B. Importer version drift + single-parser rule.** Your `crates/supervisor/src/collectibles_import.rs:293 (open_launch)` accepts only package versions 1–2 (`:303-306`), but Kinet.ink now emits v3 and is moving to v4 — already incompatible. Decision: **GoBanq is the single parser-of-record** of the Kinet.ink package. Your API and launch path should consume GoBanq's **Normalized Collection Spec**, not the raw Kinet.ink JSON. Keep `open_launch` only for the manual desktop-upload path, and if you keep it, **bump it to validate the published v4 schema** so it can't drift again.
- **Burn.** There is no standalone NFD burn op (subtypes stop at 0x0E); destruction happens only via forge and bridge-out. That's fine — the adapter uses a `forge` verb (atomic burn+produce), so no standalone burn is needed for Percs. Only build a standalone burn if a later chain needs it.

## YOUR TASKS (DD69 / Divi)
1. **Build the external NFD API service** (`docs/NFD-API-SERVICE.md` is currently PLAN-only). Expose the Divi side of GoBanq's **Chain Adapter interface** over HTTP: createCollection, mintToAddress, forge, list, buy, cancel, ownedBy, reveal — backed by the existing on-chain machinery. This is the keystone that lets GoBanq, the agents, and the mini-app drive Divi NFDs without the desktop wallet. Define its auth with GoBanq (it will be called by GoBanq's Divi adapter).
2. **Custodial signing path.** Desktop users sign in-wallet today. For custodial Telegram/mini-app users, the API must build **unsigned overlay records** that the custodian (DiviGo gateway) signs and broadcasts, mirroring the self-custody pattern. Coordinate the record format with the gateway owner.
3. **Consume the Normalized Collection Spec** from GoBanq for launches (not the raw Kinet.ink package). Align `open_launch` to v4 if you keep the desktop path.
4. **Mainnet launch config** (remaining ☐ in `docs/NFD-PERCS-LAUNCH-PLAN.md`): treasury, fee table, activation height, flip `MAINNET_WRITE_ENABLED`, GoBanq **mainnet** storage (not just devnet), dress rehearsal.
5. **Finish UI loose ends:** NFD activity-history rows; make sure the Collection grid + Marketplace read ownership consistently with GoBanq's ownership-query facade so the agent/mini-app and the desktop app show the same thing.
6. **Branch merge** `feat/nfd-collectibles` → main when stable.

## How you talk to others
- Receive: the **Normalized Collection Spec** and mint/forge/buy calls from **GoBanq's Divi adapter** (and custodial signatures via the gateway).
- You do not parse the Kinet.ink package (GoBanq does) and you do not call the Telegram agent.

## Sequencing
After GoBanq publishes the adapter interface (contract #4) and the Normalized Collection Spec (#2), build the NFD API service to that shape. Your chain code already exists, so this is mostly wrapping it in an HTTP service + custodial signing + mainnet config.
