# DIVA Stablecoin + BTC Plan

**Status:** Design / spec. Nothing built yet.
**Scope:** How Bitcoin, USDC, and USDT arrive on **DIVA** (the Divi Authority chain, our forked geth side-chain secured by POAS).
**Anchor chain:** **Base** (chosen below). Design is chain-agnostic so Robinhood Chain or Ethereum L1 can be added later without rebuilding.
**Date:** 2026-Jul-26

---

## 1. Goal in one line

Let DIVA hold real value that isn't DIVI — **Bitcoin, USDC, and USDT** — so DIVA can be used for real payments, DeFi, and trading, without Divi ever having to custody those assets alone or run a risky bridge from scratch.

## 2. The core idea

We do **not** try to teach Bitcoin to talk to DIVA directly (Bitcoin has no smart contracts, so that path is slow, custodial, and hard). Instead:

> Connect DIVA to one large, liquid EVM chain that **already has** wrapped BTC and native stablecoins, and bridge those in.

That anchor chain is **Base**. On Base these assets already exist, are deep and liquid, and are EVM-standard — which means our bridge only has to speak one language (EVM ↔ EVM), the same federated-peg mechanism we already designed for **dDIVI**.

When an asset crosses to DIVA it lands as a normal ERC-20 and gets a Divi-branded name:

| On Base | On DIVA | What it is |
|---|---|---|
| USDC (native, Circle) | **dUSDC** | US-dollar stablecoin |
| USDT (bridged) | **dUSDT** | US-dollar stablecoin |
| cbBTC **or** tBTC | **dBTC** | Bitcoin |

## 3. Why Base over Robinhood (or Ethereum)

- **Base** is a top-tier L2 with native Circle USDC, deep BTC wrappers (cbBTC, tBTC), Circle **CCTP** support, low fees, and huge liquidity. It is by a wide margin the biggest, most popular option that fits.
- **Robinhood Chain** was only recently announced and is not a mature, liquid L2 yet. Not enough there to anchor real value today. We keep the door open for it later.
- **Ethereum L1** is the most trusted but the most expensive to move assets across. We can add it later as a second anchor for users who want maximum trust and don't mind fees.

Decision: **launch on Base, keep the bridge multi-anchor** so adding Robinhood/Ethereum later is config, not a rewrite.

## 4. Two different problems

### 4a. Stablecoins (USDC / USDT) — the easy half

Nobody "locks" anything. Tether and Circle issue these directly. Two ways in:

1. **Lock-and-mint bridge (launch method):** lock USDC/USDT on Base, mint dUSDC/dUSDT on DIVA. Same peg mechanism as everything else here. Works day one.
2. **Circle CCTP (upgrade, USDC only):** Circle's burn-here / mint-there protocol moves the *real* USDC with **no wrapper and no double-trust**. It only works on chains Circle officially supports, and DIVA won't be one at launch. So this is a **later upgrade**: apply to Circle for CCTP support, and once granted, dUSDC becomes canonical USDC instead of a wrapped claim.

### 4b. Bitcoin — the hard half

Bitcoin can't be sent to DIVA directly, so something has to hold the real BTC and issue a claim. Two flavors, and we do them in this order:

**Path A — bring an already-wrapped BTC (launch).** cbBTC and tBTC already exist on Base. We lock one of them in our bridge and mint dBTC on DIVA. No Bitcoin custody work on our side.

- **cbBTC** (Coinbase-issued): simplest, deepest liquidity, one reputable custodian.
- **tBTC** (Threshold Network): decentralized signer set, less trust in any single party.
- **Recommendation:** launch with **tBTC** if the story is "trust-minimized," or **cbBTC** if the story is "just works / deepest liquidity." Pick one; supporting both later is fine.
- **Honest caveat:** bringing an already-wrapped BTC stacks two layers of trust — the wrapper's custody risk *plus* our bridge. tBTC and CCTP reduce this; cbBTC and plain USDT bridges don't. This is a trust trade-off, called out on purpose.

