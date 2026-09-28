# DiviStore — Status Audit, Deeper-Audit Plan, and Admin Panel Spec

**What this is:** the front-door status + forward plan for **DiviStore**, Divi/DIVA's own Arweave-style paid storage market (node operators earn by storing data, encrypted or not).
**Audience:** any agent picking up DiviStore work. Read this, then the build plan at `/Users/geoffreymccabe/diva/STORAGE_PLAN.md` (the phase-by-phase source of truth) and the contracts in `/Users/geoffreymccabe/diva/bridge/contracts/`.
**Scope note:** this doc does **not** ask for integration with DD69, GoBanq, LW-SSO, or divid. It covers (1) what exists, (2) how to audit it fully, (3) essential missing parts to build, and (4) a detailed, modular **admin panel** to control it all.
**Status date:** 2026-Sep-27. All code verified by reading it, not from claims.

---

## 1. Verified status (the audit)

**One line:** the storage *engine* is largely built and tested, but it is a standalone prototype on the local DIVA devnet, connected to none of the other apps, and the Arweave permanence leg is not wired.

**Everything lives in `/Users/geoffreymccabe/diva`:** contracts in `bridge/contracts/`, the node + agent in `storage/`, the plan in `STORAGE_PLAN.md`. A grep across DD69, divid core, GoBanq (`divigo-gobanq`), and the SSO repos (`sso`, `sso-aww`, `sso-cnft`) found **no** DiviStore references anywhere outside `~/diva`.

### 1a. Built and tested (on the devnet)
- **On-chain economics on DIVA (the hard part, working end to end):** `StorageRegistry` (pay-to-store), `ProviderRegistry` (operators bond, slashable), `ProofOfStorage` (random Merkle-proof challenges verified on-chain), `FeeDistributor` (pays providers for verified bytes). All deployed on the devnet with passing tests.
- **Node software:** a content-addressed storage daemon + gateway (`storage/divistore-node.mjs`: PUT/GET/HEAD by sha256, disk quota, pins only if paid), upload/retrieve tools (`divistore-put.sh` / `divistore-get.sh`), and an **autonomous earning agent** (`storage/divistore-agent.mjs`: auto-registers held content, auto-answers challenges, auto-claims pay).
- **Native NFT service:** `DivaNFT` + `DivaNFTFactory` (create a collection and mint storage-backed NFTs with no custom storage code).
- **Multi-node redundancy** with fallback (store to two nodes, kill one, still served, integrity verified). Real, but this is redundancy between DiviStore nodes, **not** Arweave.
- **Quantum-resistant encryption module (BUILT 2026-Sep-27):** hybrid X25519 + ML-KEM-768 wrap over AES-256-GCM. Self-contained + tested. See section 5.

### 1b. Connection scorecard
| System | Status |
|---|---|
| **DIVA / POAS** | Fully connected: DiviStore *is* DIVA contracts; providers bond the native coin. Caveat: contracts are deployed+tested but **not yet predeployed at genesis** (not canonical on every node yet). |
| **Divi (divid core)** | Not connected, correctly. DiviStore is a DIVA thing; bytes are off-chain; the UTXO core needs no change. |
| **DD69 app** | Not connected. No operator dashboard; the agent runs as a standalone script. The NFD storage seam (`crates/supervisor/src/nfd_storage.rs`) exists only on branch `feat/nfd-collectibles`, not `main`, and no DiviStore backend is written for it. |
| **Arweave (double-storage)** | Not wired. Design complete and `StorageRegistry` has a field for the Arweave id, but there is **no working Arweave upload code**. Blocked on a funded upload key (Turbo/Irys) + a small relay. |
| **LW-SSO** | Zero connection. |
| **GoBanq** | Zero connection. The "GoBanq runs it centrally for all apps" idea is not started. |

### 1c. Modularity (good news for a shared service later)
Built modular on purpose: contracts expose swappable **seams** (settable `slasher`, settable `accountant`), a reusable `MerkleProof` library, and `ProviderRegistry` is reusable for any bonded role. The daemon is plain Node with no exotic dependencies. So it is well-positioned to become one shared service every app calls, though nothing consumes it centrally yet.

### 1d. Honest "how done is it?"
- **Engine / economics / native NFT:** ~80-90% of an MVP, proven on a devnet.
- **Production readiness:** low. It is devnet-only, single-operator-trust, no Arweave, no admin controls, no abuse limits.
- **Ecosystem integration:** 0%.

---

## 2. Deeper-audit plan (do this before building more)

A structured pass to confirm the prototype is actually sound, module by module. Each item = read the code, run/inspect the test, note gaps.

