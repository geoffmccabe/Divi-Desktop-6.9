# Points, and buying them with DIVI

**Status:** built 2026-Aug-24. Service side and wallet side both landed; the
treasury address and the DIVI rate are the two numbers Geoff must set before
anyone can buy.

---

## What a point is

**1,000 points = $1.00 of what we charge.** Fixed, forever.

A point is a fixed amount of *money we charge*, never a fixed amount of model
usage. That distinction is the whole design:

- If Anthropic raises a price, a build step costs more **points**.
- Nobody's existing balance quietly becomes worth less.

We charge **twice** what the tokens cost us, which is Geoff's number and lives in
one place (`MARKUP` in `contrib/app-builder/src/points.mjs`).

So a step that costs us $0.05 charges $0.10, which is 100 points.

## The bundles

| Bundle | Points | Price | Discount | Per point |
|---|---|---|---|---|
| Starter | 1,000 | $1 | — | 1.00 |
| Builder | 10,000 | $8 | 20% | 0.80 |
| Studio | 100,000 | $64 | 36% | 0.64 |

Ten times the points for 20% off, again at the next step (0.8 × 0.8 = 0.64), so
the reward for buying bigger is consistent rather than picked out of the air.

**The bundles are data.** Adding a fourth is one line in `TIERS`; the panel
renders whatever is there and the purchase flow prices whatever it is handed.
Nothing counts the tiers or assumes there are three.

## Buying

1. The buyer picks a bundle. We write down what they owe, **to the satoshi,
   before they pay**. The price cannot move underneath them.
2. Each order gets a tiny unique amount added, a few ten-millionths of a DIVI.
   That makes the payment self-identifying: two people buying the same bundle at
   the same moment owe different amounts, so one cannot claim the other's
   payment. It costs the buyer a rounding error and removes the need to prove
   who they are just to top up.
3. The wallet sends it as a **normal send** — same password rules, same
   confirmation. Buying is not a back door that moves coins more easily than the
   Send panel would.
4. **We ask the node**, not the buyer, whether the payment happened. Points
   appear after 2 confirmations.
5. A transaction id can settle exactly one order, ever.

If the node cannot be reached, nothing is credited and the order stays open.
Failing closed costs a buyer a wait; failing open would let anyone mint points
by inventing a transaction id.

## Where a balance lives

In the service's append-only ledger (`points-ledger.jsonl`), and nowhere else.

The audit of the previous version found the balance arriving **in the request**,
so anyone could declare themselves rich. That is closed: the wallet can read a
balance and start a purchase, but nothing in it can change one.

The ledger is the truth and the balance is replayed from it, so the two can never
disagree. Every movement records what it was for, which is what lets us answer a
dispute and reconcile against the real Anthropic invoice.

## Spending

Before each step the builder works out **the most that step could possibly
cost**, holds that many points, and refuses to start if the balance will not
cover it. The same ceiling is sent to the model as a hard output limit, so it is
a real bound rather than a hope. The step is then charged on the token counts the
API actually reports.

A model with no configured price is refused **before** the call. The earlier
version made the call and then failed to bill, which meant we paid and the
developer did not.

## The two numbers Geoff must set

| Setting | What it is |
|---|---|
| `DIVI_TREASURY_ADDRESS` | The address buyers pay into. Points are only ever credited from payments to this address. |
| `DIVI_PER_USD` | How many DIVI to a dollar. **Admin-set, never a live feed:** price aggregators disagree by roughly 4.5x on DIVI because they track different illiquid venues, so billing off a feed would be indefensible. |

Until both are set the panel says so plainly and refuses to sell.

## Still open

- **Proving an account belongs to someone.** An account is currently the
  wallet's main receiving address, taken at its word. That is only acceptable
  because the service listens on this machine and nowhere else. Signing a
  challenge with that address is the next piece, and must land before this is
  ever exposed to a network.
- **Reusing the modal.** `PurchaseWithDivi` knows nothing about points — it is
  handed choices and told when the money moved. Selling a theme or a community
  app later is a new caller, not a new modal.
