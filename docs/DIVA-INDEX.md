# DIVA — Master Index

**The front door for the DIVA side-chain work.** Read this first, then the linked docs.

**What DIVA is:** Divi's EVM side-chain — a **fork of BNB Chain (BSC)**, whose **Parlia engine is Proof-of-Staked-Authority = our POAS**. Green (no PoW), anchored into DIVI by signed per-minute checkpoints. chain ID **1838**.

**Reality check (2026-Sep-01):** there are **two workstreams**, and they are not fully in sync:
- **Design layer** = these `docs/DIVA-*.md` files in the DD69 repo (decisions, specs).
- **Build layer** = a real, running implementation at **`/Users/geoffreymccabe/diva`** (its own git repo, a live local devnet, deployed contracts). This is where the actual code lives.

There is **one unresolved conflict between the two that blocks further core building — see §1.** Do not treat any "decision" here as final over the running code until §1 is settled.

**Last updated:** 2026-Sep-01 (rewritten to match the `~/diva` build reality)

---

## 1. ⚠ OPEN DECISION — the token model (BLOCKS Phase 2/3, needs Geoff)

This must be decided before the consensus and bridge work hardens, because you stake and peg differently depending on the answer.

- **What the BUILD (`~/diva`) has locked and is building on — the TWO-COIN model:** **DIVA** = a separate, sellable native gas + staking coin (its purpose is to *fund the project*); **dDIVI** = a separate bridged ERC-20 backed 1:1 by locked DIVI, used for value/DeFi, **not** gas by default; and *"do not force DIVA and dDIVI to 1:1 parity"* (avoids a Gresham's-law arbitrage).
- **What Geoff leaned toward in design discussion — the UNIFIED model:** **Divi is the one coin**, bridged 1:1 to *be* the native gas; DIVA is only the chain's name (Base:ETH :: DIVA:Divi). Cleaner "connected side chain" story; but it removes the sellable-coin fundraising path, so team/founder funding would move to a **separate governance/revenue token** and/or a **vested Divi allocation**.

**Status: UNRESOLVED.** The build is on two-coin; the design leaned unified. A prior version of this file wrongly called "unified" canonical — it is not. **Geoff to choose.** Trade-off in one line: *two-coin = you can sell DIVA to raise funds, at the cost of a second coin and some confusion; unified = one clean Divi story, at the cost of the DIVA-sale fundraise (replace with a governance token).*

---

## 2. Settled decisions

### 2a. Locked in the build (`~/diva`), proven or in progress
| Area | Decision |
|---|---|
| Base client | Fork of **BSC** (Parlia = POAS). Vanilla geth removed CLI block production; BSC was the right base. |
| Chain ID | **1838** (live on the local devnet + explorer). |
| Empty blocks | **On-demand only — verified.** No blocks when idle; one tx → one block. Optional slow ~1/min heartbeat aligned to checkpoints. |
| Consensus target | **POAS** — authority tier for launch liveness + open staked validators, **1,000,000** bond, **38** active cap, standby rotation, slashing. (Engine not built yet — see §3.) |
| Finality | **Per-DIVI-block (~1 min) signed checkpoint** of the DIVA tip into DIVI OP_META. Precedent: Komodo dPoW, Polygon→Ethereum. |
| Bridge trust | **Validator-federated peg** (POAS validators = signer set; no new trust party). Flagged in-build as *"the hardest, most security-critical piece."* |
| Footprint | Pruned full nodes (never archive); idle RSS ~38MB measured → 4GB boxes are fine. |

### 2b. Decided at the design layer with Geoff (NOT yet in the build; the `~/diva` team may not have these yet)
| Area | Decision | Doc |
|---|---|---|
| Private contracts | **FHE (Zama fhEVM) flagship + TEE (Oasis model) lighter option**; both obey the same compliance rules. | `DIVA-PRIVATE-CONTRACTS-PLAN.md` |
| Decryption quorum | **30/38** (higher than the 26/38 value quorum) to reveal private data. | same |
| Transparency threshold | **$10k USD-equiv, rolling 24h aggregate** (+ optional $3k soft tier), USD-oracle priced; aggregate to defeat structuring. | same |
| KYC scope | **Only to use confidential contracts.** All public/default activity permissionless + KYC-free. | same |
| Fee model | Prepaid retainer default + staker free-gas tier (gas-budget metered, per-block+per-day caps) + congestion backstop + paymaster/sponsored onboarding; event-based low-balance alerts; refills always sponsored. | *(not written yet)* |
| Foreign assets | dUSDC/dUSDT/dBTC bridged from **Base** (anchor; multi-anchor later). | `DIVA-STABLECOINS-BTC-PLAN.md` |
| NFT bridge shape | Divi↔DIVA **lock-and-release**; NFD (DVXP 0x02) parked at a federation address ↔ ERC-721 on DIVA; content-key carried across. | `DIVA-EVM-AND-NFT-BRIDGE-SPEC.md` (already reconciled into `~/diva/NFT_BRIDGE_PLAN.md`) |

---

## 3. Build status (what actually runs at `~/diva`)

| Phase | State |
|---|---|
| **0 — Foundations** | ✅ **Done.** BSC fork builds on Mac; footprint measured. |
| **1 — DIVA base identity** | 🔧 **In progress.** chainId 1838 devnet + explorer live; on-demand blocks verified; modern EVM features on (EIP-7702, 4337, BLS, KZG). **Next:** canonical predeploys (Multicall3/Permit2/WETH/4337 EntryPoint), native-coin genesis + allocations, multi-validator devnet. |
| **2 — POAS consensus** | ❌ **Not built.** Still dev/authority mode. The real 1M-bond / 38-validator / slashing engine is the core "is it really our chain" gap. |
| **3 — dDIVI + federated peg** | ❌ **Not proven.** Bridge contracts stubbed/deployed on devnet, but no proven lock-release round-trip against the real divid + no security review. **The make-or-break, security-critical piece.** |
| **4 — Checkpointing into DIVI** | ❌ **Not built.** |
| **5 — DiviStore** | ✅ **Largely built & tested, ahead of order** (P1–P9): storage market, pay-to-store, on-chain proof-of-storage, autonomous provider agents, fee distribution, **native NFT service (DivaNFT + factory)**. Plans: `~/diva/STORAGE_PLAN.md`. |
| **NFT cross-chain bridge** | 📝 **Planned** (`~/diva/NFT_BRIDGE_PLAN.md`, reconciled against the DD69 spec; instant-mint + maturation-lock N=10). Native NFT minting works; cross-chain lock/release against real Divi NFD not yet proven. |

**Honest summary:** strong chain scaffolding + a surprisingly complete storage/NFT layer, but the **three load-bearing, security-critical pieces (POAS staking, the DIVI peg, checkpointing) are still ahead of us.**

---

## 4. Document map

**Design layer — DD69 repo (`Divi-Desktop-6.9/docs/`):**
| Doc | Covers | Status |
|---|---|---|
| **DIVA-EVM-AND-NFT-BRIDGE-SPEC.md** | DIVA EVM features + Divi↔DIVA NFT lock-and-release bridge. | ✅ Spec ready; already adopted into the build's NFT plan. |
| **DIVA-PRIVATE-CONTRACTS-PLAN.md** | FHE/TEE + compliance + threshold-warrant. | ✅ Design complete; not yet in build. |
| **DIVA-STABLECOINS-BTC-PLAN.md** | Base-anchored fungible peg (dUSDC/dUSDT/dBTC). | ⚠️ Written on the two-coin framing; revisit once §1 is decided. |
| **DIVA-FEE-MODEL.md** | The §2b fee model in full. | ❌ Not written yet. |

**Build layer — `~/diva/` (the running code; treat as another agent's tree — read, don't modify):**
`PLAN.md` (north-star + phases), `NFT_BRIDGE_PLAN.md`, `BRIDGE_PLAN.md`, `STORAGE_PLAN.md`, plus `bsc/` (the fork), `bridge/`, `devnet/`, `genesis/`, `storage/`.

**Built Divi-side code the bridges depend on (DD69 repo; source of truth — do not re-implement):** `crates/supervisor/src/{dvxp.rs, nfd_record.rs, crypto_nfd.rs, collectibles.rs}` + chain branch `feat/opcodes` (`OP_NFD = 0xbb`, `createnfd`/`verifynfd`). NFD = **DVXP type 0x02** in **OP_META (0x6a)**.

---

## 5. Open / pending work (in priority order)

1. **Decide §1 (token model).** Blocks Phase 2/3. Nothing core should harden until this is set.
2. **Reconcile the two doc-sets** so the design layer and `~/diva/PLAN.md` agree on the token model, quorum numbers, and NFT-bridge details (they already share the content-key design).
3. **Sync the design-layer decisions in §2b to the `~/diva` team** (private contracts, fee model, KYC scope) — they may be building without them.
4. **Write `DIVA-FEE-MODEL.md`** (captures §2b fee decisions).
5. **Revisit `DIVA-STABLECOINS-BTC-PLAN.md`** after §1.

---

## 6. Where we need to be next (the real gates)

The devnet exists; the easy scaffolding is largely done. The remaining path is the hard, slow, security-critical part:

1. **Settle the token model (§1).**
2. **Build POAS consensus for real** (Phase 2): staking, the 38-validator active set, slashing, churn — on the BSC/Parlia base.
3. **The federated DIVI↔DIVA peg** (Phase 3), proven round-trip against the real divid, **with a security review before any real value.** This is the make-or-break gate.
4. **Checkpointing into DIVI** (Phase 4) for deep-reorg finality.

Only after those does it make sense to layer on the private-contracts, Base-asset, and cross-chain-NFT work. **Recommendation: pause new core building until §1 is decided, so Phase 2/3 aren't built twice.**
