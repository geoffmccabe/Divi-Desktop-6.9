# DIVA Private Smart Contracts Plan

**Status:** Design / spec. Nothing built yet.
**Scope:** Confidential smart contracts on **DIVA** (the Divi Authority chain, our forked geth side-chain secured by POAS), plus the compliance knobs that keep them defensible.
**Date:** 2026-Jul-30

---

## 1. Why

Businesses won't put real activity on a chain their competitors can read. Private smart contracts — where the *logic and data* are hidden but the chain still verifies them — are what make DIVA usable for real commerce. The goal is **privacy for business logic, without turning DIVA into an untraceable money launderer**, so it stays defensible to regulators.

## 2. The core idea

Use a privacy tech that (a) is EVM-shaped so it fits our forked-geth DIVA, and (b) has **selective disclosure built in**, so the same mechanism that hides data can reveal it under a defined, narrow policy. That points at **FHE**.

## 3. The three technical options

All three are EVM-compatible enough to sit on DIVA:

| Tech | What it does | Fit |
|---|---|---|
| **FHE — Zama fhEVM** *(recommended)* | Compute on **encrypted** state. Near-normal Solidity with encrypted types. Each encrypted value carries an **access list** deciding who may decrypt it. | Best. Selective disclosure / viewing keys / threshold-decrypt are **native**, not bolted on. |
| **TEE — Oasis Sapphire model** | Contract state sealed inside secure hardware (confidential EVM). | Simplest to adopt, production-proven. Weaker if the hardware trust assumption is ever broken. |
| **ZK / commitments — Aztec-style** | Strongest privacy via zero-knowledge proofs and hidden state. | Own VM, not a drop-in EVM. Most work; keep as a future option. |

**Decision: offer both FHE and TEE, with FHE as the flagship.** FHE (Zama fhEVM) is the default and the one we lead with, because its per-value access control is exactly what the compliance design below needs, and its "trust the math" story matches a privacy chain's core pitch. **TEE (Oasis Sapphire model) is also supported** as a cheaper, faster option for teams that don't need FHE's strength — clearly labeled as the **lighter-trust** choice (it trusts a CPU-maker's on-chip secure enclave, which has been cracked before). Developers pick per contract. ZK stays a future option.

**Both tiers obey the same compliance rules.** The transparency threshold (4.1), sanctions screening, and the warrant path (§5) apply to TEE contracts too — for TEE this is enforced through the enclave's key management (state is releasable to the same POAS threshold committee), so choosing TEE buys speed and lower cost, **not** an escape from the disclosure rules.

## 4. The "fair and balanced" compliance knobs

These bolt onto the FHE base. The design principle: **hide what a business is doing; do not hide illicit money movement.**

1. **Private state, auditable value.** Hide the contract's logic and business data (what competitors care about), but keep coin transfers **above a threshold transparent**; small transfers stay private. Privacy for *how you operate*, not for *large untraceable payments*. The threshold is an **aggregate**, not per-transaction — see 4.1.
2. **Sanctions / blacklist screening at the protocol level.** Transfers to flagged addresses are blocked or forced transparent, enforced by the chain, not left to each app.
3. **Threshold viewing keys held by POAS validators.** A specific contract or transaction can be decrypted **only when a quorum of validators signs off** — deliberately set *higher* than the consensus/bridge quorum (e.g. **30 of 38**, vs 26/38 for moving money), because irreversibly revealing someone's private data should be harder than a normal transfer. Triggered by a court order. Targeted, not mass surveillance; **no single party — or single government — can peek alone.** This is the "warrant backdoor," done cleanly and auditably.
4. **Proof-of-innocence (Privacy Pools model).** Users can prove their funds are **not** from a known-illicit set without revealing their identity. This is the current state-of-the-art "privacy that regulators tolerate."

### 4.1 Anti-structuring — making the transparency threshold hold

A flat *per-transaction* threshold is trivially defeated by **structuring** (splitting one big transfer into many sub-threshold pieces). So the threshold is defined as a **rolling aggregate**, and the FHE base lets us enforce it without exposing amounts.

**Chosen values (tunable in config, not baked into consensus):**

- **Transparency threshold: $10,000 USD-equivalent, aggregated per identity over a rolling 24 hours.** Ten small sends still sum against the same 24h bucket, so splitting gains nothing. $10k is chosen to mirror the US cash CTR line — a figure regulators already accept, so we inherit its defensibility instead of inventing our own.
- **Soft tier: ~$3,000 aggregate → "recorded but still private."** Metadata is logged (reachable only via the warrant path), not made public. Mirrors the Travel Rule tier and gives an early-warning band before full transparency.
- **USD-oracle priced.** dUSDC, dBTC, and native DIVA are all measured on one dollar scale via an oracle, so a volatile coin price can't quietly move the line.
- **Rolling, not calendar-day.** A fixed day boundary would just push abuse to 11:59pm; a rolling window closes that.