**Path B — custody real Bitcoin ourselves (later, for prestige).** The POAS validators (who already bond 1M DIVI each) co-hold a **Bitcoin threshold-signature vault**. Real BTC locks in the vault, dBTC mints on DIVA, burning dBTC releases the BTC. This is tBTC's own model at our scale. It removes the middle wrapper and lets us truthfully say "DIVA is backed by real Bitcoin we custody." It is real cryptographic work (threshold signing, key ceremonies, watchtowers) and is **explicitly out of scope for launch.** Graduate to it once the Base bridge is battle-tested.

## 5. How the bridge works (shared for all assets)

The bridge is the **same federated peg we designed for dDIVI**, just pointed at Base instead of at DIVI.

- **Signer set:** the POAS validators. They already bond 1M DIVI and are the trust root for DIVA, so they double as the bridge federation. No new trusted party is introduced.
- **Lock side (Base):** a bridge contract on Base holds the deposited USDC / USDT / wrapped-BTC.
- **Mint side (DIVA):** a matching contract mints the dToken 1:1 when a quorum of POAS validators signs off on a confirmed Base deposit.
- **Redeem:** burn the dToken on DIVA → quorum signs → the original asset releases on Base.
- **Quorum:** a threshold of the 38 POAS validators (e.g. 26 of 38) must sign each mint/redeem. No single validator can move funds.
- **Finality wait:** deposits wait for Base finality before minting, so a Base reorg can't create unbacked dTokens.

Every dToken on DIVA is **fully backed 1:1** by the locked asset on Base. It is a claim check, not new money.

## 6. Where these assets live: DIVA, not DIVI

Land **everything on DIVA first.** DIVA is EVM, so foreign assets are trivially standard ERC-20s there — wallets, DeFi, and trading all "just work."

Getting BTC/USDC onto **DIVI's** DVXP token layer would mean teaching our own UTXO token standard to represent them: extra work for little near-term gain. If DIVI ever needs them, we **mirror across the per-block checkpoint bridge** that already ties DIVA to DIVI, rather than building a second independent bridge. DIVI stays lean; DIVA is the home for foreign value.

## 7. Build order

1. **One DIVA ↔ Base federated bridge** (POAS validators as signers). This is the load-bearing piece; build and audit it first.
2. **dUSDC + dUSDT** via lock-and-mint. Immediate, low-risk, high-utility.
3. **dBTC** via cbBTC or tBTC (pick one).
4. **Upgrade: Circle CCTP** for canonical USDC (removes double-wrap on the biggest stablecoin).
5. **Upgrade: native BTC vault** (Path B) for real, self-custodied dBTC.
6. **Optional later:** add Ethereum L1 and/or Robinhood Chain as second anchors (config, not a rewrite).
7. **Optional later:** mirror select assets to DIVI over the checkpoint bridge, only if a use case demands it.

## 8. Open decisions (need Geoff's call)

1. **BTC source at launch:** tBTC (trust-minimized) vs cbBTC (deepest liquidity, simplest). Default recommendation: **tBTC**, unless liquidity depth matters more than the trust story.
2. **Redeem fees:** do we charge a small bridge fee on mint/redeem? (Could fund the POAS validators / treasury.)
3. **Second anchor timing:** add Ethereum L1 early for the trust story, or stay Base-only until volume justifies it?

## 9. Naming

Branded to match **dDIVI** (bridged Divi): **dBTC, dUSDC, dUSDT.** Consistent "d = bridged onto Divi" prefix across the whole superchain.

---

### One-paragraph summary

DIVA gets Bitcoin and dollars by anchoring to **Base** and bridging in the wrapped/native assets that already live there, using the **same POAS-validator federated peg we built for dDIVI**. Stablecoins come first (dUSDC, dUSDT) because they're easy; Bitcoin follows via an existing wrapper (dBTC from tBTC or cbBTC). Later upgrades make it stronger without changing the model: **Circle CCTP** for canonical USDC, and a **POAS-run Bitcoin vault** for real self-custodied dBTC. Everything lands on DIVA (EVM, easy); DIVI stays lean and only mirrors assets over the existing checkpoint bridge if ever needed.
