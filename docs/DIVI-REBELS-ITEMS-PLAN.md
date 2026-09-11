# Divi Rebels: rare items, drop charts, tiers, forging, inventory (plan)

Written 2026-Sep-05 from Geoff's brief. Nothing built yet. Questions at the
end decide details; the phases do not depend on them except where marked.

## What exists that this builds on

- Items are data (`ui/src/wallet/rebels/itemCatalog.ts`): key, kind, tier,
  amount, price, prerequisite. The flight model, the room and the help card
  already read multipliers from items (`superMult`, `strafeMult`). A new
  passive item is a row plus one reader.
- Ownership is per account (`rebelsArmoury.ts`), mirrored to the DD69
  Supabase row `rebels_loadout` and declared to the room on join (`gear`).
- The room already runs the two halves a drop needs: a world object that
  persists (gems: `dropGem`, `stepGems`, storage `gem:<id>`, wire `G`) and a
  per-seat credit banked to the ledger (`seat.gems`, `ledger.credit`).
- Kills carry `who`, `tier`, `worth`, `fleet` on the `enemyDown` event.
- The wallet has an admin overlay with a panel registry
  (`ui/src/admin/registry.tsx`): the drop-chart editor is one more panel.
- Gems are the model for anything found in the world: room-only, the
  room's word, magnetic, shootable, never lost.

## The rules, made precise

- **Chance of a drop** on a kill: 10% x the enemy's tier (tier 1 10%, tier 7
  70%), rolled by the room. Q1 asks how flock members count.
- **Which item**: a weighted pick from the chart assigned to that enemy
  kind, weights as Geoff's list (Drop chart 1 below). Q2 covers the Rear Gun.
- **Visibility**: the drop is a world object at the kill, seen only by the
  killer for 60 seconds, then by everyone. Picked up by flying through,
  magnetic like a coin. Recorded by the room, credited to the account.
- **Tiers**: T1 to T5 as in the chart, colours yellow, green, blue, purple,
  red. A forged T6 or T7 is "by name" (white, fuchsia) with T5's power.
- **Forging**: four of one tier become one of the next; +1 tier 90%, +2 9%,
  +3 1%. Server-side, on the ledger, never on the client.
- **Inventory**: the `I` key, a full panel: ships, weapons, then items by
  tier (best first) then name. Each item a card: model on the left,
  tier, name, description.

### Drop chart 1 (Geoff's weights)

| Weight | Item | Effect |
|---|---|---|
| 100000 | Instant Recharge | Everything to full, as at home base. |
| 40000 | Supercharge | A full recharge ON TOP of what the ship has (up to 200%). |
| 1000 | Rear Gun | Q2. |
| 40000 / 10000 / 2500 / 625 | Vertical Strafe T1 to T4 | 1.5x, 2x, 2.5x, 3x. |
| 40000 / 10000 / 2500 / 625 | Horizontal Strafe T1 to T4 | 1.5x, 2x, 2.5x, 3x. |
| 40000 / 10000 / 2500 / 625 / 156 | Hull Boost T1 to T5 | Q3 for the amount. |
| 100 | Local Portal | A placeable portal near Earth; phase 5. |
| 10000 / 2500 / 625 / 156 / 39 | Drone T1 to T5 | Autonomous wingman; phase 4. |

Total weight 322,742. Instant Recharge is 31% of drops, a T5 Drone one in
eight thousand drops, about one in 80,000 tier-1 kills.

## Phase 0: the drop system and the charts (server first)

The foundation everything else stands on. Nothing visible changes for the
player until phase 1 except that items begin to drop and land in the
account.

- **Catalogue v2** (`itemCatalog.ts`): every item above as a row: `key`,
  `name`, `kind`, `tier`, `amount`, `describe`, `colour`, `consumable`.
  Kinds: `recharge`, `supercharge`, `reargun`, `vstrafe`, `hstrafe`, `hull`,
  `portal`, `drone`. The existing bought items (torpedo, mag, vip, super,
  strafe) stay as they are; `strafe` becomes `hstrafe` with an alias so
  nothing owned is lost.
- **Drop charts in Supabase**: `rebels_drop_charts` (id, name, notes),
  `rebels_drop_chart_items` (chart, item key, weight), `rebels_drop_rules`
  (enemy kind: fighter/drone/flock, tier from..to, chart, chance per tier).
  Public read; writes only through an RPC that checks an admin secret
  (Q5). The room fetches charts at start and every 10 minutes.
- **The roll**, in the room, on `enemyDown` with a `who`: chance = rule's
  per-tier chance x tier; on a hit, weighted pick; `dropItem(c, key, at,
  id, owner, ownerUntil)` puts a world drop in orbit like a gem, saved to
  storage `drop:<id>`, streamed in a new `D` wire array with owner and the
  seconds until public. Pickup: within reach, and (owner or past the
  minute) -> `seat.items[key]++`, banked to the ledger `items` map,
  storage deleted. Solo play: no drops, like gems (Q6).
- **Ledger**: `items: Record<key, count>` on the account; purse carries it.
- **Admin panel** "Rebels Drops" in the wallet's admin overlay: charts,
  items and weights editable, rules assignable, a "test 10,000 rolls"
  button that shows the resulting distribution so a change can be checked
  before it is saved. Saved with the admin secret.
- **Drawing**: a drop is a coin-sized sphere in its tier's colour with the
  tier label on it (canvas texture, as the DIVI logo is), pulsing; a private
  drop is drawn only for its owner. Models come later (Q7).
