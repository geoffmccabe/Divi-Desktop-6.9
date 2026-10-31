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

### 2.5 Address & identity model: one key, two faces, one name (added 2026-Oct-30)

**The question answered here:** can a Divi address and its DIVA address be the same, so bridging round-trips to "the same you"? Functionally yes; literally (identical string) no, and this section fixes why and how.

**Not the identical string, and why we reject forcing it.** A Divi address and a DIVA (EVM) address are both 20 bytes, but derived from the public key by *different* hashing recipes: Divi uses the Bitcoin recipe (`hash160` = RIPEMD160(SHA256(pubkey)), wrapped in Base58Check with a version byte — the leading `D`), the EVM uses the last 20 bytes of `keccak256(pubkey)`, hex with `0x`. Same key in, different bytes out. To make the bytes identical we would have to change how the EVM derives an account address from a key and from a signature (`ecrecover`, CREATE/CREATE2, every tool). That breaks compatibility with MetaMask, hardware wallets, and all standard EVM libraries, which is the whole point of being a normal EVM chain. **Rejected.** We embrace "two faces of one key," not "one string."

**The good news that makes it work: same curve, same key.** Divi and the EVM both use **secp256k1**. The private/public key is *identical* across both chains; only the derived address differs. So a single seed already controls both your Divi address and your DIVA address. That is as close to "same address" as the math allows, and it is enough.

**Auto-routing round-trip (the real goal, achievable).** No manual address entry is needed in either direction:
- **Bridging out of Divi:** spending a Divi UTXO reveals the owner's public key in the input (standard P2PKH, no SegWit on Divi). The bridge takes that pubkey, derives the owner's DIVA (EVM) address itself, and delivers there.
- **Bridging back from DIVA:** the EVM signature reveals the same pubkey (`ecrecover`), so the bridge derives the Divi `hash160` address and delivers home.
Because both faces come from one key, the mapping is deterministic and needs no registry: given the key, both addresses are fixed and computable. Value always returns to the same owner.

**The name layer IS the Divi HRA project — not a second namespace.** "DIVA:geoff" must resolve to the *same* `GEOFF` that lives in the Divi Human-Readable-Address registry (DVXP record type **0x05**, one namespace shared with DMT tickers, uppercase-ASCII, OP_META, no fork — built and regtest-proven; see `/Users/geoffreymccabe/Divi-Desktop-6.9/docs/HUMAN-READABLE-ADDRESSES.md` and the `name-registry` crate). A separate DIVA naming system is **forbidden**: two namespaces means `GEOFF` the person and `GEOFF` owned by someone else, which is exactly the impersonation hole the "one namespace" decision closes.

Design for resolving a name on DIVA:
- **Divi stays the single source of truth.** Names are registered, owned, transferred, renewed and expired on Divi. DIVA does not run a competing registry; it **reads** the Divi name state through the same per-epoch registry-root / checkpoint path this bridge already defines for NFD ownership (§3 onward).
- **Add a DIVA-address pointer to the name record,** exactly like ENS holds addresses for several chains under one name. `GEOFF` then carries both a Divi-address record and a DIVA-address record. The owner sets it; it needs the same both-directions-agree (reverse-resolution) check the HRA design already requires, so a name can never display as someone else.
- **Same-key users get it for free:** the wallet derives the owner's DIVA address from the one key and fills/proves the pointer automatically. A user who wants a *different* DIVA address sets it by hand.
- **"DIVA:" is a resolver/display hint only,** never part of the stored name (the stored name is just `GEOFF`). Keep it out of the on-chain record, and note that `DIVA` could itself be a registered name, so the prefix must stay a UI convention, not a namespace.

**Status.** The Divi/HRA half is built and regtest-proven. The DIVA-address pointer record type and the DIVA-side resolver are **to-build**, and they ride the registry-root / checkpoint path, which is itself gated on the network + POAS landing (see `DIVA-2-NODE-LAUNCH-PLAN.md`). This is a clean extension of locked architecture, not a new design.

### 2.6 Cross-chain state model: known on both sides, active on one (added 2026-Oct-31)

**Goal (Geoff):** both chains should know the ownership registry of everything on either chain (NFDs, names, tokens), and a user should be able to transact on one chain with an asset that currently lives on the other, in one action, without planning or doing two manual steps.

**The safety rule this is built on:** an asset is **canonical on exactly one chain at any moment.** "Known on both" (information) is unlimited and encouraged; "transferable on both at once" is forbidden (it is a double-spend). The other side either knows the asset read-only, or holds a locked original / burned wrapper while it is active elsewhere.

