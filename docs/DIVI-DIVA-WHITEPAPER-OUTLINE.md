# DIVI / DIVA Whitepaper — Feature Outline (v0.1)

**Status:** Working outline. This stage = the **Features** level only (one plain-English "what it is" per feature). **Benefits** and **The Tech** are deliberately NOT written yet.
**Date:** 2026-Oct-31
**Destination:** a new whitepaper on the divi.love website.
**How it maps to the site:** each numbered SECTION below becomes one page/section with three tabs:
- **Features** = *what it is* (this document)
- **Benefits** = *why it's good for you* (later)
- **The Tech** = *how it works* (later)

**Status tags used below:** LIVE (on mainnet now) · BUILT (working, proven on regtest/devnet) · DESIGNED (specified, not built) · IDEA (early, gated on an external unknown).

---

## Section 1 — The Divi Network (the green base chain)

- **Green Proof-of-Stake** — Divi runs on staking, not mining, so securing it uses almost no electricity. *LIVE*
- **Fast, steady blocks** — a new block about every 60 seconds since launch (~4.1M blocks). *LIVE*
- **LoveNodes (tiered nodes)** — tiered staking nodes, including a lightweight "LoveNode" that can stake from a phone through a relay. *LIVE (chain); phone client partly DESIGNED*
- **Lottery blocks** — a recurring, network-wide jackpot draw built into the chain itself. *LIVE*
- **Deliberately simple money model** — a clean Bitcoin-style transaction format (no SegWit) that makes everything built on top unambiguous and safe. *LIVE*
- **Big data capacity** — Divi can carry about 603 bytes of data per transaction, roughly 7.5x what Bitcoin allows, which is what makes the whole overlay toolkit possible with no network split. *LIVE*
- **Spend-limit covenant (OP_LIMIT_TRANSFER)** — a live rule that can cap how much a transaction moves and return the rest, something Bitcoin itself still hasn't turned on. *LIVE*
- **Timelocks** — coins can be locked until a chosen time. *LIVE (absolute); relative timelock DESIGNED*
- **One-time upgrade bundle** — a single planned, opt-in network upgrade that will turn on a set of native commands at once. *BUILT, not activated*
- **Modernization** — ongoing cleanup to a modern, Apple-Silicon-native, more secure codebase without changing the rules of the chain. *IN PROGRESS*

## Section 2 — DVXP: the no-fork overlay (the keystone)

- **One shared on-chain envelope** — a single standard way to write many kinds of records (tokens, names, collectibles, and more) into Divi transactions, with no network upgrade ever required. *BUILT*
- **One reader for everything** — a single piece of software reads all these record types, so every app sees the same truth. *BUILT*
- **Agreement fingerprint** — each block produces a fingerprint of the resulting state so two independent readers can prove they agree, and any disagreement is caught and stays caught. *BUILT*
- **Honest-when-unsure** — if the chain reorganizes beyond a safe window, the reader stops and says so rather than showing a guess. *BUILT*
- **Permanent, registry-free IDs** — every token or record is identified by where it was created, so names and tickers can never be confused or hijacked. *BUILT*

## Section 3 — What you can create on Divi (the overlay apps)

- **NFD / Divi Collectibles** — collectibles and NFTs whose media is stored permanently and encrypted so only the owner can open it. *BUILT*
- **DMT tokens** — one general-purpose token system for currencies, tickets, passes, credits, licences and vouchers. *BUILT (public lookup API + a launch setting still to finish)*
- **Divi Names (human-readable addresses)** — a memorable name that stands in for your long wallet address. *BUILT*
- **Proof of Existence** — timestamp any file on Divi to prove it existed at a point in time, without the file ever leaving your device. *LIVE*
- **Governance (DAO)** — tamper-evident proposals and voting anchored to the chain. *BUILT (format)*
- **Payment Requests** — on-chain invoices: "please pay me X," delivered straight to the payer's wallet. *LIVE*
- **Treasury & fees** — transparent, fixed fees for creating tokens and names that fund the Divi Love treasury. *BUILT*

## Section 4 — The Divi Desktop wallet (DD69)

