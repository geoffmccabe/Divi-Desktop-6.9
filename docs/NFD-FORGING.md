# NFD forging — the PERC upgrade mechanic

Forging is what makes a **PERC** more than a static collectible: burn two NFDs of
the **same group and tier**, pay the collection's forge fee, and re-roll a
**guaranteed upgrade** to a higher tier in that group. Forging is configured
**per group** by the creator at launch and resolved provably-fairly on-chain.

## 1. Rules (Geoff, locked 2026-Nov-01)

- **Groups.** A collection has one or more groups: the **main set** (the base
  tier ladder) and each named **Ultra-Rare set**. Forging happens *within a
  group* — two main cards forge into a higher main card; two cards of one UR set
  forge into a higher card of that same set. You cannot mix a main card with a UR
  card, or two different UR sets.
- **Inputs:** two different NFDs in the same collection, the **same group** and
  the **same tier** within it, both revealed and owned by the forger.
- **Per-group dials (set by the creator at launch, fixed on-chain):**
  - **On / off** — each group can be forgeable or not. The main set is **on by
    default**; each UR set carries its own switch (from the Kinet.ink package).
  - **Mode** — **+1 only** (a forge always yields exactly input tier + 1) or
    **variable** (a random climb).
  - **Climb chance** (variable only) — the per-step chance of climbing one more
    tier. **Default 50%**, giving **+1 at 50%, +2 at 25%, +3 at 12.5%, +4 at
    6.25% …** (a forge is **always at least +1** — an upgrade every time).
- **Cost:** a single **per-collection** amount the creator sets (editable in the
  launch review screen), paid to the creator's payout address. `None` = free.
  (The old flat 1000-DIVI rule is retired.)
- **Past the last artwork:** the result **tier number keeps climbing** even when
  it passes the group's available art — e.g. 29 → 34 in a 30-art set. The number
  stays as-is in the metadata; the **artwork caps** at the top available tier (it
  reuses the top card's art). There is a safety cap of +40 on a single forge.
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
  SHA256(result_id ‖ resolve_block_hash)`, then the climb K is drawn from that
  seed under the group's dials (+1-only → 1; variable → 1 plus consecutive
  "continue" draws at the group's climb chance, capped at +40). See
  `forge_climb` in `crates/nfd-indexer/src/lib.rs`.

(A PoS block producer could in principle grind the seed block's hash slightly;
for a game upgrade that's an acceptable v1. A commit-reveal or multi-block seed
can harden it later if needed.)

## 3. On-chain shape

- **Per-group forge dials** live in the **COLLECTION-CREATE v3** record
  (`nfd_record.rs` `encode_collection_create_v3`, version byte `0x03`): the base
  set and each UR set each carry `forge_mode(1)` (0 off / 1 +1-only / 2 variable)
  and `forge_continue_ppm(4)`. v1/v2 collections (which carried no dials) map to
  the legacy behavior: main set variable @ 50%, UR sets off.
- **FORGE record** (NFD subtype `0x05`): `input_a_txid(32) ‖ input_b_txid(32) ‖
  collection_id(32)`. Signed by the forger (funds the tx), pays the collection's
  forge fee to the creator's payout address.
- **Result:** once the resolve block exists, a sealed result pack (keyed by the
  forge txid) resolves to the climbed tier, stamped back into its group (a UR
  result carries its `ur_set` + the new `ur_tier`). It references the result
  tier's shared artwork off-chain; tiers past the art count reuse the top art.

## 4. What's implemented vs. next

- **Done + unit-tested** (`crates/nfd-indexer/src/lib.rs`, `crates/supervisor/
  src/{nfd_record,forge}.rs`): the v3 per-group record format, the indexer's
  authoritative enforcement (same group + same tier, group enabled, burn both,
  roll the climb under the group's dials, reorg-safe undo), the parameterized
  climb (50/25/12.5 at 50%, the tunable chance, +1-only), and the wallet-side
  preview + launch wiring (the review screen edits every group's dials).
- **Next:** vendor the updated `nfd-indexer` into the chain daemon and the
  Divilovescan indexer so the **node enforces** it (until then forging is
  wallet-driven — correct records on-chain, node enforcement to follow), the
  wallet forge UI (pick two same-group/tier owned PERCs → forge → "resolving in N
  blocks" → reveal), and the tier→artwork registry so a result references the
  correct (capped) tier art automatically.

## 5. Open decision

- **Forge fee destination** — assumed the **creator's payout address** (same as
  commissions and the mint price). Confirm, or route it elsewhere (treasury /
  partial burn).
