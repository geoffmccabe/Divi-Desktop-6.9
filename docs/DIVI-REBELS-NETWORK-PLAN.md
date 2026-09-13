# Divi Rebels: ready for real multiplayer

Written 2026-Sep-12, after measuring what the room actually sends. Nothing
here is built yet. The order is deliberate: each phase is worth doing on its
own, each one is measured, and none of them needs the one after it.

## Where we are

One WebSocket per player, opened in one place, one shared protocol file, one
handler each end, and the SAME simulation file running on both sides. That
last part is the foundation everything below leans on, and it is worth
saying plainly because it is what makes the cheap fixes possible: the client
already knows how a bullet flies, how a coin orbits and how wreckage
tumbles, because it runs the same code the server does.

What is wrong is not the shape of it. It is that the server sends every
player the entire world, every tick, as JSON, with nothing left out and
nothing compressed. Measured from the real wire shapes:

| scenario | bytes/tick | per player | server out |
|---|---|---|---|
| 1 player, quiet | 2,078 | 41 kB/s | 0.04 MB/s |
| 1 player, busy | 10,138 | 198 kB/s | 0.19 MB/s |
| 8 players, busy | 19,058 | 372 kB/s | 2.9 MB/s |
| 24 players, busy | 34,926 | 682 kB/s | 16 MB/s |
| 24 players, flocks | 51,359 | 1,003 kB/s | 23.5 MB/s |

Comfortable now. Uncomfortable at eight. Broken at a few dozen. And it is one
Durable Object, one thread, doing the fight and the serialising for everyone.

**The target**: 24 players in a busy fight, under 50 kB/s to each player and
under 2 MB/s out of a shard. That is a factor of fourteen, and phases 1 to 4
should get there with room to spare.

## Phase 1: stop sending what the client can work out

The largest arrays on the wire are the ones the client could compute
perfectly well on its own, because their motion has no decisions in it.

- **Bullets** are the biggest count and the most predictable thing in the
  game: constant velocity, known lifetime, no steering. Send the SHOT, not
  the bullet. One event per trigger pull carries the muzzle, the direction,
  the weapon and the tick it was fired on; every cockpit then flies that
  round with the same code the server uses. The server still decides every
  hit, exactly as now, and still says when a round was spent early.
- **Coins, gems and wreckage** orbit deterministically from where they were
  dropped. Send them once when they appear, and again only when something
  changes them (a hit that knocks a coin, a pickup, a restart). Not sixty
  numbers a tick, for ever, while they hang in space.
- **Torpedoes** are the same: a launch event, a detonation event.

Nothing about authority changes. The server owns every outcome; the wire
stops repeating what both ends already know.

Expected: the 24-player busy snapshot from about 35 kB to about 12 kB.

**BUILT 2026-Sep-12, v69.9.37, and measured on a real room** rather than
estimated. `scripts/run-rebels-wire-tests.sh` seats real players, spawns real
swarms, holds every trigger down and weighs the actual strings:

| room | rounds in the air | bytes/tick | per player |
|---|---|---|---|
| 1 player | 48 | 1,255 | 25 kB/s |
| 8 players | 240 | 4,254 | 85 kB/s |
| 24 players | 722 | 9,595 | 192 kB/s |
| 24 players, 3 wingmen each | ~900 | 15,574 | 311 kB/s |
| 24 players, everything at once | 2,900 | 15,523 | 310 kB/s |

The last row is the one that shows what changed: two thousand nine hundred
rounds in the sky, and not one of them on the wire. Sent as positions they
would have been about 130 kB a tick on their own. Server egress at 24
players went from 16 MB/s to 4.6 MB/s.

Those budgets are now a test that fails the build if a change puts them back.
Coins, gems and wreckage are still streamed: they are three to seven numbers
each rather than eight, and their motion follows the players, so they are
phase 2's business rather than phase 1's.
Risk: drift between a client's copy of a round and the server's. Bounded by
the fact that a round lives about two seconds, and by the server's existing
"spent" events. Test: fly the same seed on both sides for 600 ticks and
assert the positions never diverge by more than a tenth of a unit.

## Phase 2: send each player only what is near them