- **Crash-proof wallet** — a desktop wallet that runs a full Divi node for you and protects it from the corruption a hard shutdown can cause. *BUILT*
- **Fast Send** — a priority send that the receiver can recognize as a fast payment. *BUILT*
- **Pin Code Send** — lock coins so the receiver can see them waiting but can only claim them with a release code, with no middleman. *BUILT*
- **Bearer send (claim codes)** — create a redeemable code, like digital cash, that anyone holding it can claim. *BUILT*
- **Points** — buy in-app points (1,000 points = $1) with Divi. *BUILT*
- **Contacts** — a labeled address book that flags known contacts when you send. *BUILT*
- **Node Map** — a live 3D globe of the Divi network showing node types and real-time activity. *BUILT*
- **Multi-signature wallets** — wallets that need several people to approve a spend. *DESIGNED*
- **Everyday wallet** — send/receive with fee preview and address checks, a staking panel that explains itself, activity feed, and a 24-word backup. *BUILT*
- **Optional sign-in & community apps** — an optional login that personalizes your identity but never controls your funds, plus a sandbox for community apps and the Divi Rebels game. *BUILT (login/apps); multiplayer DESIGNED*

## Section 5 — DIVA: the green smart-contract chain

- **DIVA EVM side-chain** — a green smart-contract chain that runs standard Ethereum-style apps, built as the "Costa Rica blockchain" (chain number 1838, Costa Rica's sovereignty year). *BUILT (devnet); core consensus in progress*
- **POAS consensus** — Proof Of Authority Staking, named for Costa Rica's Poás volcano: validators stake to take turns producing blocks, with no mining and no electricity cost. *DESIGNED (interim launch uses a simpler authority mode)*
- **No empty blocks** — DIVA only makes a block when there's something to do, aiming for 2 to 3 second blocks on ordinary hardware. *BUILT (verified feasible)*
- **One coin** — DIVA uses bridged Divi as its only coin for fees and staking; there is no separate DIVA coin. *DECIDED*
- **Modern features from day one** — the newest Ethereum capabilities (smart accounts, passkey logins, account abstraction) are on from the start. *BUILT (devnet)*
- **Pay gas in any token** — users can pay network fees in a token of the app's choice, or have fees sponsored, so games and apps can hide crypto complexity. *DESIGNED*
- **Shared security with Divi** — DIVA regularly writes its state into the Divi chain so it inherits Divi's finality. *DESIGNED*

## Section 6 — DiviStore: permanent storage

- **Permanent storage market** — pay once to store files forever, served by node operators who earn by storing and proving they still hold the data. *BUILT (devnet)*
- **Quantum-resistant encryption** — files are encrypted with a method designed to resist future quantum computers (so data stolen today can't be unlocked later). *BUILT (standalone, audited)*
- **Storage-backed NFTs on DIVA** — create collections and mint NFTs whose media lives in permanent storage, with no custom code. *BUILT (devnet)*
- **Self-running storage agent** — an optional agent that registers content, answers storage challenges, and claims earnings automatically. *BUILT (devnet)*
- **Storage admin & productization** — a management panel and a hosted service so other businesses can use DIVA storage. *DESIGNED*

## Section 7 — Privacy & compliance on DIVA

- **Confidential smart contracts** — contracts whose business logic stays private, using proven privacy technology. *DESIGNED*
- **Fair-and-balanced transparency** — ordinary activity stays private, but large transfers (above a set dollar threshold over 24 hours) are transparent, discouraging money-laundering structuring. *DESIGNED*
- **Proof of innocence** — users can prove their funds aren't from sanctioned sources without revealing their whole history. *DESIGNED*
- **Court-order-only disclosure** — no single party or government can peek; only a quorum of validators can unlock one named item under a court order, and every such disclosure is itself recorded. *DESIGNED (quorum size under review)*
- **Privacy-scoped KYC** — identity checks apply only to the confidential-contract features; normal use of the chain stays open and private. *DESIGNED*

## Section 8 — Money & real-world banking

- **Stablecoins and Bitcoin on DIVA** — US-dollar stablecoins and Bitcoin, brought onto DIVA and backed 1:1. *DESIGNED*
- **Licensed Costa Rica banking (the moat)** — a native, licensed way to move between real money and crypto, using a Costa Rica money-transmitter license and real bank accounts, which other chains have to rent from third parties. *IDEA (gated on confirming bank capabilities)*
- **dCRC colón stablecoin** — a Costa Rican colón stablecoin backed by real deposits. *IDEA*
- **Wallet-linked bank accounts (IBANs) & SINPE** — optionally turn a DIVA wallet into a real bank account and connect to Costa Rica's national instant-payment system. *IDEA*

## Section 9 — One ecosystem, two chains (bridge & identity)

- **Move collectibles between chains** — lock an NFD on Divi and use it as an NFT on DIVA, or bring it back, with it only ever live on one side at a time. *DESIGNED*
- **Both chains know everything** — each chain holds a verified, up-to-date view of who owns what on the other (collectibles, names, tokens, timestamps). *DESIGNED (format BUILT)*
- **One key, two faces, one name** — a single key controls your address on both chains, and your Divi name works on both, so money always comes back to "the same you." *DESIGNED (name layer BUILT on Divi)*
- **Asset-location passport** — every item shows which chain it currently lives on, and a one-click move brings it to where you want to use it. *DESIGNED*
- **Trust-minimized bridge** — the bridge between the chains is run by the validator set itself, with no new trusted party. *DESIGNED (the hardest, most security-critical piece)*

---

## Analysis for this build (what the user asked me to check)

### A. Explanations to get RIGHT (corrections and conflicts found across the docs)

1. **One-coin, not two.** `/Users/geoffreymccabe/diva/PLAN.md` still describes the old model (a separate sellable DIVA coin + dDIVI). The current, decided model (2026-Sep-01) is **one coin: bridged Divi is the only coin.** The whitepaper must use the one-coin model. PLAN.md should be fixed separately so it stops misleading readers.
2. **POAS = "Proof Of Authority Staking"** (named for the Poás volcano), NOT "Proof of Staked Authority." PLAN.md still has the old wording.
3. **Record-type collision on 0x05.** The old `PAYMENTS-SPEC.md` labels type 0x05 as "Payment Requests," but the authoritative registry uses 0x05 = Names and 0x06 = Governance. The whitepaper must not claim 0x05 = Payment Requests; Payment Requests need a confirmed type byte.
4. **"Solana bridge" is not a committed feature.** The committed specs anchor stablecoins/assets to **Base**, not Solana. Solana compatibility was only explored as a future idea in an earlier feature-map artifact. Treat Solana as exploratory/future, not current, unless Geoff says otherwise.
5. **Numbers still in flux:** the privacy-disclosure quorum (docs say 30/38; Geoff flagged that as too high) and DIVA's exact block time (docs vary between sub-second and 2-3s; the chosen target is 2-3s). Don't hard-state a number the whitepaper might have to walk back.

### B. Novel things we should SHOWCASE (easy to under-sell)

- The **no-fork overlay** (add features to a live chain with zero split risk) is the single most distinctive engineering idea; make it a hero section.
- **Permanent AND private NFTs** (stored forever, encrypted to the owner) with the honest framing that it's private, not "uncopyable."
- **One namespace for names and tickers** + **uppercase-only** = whole classes of impersonation/look-alike attacks made impossible (ENS still can't fix the look-alike one).
- **Atomic priced open-mint** for tokens (buyer pays and claims in one step, issuer can't withhold) — the thing older token systems got wrong.
- **Pin Code Send** (trustless escrow) and **Bearer codes** (digital cash) as standout, tangible wallet features.
- **Quantum-resistant encryption** on permanent storage (protects against "store the ciphertext now, crack it later").
- **Green** across both chains (no mining anywhere).
- **Lottery blocks** as a fun, native chain feature.
- **Licensed Costa Rica banking** as the business moat.
- **Fair-and-balanced privacy**: private by default, transparent only above a threshold, and disclosure only by court order via a validator quorum (no single peeker) — a genuinely different stance from both "fully transparent" and "fully anonymous" chains.
- **One key, two faces, one name** + **asset-location passport** as the "it just feels like one system" story.

### C. Honesty rules to carry into every section

- The chain carries and orders records; software interprets them. Never say "the network enforces/guarantees" an overlay rule.
- A malformed record is skipped, never destructive (only an explicit burn destroys value). This is a deliberate safety stance.
- Be clear about LIVE vs BUILT vs DESIGNED; a whitepaper that implies the unbuilt DIVA core already exists would be misleading. A "what's real today" box is recommended.

### D. Open questions before writing Benefits/Tech

- Confirm the final privacy quorum size and the DIVA block-time number.
- Confirm whether Solana is in or out of the public story.
- Confirm a type byte for Payment Requests.
- Decide the audience priority (end users vs investors vs node operators vs art/POE partners) since it shifts the Benefits emphasis.
