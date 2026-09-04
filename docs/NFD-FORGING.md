# NFD forging — the PERC upgrade mechanic

Forging is what makes a **PERC** more than a static collectible: burn two NFDs of
the **same tier**, pay a fee, and re-roll a **guaranteed upgrade** to a higher
tier. Design + status below. The roll math and the on-chain flow are implemented
and proven on regtest; the wallet UI and the indexer's authoritative enforcement
are the next steps.

## 1. Rules (Geoff, locked)

- **Inputs:** two NFDs of the **same tier**, in the same collection, both owned by
  the forger.
- **Cost:** **1000 DIVI** (flat, like the creator commission), paid to the
  creator's payout address.
- **Outcome — always an upgrade.** The result tier = input tier + a bump K:
  - +1 tier at **50%**, +2 at **25%**, +3 at **12.5%**, … halving, up to **+40**.
  - So `P(K=k) = 1/2^k` for k = 1..39, with the tiny tail folded into K = 40.
- **Past T40:** the result tier may exceed 40 (e.g. forge two T38 → T45). Tiers
  above 40 **reuse T40's artwork** — the tier number keeps climbing, the art caps.
- Both inputs are **consumed** (burned) by the forge.

## 2. Fairness — an ungrindable, verifiable roll

The one thing that must be right: the forger can't predict or retry the roll.

- The forge is a single transaction that **burns the two inputs and pays the fee
  up front** — the forger is committed before the outcome exists.
- The outcome is derived from the hash of a **future block** (`forge block +
  FORGE_DELAY`, currently 6). That hash is unknown when the forge is committed, so
  it can't be steered; and because the forger has already burned + paid, there is
  no retry.
- The roll is deterministic and **anyone can verify it**: `seed =
  SHA256(forge_txid ‖ resolve_block_hash)`, then K = (leading 1-bits of the seed)
  + 1, capped at 40 — which is exactly the halving distribution above. See
  `crates/supervisor/src/forge.rs`.

(A PoS block producer could in principle grind the seed block's hash slightly;
for a game upgrade that's an acceptable v1. A commit-reveal or multi-block seed
can harden it later if needed.)

## 3. On-chain shape

- **FORGE record** (`nfd_record.rs`, NFD subtype `0x05`): `input_a_txid(32) ‖
  input_b_txid(32) ‖ collection_id(32)`. Signed by the forger (funds the tx), pays
  1000 DIVI to the creator's payout address.
- **Result:** once the resolve block exists, the forger mints **one** result PERC
  — a Public mint that **references the result tier's existing shared artwork** (no
  re-upload), tagged with the new tier. `collectibles::forge` /
  `forge_outcome` / `mint_public_ref`.

## 4. What's implemented vs. next

- **Done + proven on regtest** (`examples/forge_demo.rs`): the roll math (unit
  tests confirm 50/25/12.5 and "always an upgrade"), the FORGE record, and the full
  commit → future-block resolve → result-mint flow (two T5 → T8 in the run).
- **Next:** wallet UI (pick two same-tier owned PERCs → forge → "resolving in N
  blocks" → reveal), the tier→artwork registry on the collection (so the result
  references the correct tier art automatically), and the **indexer's authoritative
  enforcement**: verify the forger owns both inputs and they share a tier, **burn**
  them, waive the creator-only rule for the single forge result, and check the
  result tier matches the block-hash roll. Until the indexer lands, forging is
  wallet-driven (correct records on-chain, enforcement to follow) — the same
  posture as the rest of the NFD system today.

## 5. Open decision
- **Forge fee destination** — assumed the **creator's payout address** (same as
  commissions). Confirm, or route it elsewhere (treasury / partial burn).
