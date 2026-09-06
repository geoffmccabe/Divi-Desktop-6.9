# DIVA — Master Index

**The front door for the DIVA side-chain work.** Read this first, then the linked docs.

**What DIVA is:** Divi's EVM side-chain — a **fork of BNB Chain (BSC)**, whose **Parlia engine is Proof-of-Staked-Authority = our POAS**. Green (no PoW), anchored into DIVI by signed per-minute checkpoints. chain ID **1838**.

**Reality check (2026-Sep-01):** there are **two workstreams**, and they are not fully in sync:
- **Design layer** = these `docs/DIVA-*.md` files in the DD69 repo (decisions, specs).
- **Build layer** = a real, running implementation at **`/Users/geoffreymccabe/diva`** (its own git repo, a live local devnet, deployed contracts). This is where the actual code lives.

The token-model question that used to block core building is now **decided — see §1.**

**Last updated:** 2026-Sep-01 (token model decided: unified/one-coin)

---

## 1. ✅ DECIDED — token model: UNIFIED (one coin, Divi)

**Decided by Geoff, 2026-Sep-01.** There is **no separate DIVA coin.** The DIVA chain has **one coin: Divi**, bridged 1:1 from DIVI L1 to *be* the chain's native gas + main coin.

- **User-facing name is always "Divi."** On DIVI L1 and on the DIVA chain it is the same coin to the user.
- **Internal/dev shorthand** may call the bridged native coin **dDIVI** or **DIVA** — but they all mean the same thing: bridged Divi acting as native gas. There is no second, separately-issued coin.
- **Model:** custom-gas-token chain — bridging DIVI in mints native Divi gas 1:1; bridging out burns it. (Base:ETH :: DIVA:Divi.)

**Implications now locked:**
- **Validator/staking bond is denominated in Divi** (bridged native), not a separate DIVA coin. The 1,000,000 bond stands — in Divi.
- **The DIVA-coin sale fundraising path is OFF.** Fund the team/project via a **separate, clearly-labeled governance/revenue token** and/or a **vested Divi allocation** — never a shadow gas coin.
- **"dDIVI as a separate ERC-20 alongside a native DIVA coin" collapses:** the native coin *is* bridged Divi. Foreign assets (dUSDC/dBTC/dUSDT) stay separate ERC-20s; **Divi itself is native.**

**⚠ Build impact:** the `~/diva` build still carries the *old two-coin* model as a "locked decision" in its `PLAN.md` (sellable DIVA + separate dDIVI). That is now **superseded** and must be updated to unified before Phase 2/3 harden. See §5.

---

## 2. Settled decisions

### 2a. Locked in the build (`~/diva`), proven or in progress
| Area | Decision |
|---|---|
| Base client | Fork of **BSC** (Parlia = POAS). Vanilla geth removed CLI block production; BSC was the right base. |
| Chain ID | **1838** (live on the local devnet + explorer). |
| Empty blocks | **On-demand only — verified.** No blocks when idle; one tx → one block. Optional slow ~1/min heartbeat aligned to checkpoints. |
| Consensus target | **POAS** — authority tier for launch liveness + open staked validators, **1,000,000 Divi** bond (bridged native coin, per §1), **38** active cap, standby rotation, slashing. (Engine not built yet — see §3.) |
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

1. **Propagate the unified token decision (§1) into the `~/diva` build** — update `~/diva/PLAN.md` "locked decisions": remove the sellable DIVA coin + the separate dDIVI ERC-20; native coin = bridged Divi; bond in Divi. **Highest priority — the build is still on two-coin.**
2. **Reconcile the two doc-sets** so the design layer and `~/diva/PLAN.md` agree on quorum numbers and NFT-bridge details (they already share the content-key design).
3. **Sync the design-layer decisions in §2b to the `~/diva` team** (private contracts, fee model, KYC scope) — they may be building without them.
4. **Write `DIVA-FEE-MODEL.md`** (captures §2b fee decisions).
5. **Revisit `DIVA-STABLECOINS-BTC-PLAN.md`** — rewrite its two-coin framing to unified (bridged Divi = native; dUSDC/dBTC/dUSDT stay ERC-20s).

---

## 6. Where we need to be next (the real gates)

The devnet exists; the easy scaffolding is largely done. The remaining path is the hard, slow, security-critical part:

1. ~~Settle the token model~~ ✅ **Done — unified (§1).**
2. **Propagate unified into the `~/diva` build** (§5.1) before Phase 2/3 harden.
3. **Build POAS consensus for real** (Phase 2): staking, the 38-validator active set, slashing, churn — on the BSC/Parlia base. Bond in Divi.
4. **The federated DIVI↔DIVA peg** (Phase 3), proven round-trip against the real divid, **with a security review before any real value.** This is the make-or-break gate — and under the unified model it is *also* what mints the native gas coin, so it's doubly load-bearing.
5. **Checkpointing into DIVI** (Phase 4) for deep-reorg finality.

Only after those does it make sense to layer on the private-contracts, Base-asset, and cross-chain-NFT work.
