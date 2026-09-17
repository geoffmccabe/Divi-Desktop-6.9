# Spikeworld: colliders, the heart, and the orange flock

Geoff, 2026-Sep-17, in one message: fix the spin on leaving full screen; give
the cubes colliders with a billiard bounce and 1-40 damage; give the heart a
million points of health and a bar; and launch a big flock of orange spheroids
when a player reaches the cavity, which splits when a torpedo is fired at it.

## Done

**1. The spin on leaving full screen.** Without a pointer lock the aim is the
pointer's position INSIDE the canvas, as a fraction of it, and the offset from
the middle is how hard the ship turns. Change the canvas size and that fraction
changes without the mouse having moved: leaving full screen shrinks the canvas
out from under the pointer, which is then often outside it altogether, so no
further move event arrives and the stick stays jammed. Any change of canvas
size now hands back a neutral stick, which is what leaving the window already
did. `platform/desktopInput.ts`.

**2. Cube colliders, the bounce and the knock.** `voxel/voxelCollide.ts`, pure
like the rest of that folder, so the room can use the same collision when it
becomes the authority out here. A cube world has only six possible normals,
which makes the bounce exact rather than approximated:

- the face a ship hit is the one OPPOSING its motion on that axis, and of the
  three candidates the shallowest is the one it touched. Picking the shallowest
  of all six instead was the first attempt and is wrong in the commonest case:
  a ship in the middle of a cube overlaps all three axes equally and the tie
  chose the face it was flying toward, the way out.
- the velocity is reflected in that face and keeps 70%, which is a ball off a
  cushion, and with one cushion per axis it is the real formula.
- the ship is lifted back out of the cube, or the next frame finds it inside
  and bounces it again.
- the damage is the speed INTO the surface, squared: a graze is 1 point, flying
  flat out straight into a wall is 40, and a dozen scrapes come to 36 of a
  hundred. Speed and angle in one number, because the component along the
  normal is speed times the cosine of the angle.
- one knock every third of a second at most, because a ship sliding along a
  wall touches it every frame.

Twenty tests in `scripts/run-voxel-collide-tests.sh`.

## The prerequisite the rest of it needs

**Spikeworld has no fight in it.** The cockpit does not simulate the fight at
all: the room does, and the cockpit draws what comes over the wire. Out here the
ship deliberately stops reporting its position (the room's world is Earth's
neighbourhood and it would snap a ship back from 200,000 units out), so the room
has no idea where the player is. A shot fired at Spikeworld is simulated by the
room in Earth orbit, hits nothing, and never comes back.

So nothing can be shot out here until the fight runs LOCALLY while the ship is
at Spikeworld. That is one call, `stepCombat`, and a decision about who owns the
outcome; the simulation itself is the same file the room runs, which is the
whole point of how it was written. Until that is in place the heart cannot be
shot and the flock cannot be fought, so it comes first.

## Next, in order

**3. The fight, locally, while at Spikeworld.** Step the cockpit's own combat
when `atSpikeworld`, with the player as the only ship in the world. The room
keeps the seat parked (`away`) exactly as it does now. Multiplayer out here is
Phase 5 and unchanged by this: when it comes, the room steps the same file.

**4. The heart's health.** A million, counting down, with the bar that already
exists (`healthPulse.ts` / `RebelsHealthBar.tsx`, which DreadRoot's bar was
copied from). The heart becomes a target the guns can hit: one sphere, radius
25 cubes, at the planet's centre. Bullets, beams and torpedoes all reach it
through the same tests they use on a fighter.

**5. The orange flock.** A drone class that is not one of the seven tiers:
the heart's own orange, behaving as tier one but arriving in a big flock, when
a player crosses into the cavity. The flock system already has everything it
needs except this one thing:

**6. Splitting away from a torpedo.** The moment a torpedo is fired at a group
it splits in two and both halves fly apart until the torpedo goes off; a
sub-group that is itself torpedoed splits again. When the blast has passed they
rejoin or stay split on the ordinary roll. The flock file already has the split,
the merge, and the "flash expansion" burst that makes a split read as an event
(Reynolds, 1987) - what it lacks is a reason to split that is not the timer, and
a fear that points away from a specific thing rather than away from the player.
