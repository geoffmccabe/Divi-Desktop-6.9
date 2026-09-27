# Divi Rebels: the Game Builder

Admin-defined game types, enemy types and wave sequences, and the game
controller that runs them.

Geoff, 2026-Sep-26: *"The game is supposed to have a clear sequence of play,
with new waves every 2 minutes... Do we need a game controller module now?
Let's add that and an admin panel to control the different types of games."*

---

## 1. What a game IS

Geoff's own definition, which the whole design follows:

> *"Games can be on Earth (current world) or at any of the planets or other
> space objects already placed near to earth. Or to a code-created world such
> as the Spikeworld. So a wave may be an easy one at Earth, or a very difficult
> one on earth, or on another planet or in anywhere else. So games are a
> combination of both a place, and a set of waves with (usually) increasing
> difficulty and perhaps a boss at the end."*

So:

    A GAME  =  a PLACE  +  a SEQUENCE OF ROUNDS  +  REWARDS

- **Place** — Earth orbit, one of the fourteen planets, one of the six
  stations, one of the four asteroid belts, or a built world such as
  Spikeworld. Every one of these already exists in the sky
  (`ui/src/wallet/rebels/spaceEnvironment.ts`) with a fixed position and a name.
- **Rounds** — each with a length in seconds and a list of what arrives in it.
  Rounds end **on the clock**, always (Geoff's answer).
- **Rewards** — what enemies drop, what a round pays, and what beating the
  whole thing is worth.

### The one insight that makes this cheap

A place is a **region**, and regions were built on 2026-Sep-26 for Spikeworld
(`ui/src/wallet/rebels/rebelsRegions.ts`, `contrib/rebels-room/src/protocol.ts`).
A region is: a room name, a point in the world that is that room's origin, and
whatever the room puts in front of the players. Positions travel on the wire
*relative to the region's origin*, which is exactly what lets a place two
hundred thousand units from Earth work at all.

Every planet, station and belt is therefore already a candidate place: it has a
position (`planetLayout()`, `furnitureLayout()`) and it needs nothing new except
a room name. `roomNameOk` in `contrib/rebels-room/src/protocol.ts` **already
reserves `p1` to `p14`** for exactly this, described in the code as "the planet
shards".

---

## 2. What already exists, and must be reused rather than rebuilt

| Thing we need | What is already there |
|---|---|
| Admin panel that edits live config | `ui/src/admin/panels/RebelsDropsPanel.tsx` + `ui/src/admin/registry.tsx` |
| Live config read by both cockpit and room, with a safe default | `ui/src/wallet/rebels/dropConfigRemote.ts` + `dropCharts.ts`; the room re-reads it every 600 s |
| Item drops per enemy kind, with weights and per-tier chances | `dropCharts.ts` — **extend this, do not write a second one** |
| Places in the sky, named and positioned | `spaceEnvironment.ts` |
| Regions: rooms with their own origin | `rebelsRegions.ts`, `contrib/rebels-room/src/room.ts` |
| Ship look designer (hue/saturation/brightness/overlay per part) | `shipColours.ts`, `ShipMarket.tsx` |
| Shrinking an uploaded picture to a small WebP | `ui/src/wallet/rebels/shipSkin.ts` |
| Enemy tiers, flocks, the dragon | `rebelsFlock.ts`, `rebelsCombat.ts` |
| Banking what a player earned, in one place | `contrib/rebels-room/src/economy.ts` + the ledger Durable Object |

The pattern to copy for every new piece of config is the drops one exactly:
a table row holding JSON, a validator that refuses anything malformed, a
fallback to a built-in default so **a bad save can never stop the game**, and a
save path the server authorises.

---

## 3. Phases

Each phase is shippable on its own and leaves the game working. No phase
depends on a later one.

### Phase 0 — Roles

Nothing can be gated until the game knows who is an admin. Geoff chose an ADMIN
tab inside Divi Rebels, behind a role on the account.

- A `rebels_roles` table: account, role (`admin` | `superadmin`), granted-by,
  granted-at.
- The room reads it over its binding and decides; the cockpit reads it only to
  decide whether to *show* the tab. **The server never trusts the client's
  claim** — the same rule the cash-out already follows.
- The ADMIN tab appears in the game for those roles and for nobody else.
- Seeded with Geoff's own account as `superadmin`.

*Risk:* this is the first role system in Rebels. Keep it to two roles and one
table; resist making it general.

### Phase 1 — The game definition, with nothing visibly changing

Define the shape and get it flowing end to end before anything depends on it.

- A `GameType` record: id, name, card image, place, rounds, rewards, whether it
  is published, whether it is solo or multiplayer.
- A validator in the shared code, so the room and the panel agree.
- A `rebels_games` table, **one row per game type** (not one big row — the card
  images would bloat a shared row).
- A built-in default: **today's game, exactly as it is** — Earth orbit, rounds
  of 120 seconds, ten enemies in the first and two more each round. The current
  game becomes the first entry rather than a special case.
- The room reads game types the way it reads drop charts, and still plays the
  built-in one.

At the end of this phase players see no difference at all. That is the point:
the pipe is proved with nothing riding on it.

### Phase 2 — Places

Generalise regions from `earth` and `spike` to every place in the sky.

- A place table in shared code: id, room name, display name, world centre,
  what the sky looks like there, the flight ceiling and floor.
- Earth and Spikeworld become the first two entries of a list rather than two
  hard-coded branches in `room.ts`.
- `roomNameOk` opens `p1`–`p14` (already reserved) and the station and belt
  names.
- The gate machinery already handles arriving and leaving; a game at a planet
  arrives the way Spikeworld does.

*Risk:* the flight model assumes a planet at the world origin with a ground and
a ceiling. A game at a station has no ground. This phase must decide what
"altitude" means at each kind of place, and the room's position check must
follow it — the same bug that snapped every arriving Spikeworld pilot back to
Earth's floor and dropped them inside the heart.

### Phase 3 — The enemy builder

An `EnemyType` record and the panel that edits it.

Fields, from Geoff's list: name, health, damage, fire rate, colour of its
firing, velocity of the ship, velocity of its firing, shields, damage
resistance, whether it flocks — plus which hull it flies and what that hull is
painted like.

- **Built-ins appear as read-only entries**: the seven fighter tiers, the flock
  drone, the heart guard, the dragon. Any of them can be duplicated and the
  copy edited. Nothing existing is replaced.
- **Designing the look reuses the player's own designer.** An enemy ship is one
  of our existing hulls plus a paint scheme, chosen with the same controls
  players use in the Ship Market. No new modelling.
- The simulation gains **one** change: an enemy carries a type id and reads its
  stats from the table instead of from the hard-coded tier array. The built-in
  types produce byte-identical numbers to today, which is testable.

*Risk:* this touches `rebelsCombat.ts`, the file both the room and every cockpit
run. The wire golden test must stay byte-identical for the built-in types.

### Phase 4 — Rounds, and the game controller

The module Geoff asked for.

- A `Round` record: length in seconds, and a list of entries — enemy type, how
  many, and how they arrive (all at once, evenly across the round, or in
  clumps).
- A **game controller** in the room that walks the rounds on the clock: start
  the game, run round 1 for its seconds, round 2, and so on, then finish.
- `startWave` becomes one producer feeding the controller rather than the thing
  that drives the fight. The built-in Wave Defence is *generated* as a round
  list, so there is only one code path and the old one cannot rot.
- Round and game boundaries become events on the wire, so the cockpit can
  announce "ROUND 3" and "GAME OVER" properly. **The wave number going blank
  after a death was a real bug** — the sequence needs to be something the
  cockpit is told about, not something it infers.

*Open question, flagged rather than guessed:* rounds end on the clock, always,
which is clean for survival rounds but odd for a boss — kill the boss with
ninety seconds left and you fly around an empty sky. Suggestion, for Geoff to
accept or refuse: the **last** round of a game may end early when its boss dies,
because that is the win condition rather than a timer. Everything else runs its
clock.

### Phase 5 — The player-facing panel

- A grid of cards: the 3:2 image, the name, the place, the difficulty, whether
  it is solo or multiplayer, and how many people are in it right now.
- Picking one joins that place's room and starts that game.
- Uses the game's own CSS conventions, like every other panel.
- The 3:2 image is uploaded in the admin panel and shrunk on the way in, with
  the machinery already written for ship skins (`shipSkin.ts`): redrawn to a
  fixed size, re-encoded as WebP, and capped, so a game card can never be a
  two-megabyte photograph.

### Phase 6 — Rewards

Geoff: *"Enemies drop cryptos in various amounts which are defined by every
enemy type. They may also drop items or perhaps NFTs. Waves or Games may also
drop items or have an award for beating them."*

- Per enemy type: what it is worth in DIVI, and its item drop chart —
  **folded into the existing `dropCharts.ts`**, which already does "which
  enemies drop which items, with what weight and what chance". Its admin panel
  and this one become two views of one thing.
- Per round: an award for surviving it.
- Per game: an award for finishing it.

**This is the phase to be careful in.** An admin-defined enemy worth a lot,
multiplied by a round containing a thousand of them, is a money printer. The
guards, all enforced on the server and none in the panel:

1. A ceiling on what one enemy can be worth.
2. A ceiling on what one round and one whole game can pay.
3. The ledger stays the single place that banks anything — it already is.
4. The validator refuses a game whose theoretical maximum payout exceeds the
   ceiling, and says so in the panel *before* it is saved.

### Phase 7 — Other coins and NFTs

Geoff: *"perhaps other coins that should be part of the design."*

Deliberately last. The ledger banks DIVI today; other assets mean new columns,
new payout paths and new custody questions, and none of the phases above need
them. Worth designing on paper during phase 6 so nothing blocks it.

---

## 4. What I would NOT build

- **A general rules engine.** Places, rounds, enemies and rewards are four
  specific things with four specific shapes. A scripting language for game
  types would be more powerful and much worse.
- **A second drops system.** Extend `dropCharts.ts`.
- **A model editor.** Enemy ships are our hulls plus paint.
- **Role hierarchies.** Two roles.

---

## 5. Things that will bite, listed now

1. **The room re-reads config on a timer** (600 s for drops). A game type edited
   in the panel will not appear until then. The panel needs a "publish now"
   that pokes the room, or the wait needs to be short for game types.
2. **A game type in use when it is edited.** Rounds should be read once when a
   game starts and held, so a save mid-game cannot change the fight under the
   players in it.
3. **Places with no ground.** See phase 2.
4. **Deleting a game type somebody is playing.** Retire rather than delete.
5. **The built-in game must stay byte-identical** through phases 3 and 4, or
   every wire test and every player's expectations move at once.

---

## 6. Status

- 2026-Sep-26 — written. Phases 0–7 not started. Regions (the foundation for
  places) shipped the same day; see `DIVI-REBELS-SPIKEWORLD-COMBAT-PLAN.md`.