**2.6.1 The information mirror (both chains know the whole registry).** Use the signed registry-root mechanism (`/Users/geoffreymccabe/Divi-Blockchain_6.9/docs/NFD-REGISTRY-ROOT.md`) in both directions: Divi→DIVA via per-epoch (hourly) ownership roots, DIVA→Divi via the per-Divi-block tip checkpoint already in §1. How complete the on-chain knowledge is, is a choice:
- **Root only (light):** the chain stores the 32-byte root; ownership is proven on demand with a small proof. Scales to any count.
- **Full on-chain mirror:** a contract holds every item's id→owner, refreshed each epoch. Lets on-chain logic read ownership directly, but storage/gas grow with the item count.
- **Hybrid (recommended):** anchor the root on-chain (cheap, authoritative) and keep a full, fast, queryable copy in an off-chain index/API for wallets and apps, with proofs available whenever trustlessness is needed.

Extends beyond NFDs by the same pattern: **HRA names** (one name resolvable on both, §2.5), **DMT tickers / fungible registry** (shared namespace, so each chain knows which tickers exist and who owns them), and **Proof-of-Existence timestamps** (DIVA can verify "registered on Divi at time T", useful for art/POE clients).

**2.6.2 Asset-location passport.** Give every bridgeable item a small location status carried in the registry: its **home chain** (where launched) and its **currently-active chain**. Both chains mirror it; the wallet always shows where an item lives and offers a one-click "bring it here." The lock sets the flag and the mint reads it, so double-activation is structurally impossible, not merely discouraged.

**2.6.3 Transacting across the boundary in one action (the key UX).** Scenario: owner holds a Divi-born NFD not yet on DIVA and wants to sell/use it on DIVA.

- **Unavoidable:** the asset must be locked on Divi (only the owner's Divi key can authorize that) before it mints on DIVA. So there is always a Divi signature. What we remove is the *manual two-step*, not the signature.
- **One approval, two legs.** Because one secp256k1 key controls both chains (§2.5), the wallet signs the Divi lock and the DIVA action in a single confirmation and orchestrates the rest. One click for the user.
- **Honest latency.** The DIVA side must wait for the Divi lock to be **final** (about 1 to 3 minutes: ~1-minute Divi blocks, 1-2 confirmations) before completing. Pair this with a transparent UI: "This item is on Divi; selling it here brings it over first, up to about N minutes. Proceed?" (Geoff's option 3, which is the right default, combined with the automatic option 1.)
- **Hide the wait behind browsing:** start the bring-over the moment the owner **lists**, not when a buyer commits. By the time a buyer appears the item is already a native DIVA NFT and the sale is instant and normal. The DIVA marketplace contract must never accept a sale of an item that is not yet finally minted on DIVA.

**2.6.4 The fast-lane, and why the naive version is unsafe (correction, 2026-Oct-31).** A tempting "instant" path is to act on the **unconfirmed Divi mempool** lock and mint on DIVA immediately. The cheapest attacker against this is **the owner double-spending their own unconfirmed lock**: broadcast the lock, let DIVA mint and the sale complete, then get a conflicting Divi tx mined so the lock never happened, keeping both the asset and the proceeds. This is a cheap mempool trick, NOT a "massive stake control" attack, so an unconfirmed lock must never be treated as final.
- **Fungibles (DMT, stablecoins):** a safe instant path exists via an **underwriter/solver** who fronts the amount and is repaid on finality, eating the loss (or claiming a posted bond) if the lock fails. Proven elsewhere (Mayan, deBridge); price the risk as a small fee. OK to offer.
- **Unique NFTs/NFDs:** do NOT offer the unconfirmed-mempool path by default. A unique item cannot be fronted from a pool, and a completed sale against a failed lock leaves the buyer with a worthless wrapper and no clean unwind. If an instant NFT lane is ever wanted, it requires an explicit underwriter accepting unique-asset risk plus an owner bond, and it is a later nicety, not the foundation. Default for NFTs is finality-gated (2.6.3).

**2.6.5 Trust and status.** As everywhere, the mirror and the lock-attestation are only as trustworthy as who signs the roots and the mint/release quorum. Today that is effectively one key; it becomes trust-minimized only once POAS and the validator set exist. Built today: the Divi-side NFD registry + roots, HRA. To-build: the DIVA-side mirror contract/index, the location-passport flag, the one-approval two-leg wallet flow, the fungible fast-lane; and the symmetric gap from §3 (a DIVA-*origin* NFT moving to Divi needs the NFD format to carry a foreign-origin pointer).

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
