# Divi Rebels: the voxel planet

Written 2026-Sep-15 for the gameplay session. A plan, not built yet.

Geoff's brief: "a hollow sphere made out of cubes on a grid, as if it's made of
voxels in Minecraft... around 1000 x 1000 x 1000 and for the actual sphere it
would have only 1/4 of its cubes as solid and the other 75% would be missing.
This would allow users to find paths through the cube into its center. The
center 50% would be empty (for now) except for a second smaller sphere of
50x50x50 floating in the center as the planet's heart. The heart would be
joined to the planet's insides by radiating lines, like 24 or so spokes...
The placement of the voxels in the planet wouldn't be random but would be
procedurally generated, so that we don't need to store a massive database of
millions of cube locations. The outer skin of the planet would also have a
random assortment of rods and spikes radiating out from it, a few thousand of
them from 1 to 10 cubes wide and up to 100 cubes long."

And: "each cube should be around 3x the width of the average heavy fighter
spaceship, to make it possible to navigate through the maze of holes to get to
the center."

---

## 1. The short answer

**Yes, this can be built, and it can be made cheap. But not the obvious way.**

The obvious way is impossible, and it is worth being exact about why, because
the number decides the whole design.

A shell from radius 250 to radius 500 on a 1000-cube grid holds about 458
million cells. A quarter of them solid is **114 million cubes**. If the solid
quarter is scattered at random, almost every cube has open air on most sides:
measured below at **4.54 exposed faces per cube**, which is **over a billion
triangles**. For scale, the last DFlow capture of the live game showed trouble
beginning at about 200,000 triangles a frame on Geoff's Mac.

Three facts, all measured rather than guessed, make it work anyway:

1. **Clustering is worth twelve times.** The same 25% fill, arranged as blobs
   by a noise field instead of scattered, drops to **0.87 exposed faces per
   cube**, and because the faces are then flat and adjacent they merge:
   **6,110 triangles per 32-cube chunk** against 74,326 scattered. This is the
   single most important decision in the plan, and it is also what makes it
   look like Minecraft terrain rather than television static.
2. **Nothing is stored, so nothing has to be loaded.** The planet is a
   function of the cube's coordinates. Collision is a handful of calls to that
   function, on the client and on the server, which agree because it is the
   same function. No database, no streaming, no save file. A seed is the whole
   planet.
3. **The spikes are not voxels.** A rod one cube wide and a hundred long IS a
   box. Drawn as a few thousand stretched box instances with a grid texture, a
   few thousand spikes cost about **36,000 triangles in one draw call**. The
   same trick draws the 24 spokes for 288 triangles.

The one genuinely hard case is **the whole planet seen from far away**, which
section 6 deals with and section 8 measures before anything else is built.

---

## 2. What was measured

Script: `/private/tmp/.../scratchpad/voxel.mjs`, re-created as a permanent test
in Phase 0. One 32×32×32 chunk taken from the middle of the shell, generated
with a two-octave value-noise field, thresholded to a 25% fill, then greedily
meshed the way a Minecraft-style renderer does.

| Arrangement | Fill | Exposed faces per cube | Triangles for one 32³ chunk |
|---|---|---|---|
| Scattered (a plain hash per cube) | 25% | 4.54 | 74,326 |
| Blobs about 6 cubes across | 28% | 1.09 | 10,536 |
| **Blobs about 10 cubes across** | **24%** | **0.87** | **6,110** |
| Blobs about 16 cubes across | 15% | 0.40 | 1,740 |
| Blobs about 24 cubes across | 27% | 0.33 | 2,244 |

Two things to read off this.

- Blobs of ten cubes are the sweet spot for the brief: still a fine-grained
  maze, twelve times cheaper than scattered.
- The fill drifts with the blob size (the 16-cube row came out at 15%, not
  25%). The noise field is not evenly distributed across a spherical shell, so
  the threshold has to be corrected by radius. That is Phase 1's job and it is
  the sort of thing that would otherwise be noticed late, as a planet with a
  suspiciously thin crust.

