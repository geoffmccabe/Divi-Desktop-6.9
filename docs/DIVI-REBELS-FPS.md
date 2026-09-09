# Divi Rebels: frame rate

Target: 90 to 120 frames a second, holding through late waves and a full room.
Written 2026-Sep-09 against 69.9.6. Every number below was measured; where a
figure is a judgement it says so.

## Where the time goes

Two budgets, and they are different problems: the CPU work per frame (the
simulation, allocation, JavaScript) and the GPU work per frame (draw calls,
triangles, fill). At 120fps a frame is 8.3ms, and the two must fit in it
together.

### CPU: the simulation

Measured headless, the whole combat step at a real population:

| Situation                         | Before   | After 69.9.6 | % of a 120fps frame |
|-----------------------------------|----------|--------------|---------------------|
| Late wave, 30 fighters, 100 rounds| 0.19ms   | 0.27ms       | 3%                  |
| 40 fighters, 140 rounds           | 0.48ms   | 0.23ms       | 3%                  |
| 72 drones (3 fleets)              | 1.58ms   | 0.61ms       | 7%                  |
| 144 drones (the cap)              | 6.08ms   | 0.85 to 1.4ms| 10 to 17%           |
| 40 fighters + 72 drones + 140     | 1.11ms   | 0.58ms       | 7%                  |

The 6ms case was not what it looked like. It scaled like an all-pairs loop and
the drones DO have two of those, but the cost was allocation: every bullet was
tested against every enemy, and the test allocated three vectors per call. The
drones fire, their rounds live four seconds, and at a full sky that was tens of
thousands of short-lived objects a frame with the garbage collector pausing to
sweep them. Reusing three scratch vectors took the worst case from 6ms to about
1ms. The controller's per-frame filter() calls and a doubled room.others() went
the same way.

**Conclusion: the simulation is not the problem.** Even the cap is a sixth of a
120fps frame, and the cap is six fleets, which the cheat key can summon and the
waves cannot.

### GPU: draw calls, and this is the problem

A draw call is one instruction to the graphics card. The commonly quoted
budget is about 500 a frame for 60fps on ordinary hardware; 120fps halves the
time and so roughly halves what is comfortable.

Counted from the code:

| What                              | Draw calls each | How many    | Total       |
|-----------------------------------|-----------------|-------------|-------------|
| Node tower (cone + sphere)        | 2               | 99 nodes    | ~198        |
| Helix connection (two strands)    | 2               | up to 144   | up to 288   |
| Fighter (7 meshes + 3 line sets)  | 10              | 30 late     | 300         |
| Fighter shield (only while hit)   | 3               | a few       | ~10         |
| Peer ship (full hull)             | 5 to 15         | per player  | 20 x 10 = 200|
| Game effects (all instanced)      | ~50 total       |             | ~50         |
| Globe, atmosphere, borders, detail| ~6              |             | ~6          |

**A late wave in a full room is 800 to 1,000 draw calls.** The map alone, with
nobody playing, is nearly 500. That is where the frame goes, and it is why the
game gets worse as the waves go on: every fighter is ten more.

Two things I checked and ruled out:

* **Pixel ratio.** Nothing in the globe stack sets it, so three.js's default of
  1 applies: on a Retina display the game already renders at half the physical
  resolution and is upscaled. Fill rate is therefore already at the cheap end
  and capping it would gain nothing. (Raising it for sharpness would COST
  frames. Leave it.)
* **Idle shields.** A fighter's shield rig hides itself when not flashing, so
  it only costs anything for the second or two after a hit.

## What to do, in order of return for effort

### 1. Instance the fighters. Confidence: high.

Every fighter is a clone of a ten-object group: seven meshes and three edge
sets. That is ten draw calls per fighter and it is the reason a late wave costs
what it does. The drones were built the right way from the start (two
instanced meshes for the whole swarm however many there are) and it shows in
the numbers: 144 drones cost fewer draw calls than two fighters.

The fix is the same shape: one instanced mesh per PART, with a matrix and a
tint per fighter. Ten draw calls for the whole wave instead of ten per ship.
Thirty fighters go from 300 draw calls to 10. Medium effort, a day, because
the tier colours and the tumble-on-hit have to become per-instance data.
Expected gain: the single largest, and it grows with the wave.

### 2. Merge the helix tubes. Confidence: high.

Up to 288 separate tube meshes, each 96 to 800 segments. They never move; only
the characters flowing along them do, and those are already one GPU points
system. Merging all the tubes of one colour into one geometry makes them two
draw calls instead of nearly three hundred. Medium effort, mostly in
GlobeMap.tsx, and it is the WALLET's map so it helps the node view too.
Expected gain: about 280 draw calls, present whether or not anyone is playing.

### 3. Instance the towers. Confidence: high.

Ninety-nine cones and ninety-nine spheres are 198 draw calls for two shapes.
Two instanced meshes with per-instance colour is 2. The window shader on them
(towerLights.ts) already works per-object and would need to read its colour
from an instance attribute instead. Medium effort. Expected gain: ~196 draw
calls, and again it helps the map itself.

### 4. Level of detail for peers. Confidence: medium.

A remote player's hull is the full model, thousands of triangles and several
materials, at any distance. Twenty players at 200 units is twenty full hulls
drawn as specks. Past a few hundred units they can be the same instanced
sphere the drones use, tinted with their paint's hull colour, and swap to the
real hull when they come close. Effort: a day. Expected gain: depends entirely
on how many people are in a room; at two players it is nothing, at twenty it
is the difference between a room that runs and one that does not.

### 5. A frame-time readout. Confidence that it is worth having: certain.

None of the above can be tuned blind. The black box already writes to local
storage every two seconds; adding the average and worst frame time over that
window, and the draw call count from renderer.info, costs nothing and turns
every future "it feels slow" into a number. Effort: an hour. Do this first.

### Things I would NOT do

* **A spatial grid for the swarm.** The research and the measurement agree:
  below about 150 agents the naive loop wins, and the drone cap is 144.
* **Lowering the pixel ratio.** It is already 1.
* **Reducing the fighter model.** It is 244 triangles. Triangles are not the
  cost; the ten separate objects are.
* **Web Workers for the simulation.** It is 3% of a frame. There is nothing to
  move.

## Honest limits

I cannot see the frame rate. Every draw-call figure above is counted from the
code and every simulation figure is measured headless in node; neither is a
measurement of the game running on a GPU. The order of the recommendations is
what the counts say, and I would want number 5 in place before spending a day
on number 1, so that the day is measured rather than believed.