1. **Contracts (`bridge/contracts/`):**
   - Re-read `StorageRegistry`, `ProviderRegistry`, `ProofOfStorage`, `FeeDistributor`, `DivaNFT(+Factory)` for: access control (who can call privileged functions), integer/accounting safety (over-credit, double-pay, reentrancy), and the seam wiring (is the slasher/accountant actually set to the right addresses on the devnet?).
   - Confirm the proof math: can a provider pass a challenge **without** actually holding the bytes? Confirm the random-chunk selection is not gameable and the time bound is enforced.
   - Confirm pay-once-store-forever accounting: does expiry actually gate pinning and eviction?
2. **Storage daemon + gateway (`storage/divistore-node.mjs`):** hash verification on PUT, 402-if-unpaid, quota enforcement, eviction of unpaid/expired, integrity check on GET, and behavior under a corrupt or truncated blob.
3. **Provider agent (`storage/divistore-agent.mjs`):** does `watch` mode correctly and safely auto-answer only challenges for content it truly holds, and never leak anything it should not? Does it recover after a crash without double-claiming?
4. **Economics end to end:** run the full bond -> store -> prove -> earn / miss -> slash loop and verify the numbers (credited bytes == real size, no double-pay, cooldowns actually stop reward-farming). The git log claims these passed; re-verify.
5. **Durability:** kill nodes mid-serve, restart, confirm repair intent and that data survives an unclean crash (archive mode).
6. **Trust assumptions:** write down exactly what is trusted today (we run the bonded nodes; proofs exist but operators are not yet adversarial). This defines what P12 must harden.

**Output of the audit:** a short findings list (confirmed-good vs gap vs bug), feeding section 3.

---

## 3. Essential missing parts to build (DiviStore standing on its own)

Not integration. These are the pieces DiviStore itself needs to be a real, safe product.

