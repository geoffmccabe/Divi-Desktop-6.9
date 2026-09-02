# DIVA Crypto-Banking Plan (Costa Rica)

**Status:** Idea / early design. Nothing built. This captures a direction so we do not forget it.
**Date:** 2026-Sep-02
**Scope:** Native banking / fiat features baked into DIVA, using Geoff's Costa Rica money-transmitter license and IBANs at GoBanq.
**Fits:** DIVA is marketed as "the Costa Rica blockchain." These features make that positioning real, not just branding.

---

## 1. Why this is uniquely ours (the moat)

The key asset is **not the chain, it is the GoBanq money-transmitter license + real IBAN accounts in Costa Rica.**

Almost no blockchain can legally touch fiat rails, so nearly every chain outsources its on/off-ramp to a third party (MoonPay, etc.) that skims fees and owns the customer. Because Geoff holds the license and the IBANs, DIVA can do this **in-house and natively**. That is the whole edge: DIVA becomes "a chain with a licensed bank account wired into it," which competitors cannot copy without their own license.

## 2. The foundation feature: a native, licensed fiat on/off-ramp

Everything else sits on this. Because we hold the IBANs:

- Someone wires colones or US dollars to a GoBanq IBAN, and the chain credits them stablecoin automatically.
- They send stablecoin on-chain, and it withdraws back out to an IBAN.

That "deposit fiat, get on-chain money, cash back out" loop, run under our own license, is the piece other chains have to rent. Build this first; the rest are products on top of it.

## 3. Feasible + useful features (ranked)

| # | Feature | What it is | Why it matters |
|---|---|---|---|
| 1 | **dCRC (colon stablecoin)** | A token fully backed by real colones held in GoBanq IBANs. | "The Costa Rica blockchain" with its own national-currency stablecoin, backed by licensed bank deposits. Real local utility + headline marketing. |
| 2 | **Wallet-linked virtual IBANs** | Each DIVA wallet can optionally claim a real virtual IBAN via GoBanq. Money sent to the IBAN appears on-chain; on-chain sends can withdraw to it. | "Your crypto wallet is also a real bank account." Concrete, no jargon. |
| 3 | **SINPE / SINPE Movil bridge** | Settle DIVA payments to/from Costa Rica's national instant-payment system (phone-number based). | This is how locals actually move money. Turns DIVA from "interesting to crypto people" into "usable at the corner store." NEEDS verification of what GoBanq can access on SINPE. |
| 4 | **Merchant settlement / POS** | Merchants accept dUSDC/dCRC on DIVA and auto-settle to their IBAN daily. | Real payment volume, not speculation. Pairs with #3. |
| 5 | **Remittance corridor** | US to DIVA stablecoin to colones at a Costa Rican IBAN or SINPE. | Remittances are a real Costa Rica money flow; the MTL is what makes running the corridor legal. |
| 6 | **Payroll rails** | Businesses pay salaries in stablecoin on DIVA; employees cash out to IBAN/SINPE. | B2B utility that brings recurring real volume. |

**Recommended core:** #1 (dCRC) + the #2 ramp are the foundation; **#3 (SINPE) is what makes it real for actual Costa Ricans** rather than only crypto users. That trio is the defensible, uniquely-ours story.

## 4. How it ties into decisions already made

- **KYC scoping fits perfectly.** We already decided (see `DIVA-PRIVATE-CONTRACTS-PLAN.md` and `DIVA-INDEX.md` section 2b) that KYC applies only to specific features, not to using the chain. The fiat-ramp / IBAN features are the natural home for KYC (the license requires it there anyway), while ordinary on-chain activity stays permissionless and KYC-free.
- **Same shape as the asset bridge.** Minting dCRC against real IBAN balances is architecturally the same pattern as minting dUSDC against Base deposits (`DIVA-STABLECOINS-BTC-PLAN.md`): a licensed operator issues on-chain tokens backed by real off-chain reserves. We reuse the peg / attestation design, pointed at GoBanq instead of Base.
- **Proof-of-reserves.** Publish on-chain attestations that the IBAN balances back the tokens, to build trust. Same idea as the bridge's 1:1 backing claim.

## 5. Honest architecture caveat (what is really "in the chain")

The IBANs themselves always live **at GoBanq, off-chain.** The blockchain never literally holds a bank account. What is genuinely *in the chain* is:

- the token standard (dCRC),
- the mint/burn + settlement logic,
- the KYC-gating,
- the proof-of-reserves.

The link between GoBanq's ledger and the chain is a **trusted, licensed bridge/oracle that Geoff operates.** So "banking features in the chain" means "the chain is the ledger and UX; the licensed IBAN infrastructure is the vault." The marketing must not outrun that: it is a licensed operator bridging real bank balances onto a chain, not a trustless bank.

## 6. Regulatory note (not legal advice)

The thing that makes this legal for us and not for a random chain is precisely the GoBanq MTL. So the safe pattern is to keep every fiat-touching feature **inside the licensed GoBanq perimeter** and let DIVA be the ledger/UX layer on top. This doc only flags where the license matters; the actual regulatory judgment is Geoff's (and any counsel he uses).

## 7. Open questions (need answers before building)

1. **What can GoBanq actually do on the SINPE / IBAN side today?** Which of #2 (virtual IBANs per wallet), #3 (SINPE Movil), and #5 (remittances) are real now vs aspirational? This gates the whole roadmap.
2. **Reserve model for dCRC:** one pooled IBAN backing all dCRC, or per-user segregated? Affects trust story and compliance.
3. **Who runs the mint/burn oracle** and how is it secured (single licensed operator vs POAS-attested)?
4. **Fee model:** do ramp/settlement fees fund the treasury / validators?
5. **KYC provider:** reuse GoBanq's existing KYC, or a separate identity layer bound to the compliance tier?

## 8. Next steps

1. **Verify GoBanq capabilities** (question 7.1) — the single most important unknown.
2. Decide the dCRC reserve model (7.2).
3. Only then: spec the dCRC token + ramp as an extension of the existing bridge design.

**Do NOT build yet.** This is a captured direction, pending the GoBanq capability check.

---

### One-paragraph summary

DIVA's real banking edge is Geoff's Costa Rica money-transmitter license + GoBanq IBANs, which let DIVA run a **native, licensed fiat on/off-ramp** that other chains must outsource. On top of that: a colon stablecoin (**dCRC**) backed by real IBAN deposits, **wallet-linked virtual IBANs**, and a **SINPE Movil bridge** so locals can actually spend and cash out. It reuses the existing peg/KYC design (fiat features are the natural KYC home; ordinary chain use stays permissionless). The IBANs stay off-chain at GoBanq; the chain is the ledger and UX, the license is the vault. Biggest open question before any build: what GoBanq can actually do on the SINPE/IBAN side today.