Everyone currently gets everything, including a fight on the far side of the
planet they cannot see.

- A view budget per kind, because they are not equally visible: other ships
  and enemies out to a long range, beams further (they are bright), rounds
  and coins and wreckage only nearby.
- A coarse grid over the world, entities bucketed once per tick, each seat
  reading the buckets its ranges touch. Not a distance test per seat per
  entity, which is the naive version and is quadratic.
- The serialising becomes per seat rather than one string for everybody,
  which costs CPU; the payload shrinking by an order of magnitude pays for
  it several times over. Measure both.

Expected: about 12 kB to about 4 kB at 24 players.
Watch for: things popping in at the edge of the range. Fix with a little
hysteresis, and by keeping ships in view further out than everything else.

**BUILT 2026-Sep-12, v69.9.38, and measured.**

The first attempt saved nothing at all, and the reason is worth writing
down. The ranges were picked from the size of the WORLD: ships at nine
hundred units, fighters at seven hundred. But the shell of sky around Earth
where everybody actually fights is only about seven hundred units across, so
every player could still see every other player and every fighter, and not
one row was dropped. Ranges have to come from the size of a FIGHT, not the
size of the map. A fighter shoots at seventy units, a swarm hunts from two
hundred and twenty, and a rival's name plate stops being drawn at four
hundred and twenty. The ranges are now four hundred and fifty for ships,
three hundred and forty for fighters, and two hundred and ten for coins,
gems and wreckage, which are specks at that distance anyway.

| room | after phase 1 | after phase 2 | saved |
|---|---|---|---|
| 1 player | 1,255 | 1,261 | nothing, and rightly |
| 8 players | 4,254 | 2,101 | 51% |
| 24 players | 9,595 | 3,450 | 64% |
| 24 with wingmen | 15,574 | 9,404 | 40% |
| 24, everything at once | 15,523 | 9,402 | 39% |

Against where this started, two dozen players went from about 35,000 bytes a
tick to 3,450: a tenth. Each player is now sent 69 kB/s instead of 682, and
a room of two dozen sends 1.7 MB/s instead of 16.

And a fight you cannot see costs nothing: one player at Earth and one out at
a planet three thousand units away are each sent about half the fighters and
a thousand bytes, and neither is told the other exists. That is the property
that makes a big world affordable, and it is what phase 7's shards are built
on top of.

One range had to be split rather than tightened, and the test caught it. A
flock's gem is left wherever its last member fell, which measured three
hundred and twenty units from where the player had been fighting: inside the
old range, outside the new one. Coins and gems are not the same kind of
thing. Coins scatter at your feet, there are hundreds, and you fly through
them seconds later; a gem is rare, it persists, and going to fetch it is the
point. Coins stay at two hundred and ten. Gems and dropped spheres see seven
hundred, which costs almost nothing because there are only ever a handful in
the sky.

Not done here, deliberately: hysteresis at the edge of a range. Something
crossing four hundred and fifty units will pop in and out if it hovers
exactly there. It needs the per-player memory that phase 3 introduces
anyway, so it belongs with the deltas rather than on its own.

## Phase 3: delta snapshots

Send what CHANGED since the last snapshot that player actually received.

- Every entity needs a stable id. Enemies have one. Wingmen have owner and
  slot. Gems have ids. Coins and wreckage need one, which is two bytes.
- The client acks the tick it last applied; the server keeps a short ring of
  recent snapshots per seat and diffs against the acked one. If the ack is
  too old, it sends a full one and says so.
- Removals travel as a list of ids, which is what makes this safe: a missed
  removal is a ghost, and ghosts are the classic delta bug.

Expected: about 4 kB to about 1.5 kB, because most of what is in view is not
moving in an interesting way from one tick to the next.

## Phase 4: binary

The arrays are already flat numbers in fixed positions, so this is an
encoder and a decoder either side of the same seam, not a redesign.

- Positions quantised to 16 bits over a known range (the world is 8 planet
  radii across; a centimetre of precision is not needed and a tenth of a
  unit is what we already round to). Directions as three signed bytes.
  Ids as 16 bits. Flags packed into one byte.
- A player row: about 14 bytes against about 60 as JSON.