Coarser sampling, for the distance levels (one cube standing for several):

| Sampling | Ground covered | Triangles per chunk |
|---|---|---|
| every cube | 32 cubes across | 1,740 |
| every 2nd | 64 cubes | 8,536 |
| every 4th | 128 cubes | 16,646 |
| every 8th | 256 cubes | 10,942 |

These are one sample position each and so are rough; Phase 0 averages them over
the shell. The shape is what matters: a coarse chunk covers eight times the
ground for about the same cost, which is what pays for the distant view.

---

## 3. Scale: the number everything else follows from

A heavy fighter is about **3 world units** wide (`SHIP_LENGTH` is 2.6 in
`/Users/geoffreymccabe/dd69-rebels/ui/src/wallet/rebels/rebelsController.ts`,
and a fighter's wingspan is close to its length). Three times that makes

> **one cube = 9 world units.**

Everything else follows, and it is worth seeing the consequences written down
before a line is written:

| Thing | In cubes | In world units | Compared to |
|---|---|---|---|
| The planet | 1,000 across | **9,000** | Earth in this game is 200 across |
| The shell | radius 250 to 500 | 2,250 thick | |
| The hollow centre | radius 250 | 4,500 across | |
| The heart | 50 across | 450 | over twice Earth's diameter |
| A spoke | 225 long | 2,025 | |
| A spike | 1 to 10 wide, to 100 long | 9 to 90 wide, to 900 long | |
| One cube | 1 | 9 | a heavy fighter is 3 wide |

**This planet is forty-five times Earth's diameter.** Crossing the shell takes
about four and a half minutes at cruise (8 units a second), two minutes on
boost, and forty seconds on super boost. Crossing the whole thing takes twenty
minutes at cruise.

That may be exactly right: a landmark you travel to and spend a session inside.
But it is a consequence of "1000 cubes at 3 ship widths" rather than something
that was chosen, so **Geoff should confirm it before Phase 1**. Everything
scales from the one number, so the alternatives are cheap:

- **1000³ at 9 units** (as briefed): 9,000 units. An expedition.
- **1000³ at 6 units** (2 ship widths): 6,000 units. Still a wide corridor for
  a fighter; a third off every journey.
- **400³ at 9 units**: 3,600 units, eighteen Earths, ninety seconds across the
  shell on boost. Same cube size, same feel flying, a quarter of the travel.

The recommendation is **400³ at 9 units for the first one**, with the grid size
as a single number so a 1000³ version is a different seed and a different
planet rather than a rewrite. The reason is not performance: the rendering cost
is the same either way, because it is set by what is on screen. It is that a
twenty-minute crossing is a long way to fly to find out whether the maze is fun.

---

## 4. How the planet is generated

One pure function, shared by the cockpit and the room, in the same way
`rebelsCombat.ts` is shared today. Nothing is stored but a seed.

```
solid(x, y, z, seed) -> true or false
```

In layers, cheapest test first, so most calls stop early:

1. **The shell.** Outside radius 500 or inside radius 250: empty. This alone
   rejects most of the grid.
2. **The crust profile.** A radial curve makes the outside denser than the
   inside, so the planet has a skin and the cavity has a ragged ceiling rather
   than the whole shell being uniform mush. This is also where the threshold is
   corrected so the fill really is a quarter at every depth (see section 2).
3. **The blobs.** Two octaves of value noise on a lattice, the coarse one about
   ten cubes across and a finer one for roughness. Solid where the field is
   under the corrected threshold. Value noise on an integer lattice is a
   handful of hashes and some multiplies: no tables, no allocation, identical
   on both sides of the wire.
4. **Guaranteed ways in.** A few dozen worm tunnels are carved from the outer
   surface to the cavity, each a deterministic curve from the seed, forced
   empty along a radius of one or two cubes.

   A quarter fill almost certainly leaves the empty space fully connected
   anyway: site percolation on a cubic lattice turns solid at about 31% fill,
   so at 25% the solid phase does not connect and the void does. But "almost
   certainly" is not a promise, and a player who cannot find a way in has no
   game, so the ways in are carved on purpose and the test asserts a path
   exists from outside to the cavity.
5. **The spokes.** 24 directions spread evenly over the sphere, each a line of
   cubes from the heart out to the inner face of the shell. Forced solid.
6. **The heart.** A 50-cube ball at the centre, generated by the same field at
   a higher fill so it reads as solid with detail rather than a smooth ball.

Spikes are NOT part of `solid()` — see section 5.

**Cost of a call:** a length, two or three comparisons, and for the cells that
get that far, eight hashes per octave. The order matters: a collision test near
the surface is a few hundred nanoseconds, and the server does a handful per
player per tick.

---

## 5. The spikes, and why they are not voxels

A few thousand rods, 1 to 10 cubes wide and up to 100 long, sticking out of the
skin. Generated as a list from the seed, not as cells:

- direction (spread over the sphere, jittered)
- where it leaves the surface
- width, length, and a slight lean

Each rod is drawn as **one stretched box instance**. A rod one cube wide and a
hundred long is a box exactly, so nothing is lost, and a repeating grid texture
draws the cube edges along it so it still reads as stacked cubes. A few thousand
rods cost about **36,000 triangles in a single draw call**, which is a twentieth
of one 32³ chunk of scattered voxels.

The 24 spokes are drawn the same way: 24 instances, 288 triangles.

Collision against a rod is a point-in-box test in the rod's own frame, and only
rods near the ship need testing, which a coarse direction lookup gives. This is
cheaper than voxel collision, not more expensive.

---

## 6. How it is drawn without spending the frame

Five mechanisms, in order of how much they save.

**1. Chunks, built on a worker.** The shell is divided into 32-cube chunks. A
chunk is generated and greedily meshed off the main thread (the repo already
has a worker test suite, `scripts/run-rebels-web-worker-tests.sh`), then handed
over as a finished buffer. Nothing is generated for a chunk nobody can see.

**2. Greedy meshing.** Exposed faces only, merged into the largest rectangles
that fit. Measured at 6,110 triangles per chunk on 10-cube blobs, against
74,326 if the fill were scattered.

**3. Rings of detail.** Full detail only in the nearest ring; beyond that one
cube stands for 2, then 4, then 8, then 16. A coarse chunk covers eight times
the ground for roughly the same triangles. This is what makes the distant view
affordable and it is the standard answer; there is nothing clever in it.

**4. A hard budget, enforced.** The planet gets a triangle and draw-call
allowance, and the ring radii are computed from it rather than typed in. If a
view would exceed it the rings tighten, so the worst case is a slightly coarser
planet and never a dropped frame. DFlow gets its own stages (`vox.gen`,
`vox.mesh`, `vox.draw`) so a regression is visible the way the tower one was.

**5. Occlusion, which is free inside.** Inside the shell the view is blocked
after twenty or thirty cubes. A chunk whose every face is walled in is not
drawn, and the view distance inside is short by design: this is the case the
brief cares most about (finding a path to the centre) and it is the cheapest
case in the whole plan.

### The case that needs watching

The whole planet from far away. At full detail the visible half of the shell is
fifteen hundred chunks, which is nine million triangles: not possible. At the
coarsest ring it is a few dozen chunks and a few hundred thousand triangles,
which is close to affordable but not obviously inside budget. Three answers, in
the order they will be tried:

1. Coarser still: one cube standing for 16 or 32 at the outermost ring.
2. A shell-only pass at distance: the outer surface alone, with no interior
   faces generated, since none of them can be seen from out there.
3. An impostor: past some distance, one sphere with a shader that fakes the
   pitted, spiked silhouette. Cheapest, and the least honest; only if the first
   two miss.

**This is measured in Phase 0, before anything is built**, because if the
distant view cannot be made to fit then the planet needs to be smaller or
farther from anywhere the player normally flies, and that is much better known
first.

---

## 7. Where it fits in the game

**It has to be its own shard.** At 9,000 units across it is two and a half
times the whole current world, which reaches about 3,600 units to the outer
planets. It cannot sit in Earth orbit. The network plan already calls for
sharding by planet
(`/Users/geoffreymccabe/dd69-rebels/docs/DIVI-REBELS-NETWORK-PLAN.md`, phase
5): approaching a planet moves the player into that planet's own room, with its
own world. The voxel planet is the best possible reason to build that, and the
first thing that genuinely needs it.

Until sharding exists, the honest options are a smaller first version (section
3) placed far out, or building it behind a door that only opens once sharding
lands. Either is fine; pretending it can share Earth orbit is not.

**The server needs the same function.** Movement is client-authoritative with a
budget check and a snap-back, so the room has to be able to say whether a ship
is inside a cube. That is `solid()` again, on the server, which is why it lives
in the shared module set rather than in the cockpit. `contrib/rebels-room/` is
owned by the other game session during the refactor, so that part is agreed
with them rather than done unilaterally.

**Timing.** The build agent's package move (task B2) touches every game file. A
new module of this size started before that freeze would be a painful merge for
everyone. The plan is written now and built after the freeze.

---

## 8. The phases

### Phase 0. Measure, before building (half a day)
- Turn the scratchpad script into a permanent test that generates real chunks
  across the shell (surface, mid-shell, cavity ceiling, near a spoke) and
  reports cubes, faces, merged quads and triangles at every detail level.
- Answer the one open question: what the whole planet costs from outside, at
  each of the three answers in section 6.
- Report the numbers and the recommended grid size and cube size.
- **Stop here for Geoff.** If the distant view cannot be made to fit a budget,
  say so and what would have to change.

### Phase 1. The field
- `solid(x, y, z, seed)` with the shell, the crust profile, the radius-corrected
  threshold, the blobs, the carved ways in, the spokes and the heart.
- Tests: the fill really is a quarter at every depth; the cavity is empty; the
  heart is where it should be; a path exists from outside to the cavity
  (searched, not assumed); the same seed gives the same planet on both sides.
- Nothing drawn yet. This phase is a pure function and a test.

### Phase 2. One chunk on screen
- Worker generation, greedy meshing, one material, DFlow stages.
- Fly to a fixed point and look at a hundred chunks. Read the frame.

### Phase 3. Rings and the budget
- The detail rings, computed from the allowance; chunk occlusion; the coarse
  distant pass.
- Done when the planet holds its budget from outside, from just above the
  surface, and from inside a tunnel, all measured through DFlow.

### Phase 4. Spikes, spokes and the heart
- The rod list from the seed; instanced stretched boxes with the grid texture;
  the heart meshed once.

### Phase 5. Collision
- Against the field for cubes, against boxes for rods, on the cockpit and in
  the room, agreed with the session that owns the room.
- Tests: a ship cannot pass through a solid cube; a tunnel one cube wide is
  flyable by a heavy fighter (this is what the cube size was chosen for, so it
  is asserted rather than hoped for).

### Phase 6. Making it a place
- Where it sits, how it is approached, what is inside the cavity, and what the
  heart is for. Deliberately last: a maze is worth building only once it is
  known to be flyable, and worth decorating only once it is worth visiting.

---

## 9. What could still go wrong

- **The distant view.** The one unresolved number, and the reason for Phase 0.
- **Worker build cost.** A 32³ chunk is 32,768 field calls. Rough arithmetic
  puts a chunk at a few milliseconds on a worker, so a hundred chunks is a
  fraction of a second of background work; if it is worse than that, chunks get
  smaller and the rings tighter.
- **Sameness.** One noise field over nine thousand units risks looking the same
  everywhere. The crust profile helps; large-scale variation (denser continents,
  emptier oceans) may be needed, and costs one more octave.
- **The look.** A quarter fill in ten-cube blobs is a guess at what Geoff has
  in mind. It is one number and one frequency, so Phase 2 is the place to sit
  and turn the dials with him rather than to argue about it now.