- Tests: the roll's distribution over 100,000 rolls against the weights;
  chance per tier; owner-only pickup for 60s then anyone; persistence.

## Phase 1: what the items do, and forging

- **Consumables**: Instant Recharge and Supercharge. On pickup the room
  applies them at once to the seat (Q4): shield, ammo, boost, torpedoes,
  guards to full; Supercharge adds a full set on top, capped at 200% and
  drained first. The HUD gauges already show over-full as a longer bar.
- **Passives**: Vertical Strafe, Horizontal Strafe, Hull Boost feed
  `Extras` (`vstrafeMult`, `hstrafeMult`, `hullMult`) through `flightExtras`
  and the room's join. Best owned tier applies; forged "by name" tiers
  apply T5's amount. Hull Boost raises MAX_SHIELD by its amount (Q3).
- **Forging**: a ledger operation `forge(key, tier)`: needs four of that
  tier of that item family, removes four, rolls +1 (90%), +2 (9%), +3 (1%),
  adds one of the result, capped by name at the family's top tier plus two
  (T6, T7 "by name"). The client asks, the room forwards, the ledger
  decides and answers with the new purse. Inventory shows a FORGE button on
  any stack of four or more. Tests: the odds over 10,000 forges; never
  below four; a T5 forge lands T6 by name with T5 power.

## Phase 2: the inventory panel

- `I` opens it anywhere in the game (not while typing). Full panel in the
  store's cloth: three sections. **Ships**: the fleet from `rebels_ships`,
  the flown one first, each with its turntable preview. **Weapons**: the
  account's guns (they are per account now, not per hull: Q8). **Items**:
  every stack, sorted by tier (best first) then name, each a card: the
  placeholder model on the left (the labelled sphere, turning), tier badge
  in its colour, name, what it does with the numbers, count, FORGE when
  there are four, USE for a consumable held in reserve (Q4).
- Reads the purse (ledger) when the room is live, the local mirror when
  not; says which it is showing.

## Phase 3: Rear Gun and Hull Boost in the fight

- Hull Boost: MAX_SHIELD x (1 + amount), on the client's flight and on the
  room's seat.
- Rear Gun (pending Q2): the likeliest reading, an automatic gun that fires
  at anything behind the ship within a cone, at the pulse gun's damage, on
  its own cooldown, using the magazine. Room-side like every weapon.

## Phase 4: Drones (wingmen)

The biggest piece. Each drone is a room-simulated body with its own hull
and ammo, flying formation on the owner: eight slots on a ring around the
ship at 1.5 ship-widths (right, lower right, below, lower left, left, upper
left, above, upper right), filled in that order. It matches the owner's
speed, fires when the owner fires at the owner's aim, at the tier's damage
share (50/80/110/140/170%), with the tier's hull share and bullet
multiplier (1.25x, 1.5x, 1.75x read as magazine size: Q9). Drawn as the
owner's hull at half scale, painted the same. Enemies can target drones
(Q10 asks whether a destroyed drone is lost). Wire: a new `W` array (owner,
slot, hull, tier). Tests: formation geometry, firing in unison, hull share.

## Phase 5: Local Portals

A world object the owner places: pick a point (fly there and press the
place key, or a map click), the portal appears near Earth at that point and
persists. Flying into any portal: the owner gets PICK UP or a destination
list; anyone else gets the destination list (every other portal, by owner
name and place) and is teleported. Room-simulated and persisted like gems.
The dropdown is a HUD panel in the store's style. This is the most UI of
the five phases and the least defined; it goes last.

## Anti-cheat, stated

Drops are rolled by the room, never asked for. Pickups are the room's.
Forging and counts are the ledger's. The client only draws and asks. A
client that lies about owning a T5 drone declares gear the room can check
against the account once items live on the ledger (phase 0 gives the room
the account's items at join, closing the "gear is the client's word" gap
for these items).

## Order and size

0 then 1 then 2 are the useful core: items drop, do things, can be forged
and seen. 3 is small. 4 and 5 are each as big as 0 to 2 together. Each
phase ships on its own with tests, docs and a version.

## Questions

1. Flock members are a fifth of a kill. Do they roll drops at a fifth of
   the chance (2% x tier), at the full chance, or only the flock kill?
2. Rear Gun: what does it do? (My guess: an automatic gun covering the
   rear cone.)
3. Hull Boost: how much per tier? (My guess: +20% max hull per tier, T5 =
   double.)
4. Instant Recharge and Supercharge: applied the moment they are picked up,
   or held in the inventory and used with a key when needed?
5. Who is admin, and how do we prove it to the server? (My proposal: a
   secret in a file on your Mac, typed once into the admin panel, checked
   by the Supabase write function. Same pattern as the payout secret.)
6. Drops only in the shared room, like gems? Flying alone would then drop
   nothing.
7. Placeholder models: coin-sized spheres with "T1" and the tier colour, as
   you said, plus the item's initial letter so a drone and a strafe are
   told apart before real models exist. OK?
8. The inventory brief says "weapons for each ship". Weapons are per
   account now (the minigun fix). Show them once, or go back to per ship?
9. Drone "bullets x 1.25": a bigger magazine, or a faster rate of fire?
10. A drone shot down: lost for good (the item consumed), or back with the
    owner's next respawn?
11. Stacking drones: can a player fly with several (up to the eight slots)
    if they own several?
