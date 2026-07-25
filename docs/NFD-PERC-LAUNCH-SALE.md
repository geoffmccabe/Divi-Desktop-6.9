# Perc launch — handling a concurrent buy-rush

Planning for the Skylie Perc launch, where ~12-30 people buy at the same moment
and their transactions land in the same few blocks. Written for the NFD + wallet
agents and for Geoff. This is analysis + architecture; the allocation policy (§4)
is Geoff's call.

## 1. The real bottleneck is NOT block size

A common worry is "12-30 buys will crowd/clog the block." They won't. A Divi
block (~60s target, Bitcoin-fork block size ~1-2 MB) holds **thousands** of
~300-byte transactions. 12-30 txs is well under 1% of one block. Even 10x that is
fine. **Block space is not the constraint at this scale.**

The actual constraints are three, and all are solvable:

1. **Many transactions from ONE treasury address at once.** If every sale spends
   the treasury's funds and each tx chains on the previous one's *unconfirmed*
   change, you hit the mempool ancestor limit (~25 unconfirmed in a chain) and the
   rest **stall until a block confirms** — roughly one per block after that. This
   is exactly the batch-mint stall the importer audit found, amplified by a burst.
2. **Two buyers racing for the same PERC** → double-allocation of one collectible.
3. **Fair, ordered allocation of the desirable low serial numbers.**

## 2. Architecture that absorbs the rush

1. **Pre-mint all inventory to the treasury BEFORE launch.** Each PERC is an
   encrypted NFD owned by the treasury. There is no time pressure here — it's done
   ahead of the sale, so the buy-rush never triggers minting/Arweave uploads.
2. **Pre-split the treasury's DIVI into a UTXO pool** — one spendable, *confirmed*
   UTXO per expected concurrent buy, with margin (e.g. 200). Then each sale's
   on-chain transfer spends an **independent** confirmed UTXO: no chaining, no
   ancestor-limit stall, and **hundreds of transfers can land in a single block.**
   This one change is what makes a burst work.
3. **A sale coordinator** (extend the `nfds.divi.love` relay, or a small sibling
   service): it **serializes allocation** (an atomic "next PERC" assignment per
   §4), verifies payment, then **dispatches the transfer** (re-wrap the content key
   to the buyer + a TRANSFER record) using a free UTXO from the pool. Allocation is
   serial (no races); settlement is parallel (fast). 12-30 concurrent requests is
   trivial for one server to order.
4. **A buyer queue + live status:** "assigned #12 · payment seen · transferring ·
   done." Congestion becomes *visible and dynamic* rather than silent failures —
   the queue simply drains at chain speed. No one gets a stuck/failed buy.
5. **Pool replenishment:** a background job re-splits confirmed change back into
   the UTXO pool so it never runs dry mid-sale.

Because purchase = **transfer of a pre-minted PERC** (only the wrapped key is
re-wrapped, the ciphertext is never re-uploaded), each sale is a light, fast
operation — the cheap path the design already favors.

## 3. Why a purchase is a transfer, not a mint

Minting encrypts content to a specific owner and uploads to Arweave — slow and
per-item. Doing that live during a rush is the worst case. Pre-minting to the
treasury moves all of that *before* launch; the rush then only does cheap
transfers. This also sidesteps "two people mint the same edition" entirely, since
every PERC already exists with a fixed serial before anyone buys.

## 4. Allocation policy — blind per-block auction (Geoff, locked)

Position is decided by a **sealed-bid (blind) auction, resolved block by block:**

- Each buyer submits a purchase with a **bid = the amount they pay**, but **nobody
  can see anyone else's bid** — so they have to guess how much to put up to win a
  good spot.
- When a block closes, the coordinator ranks that round's bids: the **highest
  bidders get that block's (lowest available) serials**, delivered in that block.
- **Lower bidders roll to the next block**, where the same blind auction repeats
  against whoever else is still waiting (and any new arrivals). It keeps repeating
  until the set is sold out.
- **Pay-your-bid:** the amount you put up is spent (it's not refunded down to a
  base price) — that's what makes bidding meaningful. (ASSUMPTION — confirm losers'
  bids simply *carry* to the next round, and whether they may top up between rounds.)

**Making it truly blind.** On-chain DIVI payments are public, which would leak
bids. Two ways to keep them sealed until a round resolves:
- **Coordinator-held (simplest, launch):** bids go privately to the coordinator,
  revealed only when the block's round resolves. Fine for a first-party drop where
  Geoff runs the coordinator; requires trusting it not to peek/leak.
- **Commit-reveal (trustless):** buyers first publish `hash(bid+nonce)` (hides it),
  then reveal after the round; the coordinator/chain can't front-run. More UX, no
  trust needed. Recommended if/when the sale must be trustless.

This still sits on the same §2 architecture — pre-mint + UTXO pool + coordinator;
the auction only changes the *order* the coordinator assigns serials each block.

## 5. Payment + atomicity

- **Primary sale = coordinator-mediated:** buyer pays the treasury, the coordinator
  confirms and delivers the PERC. Standard for a first-party drop, and fine here.
- **Trust-minimized (later / secondary market):** HTLC (Divi has a `TX_HTLC`
  template) makes pay-and-deliver atomic without trusting the coordinator — the
  same mechanism planned for the marketplace.

## 6. Anti-abuse

- **Per-buyer purchase cap** (per identity/address) so one person/bot can't sweep
  the set. Essential with random-fair or FCFS.
- The coordinator is the single choke point — same posture as the moderation relay
  — so rate-limiting and caps are enforced in one place.

## 7. Relationship to forging

Launch is the **primary sale** (this doc). **Forging** (merge 2 same-tier → weighted
re-roll up) happens *after* people own PERCs, and reuses the same UTXO-pool +
coordinator patterns for its burn+mint. They don't collide at launch.

## Open decision
Pick the §4 allocation policy — it's the only thing that changes the build shape.
Everything else (pre-mint, UTXO fan-out, coordinator queue) is the same regardless.
