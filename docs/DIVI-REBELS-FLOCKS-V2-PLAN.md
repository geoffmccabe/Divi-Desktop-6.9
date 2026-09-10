# Divi Rebels: living flocks, flock kills and gems (plan)

Written 2026-Sep-09 from Geoff's brief. Nothing here is built yet.

## What exists today (measured, not assumed)

- Flocks exist only in the SOLO simulation and only from the cheat key.
  Nothing spawns them naturally. `ui/src/wallet/rebels/rebelsFlock.ts`,
  `spawnFleet` in `rebelsCombat.ts`.
- Six tiers (grey, gold, green, blue, purple, red), fleets of 24, cap of 144
  drones alive at once. Health 50 + 25 per tier, speed +15% per tier.
- Drones are drawn as two instanced spheres (core + glow), one draw call each,
  with per-instance colour. No animation beyond a pulse.
- The multiplayer room runs the same simulation (`stepCombat`) so it CAN step
  flocks, but it never spawns one, and its wire format has no "this is a
  drone" flag, so a client would draw them as fighters.
- The 14 planets are fixed decoration at 1,000 to 3,600 units out
  (`planetLayout` in `spaceEnvironment.ts`), with positions the simulation can
  read.
- Kills are credited per seat by the room; the ledger holds per-account
  kills, score, DIVI. Items today are per ship (`itemCatalog.ts`,
  `dd69.rebels.owned`).
- DIVI coins: radius 0.33, orbit the planet at 82% of a speed cap, drawn as
  one instanced mesh; the room streams them in the `C` array of the state
  message.

## The brief, made precise

| Tier | Colour | Fleet | Members for a "kill" (over half) | Spawn odds | Extra shapes |
|---|---|---|---|---|---|
| 1 | yellow | 24 | 13 | 70% | 6 |
| 2 | green | 28 | 15 | 21% | 8 |
| 3 | blue | 32 | 17 | 6.3% | 10 |
| 4 | purple | 36 | 19 | 1.89% | 12 |
| 5 | red | 40 | 21 | 0.567% | 14 |
| 6 | white | 44 | 23 | 0.17% | 16 |
| 7 | fuchsia | 48 | 25 | 0.051% | 18 |

- Odds are the 0.3 ratio Geoff gave, carried to seven tiers; they sum to
  99.98%, the remainder rounds into tier one. Data in one table.
- Geoff gave six shape counts for seven tiers (6, 8, 10, 12, 14, 16); tier
  seven continues the step to 18. Confirm.
- Spawn check: every 5 seconds of play, 1% chance. That is one flock every
  8 minutes on average, with long gaps and occasional pairs, as random gives.
- Split sizes must divide the new fleet sizes into groups of 4 to 12:
  24 = 2×12, 3×8, 4×6, 6×4; 28 = 2×14 (too big), 4×7, 7×4; 32 = 4×8, 8×4;
  36 = 3×12, 4×9, 6×6, 9×4; 40 = 4×10, 5×8, 8×5, 10×4; 44 = 4×11, 11×4;
  48 = 4×12, 6×8, 8×6, 12×4. Computed from the size, not hand-listed.

## Phases

### Phase 1: seven tiers, natural spawns, hunting (simulation, shared by solo and room)

- Retire grey and gold; the seven colours above. Health and speed keep the
  present ramps (50 + 25/tier, +15%/tier). Cap stays 144 = three full fleets
  of 48; a fourth is refused until one is gone.
- `spawnClock` in the combat state: every 5s roll; on success roll the tier
  from the odds table; spawn at the NEAREST PLANET to the nearest living
  player. From there the flock flies toward that player.
  - The planets are 1,000+ units out and a flock cruises at roughly 20
    units/s, so a literal flight from the planet is nearly a minute of nothing
    visible. Proposal: spawn AT the planet, travel at a transit speed (about
    5x) until within 200 units of the target, then drop to fighting speed.
    From the cockpit that reads as "something is coming from that planet"
    without a minute's wait. **Decision needed.**
- Hunting: target = nearest living player within a leash (600 units). When
  it dies or leaves, retarget to the next nearest. If none is alive or in
  reach for 60s, the flock heads back to its planet and despawns on arrival,
  so a dead room does not fill with idle drones.
- Solo uses the same code with one player. Tests: odds table, fleet sizes,
  split divisors, spawn timing over a simulated hour, retargeting when the
  target dies, despawn when nobody is left.

### Phase 2: bringing them alive (drawing only)

- Each drone keeps its sphere and gains, by tier, N radiating shapes: a mix
  of cones (spikes), thin cylinders (rods), capsules and line segments, in
  the tier's colour a shade off the core so they read as parts, not glow.
- Built as ONE merged geometry per tier (the N shapes arranged on a Fibonacci
  sphere round the core), drawn as ONE `InstancedMesh` per tier with the
  drones as instances: seven draw calls for all 144 drones, whatever N is.
  Growing in and out is done in the vertex shader from a per-instance phase
  attribute (each shape scales along its own axis by a sine of time plus
  phase, with different rates per shape so they breathe out of step), so
  animation costs nothing on the CPU.
