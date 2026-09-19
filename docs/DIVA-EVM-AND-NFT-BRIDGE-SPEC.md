# DIVA — EVM Feature Reference & Divi↔DIVA NFT Bridge Spec

**Audience:** an engineer/agent building the **NFT lock-and-release bridge** between the **Divi UTXO chain** and **DIVA** (Divi's EVM side chain).
**Status:** DIVA chain and this bridge are **spec / not yet built.** The Divi-side NFD layer this depends on **is built** (see §3). Where something is a decision the builder must make, it's marked **[BUILDER].**
**Date:** 2026-Jul-31
**Companion docs:** `DIVA-STABLECOINS-BTC-PLAN.md` (fungible peg), `DIVA-PRIVATE-CONTRACTS-PLAN.md` (FHE/TEE + threshold committee). Read both — the NFT bridge reuses the same POAS federation and the same threshold-signing machinery.

---

## 0. One-paragraph orientation

DIVA is a **geth (go-ethereum) fork** secured by **POAS** (Proof of Authority Staking), with **Divi as its one native gas coin** (bridged 1:1 — see §2.4). The NFT bridge lets a holder **lock** a Divi Collectible (NFD) on the UTXO chain and receive a matching **ERC-721** on DIVA, and **release** it back by burning the ERC-721. The federation that signs both directions is the **POAS validator set**, the same one that runs consensus and the fungible bridge. The one thing that makes the NFT bridge harder than the coin bridge is that NFD art is **encrypted to its owner**, so the bridge must carry the **content key** across the boundary, not just a balance.

---

## 1. DIVA chain: the essentials a bridge builder needs

| Property | Value / decision | Notes |
|---|---|---|
| Base client | **Forked geth** | Standard EVM, standard JSON-RPC, `eth_subscribe` for logs. |
| Chain ID | **1838** | (Costa Rica sovereignty year; also the validator-count anchor.) |
| Consensus | **POAS** — Proof of Authority Staking | Authority set of validators, each bonded with stake. PoW is explicitly excluded. See §5. |
| Validator count | **up to 38** | Anchored to 1838. |
| Validator bond | **1,000,000 DIVI** | This is the *validator* bar; unrelated to the small user free-gas stake in the fee doc. |
| Block time | sub-second to a few seconds, **on-demand** **[BUILDER to finalize]** | No empty blocks when idle. |
| Native gas coin | **Divi**, minted 1:1 by the bridge (custom-gas-token model) | DIVA is the *chain*; Divi is the *coin*. No separate premined DIVA coin. |
| Finality anchor | **Per-block checkpoint into the DIVI UTXO chain** | DIVA tip hash written to DIVI via OP_META each DIVI block (~1 min), quorum-signed. Gives deep-reorg protection. |
| Quorum (move value / mint / release) | **26 of 38** | Same threshold the fungible bridge uses. |
| Quorum (decrypt private data) | **30 of 38** | Higher bar; only relevant here for the content-key rewrap path (§6.4). |

### 1.1 EVM features the bridge relies on
- **ERC-721 / ERC-1155** token standards — the DIVA-side NFT is a standard ERC-721 so wallets, marketplaces, and tooling work out of the box.
- **Events / logs** — the release direction is driven by the bridge contract emitting a log that the federation watches via `eth_subscribe`. Cheap; piggybacks on the burn tx (no separate alert tx). Same pattern as the gas-retainer alerts in the fee doc.
- **Federation-signature verification on-chain** — mint/release must be gated by a POAS quorum signature. **[BUILDER]** choose one:
  - a **threshold-signature (BLS/FROST) precompile** so the contract verifies one aggregated signature (cheapest, cleanest), or
  - an **N-of-M multisig verified in Solidity** (ecrecover over 26+ validator sigs; simpler to ship, higher gas).
  Recommended: start with the Solidity multisig for the testnet, move to a BLS/FROST precompile for production.
- **Account abstraction / paymaster (ERC-4337 / EIP-7702)** — so a user releasing/holding an NFT can pay gas in a token or have it sponsored (see fee doc). Not required for correctness, but expected UX.

---

## 2. Trust model / the federation (shared with the coin bridge)

- The **signer set is the POAS validators.** No new trusted party is introduced.
- Every cross-chain action (lock→mint, burn→release) requires a **26/38 quorum** signature. No single validator can mint or release.
- Validators run a **watcher** on *both* chains: a Divi full node (to see NFD records) and a DIVA node (to see contract events).
- **Finality before acting:** the federation waits for the source event to be final before signing the destination action — see §7 for the exact depths, because UTXO reorgs and EVM reorgs are handled differently.

### 2.4 Why native gas = bridged Divi (context)
DIVA launches with ~zero native supply. Bridging Divi in mints native gas 1:1; bridging out burns it. This is the "custom gas token" pattern (supported by Arbitrum Orbit / OP Stack / Polygon CDK). The **NFT bridge does not mint gas** — it mints ERC-721s — but it shares the same federation and the same lock-and-release invariant. Keep the two bridges as separate contracts with a shared signer set.

---

## 3. Divi UTXO side: the NFD layer (THIS IS BUILT — read the real code)

Source of truth, all under `/Users/geoffreymccabe/Divi-Desktop-6.9/crates/supervisor/src/` unless noted:

| Piece | File | What it gives the bridge |
|---|---|---|
| DVXP overlay plumbing | `dvxp.rs` | OP_META = `0x6a`; max script 603 bytes / ~596 payload; record magic `"DVXP"` + version `0x01` + type byte. **NFD is type `0x02`.** |
| NFD record codec | `nfd_record.rs` (+ vendored `dvxp-core`) | Subtypes: **mint / transfer / key-announce / collection.** Flags: `ENCRYPTED`, `HAS_THUMB`, `IN_COLLECTION`. This is how you read/emit an NFD record. |
| Encryption core | `crypto_nfd.rs` | Content AES-256-GCM under a random **content key (CK)**; CK wrapped to owner via **X25519→HKDF→AES-GCM**; **`rewrap()`** moves CK to a new owner on transfer. 8 tests. |
| Mint/view/transfer flows | `collectibles.rs` | Proven end-to-end on regtest. The transfer flow is the model for "lock." |
| Storage | `nfd_storage.rs` | Swappable trait; Arweave relay behind it. **Art ciphertext is immutable on Arweave** — a very useful property for a bridge (the blob never moves). |
| Native chain opcode | chain repo, branch `feat/opcodes` | **`OP_NFD = 0xbb`**, RPCs **`createnfd` / `verifynfd`**. `verifynfd` is how the federation confirms an NFD's current state/owner on-chain. |

### 3.1 The ownership model (critical — read twice)
NFD ownership is an **overlay**, not a UTXO-bound token. The current owner is whoever the **latest mint/transfer record** assigns the NFD to (and whose key the content key is currently wrapped to). Three facts drive the bridge design:

1. **Only the owner can decrypt the art.** Anyone else can see only the **public thumbnail** (`HAS_THUMB` / `thumb_ptr`) and public **traits** (`traits_ptr` on collection mints). → The DIVA-side ERC-721 can *always* display the thumbnail + traits; showing full art on DIVA requires the key-rewrap path in §6.4.
2. **Transfers are cheap** — only the wrapped key is re-wrapped; the ciphertext is never re-uploaded. → Locking and releasing are light operations.
3. **The blob is immutable on Arweave.** → Both chains can reference the *same* content pointer; the bridge never copies art.

---

## 4. The invariant (the whole safety property in one line)

> An NFD is **either** freely owned on Divi, **or** locked to the bridge and represented by exactly one live ERC-721 on DIVA — **never both, never neither.**

Everything below exists to preserve that invariant across reorgs, timeouts, and crashes. Like the fungible bridge and like physical cash: **whoever holds the DIVA ERC-721 can release it** (it's the claim check), not only the original locker.

---

## 5. POAS consensus notes the bridge must respect

- POAS = a bonded **authority set** (up to 38) producing blocks; no PoW. Validators are the same entities that sign bridge actions and hold the threshold key shares.
- **DIVA finality** for bridge purposes is defined by the **checkpoint into DIVI**, not just DIVA block depth: once DIVA's block containing a burn has been checkpointed into a **confirmed DIVI block**, it is safe to act on the Divi side. This is the anti-deep-reorg guarantee. **[BUILDER]** may also accept a shallower "N DIVA blocks + validator attestation" fast-path for good UX, with the checkpoint as the hard finality.
- The federation's threshold key (for signing mints/releases and for content-key rewraps) is **split across validators**; rotation on validator set changes is a **[BUILDER]** concern — spec it explicitly, because a naive rotation can strand in-flight transfers.

---

## 6. THE NFT LOCK-AND-RELEASE PROTOCOL

Two contracts/relayers, one invariant. The **bridge's Divi address** (`BRIDGE_DIVI`) is a federation-controlled address (threshold-signed). The **DIVA bridge contract** (`NFDBridge721`) is the ERC-721 + gate.

### 6.1 LOCK — Divi → DIVA (user gets an ERC-721)
1. **User** issues an NFD **transfer record** (DVXP 0x02, subtype *transfer*) reassigning the NFD to `BRIDGE_DIVI`, and includes the **destination DIVA address** in the record (a dedicated field or the record memo). The content key is **rewrapped to the federation key** (threshold-wrapped) as part of this transfer.
2. **Federation watchers** see the transfer, call `verifynfd` to confirm the NFD is now owned by `BRIDGE_DIVI` and the record is **final** (see §7 depth), and read the canonical NFD id, `thumb_ptr`, `traits_ptr`, collection id, and Arweave content pointer.
3. Federation reaches **26/38 quorum** and produces a signed **mint authorization** binding: `nfd_id → tokenId`, destination DIVA address, and a metadata commitment (thumb/traits/content pointers, collection id).
4. Anyone (typically a relayer, or the user) submits that authorization to `NFDBridge721.mintFromLock(...)`. The contract **verifies the quorum signature**, checks the `nfd_id`/nonce hasn't been used, and **mints the ERC-721** to the destination address with `tokenURI` pointing at the same thumbnail/metadata.
5. Emitted event `Locked(nfd_id, tokenId, to)` closes the loop.

**Result:** NFD parked at `BRIDGE_DIVI`; one ERC-721 live on DIVA. Invariant held.

### 6.2 RELEASE — DIVA → Divi (holder gets the NFD back)
1. **ERC-721 holder** calls `NFDBridge721.burnToRelease(tokenId, diviDestAddress)`. The contract **burns** the token and emits `Released(nfd_id, tokenId, diviDestAddress, nonce)`.
2. **Federation watchers** see the `Released` log, wait for **DIVA finality via the DIVI checkpoint** (§7), and reach **26/38 quorum**.
3. Federation issues an NFD **transfer record** on Divi moving the NFD from `BRIDGE_DIVI` to `diviDestAddress`, and **rewraps the content key to the new owner** (the returning holder) so they can decrypt the art again. (Rewrap needs the content-key material — see §6.4.)
4. `verifynfd` now shows the user as owner. Done.

**Result:** ERC-721 destroyed; NFD owned by the user on Divi. Invariant held.

### 6.3 Metadata mapping
- **tokenId** = a deterministic function of the **canonical NFD id** (e.g. `uint256(keccak(nfd_id))`), so the same NFD always maps to the same tokenId (idempotent, replay-safe).
- **tokenURI** → the **public thumbnail + traits** (already unencrypted, already on Arweave/immutable). Marketplaces on DIVA render these with zero key access.
- **Collections:** carry the Divi **collection id** into an ERC-721 collection/attribute so a bridged item keeps its set identity and rarity. Bridging a whole 240-set = 240 locks (or a **[BUILDER]** batch-lock record; the Divi side already needs batch-mint, reuse that codec).

### 6.4 The content-key wrinkle (the NFT-specific hard part) — **[BUILDER] decision**
Because art is encrypted to the owner, "who can view the full art while it's on DIVA?" must be answered:

- **Option A — view only after release (simplest, recommended for v1).** On DIVA the ERC-721 shows **thumbnail + traits only**. Full art is decryptable again once released to a Divi owner (federation rewraps to them on release, per §6.2 step 3). The federation holds the threshold-wrapped CK while locked. Clean, minimal, and the thumbnail already gives marketplaces what they need.
- **Option B — viewable on DIVA via threshold rewrap.** When the current ERC-721 holder wants to view, the federation (at the **30/38** decryption quorum) rewraps the CK to that holder's key. More powerful (art usable on DIVA), but it's a live decryption service and must obey the same disclosure discipline as the private-contracts committee. Defer to v2.

Either way: the **CK never lives in plaintext on-chain**; it moves only as threshold-wrapped material held by the federation while the NFD is locked.

### 6.5 Replay / double-spend / idempotency
- Each lock/release carries a **nonce**; `NFDBridge721` records used `nfd_id`+nonce and **rejects reuse**.
- `mintFromLock` is idempotent per `nfd_id` (deterministic tokenId + "already minted" guard) so a resubmitted authorization can't double-mint.
- The Divi side rejects a second lock of an NFD already owned by `BRIDGE_DIVI`.

---

## 7. Reorg & finality handling (get this right or you break the invariant)
- **Divi (UTXO) source events** (a lock): wait **[BUILDER: default 10–20 confirmations]** before minting on DIVA. UTXO reorgs revert overlay records too, so acting too early risks minting against a lock that vanishes.
- **DIVA source events** (a release burn): wait until the DIVA block is **checkpointed into a confirmed DIVI block** before issuing the Divi-side transfer. This is the strong guarantee; a shallow-depth fast path is optional UX, never the hard gate.
- **Crash-safety:** all federation state (seen locks, pending mints, issued releases) must be **persisted and idempotent**, so a validator restart re-derives the same decisions and never double-acts.
- **Timeouts / stuck transfers:** define a reclaim path **[BUILDER]** — e.g. if a lock is confirmed but mint never completes, the federation can, at quorum, re-issue the mint; a release that can't complete on Divi must never silently burn value (the ERC-721 burn and the Divi transfer must be two-phase or reconcilable).

---

## 8. DIVA-side contract surface (interfaces, not implementation)
`NFDBridge721` (ERC-721 + gate). Concrete signatures for the builder:
- `mintFromLock(bytes nfdId, address to, uint256 nonce, MetaCommit meta, Quorum sig)` — verifies quorum, mints deterministic tokenId, emits `Locked`.
- `burnToRelease(uint256 tokenId, bytes diviDest)` — burns, emits `Released(nfdId, tokenId, diviDest, nonce)`.
- `Quorum sig` verification path: Solidity N-of-M `ecrecover` for v1 → BLS/FROST precompile for production.
- Views: `nfdIdOf(tokenId)`, `isLocked(nfdId)`, `tokenURI(tokenId)`.
- Admin: **validator-set update** gated by quorum (mirrors POAS set changes); pausability for incident response, itself quorum-gated (no unilateral admin key).

## 9. Divi-side relayer/watcher responsibilities
- Subscribe to new blocks; parse OP_META for **DVXP 0x02** records to/from `BRIDGE_DIVI` (reuse `dvxp.rs` scanning + `nfd_record.rs` decode; do **not** re-implement the codec).
- Use **`verifynfd`** for authoritative owner/state confirmation.
- Hold and operate the **threshold key** for: signing DIVA mint authorizations, issuing Divi transfer records from `BRIDGE_DIVI`, and CK rewraps.
- Persist idempotent state; expose health so the DFlow/ops panels can watch it.

## 10. Open decisions for the builder (**[BUILDER]**)
1. Quorum-signature scheme on DIVA: Solidity multisig (v1) vs BLS/FROST precompile (prod).
2. Confirmation depths (Divi lock; DIVA fast-path if any) and the exact checkpoint-finality wait.
3. Content-key: Option A (view-after-release) for v1 vs Option B (threshold rewrap on DIVA) for v2.
4. Batch-lock a collection vs per-item locks.
5. Threshold-key **rotation** on validator-set change without stranding in-flight transfers.
6. Reclaim/timeout semantics for stuck locks and releases (must be two-phase/reconcilable).

## 11. Security must-haves
- No unilateral admin: every privileged action (mint, release, pause, set-update) is **quorum-gated**.
- CK never in plaintext on-chain; disclosure/rewrap obeys the private-contracts committee discipline (§6.4, 30/38).
- Idempotent, persisted federation state; two-phase release so a burn can never destroy value without a matching Divi transfer.
- Reuse the **vendored `dvxp-core` codec byte-for-byte** — the wallet and indexer already depend on it; a re-implementation that drifts will silently corrupt records.
- The bridge's economic security still leans on the federation honesty + the DIVI checkpoint; document the trust assumption plainly for users.

---

### Prerequisite reminder
This bridge **cannot be built or tested until a DIVA chain (even a devnet geth with a stand-in PoA/POAS set) is running.** Recommended first milestone: stand up a DIVA devnet, deploy `NFDBridge721` with the Solidity multisig gate, and prove a single NFD **lock → mint → release** round-trip on regtest-Divi ↔ devnet-DIVA before hardening finality, batching, and the BLS precompile.
