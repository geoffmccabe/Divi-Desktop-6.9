# DIVA — Master Index

**The front door for the DIVA side-chain work.** Read this first, then the linked docs.
**What DIVA is:** Divi's EVM side-chain — a **forked geth** client secured by **POAS** (Proof of Authority Staking), with **Divi itself as the one native gas coin.** DIVA is the *chain*; Divi is the *coin* (like Base is the chain and ETH is the coin).
**Overall status:** design/spec. The Divi-side NFD layer several pieces depend on **is built**; the DIVA chain and its bridges are **not built yet** (a DIVA devnet is the prerequisite for all building — see bottom).
**Last updated:** 2026-Jul-31

---

## 1. Canonical decisions (the settled choices — this section wins on any conflict)

| Area | Decision | Date |
|---|---|---|
| **Chain vs coin** | DIVA = the chain (geth fork, **chain ID 1838**). **Divi = the one native gas coin, bridged 1:1** (custom-gas-token model). **No separate premined DIVA coin.** | Jul-31 |
| **Consensus** | **POAS** — bonded authority set, **up to 38 validators**, **1,000,000 DIVI** validator bond. No PoW. | earlier |
| **Finality** | **Per-block checkpoint of the DIVA tip into the DIVI UTXO chain** (~1 min), quorum-signed. Deep-reorg protection. | earlier |
| **Bridge federation** | The **POAS validators** are the signer set for every bridge. Quorum **26/38** to move value / mint / release. | earlier |
| **Private contracts** | **FHE (Zama fhEVM) is the flagship**; **TEE (Oasis Sapphire model) also offered** as a clearly-labeled lighter-trust option. Both obey the same compliance rules. | Jul-31 |
| **Decryption quorum** | Revealing private data needs a **higher bar than moving money: 30/38** (vs 26/38). | Jul-30 |
| **Transparency threshold** | **$10k USD-equivalent, rolling 24h aggregate**, USD-oracle priced; optional **~$3k** "recorded-but-private" soft tier. Aggregate (not per-tx) to defeat structuring. | Jul-30 |
| **KYC scope** | **KYC only to use confidential contracts.** All public / default activity is **permissionless and KYC-free.** | Jul-31 |
| **Fee model** | **Prepaid retainer ("gas tank") as the default** + **staker free-gas tier** (metered by a daily *gas budget*, with per-block + per-day caps) + **congestion-pricing backstop** + **paymaster/sponsored onboarding**. Low-balance alerts via **events** (not alert-txs); **refills are always sponsored** so no one can get gas-locked. | Jul-31 |
| **Foreign assets** | **dUSDC / dUSDT / dBTC** bridged from **Base** (anchor chain; multi-anchor-capable for Ethereum/Robinhood later). Holder-redeemable, 1:1 backed. | Jul-26 |
| **Team funding** | **Separate governance/revenue token** (recommended) and/or a **vested Divi allocation** — funded from chain fee revenue and/or reserves. **Not** a shadow gas coin. Optional: redirect a slice of Divi's own issuance (needs a Divi-chain change). | Jul-31 |

---

## 2. Document map

| Doc | Covers | Status |
|---|---|---|
| **DIVA-EVM-AND-NFT-BRIDGE-SPEC.md** | DIVA's EVM feature set + the **Divi↔DIVA NFT lock-and-release bridge** (build spec for another agent). Reflects the unified-coin model. | ✅ Ready to build (DIVA devnet prerequisite) |
| **DIVA-PRIVATE-CONTRACTS-PLAN.md** | Confidential contracts (FHE flagship + TEE), compliance knobs, anti-structuring, threshold-warrant path. All 3 open decisions now settled. | ✅ Spec complete |
| **DIVA-STABLECOINS-BTC-PLAN.md** | The **fungible peg** from Base (dUSDC/dUSDT/dBTC) and the POAS federated bridge. | ⚠️ Predates the unified-coin decision — still describes a separate native DIVA coin + dDIVI as two coins. **Needs a reconciliation pass** (see §3). Bridge mechanics still valid; the token-model framing is stale. |
| **DIVA-FEE-MODEL.md** | The full fee model in §1 (retainer + staker tier + congestion + paymaster + alert/refill + team funding). | ❌ Not written yet (see §3) |

Related built Divi-side code the bridges depend on (source of truth, do not re-implement): `crates/supervisor/src/{dvxp.rs, nfd_record.rs, crypto_nfd.rs, collectibles.rs, base58.rs}`, plus chain branch `feat/opcodes` (`OP_NFD = 0xbb`, `createnfd`/`verifynfd`). NFD = **DVXP type 0x02** in **OP_META (0x6a)**.

---

## 3. Open / pending work

1. **Write `DIVA-FEE-MODEL.md`** — capture the §1 fee decisions in full (retainer flow, staker gas-budget curve, block-space split, congestion backstop, paymaster/sponsored refills + the "can't-pay-gas-to-buy-gas" deadlock fix, and the team-funding options A/B/C).
2. **Reconcile `DIVA-STABLECOINS-BTC-PLAN.md`** to the unified-coin model: dDIVI is *not* a separate ERC-20 alongside a premined DIVA coin — bridged Divi **is** the native gas coin. dUSDC/dBTC/dUSDT remain ERC-20s (they're foreign assets); only the Divi framing changes.
3. **Tokenomics doc** (optional): Divi-as-gas issuance rules, founder/team allocation vesting + caps, the separate governance/revenue token.

---

## 4. Build prerequisite & first milestone

Nothing on DIVA can be built or tested until a **DIVA chain is running** — even a devnet geth with a stand-in PoA/POAS validator set.

**Recommended first milestone:** stand up a DIVA devnet, then prove a single **NFD lock → mint → release** round-trip (regtest-Divi ↔ devnet-DIVA) using the Solidity multisig gate, *before* hardening finality, batching, the BLS/FROST precompile, or any of the fungible/private-contract work. Get one honest cross-chain round-trip working first; everything else builds on that proof.
