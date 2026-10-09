# Divi Rebels: NFDs in the game

Plan written 2026-Oct-08. Source material: Kinetink's handoff at
`/Users/geoffreymccabe/kinetink/docs/DIVI_REBELS_NFD_INTEGRATION.md`, the blind
pack model in `docs/NFD-REVEAL-UR.md`, and the overlay spec in
`docs/DIVA-EVM-AND-NFT-BRIDGE-SPEC.md`.

Four questions in section 7 block parts of this. Everything before them can be
built against a stub while the set is unlaunched.

---

## 1. What already exists, so we do not rebuild it

Checked in the code rather than assumed.

| Thing we need | What is already there |
|---|---|
| A drop whose chance rises with enemy tier | `rollDrop` in `dropCharts.ts` already computes `chancePerTier * tier`. Geoff's "1% per tier of the enemy killed" is this, with the chance set to 0.01. |
| A thing that floats in space and is picked up | `Gem` in `rebelsCombat.ts`. It already has an `item` key, a tier, orbit, magnet, recoil, persistence, and "only the killer can see it for one minute". An NFD cube is a Gem drawn differently. |
| Reveal and Ultra Rare maths | `crates/supervisor/src/reveal.rs`, `draw_geometric` and `reveal`, proven over 400k rolls. |
| Minting into a collection, tiers, encryption | `ui/src/wallet/CollectiblesPanel.tsx`. |
| The player's wallet addresses, per door | `platform().money.ownAddresses()`. The app, the web door and Lovenode each answer it their own way. |
| Admin panels, admin-only | `ui/src/admin/registry.tsx`, the pattern used by the Enemies and Games panels. |

What does NOT exist and has to be built: a damage multiplier and a damage
resistance for the PLAYER. `Extras` in `orbitFlight.ts` has torpedoes,
magazine, boost, strafe and hull, and nothing for damage dealt or taken.

---

## 2. The one architectural decision everything else follows from

**The room has to know the player's top NFD tier, and it cannot ask the
player.**

All three benefits are settled server side. The room owns shields, damage and
the drop roll, deliberately, because "the whole reason the room exists is that
it settles those numbers where nobody can reach them". Two of the three
benefits are combat, and the third one, drop chance, is a money lever: more
drops is more DIVI.

Gear and wingmen are declared BY the client today. That is tolerable because
they only change how the ship flies. An NFD tier that raises drop rate is not
in that category: a client that can claim a tier can print money.

So ownership is resolved by something the player cannot edit. See question 2.

---

## 3. Modularity: where the code lives

Geoff wants this reusable in other games. So the NFD layer is NOT inside
`rebels/`. Three separate pieces with narrow seams:

1. **`ui/src/nfd/` (game agnostic).** The catalog (what a collection is), the
   launch-JSON ingest and validation, the ownership interface, and the gallery
   components. Knows nothing about ships, waves or DIVI.
2. **`ui/src/wallet/rebels/nfdBenefits.ts` (this game).** Turns "the player's
   top tier is N" into this game's three numbers. Another game writes its own
   file and reuses everything above.
3. **The room's half** (`contrib/rebels-room/`). Reads a verified tier and
   applies it to damage, resistance and the drop roll.

The seam between 1 and 2 is one function: given a wallet address, return the
owned items and the top tier. Whether that comes from a stub table, an
indexer, or a chain scan is behind that seam.

---

## 4. Phases

### Phase 0: ingest and look at them (no chain, no gameplay)
- Catalog table keyed on `edition` 1 to 40: name, tier, rarity, `isUltraRare`,
  still image, animation, plus the collection's packaged art and banners.
- Ingest the Kinetink launch JSON. Reject anything whose `format` is not
  `kinetink-collection-launch`. Fetch media only from
  `matteqdhinpiwfnvxaef.supabase.co`, magic-byte check the bytes, size caps.
- Copy the media into our own storage once at ingest. We do not hot-link
  Kinetink on every frame.
- Admin panel, admin and super-admin only: add a collection by pasting or
  uploading the launch JSON, see the 40 items, enable or disable the
  collection for the game. This is the "only specific collections are useful
  in the game" gate.
- **Deliverable Geoff can see:** the Divi Rebels set, all 40 cards, in the
  admin panel.

### Phase 1: the NFDs tab, against stubbed ownership
- A new NFDs tab in the game's Inventory.
- The ACTIVE card at the top: the highest tier owned, large, with its three
  benefits spelled out as plain numbers.
- Below it, the rest of what the player owns, and the collection's other items
  shown as the packaged art so the set reads as a set with gaps to fill.
- Ownership comes from one function with a stub behind it, so the whole screen
  is real and testable before the chain exists.

### Phase 2: the benefits, settled by the room
- Add `damageMult` and `resistance` to the player's `Extras`, and a drop-chance
  multiplier to the drop roll.
- The room applies all three. The client only DISPLAYS them.
- Tests pin that the client cannot raise its own tier, and that the displayed
  numbers match what the room actually applies. Those are two different claims
  and both have been the fault at least once on this project.

### Phase 3: NFD cubes drop in the fight
- A new drop kind, drawn as a cube with the packaged art on each face, floating
  like the item spheres and picked up the same way. Everything about the Gem
  behaviour is reused.
- Chance is 1% per tier of the enemy killed, which is the existing
  `chancePerTier` mechanism with a new chart.
- On pickup: sealed, not yet revealed, and recorded as owed to the player.

### Phase 4: minting
- Pickup triggers a real mint to the player's address, through DD69, and the
  item appears in the NFDs tab as PACKAGED.
- The fee question is question 3. Until it is answered, pickup records a claim
  and mints on a schedule rather than one mint per pickup.

### Phase 5: unpackaging
- In the app: hand off to the existing reveal, which already has the seed, the
  animation and the maths.
- In the browser: the same reveal driven by the same server-side roll, with the
  animation reused from the app.

### Phase 6: after launch
- Map `edition` to the real on-chain ids.
- Replace stubbed ownership with the indexer.
- A second collection, to prove the modularity claim rather than assert it.

---

## 5. What a second game reuses

Phases 0, 1, 4, 5 and 6 are the reusable layer. Phase 2 and the cube art are
Divi Rebels specific. A second game writes its own benefits file and its own
drop presentation and gets the catalog, ingest, ownership, gallery, minting
and reveal for free.

---

## 6. Risks worth saying out loud

- **Drop chance is money.** Any bug that over-reports a tier pays real DIVI.
  This should be inside the payout ceiling work already in `gameTypes.ts`.
- **Minting costs a fee per drop.** At 1% per tier across a busy room this is a
  real and recurring cost. See question 3.
- **Two reveal models exist.** Kinetink's 40 items have FIXED tiers. The DD69
  blind pack model rolls the tier at reveal. They can be reconciled, but not by
  accident. See question 4.
- **Thirty tiers at 1% each is 30%.** See question 1.

---

## 7. Open questions

1. The benefit scale, given the set runs to tier 30.
2. Where ownership is read from, and whether the room verifies it.
3. Who pays the mint fee, and when minting happens.
4. Whether a dropped pack has its tier decided at drop or at reveal.
