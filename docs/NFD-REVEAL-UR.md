# Perc reveal + Ultra Rares — the blind pack model

Geoff (2026-Jul-31): Percs are **blind**. A Perc is sold **sealed** ("packaged").
The owner clicks **Reveal / Unpackage**, an animation plays, and *at that moment*
the Perc's tier — and whether it's an **Ultra Rare** — are rolled. Nobody (buyer
or seller) knows what a sealed Perc is until it's opened.

This is a shift from the earlier "each manifest item has a fixed tier" idea, so it
changes the set format and the mint/reveal flow (see §4). The roll math is built +
proven (`crates/supervisor/src/reveal.rs`).

## 1. The reveal roll

At reveal, from a fair seed (a future block hash the owner can't predict — same
anti-cheat as forging), two independent draws:

- **Base tier** — the standard halving curve: **T1 50%, T2 25%, T3 12.5% …** up to
  the number of tier artworks (e.g. 40). Formula: with rarity factor `f`, P(tier k)
  = (1-f)·f^(k-1); base uses f = 0.5.
- **Ultra Rare gate + tier** — with probability `ur_chance` (e.g. **1%**) the Perc
  *also* becomes a UR. It **keeps its base tier** and gains a **UR tier** on its own
  curve using `ur_factor` (e.g. **10% → UR-T1 90%, UR-T2 9%, UR-T3 0.9% …**) up to
  the number of UR artworks (e.g. 5). The UR artwork is shown as a **replacement**.

So a revealed Perc might be **"T10"** or, 1% of the time, **"T10 · UR-T2"**.

One consistency worth noting: it's **one mechanism, two dials** — a 50% rarity
factor makes the base tiers, a 10% factor makes the URs. Verified over 400k rolls:
base 50/25/12.5, UR gate ~1%, URs 90/9/0.9.

## 2. When a reveal happens

- **First open of a purchased Perc** — the buyer opens their sealed pack.
- **A forge result** — forging already rolls a fair upgrade; the result is revealed
  the same way (its tier via the forge bump, plus the same 1% UR check). So forged
  Percs can be URs too.

Both use the same fair-seed roll, so there's one reveal engine.

## 3. Set JSON (the config)

The Kinet.ink set JSON carries the rarity config and the **art library**, not
per-item tiers:

```json
{
  "tiers": { "factor": 0.5, "art": ["t1.webp", "t2.webp", ... "t40.webp"] },
  "ultraRare": { "chance": 0.01, "factor": 0.10, "art": ["ur1.webp", ... "ur5.webp"] },
  "sealedArt": "package.webp"
}
```

If `ultraRare` is omitted, the set simply has **no URs**. `sealedArt` is what a
packaged Perc shows before reveal.

## 4. What this changes (honest)

Carries over unchanged: **Public mode, collections, batch minting, the fair-roll
engine (forge + reveal), the on-chain record pattern, the funding fix.**

Reworked for the blind model:
- **Set format / import** — the manifest becomes an **art library + rarity config**
  (tier arts + UR arts + factors + chances + sealed art), not a list of pre-tiered
  items. (Standard, non-blind collections keep the per-item form; Percs use this.)
- **Mint** — a Perc mints as a **sealed pack** (shows `sealedArt`, no tier yet).
- **New REVEAL step** — a reveal record (analogous to FORGE): references the sealed
  Perc, commits to a future block, resolves base tier + UR from its hash, and the
  Perc's revealed art becomes the tier art (with the UR art overlaid when it hits).
- **UI** — a "packaged" state + a Reveal/Unpackage button with the reveal animation.

## 5. Status
- **Done + proven:** the reveal roll engine (base tier + UR gate + UR tier), unit
  tested to the exact odds.
- **Next:** the REVEAL on-chain record + sealed-pack mint + the art-library set
  format + the reveal UI/animation, and the indexer's authoritative resolution
  (same posture as forging: records now, trustless enforcement with the indexer).