**Why FHE is what makes this work:** the chain keeps an **encrypted running total** per account and homomorphically checks "cumulative > threshold" *without seeing the individual amounts*. Enforcing the aggregate cap therefore doesn't require exposing sub-threshold detail.

**Address-hopping** (a fresh address per send so nothing accumulates) is the harder evasion. Counters: bind the counter to a **persistent identity** (KYC'd account / identity commitment) for the compliance tier so new addresses don't reset the tally; **proof-of-innocence** so spending privately requires proving clean provenance, which structuring can't produce; **pattern flags** (fan-out/fan-in, rapid splitting) surfaced to the POAS committee; and treating deliberate structuring as a **protocol violation** rather than pretending each small send is innocent.

**Honest limit:** on any permissionless, pseudonymous chain, structuring can't be made *impossible* (same as cash). The goal is to make it **not free, detectable in aggregate, and rule-breaking**. Reuses the anti-structuring design work already done for vibe-trader.

## 5. How the threshold-warrant path works (the load-bearing piece)

- Every confidential value is encrypted so that decryption requires a **threshold of POAS validators** (a *higher* bar than consensus — e.g. 30 of 38), not any one of them.
- A lawful request names a **specific** contract/tx (not "everything"). If the quorum agrees the request is valid, they jointly produce a decryption of only that item.
- Because DIVA already trusts the POAS set for consensus, reusing it as the decryption committee introduces **no new trusted party**.
- Every threshold-decrypt event is itself recorded on-chain, so disclosure is **auditable** — abuse is visible, not silent.

This mirrors the "auditable privacy" designs in the field: strong default privacy, narrow and accountable disclosure.

## 6. What stays out of scope (for now)

- Full ZK/Aztec-style private VM (revisit later if FHE limits us).
- Cross-chain confidential messaging (private state moving over the Base/checkpoint bridges) — later.

## 7. Build order

1. **Stand up fhEVM on the DIVA testnet** — get an encrypted-state contract running and verified on our own chain.
2. **Access-control / viewing-key demo** — one party writes encrypted data, only an allowed party decrypts.
3. **Threshold decryption via the POAS validator set** — the warrant path, on testnet.
4. **Protocol-level transparency threshold + sanctions screening** on value transfers.
5. **Proof-of-innocence** membership proofs.
6. **TEE (Oasis Sapphire model) as the lighter-trust option** — wired to the same compliance rules and POAS warrant committee. Lands after the FHE path is proven, since FHE carries the flagship story.

## 8. Open decisions (need Geoff's call)

1. ~~**Transparency threshold amount**~~ — **DECIDED (2026-Jul-30):** $10k USD-equiv rolling 24h aggregate, USD-oracle priced, with an optional ~$3k "recorded-but-private" soft tier. See 4.1.
2. ~~**Quorum size for warrant decryption**~~ — **DECIDED (2026-Jul-30):** a *higher* bar than consensus/bridge (e.g. **30 of 38** vs 26/38), because revealing private data should be harder than moving money.
3. ~~**TEE fallback?**~~ — **DECIDED (2026-Jul-31):** support **both**. FHE is the flagship/default; TEE (Oasis Sapphire model) is offered as the cheaper, faster, clearly-labeled *lighter-trust* option. Both obey the same compliance rules (threshold, sanctions, warrant path) — TEE via enclave key management to the same POAS committee, so it's not a disclosure loophole.

## 9. Honest caveats

- Whether any specific knob actually satisfies US (or other) authorities is a **legal judgment for Geoff**, not something the tech guarantees. The mechanisms here *enable* a compliant policy; they don't *decide* the policy.
- FHE is powerful but computationally heavy; expect confidential operations to cost more gas / run slower than plain EVM. Fine for business logic, not for high-frequency micro-ops.

---

### One-paragraph summary

DIVA gets confidential smart contracts by building on **FHE (Zama's fhEVM)** — encrypted contract state with per-value access control — so businesses can hide their logic and data from competitors. The same access-control mechanism carries the compliance design: transparent value transfers above a threshold, protocol-level sanctions screening, **proof-of-innocence** for clean funds, and a **threshold "warrant" path** where a quorum of POAS validators (no single party) can decrypt a *specific* item under a court order, with every disclosure recorded on-chain. Strong privacy for how you operate, narrow and accountable disclosure for illicit money — reusing the POAS set we already trust.