Expected: another three to four times. That is the target reached, with the
snapshot around 400 to 600 bytes and each player under 20 kB/s.

## Phase 5: smooth everything, not just other players

Today only other ships are interpolated between ticks. Enemies, rounds,
wingmen and torpedoes are copied straight off the wire and step twenty times
a second while the screen draws sixty. Rendering only; no protocol change.
Phase 1 does most of this for free, since anything the client simulates is
already smooth.

## Phase 6: sequence numbers now, correction later

One field on every input, a counter. The server echoes the last one it
processed in the gauge message. Nothing uses it on day one.

It costs two bytes and it is the difference between being able to add proper
prediction and correction later, and having to change the wire to do it. The
ship is simulated locally today and the server only checks you did not move
impossibly far; when that stops being good enough, the ring of unacked
inputs and the replay on correction is a contained change IF the sequence is
already there.

## Phase 7: a shard per planet

Geoff, 2026-Sep-12: "We can shard each of the planets that are already
there... when approaching them, it can enter another shard, and it can have
its own world and a more detailed planet and other details."

The router already takes a room name and gives one Durable Object per name,
so the shards are `earth` and `p1` to `p14`. Fifteen objects, each asleep
until somebody is in it.

**What lives where.** The account is global and already is: the ledger holds
DIVI, items, kills and the leaderboard, and every shard talks to the one
ledger over the binding. A shard owns its own fight: its enemies, its
wreckage, the drops on its ground and the gems in its orbit. That is already
how gems persist, so it carries over unchanged.

**The handover, which is the only hard part.** A player's hull and ammo are
the server's numbers, so they cannot be carried across in the client's
pocket.

1. Approaching a planet, inside a radius, the cockpit asks its shard to hand
   it over.
2. The shard writes a sealed traveller record to the ledger: account, hull,
   ammo, torpedoes, guards, gear, wingmen and their damage, position and
   velocity, and a one-time nonce that expires in thirty seconds.
3. The cockpit is told the new room name and the nonce, and nothing else
   that matters.
4. It connects to the new shard and presents the nonce. That shard reads the
   record from the ledger, deletes it so it cannot be used twice, and seats
   the player in exactly the state they left in.
5. The old shard drops the seat when the record is claimed, or when the
   nonce expires, whichever comes first.

The client carries a token, never a number. A stolen or replayed nonce buys
nothing, because it is spent on first use and it only ever restores a state
the server itself wrote.

**Hysteresis, or players flap.** Enter a planet's shard at one radius, leave
it at a larger one, with a band between where nothing happens. Cover the
swap with the transit the game already has for launching: a second of dive
is more than the handover needs.

**What it does not fix.** Everyone starts at Earth, so Earth stays the
crowded one. Sharding buys room across space; phases 1 to 4 are what let any
one place hold more than a handful. Both, not either.

**What it buys besides capacity.** A planet shard can afford detail Earth
cannot, because it holds fewer people and its own budget: a real surface,
its own enemies, its own weather, its own rules. That is the interesting
half of the idea and it costs nothing extra once the handover exists.

## Phase 8: a bandwidth budget that fails the build

A test that builds representative snapshots at 1, 8 and 24 players and
asserts the byte counts are under budget. It is the only way a change that
quietly doubles the payload gets caught the day it lands rather than the day
somebody counts. It is cheap: the measurement script for the table above is
twenty lines.

## Order, and what each is worth

| phase | what | expected after |
|---|---|---|
| 1 | shots and drops as events, not streams | 35 kB → 12 kB |
| 2 | only what is near you | 12 kB → 4 kB |
| 3 | only what changed | 4 kB → 1.5 kB |
| 4 | binary | 1.5 kB → 0.5 kB |
| 5 | smooth everything | look, not size |
| 6 | sequence numbers | nothing today, everything later |
| 7 | a shard per planet | capacity across space, and detail |
| 8 | a budget test | it stays fixed |

Phases 1 and 2 are the ones that matter most and are independent of each
other. Phase 7 can be done at any point after 1, and is worth doing before
inviting a crowd, because it is far easier to add a second world before
anybody is standing in the first one.
