# NFD creator commissions — enforced on-chain, uncircumventable

A protocol-level creator commission for NFDs, designed to fix the failure that
plagued traditional NFTs: royalties that were never enforced on-chain, so new
marketplaces simply dropped them and creators lost their cut. Here the commission
is part of what makes a transfer *valid at all*, so it cannot be skipped.

Status: DESIGN. This changes the shared NFD record model and the transfer-validity
rule, so it needs coordination with the chain/DMT agents (shared record envelope)
and, eventually, `OP_NFD` consensus. Marked assumptions are Geoff's to confirm.

## 1. The problem it solves

ERC-721 "royalties" were metadata a marketplace could honor or ignore. Once
zero-royalty marketplaces appeared, creators got nothing on resale. The only real
fix is to make paying the creator a **condition of a valid ownership transfer**,
enforced by the same rules everyone uses to decide who owns what.

## 2. The mechanism

- Every collection (and optionally every standalone NFD) carries a **commission**:
  a **flat DIVI amount** plus a **payout address**, set by the creator.
- **Transfer-validity rule:** a TRANSFER record for an NFD is VALID only if the
  transaction that anchors it also contains an output paying **≥ the current
  commission** to that collection's payout address. A transfer transaction with no
  such output is **IGNORED** by every conformant indexer/wallet/marketplace —
  ownership simply does not move.
- Because ownership is defined by valid records replayed by the shared indexer
  (and later by `OP_NFD` consensus), a fee-dodging transfer isn't recognized
  *anywhere*. There is no marketplace that can "turn it off."

## 3. Why a flat DIVI amount, not a percentage

A percentage needs an on-chain sale price, and buyer+seller can just declare a
fake low price (or move it off-chain) to shrink the cut — the classic dodge. A
**flat DIVI toll per transfer** has no price to hide: you either pay the toll or
the transfer is invalid. The trade-off is that DIVI's value moves, so:

- The creator sets the amount as a fixed DIVI figure, and
- **updates it over time** with a signed record (§4) as the DIVI price changes.

## 4. Records (new)

- **COMMISSION-SET** — a new NFD subtype, **signed by the collection creator**
  (authorized the same way collection-create is: funded from / spending the
  creator address). It sets the current `{ amount_duffs, payout_address }` for the
  collection. Latest one wins; a transfer must satisfy the amount current as of its
  block. The creator can raise or lower it anytime.
- **TRANSFER** — unchanged in shape, but the indexer now additionally checks the
  commission output before accepting it.

Standalone (non-collection) NFDs: the minter may set a commission at mint, updated
by that same minter address. (ASSUMPTION — confirm you want standalone NFDs to
support commissions too, or collections only.)

## 5. Collusion resistance (and one honest limit)

- **Buyer + seller cannot agree to skip it.** A transfer without the toll is not a
  transfer — the ledger still shows the seller as owner, so the "buyer" can't prove
  ownership, can't resell it validly, and can't use it anywhere ownership is
  checked. The toll is unavoidable for anyone who wants *recognized* ownership.
- **The honest limit:** because NFD content is encrypted, a seller could privately
  hand a buyer a re-wrapped key so they can *view* the art without a valid transfer.
  That buyer can see it but does **not own it** (same "not uncopyable" caveat we
  state elsewhere). Enforcement protects **ownership and resale value**, which is
  what a collectible market runs on — not raw content-viewing. Say this plainly.

## 6. Scope of transfers (ASSUMPTION — confirm)

Recommended: **every** ownership transfer pays the toll — marketplace sale, direct
send, or "gift." Exempting gifts would reopen the collusion loophole (sell, then
"gift"). The cost is that moving your own NFD between your own wallets also pays;
that's the price of a closed loophole. The one natural exemption is the **primary
sale from the creator's own treasury**, where the toll would just pay the creator
themselves.

## 7. Enforcement path

- **Now (forkless):** the NFD indexer enforces the rule — this is fully in our
  control and needs no chain change. Wallets/marketplaces that replay records apply
  it uniformly.
- **Later (`OP_NFD` consensus):** the rule becomes consensus, so even a
  non-indexing verifier rejects a toll-free transfer. Backward compatible.
- **Coordination:** COMMISSION-SET is a new subtype on the shared DVXP envelope,
  co-owned with the DMT/chain agents — must be reconciled alongside the pending
  6-vs-7-byte header item before it lands.

## 8. Open decisions
1. Standalone NFDs get commissions too, or collections only? (§4)
2. All transfers pay, with only the primary sale exempt? (§6)
3. One payout address per collection (creator-chosen), updatable with the amount? (assumed yes)