1. **Arweave permanence leg (P4/P5 blocker):** the actual upload path (Turbo/Irys), tagged with our sha256 content hash, id recorded in the registry, plus read-fallback and the extra-fee wiring. Needs a funded key + a small relay. This is the highest-value gap.
2. **Genesis predeploys (make it canonical):** predeploy `StorageRegistry`, `DivaNFT`, `DivaNFTFactory` at fixed well-known addresses on every DIVA node from genesis, so the native NFT service is "always present" (like Multicall3's universal address). Additive, no consensus fork-debt.
3. **Repair / re-replication loop:** when a provider fails a proof, exits, or goes dark, automatically re-replicate its blobs to healthy providers to keep the replication target. Currently only intended, not built.
4. **Abuse / DDoS / backpressure limits:** rate limits, per-IP and per-key caps, gateway abuse protection, and confirmation that must-be-paid-to-pin + quotas + eviction fully prevent free unbounded storage.
5. **Pricing / monetization engine (feeds the admin panel, section 4):** a real price model (per byte, per tier, per duration), a USD-denominated price via oracle, and multi-asset payment. Today pricing is a fixed amount in the native coin.
6. **Gateway hardening / CDN:** cacheable public reads, content-type handling, and a resolver that stays content-addressed and verifiable.
7. **Operator safety rails:** graceful pause (triggers repair notice), retire-with-data-migration, and clear slashing warnings so an honest operator is never surprised.
8. **Proof hardening (P12):** proof-of-replication and a path to less-trusted/open operators, once the MVP is stable.

---

## 4. Admin Panel plan (the main deliverable) — detailed and modular

A control surface for the whole DiviStore market: see the nodes, see what they store (metadata only, never plaintext), and understand + adjust monetization, including multi-currency and multi-crypto.

### 4.0 Design principles
- **Modular + backend-agnostic:** the panel is a set of independent modules that read from two sources only: (a) the DIVA contracts (via read-only RPC) and (b) each provider node's status API. No app-specific coupling, so the same panel can later be hosted anywhere (a DD69 panel, a standalone web admin, or a GoBanq-run central console). Build it as a standalone module with a thin data layer, so the host is a swap, not a rewrite.
- **Read-mostly, permissioned writes:** viewing is broad; every state-changing control (adjust price, slash, pause, change accepted assets) is a privileged action gated by an admin key / role, and every such action is logged.
- **Encryption is never broken (hard rule):** DiviStore only ever holds **ciphertext** (customer keeps the key). The panel therefore shows only **metadata**: content hash, size, tier, payer address, which providers hold it, paid/expiry, proof pass/fail, timestamps. It **cannot** show plaintext, cannot decrypt, and must never offer a "view content" that would require a key. For a public thumbnail (NFD's optional unencrypted thumb) it may show that, because it is already public by the creator's choice; everything else is opaque bytes by hash.
- **No silent money moves:** the panel can *configure* and *trigger* payouts/slashes, but shows a confirmation with amounts and destinations first (normal care with crypto).

### 4.1 Modules (each independent)

**A. Providers / Nodes.**
- Table of every provider: address, gateway URL, bonded amount, capacity vs used, uptime, region (if given), status (active / paused / slashed / retiring).
- Per-node drill-in: proofs passed/failed over time, earnings accrued/claimed, blobs held (count + total bytes), last-seen heartbeat, disk used vs quota.
- Controls (privileged): flag/slash a misbehaving node (via the `slasher` seam), force a re-replication of its data, mark for retirement.
- Data source: `ProviderRegistry` + `ProofOfStorage` (chain) + each node's status API.

**B. Content / Blobs (encryption-preserving).**
- Search/browse by content hash. Columns: hash, size, tier (Standard/Permanent), payer, replication count (how many providers hold it), paid state + expiry, Arweave id (if permanent), last proof result.
- **No plaintext, no decrypt, ever.** Only the public thumbnail may render, and only when flagged public.
- Controls (privileged): force extra replication of a hash, trigger an Arweave mirror for a hash, mark a hash for eviction review (e.g. abuse report) — note: eviction is availability only; a permanent-tier blob on Arweave persists regardless.
- Data source: `StorageRegistry` + node "which hashes do you hold" APIs.

**C. Proofs & Health.**
- Live view of challenge activity: challenges issued, response times, pass/fail rate per node and network-wide, current replication health (are all paid blobs meeting their replication target?), repair queue.
- Alerts: node missed N proofs, blob under-replicated, disk near full, heartbeat lost.
- Data source: `ProofOfStorage` events + repair loop state.

**D. Monetization / Economics (view).**
- Dashboards: total bytes stored, revenue in, fees paid to providers, treasury balance, per-tier volume, revenue by asset, provider earnings leaderboard, margin (revenue minus provider payouts minus Arweave cost).
- Data source: `FeeDistributor` + `StorageRegistry` + pricing engine.

**E. Monetization / Pricing controls (adjust) — MULTI-CURRENCY + MULTI-CRYPTO.**
This is the module Geoff specifically wants to be flexible.
- **Price model editor:** set price per byte, per tier (Standard vs Permanent), per storage duration; set the provider payout share vs treasury margin; set the Arweave-tier surcharge.
- **USD-denominated base price via oracle:** the canonical price is set in USD (or another fiat), and converted at pay time via a price oracle, so a volatile coin price does not silently move the real cost. Admin sets the fiat number; the panel shows the live crypto-equivalent.
- **Multi-crypto accepted assets:** a settable list of assets a customer may pay in — the native coin (Divi), plus bridged assets (dUSDC, dUSDT, dBTC) and potentially others. Per-asset settings: enabled on/off, oracle feed, a small per-asset fee/spread, and a min-payment floor. A customer pays in any enabled asset; the registry records which asset + amount.
- **Multi-currency payouts:** providers can be paid in a chosen asset (their preference), independent of what customers paid in; the treasury absorbs the conversion. Admin sets which payout assets are offered and the conversion policy.
- **Controls are privileged + logged**, with a confirmation screen showing old vs new values before commit.
- Data source/target: a new **pricing engine** (section 3.5) that the registry reads at pay time; the panel writes its parameters.

**F. Treasury & Payouts.**
- View treasury balances per asset; trigger/schedule provider payout runs; view claim history; set payout cadence.
- Every payout shows amounts + destinations before commit.

**G. Slashing & Disputes.**
- Queue of slashing events (auto from failed proofs) and any manual flags; review, confirm, or reverse (within policy); operator appeal notes.

**H. Audit log & Alerts.**
- Immutable log of every privileged action (who, what, when, old->new). Configurable alerts (email/webhook later) for health and economic thresholds.

### 4.2 Permissions
- **Viewer:** all read modules.
- **Operator-admin:** health/repair controls.
- **Economics-admin:** pricing, accepted assets, payouts.
- **Superadmin:** slashing reversal, role management.
Roles are enforced by the data layer, not just the UI.

### 4.3 Build order (admin panel)
1. Read-only data layer (chain RPC + node status API adapters) — the foundation every module reads through.
2. Module A (Providers) + Module C (Proofs/Health) — the operational picture.
3. Module B (Content, encryption-preserving) — with the hard no-plaintext rule baked into the data layer.
4. Modules D + E (Economics view, then the multi-currency/multi-crypto pricing controls). E depends on the pricing engine in section 3.5 existing.
5. Modules F/G/H (Treasury/Payouts, Slashing, Audit log).
6. Harden permissions + logging across all modules.

### 4.4 Open decisions (for Geoff)
1. **Where the panel is hosted first:** standalone web admin, a DD69 panel, or built to be GoBanq-hostable from day one (his central-service idea). The modular data layer makes this a late choice, but it affects auth.
2. **Which assets to accept at launch** (Divi only, or Divi + dUSDC/dBTC immediately).
3. **Fiat base currency** for pricing (USD assumed).
4. **Who holds the admin roles** and how the admin key is secured.

---

## 5. Quantum-resistant encryption (BUILT)

Built 2026-Sep-27, standalone and tested, at **`/Users/geoffreymccabe/diva/storage/crypto/`** (`divistore-crypto.mjs` + `test.mjs` + README). It is the canonical DiviStore encryption module and is app-agnostic, so NFD, GoBanq, or any ecosystem app can reuse the exact same thing.

- **Design:** content is AES-256-GCM under a random content key (already quantum-safe); the content key is wrapped to the recipient with a **hybrid** of classical **X25519** + post-quantum **ML-KEM-768** (FIPS 203), combined through HKDF-SHA256. An attacker must break **both** to recover the data, which defeats "harvest now, decrypt later," and it is no weaker than today if ML-KEM were ever found flawed.
- **Verified:** 6 tests pass, including two that prove **each half is individually load-bearing** (a correct classical key with the wrong PQC key fails, and the reverse), so the hybrid is real, not decorative.
- **Dependency:** `@noble/post-quantum` (Paul Miller's audited noble library, MIT, zero runtime deps, ~484k weekly downloads; provenance verified, `ignore-scripts=true`). Node 20's bundled OpenSSL does not expose ML-KEM, so a native-stdlib version was not possible; the audited pure-JS library was the responsible choice.
- **⚠ Integration constraint (measured):** the ML-KEM ciphertext is **1088 bytes**, so the wrapped key does **not** fit in a Divi OP_META record (~596-byte budget). The wrapped key must live in the **off-chain envelope** with the content, never on-chain. Recipients also need two keypairs (X25519 + ML-KEM), so wallet key management must derive/store both.
- **Status:** the module exists and is tested standalone. It is **not yet wired into** NFD, the storage client, or GoBanq (deliberately, per the "do not integrate yet" scope). Adopting it is a later, small step for each consumer.
- **Audit (2026-Sep-27):** reviewed against the recognized standard for this exact hybrid (X-Wing / NIST SP 800-56C). **No exploitable bug found.** Hardening applied: the KDF now transcript-binds a domain label + ephemeral X25519 + the recipient's static X25519 + the ML-KEM ciphertext; the scheme is bound as AES-GCM AAD on both layers; a non-contributory (all-zero) X25519 secret is rejected; and envelope fields get strict length/presence validation. Test suite expanded to **20 groups, all passing** (every tamper vector rejected, malformed input rejected, both hybrid halves proven individually load-bearing, 200 unique-ciphertext round-trips). Residual: JavaScript is not guaranteed constant-time (noble aims to be), and a professional human crypto review is still recommended before this guards real decades-long data.
- **Integration + UI/UX: not built yet, so nothing to audit there.** The "adopted/integrated" and "UI/UX" parts of a full review do not exist by design (scope was crypto-only). When integrated, correctness will hinge on: (a) storing the ~1088-byte wrapped key in the off-chain envelope, not OP_META; (b) wallets deriving/holding BOTH keypairs (X25519 + ML-KEM) from the seed; (c) a UI that shows a blob's protection level honestly (quantum-safe vs not) without ever exposing plaintext; (d) key-rotation/re-wrap on transfer carrying the hybrid wrap.
- **Module now feature-complete for its standalone scope (2026-Sep-27):** added **transfer** (`rewrap` re-wraps the key to a new owner without re-encrypting content, so sales/gifts do not re-upload the blob), **deterministic key derivation from a wallet seed** (`deriveRecipientKeypair`, so keys come from the user's seed, not random), standalone key-wrap primitives (`wrapKeyFor`/`unwrapKey`), and a **language-neutral wire-format spec** (`FORMAT.md`) so a Rust version can interoperate. Tests now **28 groups, all passing** (adds transfer chain A→B→C and seed determinism). Files in `/Users/geoffreymccabe/diva/storage/crypto/`.
- **Known remaining limitation (documented, not a bug):** content is encrypted in one AES-GCM operation, which is fine for typical blobs but not ideal for very large files (multi-GB) or memory-constrained streaming. A chunked/streaming AEAD variant is the future add if DiviStore needs huge-file support. Everything else for the standalone module is done; the next real steps are integration (deferred) and a professional human crypto review.

## 6. Cross-links
- Build phases + test log: `/Users/geoffreymccabe/diva/STORAGE_PLAN.md`
- Contracts: `/Users/geoffreymccabe/diva/bridge/contracts/`
- DIVA front door + canonical decisions (incl. the unified one-coin/Divi model): `/Users/geoffreymccabe/Divi-Desktop-6.9/docs/DIVA-INDEX.md`
- Note on the coin: pricing/bonding "in DIVA" means **Divi** (the unified native coin), per DIVA-INDEX §1.