- Orbiting motes: 2 to 8 tiny spheres per drone by tier, one more
  `InstancedMesh` for all of them (up to 1,152 instances), positioned in the
  vertex shader from a per-instance orbit radius, tilt and phase. They spin
  round the drone; the CPU only updates the drone centres it already has.
- Same additive-blending rule as now (instance colour doubles as
  transparency), same flash on split, same three lumps of junk on death.
- Frame cost checked with the new readout: target under 0.5ms added at 144.

### Phase 3: the room owns them (multiplayer authority)

- The room spawns flocks (server-side random, never the client) with the
  Phase 1 rules; the wire gains a drone flag and pulse phase in the `E`
  array (one field, not a new message).
- Per-seat member tally: the room keeps `killedBy[seat]` on each fleet.
  When the fleet's last member dies, the seat with over half the members
  gets the flock kill (only one can). The room reports
  `{kind:"flockDown", tier, who}` and credits the ledger:
  `flockKills[tier]` on the account. Member kills are held internally
  (`flockMembers` on the account, for the stat) and never shown as kills.
- What a member kill is WORTH is not in the brief. Options: an ordinary
  kill (a tenth of a DIVI and a point of score, as fighters are), or nothing
  but the tally. **Decision needed.** Cheat-key drones stay worth nothing.
- Solo: the same tally runs locally so the solo player sees flock kills, but
  they do NOT reach the ledger, since the client would be reporting them.
  The HUD gets a FLOCKS count next to KILLS.

### Phase 4: gems

- When the last member dies, a gem of that tier appears where it died: a
  sphere the size of a DIVI coin (radius 0.33), the tier's colour, faceted
  so it is not mistaken for a coin.
- It drifts into orbit round Earth or the nearest planet, whichever is
  closer, at coin speed, so it moves and takes finding. Orbit is a few
  numbers (centre, plane, radius, phase, born-at), so its position at any
  moment is arithmetic on the clock, which is what lets it persist.
- **Persistence is server-side.** The room's Durable Object storage holds
  every gem ever dropped and not yet collected (`g:<id>`). On room start
  they are loaded; the state message streams them in a new `G` array. That
  is what "forever, even if the game restarts" means in a shared world:
  the gem is there for whoever finds it, on any machine. Solo gems would
  live only in that machine's storage and could not be traded, so gems are
  a room-only feature. **Decision needed** (recommended: room only).
- Pickup: fly through it, as coins are picked up. The room removes it, tells
  everyone, and credits the ledger account: `gems[tier] += 1`. Gems belong
  to the ACCOUNT, not to a ship: the ledger is where they will be traded or
  built with later, so it is the store now. The client keeps a mirror for
  display.
- Items tab gains a GEMS row per tier: count, colour, "not for sale". No
  building or trading in this plan.
- Cap: gems in the world are never expired or capped by count; at 0.33 units
  a thousand of them cost nothing to stream (each is a tier byte and an id;
  the orbit is recomputed from the clock).

## Anti-cheat, stated

- Flock spawns, member tallies, flock kills, gem drops, gem pickups: all
  decided by the room. The client sends position and fire, as now.
- A solo client can see flocks and gems but nothing it does reaches the
  ledger or a tradeable gem.
- The 144 cap and the 5-second roll live in the simulation, so a client
  cannot ask for more flocks.

## Order and size

Phase 1 and 2 first (they show in solo at once and answer whether the
flocks look alive and hunt well), then 3, then 4. Roughly: Phase 1 is a
day of simulation work and tests; Phase 2 is the shader work, the part
most likely to need a second pass on looks; Phase 3 touches the room, wire,
tests and a redeploy; Phase 4 touches the room, ledger, wire, drawing,
Items tab and a redeploy.

## Open decisions

1. Travel from the planet: literal (about a minute) or transit speed until
   200 units out?
2. Is a flock member kill an ordinary kill (DIVI and score) or tally only?
3. Gems and flock kills: room only (recommended), or also solo with local,
   untradeable gems?
4. Tier seven shape count: 18?
5. Pickup by flying through (assumed), not by shooting.

## Decisions (2026-Sep-10, Geoff)

1. Transit: flocks cross from their planet at five times fighting speed and
   fight at normal speed inside 220 units. "Okay if it takes a while."
2. A flock member kill is worth a fifth of a fighter: a fifth of a kill, one
   coin instead of five. Damage on a member scores points as on a fighter.
3. Gems are player property to be sold later, so the record of ownership is
   the room's. Flying alone still meets flocks and earns points and DIVI, but
   a gem only exists when the room is connected to record it.
4. Tier seven has 18 shapes.
5. Pickup by flying through or near. Gems AND coins are magnetic within
   twenty of their own diameters. A round that hits a gem or coin knocks it
   away with momentum and spin.
6. Health and speed ramps stay as they were.

## Built so far

Phase 1 (2026-Sep-10): seven tiers and colours, fleet sizes by tier, spawn
odds, the five-second one-percent roll, spawning off the nearest planet with
transit, hunting and going home, the fifth-of-a-kill worth, coin magnet at
twenty diameters, coin recoil and spin when shot. The room streams a drone
flag so a room client draws drones as drones.

Not yet: the living visuals (phase 2), per-player member tallies and the
flock kill (phase 3), gems (phase 4).
