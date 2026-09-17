// Spikeworld: is there a cube here?
//
// The whole planet is this one function. There is no database, no streaming and
// no save file: a hundred and fourteen million cubes are a seed and some
// arithmetic. Geoff: "The placement of the voxels in the planet wouldn't be
// random but would be procedurally generated, so that we don't need to store a
// massive database of millions of cube locations."
//
// That buys more than disk space. Because it is a pure function of the cube's
// coordinates, the cockpit and the room can both ask it and always agree, which
// is what lets the room stay the authority on whether a ship hit something
// without keeping a planet in memory. It is the same arrangement rebelsCombat
// already has: one simulation, run in two places.
//
// NO IMPORTS BEYOND THE NUMBERS. See voxelWorld.ts for why.
//
// HOW IT IS BUILT UP, cheapest test first
// ---------------------------------------
//   1. the shell        outside the surface or inside the cavity: empty
//   2. the heart        a small ball at the centre, denser
//   3. the spokes       24 lines joining the heart to the shell
//   4. the crust        how much rock there is at this depth
//   5. the clumps       two octaves of noise, thresholded to that much rock
//   6. the channels     radial voids carved through, so there are ways in
//
// Most calls stop at step 1, which is why collision is cheap: the shell is a
// sixth of the grid's volume and a ship is usually not in it.

import {
  R_OUTER, R_INNER, R_HEART, SPOKES, SPOKE_R,
  CLUMP, FINE_WEIGHT,
  FILL, CRUST_OUTER, CRUST_INNER,
  CHANNEL_STRETCH, CHANNEL_CUT,
} from "./voxelWorld";

/* ---- the hash ----
   One integer in, one number from zero to one out, the same on every machine.
   Written with Math.imul and unsigned shifts throughout: plain multiplication
   of large integers goes through doubles and loses the low bits, which would
   make the planet subtly different in the room than in the cockpit. */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177) + Math.imul(seed | 0, 2654435761);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smoothstep, so the lattice does not show as a grid of diamonds. */
const ease = (t: number): number => t * t * (3 - 2 * t);

/**
 * Value noise on an integer lattice: eight hashes, trilinearly blended.
 *
 * No permutation table and no gradients. A table would have to be built
 * identically on both sides of the wire and would be one more thing to get out
 * of step; this needs nothing but the coordinates.
 */
function noise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const tx = ease(x - xi), ty = ease(y - yi), tz = ease(z - zi);
  const c000 = hash3(xi, yi, zi, seed), c100 = hash3(xi + 1, yi, zi, seed);
  const c010 = hash3(xi, yi + 1, zi, seed), c110 = hash3(xi + 1, yi + 1, zi, seed);
  const c001 = hash3(xi, yi, zi + 1, seed), c101 = hash3(xi + 1, yi, zi + 1, seed);
  const c011 = hash3(xi, yi + 1, zi + 1, seed), c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
  const x00 = c000 + (c100 - c000) * tx, x10 = c010 + (c110 - c010) * tx;
  const x01 = c001 + (c101 - c001) * tx, x11 = c011 + (c111 - c011) * tx;
  const y0 = x00 + (x10 - x00) * ty, y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}

/**
 * The rock field: a coarse octave for the clumps and a fine one for roughness.
 * Low means rock.
 *
 * ---- ONE FIELD, AT EVERY DETAIL LEVEL ----
 *
 * This used to GROW the clumps with the level, so a coarse level sampled a
 * ten-times-wider version of the noise. The argument was that it kept every
 * level equally clumpy and equally cheap. What it actually did was make each
 * level a DIFFERENT PLANET, and that is the fault behind everything Geoff has
 * been reporting for four versions.
 *
 * Measured, crossing one detail boundary with the clumps grown:
 *
 *     step 1 -> 2   130% of the rock changes
 *     step 2 -> 4   103% to 179%
 *     step 4 -> 8    74% to  97%
 *
 * More cubes change than there are cubes, because almost none of the rock is
 * in the same place at the two levels. And the fill went with it: a quarter of
 * the cells at the finest level, 37% at step 4, 5% at step 8 and NOTHING at
 * all at step 16, so the distant planet was alternately more solid than it
 * should be and completely absent.
 *
 * A chunk crosses a boundary whenever the ship moves a little closer or a
 * little further, which is constantly, at every distance at once, flying
 * perfectly straight. Every one of those crossings threw away nearly all of a
 * chunk's cubes and put different ones in their place, in the middle of the
 * view, with each cube 29 pixels tall at the first boundary. Geoff, four
 * times, most plainly: "going in a straight line they appear and disappear at
 * every distance from close to me to far away ... it looks terrible."
 *
 * Every test I wrote asked whether the GROUND WAS COVERED, and the ground was
 * always covered. It was simply different rock. That is why none of them found
 * this and why four rounds of fixes did not touch it.
 *
 * So there is one field now, sampled more sparsely as the detail drops, which
 * is what a detail level is supposed to be. Measured after: 25 to 29% of the
 * rock changes at the first boundary rather than 130%, the fill holds between
 * 17% and 25% at every level instead of swinging from 37% to zero, and a
 * coarse chunk is CHEAPER than a fine one (453 triangles at step 8 against
 * 4,435 at step 1) rather than dearer, which is what the growing clumps were
 * introduced to fix in the first place.
 */
/**
 * How big the clumps are at a given detail level.
 *
 * ---- THE MIDDLE ROAD, AND WHY THE TWO EXTREMES BOTH FAIL ----
 *
 * The clumps used to grow with the level, ten cubes becoming a hundred and
 * sixty, which made every level a different planet: 130% of the rock moved at
 * the first boundary and the fill swung from 37% to nothing. That is the
 * popping.
 *
 * Holding them at ten cubes for every level fixes the shape (28% at the first
 * boundary, fill steady at 17-25%) and creates a different problem, which is
 * the one the growing was introduced to solve. A ten-cube clump is a cell and
 * a quarter across at step 8, so the rock stops being clumps and becomes
 * salt and pepper: nothing merges, a chunk costs three times the triangles,
 * and the distant planet is a haze of separate cubes. Measured, the worst
 * viewpoint wanted 1.37 million triangles against 443,000 before.
 *
 * So the clump is held at ten cubes while that is still several cells across,
 * and grows no faster than it must to stay three cells wide. The levels are
 * IDENTICAL up to step 4, which covers every boundary a player can see
 * properly: a cube is 29 pixels at the first, 11 at the second and 4 at the
 * third. Past that the shape is allowed to drift, because 4 pixels is where
 * nobody can tell which cube moved.
 */
export function clumpFor(step: number): number {
  /* ALWAYS the same. Growing it even a little was tried and is worse than not
     growing it at all: value noise is chaotic in scale, so a clump of twelve
     cubes is not a blurred version of a clump of ten, it is an unrelated
     pattern. Measured, going from 10 to 12 at step 4 put the disagreement at
     that boundary back up to 130%, as bad as the original. It is all or
     nothing, and the levels have to be the same field.

     Kept as a function because the cost of that decision is paid elsewhere:
     see the de-speckling below, and COST_BY_STEP in voxelView. */
  void step;
  return CLUMP;
}

export function rockField(x: number, y: number, z: number, seed: number, step = 1): number {
  const coarse = clumpFor(step), fine = coarse / 3;
  return (1 - FINE_WEIGHT) * noise(x / coarse, y / coarse, z / coarse, seed + 1)
    + FINE_WEIGHT * noise(x / fine, y / fine, z / fine, seed + 2);
}

/* ---- turning "a quarter of it is rock" into a threshold ----
   The field is a blend of eight uniform hashes, so its own values bunch around
   the middle rather than spreading evenly: asking for the quarter that is rock
   is NOT asking for values under 0.25. The first attempt at this plan measured
   a shell that came out 15% solid when it was meant to be 25%, which is exactly
   this mistake, and it would have shown up late as a planet with a
   suspiciously thin crust.

   So the distribution is measured once, at load, from a fixed set of sample
   points, and kept as a small table from "how much rock" to "which threshold".
   Fixed points, not random ones, so the table is identical everywhere. */
const TABLE_STEPS = 64;
/* ---- ONE TABLE PER SEED ----
   It used to be a single table and a single carved fraction, built from
   whichever seed asked first and then handed to every seed after it. With one
   planet that is invisible; with two it is a planet whose fill is set from
   another planet's noise, and the room and the cockpit disagreeing about which
   cells are rock is the one failure this whole design is built to prevent.
   Keyed by seed, and a seed is an integer, so the map stays tiny. */
const tables = new Map<number, { table: Float64Array; carved: number }>();
/**
 * What fraction of the rock the channels carve away again, per seed.
 *
 * Measured in the same pass, and it matters: the first report came back with a
 * shell 17.8% solid when it was meant to be 25%, because the threshold was set
 * to leave a quarter and THEN the channels cut a third of that quarter out.
 * The threshold has to aim high by exactly this much.
 */
function tableFor(seed: number): { table: Float64Array; carved: number } {
  const had = tables.get(seed);
  if (had) return had;
  const made = buildTable(seed);
  tables.set(seed, made);
  return made;
}

function buildTable(seed: number): { table: Float64Array; carved: number } {
  const SAMPLES = 24000;
  const v = new Float64Array(SAMPLES);
  /* Spread over the shell rather than along a line: the samples have to
     represent the place the threshold will be used. A golden-angle spiral in
     direction, and a sweep in radius. */
  const GOLD = Math.PI * (3 - Math.sqrt(5));
  let cut = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const t = (i + 0.5) / SAMPLES;
    const ct = 1 - 2 * t, st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const a = i * GOLD;
    const r = R_INNER + (R_OUTER - R_INNER) * ((i * 7919) % SAMPLES) / SAMPLES;
    const x = Math.cos(a) * st * r, y = ct * r, z = Math.sin(a) * st * r;
    v[i] = rockField(x, y, z, seed);
    if (channel(x, y, z, r, seed) > CHANNEL_CUT) cut++;
  }
  v.sort();
  const out = new Float64Array(TABLE_STEPS + 1);
  for (let i = 0; i <= TABLE_STEPS; i++) {
    const at = Math.min(SAMPLES - 1, Math.round((i / TABLE_STEPS) * (SAMPLES - 1)));
    out[i] = v[at];
  }
  return { table: out, carved: cut / SAMPLES };
}

/** The field value below which a cell is rock, for a wanted fill from 0 to 1. */
export function thresholdFor(fill: number, seed = 0): number {
  const { table } = tableFor(seed);
  const t = Math.max(0, Math.min(1, fill)) * TABLE_STEPS;
  const i = Math.min(TABLE_STEPS - 1, Math.floor(t));
  return table[i] + (table[i + 1] - table[i]) * (t - i);
}

/**
 * The threshold that leaves `fill` of the cells solid AFTER the channels have
 * been carved out of them.
 *
 * This is the one the shell uses. `thresholdFor` on its own answers a different
 * question, and using it was the fault the first report caught.
 */
export function thresholdAfterCarving(fill: number, seed = 0): number {
  const { carved } = tableFor(seed);
  return thresholdFor(fill / Math.max(0.05, 1 - carved), seed);
}

/** How much the channels carve. For the tests and the report. */
export function carvedFraction(seed = 0): number {
  return tableFor(seed).carved;
}

/** Only for the tests, which check the table is stable. */
export function fillTable(seed = 0): Float64Array {
  return tableFor(seed).table;
}
/** Only for the tests, which build the table under more than one seed. */
export function resetFieldForTests(): void { tables.clear(); }

/**
 * How much rock there is at this depth, from 0 to 1.
 *
 * A flat quarter, everywhere, because that is what was asked for. The lean this
 * used to have (a skin outside, a ragged ceiling over the cavity) is still
 * wired up through CRUST_OUTER and CRUST_INNER and is simply turned off; see
 * the note on those two for why.
 */
export function crustFill(radius: number): number {
  const t = (radius - R_INNER) / (R_OUTER - R_INNER);   /* 0 inside, 1 outside */
  return FILL * (CRUST_INNER + (CRUST_OUTER - CRUST_INNER) * Math.max(0, Math.min(1, t)));
}

/* ---- the spokes ----
   Evenly spread directions, worked out once. Geoff: "radiating lines, like 24
   or so spokes radiating evenly in every direction symmetrically." A
   golden-angle spiral is the standard way to spread N points over a sphere
   without clumping at the poles. */
const spokeDirs: number[] = (() => {
  const out: number[] = [];
  const GOLD = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < SPOKES; i++) {
    const ct = 1 - (2 * i + 1) / SPOKES;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const a = i * GOLD;
    out.push(Math.cos(a) * st, ct, Math.sin(a) * st);
  }
  return out;
})();

/** The 24 spoke directions, as unit vectors laid end to end. For drawing them
 *  as stretched boxes, which is how they are rendered rather than as cubes. */
export function spokeDirections(): readonly number[] { return spokeDirs; }

/** Is this point inside a spoke? Only asked inside the cavity, so it costs
 *  nothing in the shell where most cells are. */
function inSpoke(x: number, y: number, z: number, radius: number): boolean {
  if (radius <= R_HEART || radius >= R_INNER + SPOKE_R) return false;
  for (let i = 0; i < spokeDirs.length; i += 3) {
    /* How far along its own direction, then how far off it. A spoke is a
       cylinder, so the perpendicular distance is what matters. */
    const along = x * spokeDirs[i] + y * spokeDirs[i + 1] + z * spokeDirs[i + 2];
    if (along <= 0) continue;
    const off2 = radius * radius - along * along;
    if (off2 < SPOKE_R * SPOKE_R) return true;
  }
  return false;
}

/**
 * The radial channels: what makes tunnels instead of pockets.
 *
 * The ordinary noise field with the radial axis stretched, so its features run
 * long in the "inwards" direction. High means carved.
 */
function channel(x: number, y: number, z: number, radius: number, seed: number): number {
  if (radius < 1e-6) return 0;
  /* ---- A CHANNEL IS A DIRECTION, NOT A PLACE ----
     This is the fix for the fault the connectivity test found. The first
     version sampled the noise at the cell's own position with the radial axis
     merely compressed, which made the voids drift as they went inward: blobs,
     not tubes. The test flood-filled inwards from the surface, got to radius
     411 and stopped, a hundred and sixty cubes short of the cavity. The planet
     was sealed.

     Now the field is sampled on the DIRECTION alone, scaled so the channels are
     a few clumps apart across the sky. A carved region is therefore the same
     carved region at every depth: a shaft, open from the surface to the cavity,
     by construction rather than by luck.

     The wobble is a slow drift with radius, enough that a shaft leans and bends
     on the way in and has to be followed, but not so much that it closes. */
  const k = (R_OUTER * 0.4) / radius;
  const wobble = radius / (CLUMP * CHANNEL_STRETCH);
  /* Not scaled by the level: a channel is a direction, and the same directions
     have to be carved at every level or a shaft would close up when it went
     coarse and open again when it came near. */
  return noise(
    x * k / CLUMP + wobble, y * k / CLUMP - wobble, z * k / CLUMP + wobble * 0.5,
    seed + 3,
  );
}

/**
 * Is there a cube at this grid position?
 *
 * Coordinates are CUBES, centred on the planet, and may be any integers: the
 * shell test rejects everything outside. `seed` picks which planet.
 */
export function solid(x: number, y: number, z: number, seed = 0, step = 1): boolean {
  const r2 = x * x + y * y + z * z;
  /* 1. Outside the surface: nothing. Squared, to skip the square root for the
        majority of calls that end here. */
  if (r2 > R_OUTER * R_OUTER) return false;
  const r = Math.sqrt(r2);

  /* 2. The heart. Denser than the shell, so it reads as a solid body with
        detail rather than a smooth ball. */
  if (r <= R_HEART) {
    return rockField(x, y, z, seed, step) < thresholdFor(0.8, seed);
  }

  /* 3. The spokes, which cross the empty cavity. */
  if (r < R_INNER) return inSpoke(x, y, z, r);

  /* 4, 5. How much rock at this depth, and is this cell some of it. Aimed high
        by whatever the channels will carve back out, so the shell really ends
        up the briefed quarter. */
  if (rockField(x, y, z, seed, step) >= thresholdAfterCarving(crustFill(r), seed)) return false;

  /* 6. Carved out again if a channel runs through here. Last, because it is
        the most expensive test and only rock can be carved. */
  return channel(x, y, z, r, seed) <= CHANNEL_CUT;
}

/**
 * The same question at a coarser level: is there anything at this cell when one
 * cell stands for `step` cubes?
 *
 * Sampled at the middle of the coarse cell. Cheaper and steadier than asking
 * whether ANY of its cubes are solid, which at step 16 would mean four thousand
 * calls and would fill the distant planet in solid.
 */
export function solidAt(cx: number, cy: number, cz: number, step: number, seed = 0): boolean {
  if (step <= 1) return solid(cx, cy, cz, seed);
  const half = step >> 1;
  /* The middle of the coarse cell, in the ONE field. See the note on rockField
     for why there is no longer a coarser field to ask. */
  return solid(cx * step + half, cy * step + half, cz * step + half, seed, step);
}

/**
/* ---- A WHOLE CHUNK AT ONCE, WHICH IS WHERE THE TIME GOES ----

   `solid` is written to answer about ONE cube, because that is what collision
   asks, and it pays the full price every time: two octaves of value noise, each
   eight hashes, for every cell. A chunk is 32,768 cells, so building one costs
   half a million hashes and measured at sixteen milliseconds, three quarters of
   it in here. At a few milliseconds a frame that is one chunk a frame, and when
   a lot of new ground arrives at once, which is what crossing into the cavity
   is, the ground arrives faster than it can be built. Measured over a whole
   flight: the worst frame had three quarters of the view missing.

   But a chunk's cells sit on a REGULAR LATTICE, and the noise is built from
   corners on a lattice of its own. Over one chunk the coarse octave spans about
   three of its cells and the fine one about ten, so the eight corners each cell
   blends are shared with all its neighbours: 1,456 corner hashes for the chunk
   instead of half a million, and the rest is arithmetic on numbers already to
   hand.

   The spacing works out the same at every detail level, which is the part that
   makes this possible: a coarse level grows the clumps to match, so a chunk is
   always about three coarse cells across whatever it is standing for.

   IT MUST AGREE WITH `solid` EXACTLY. The room decides collisions with `solid`
   and the cockpit draws what this says; if they ever disagree a ship flies
   through a wall it can see. The test walks a chunk cell by cell at every level
   and compares the two. */

/** Corner hashes for one octave over one chunk, and the blend that reads them. */
interface Lattice {
  /** Lattice coordinate of the corner the block starts at. */
  x0: number; y0: number; z0: number;
  /** How many corners each way. */
  nx: number; ny: number; nz: number;
  at: Float64Array;
}

function lattice(
  fx: number, fy: number, fz: number, dx: number, n: number, seed: number,
): Lattice {
  const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
  /* Enough corners to reach the far end of the block, plus the one past it
     that the blend reads. Generous by one: a corner too many costs a hash, a
     corner too few reads past the end of the array. */
  const span = Math.floor(dx * (n - 1)) + 3;
  const at = new Float64Array(span * span * span);
  let i = 0;
  for (let k = 0; k < span; k++) {
    for (let j = 0; j < span; j++) {
      for (let a = 0; a < span; a++) at[i++] = hash3(x0 + a, y0 + j, z0 + k, seed);
    }
  }
  return { x0, y0, z0, nx: span, ny: span, nz: span, at };
}

/** The same trilinear blend `noise` does, reading corners already hashed. */
function fromLattice(L: Lattice, x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const tx = ease(x - xi), ty = ease(y - yi), tz = ease(z - zi);
  const a = xi - L.x0, b = yi - L.y0, c = zi - L.z0;
  const o = (c * L.ny + b) * L.nx + a;
  const sx = 1, sy = L.nx, sz = L.nx * L.ny;
  const c000 = L.at[o], c100 = L.at[o + sx];
  const c010 = L.at[o + sy], c110 = L.at[o + sy + sx];
  const c001 = L.at[o + sz], c101 = L.at[o + sz + sx];
  const c011 = L.at[o + sz + sy], c111 = L.at[o + sz + sy + sx];
  const x00 = c000 + (c100 - c000) * tx, x10 = c010 + (c110 - c010) * tx;
  const x01 = c001 + (c101 - c001) * tx, x11 = c011 + (c111 - c011) * tx;
  const y0 = x00 + (x10 - x00) * ty, y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}

/**
 * Fill `out` with one cube per cell for a whole block, the quick way.
 *
 * `ox, oy, oz` are in CELLS at this step and `size` is the block's edge, the
 * same as the mesher's. `part` keeps each mesh to its own: see solidShellAt and
 * solidHeartAt for why that matters.
 */
export function fillChunk(
  ox: number, oy: number, oz: number, size: number, step: number, seed: number,
  part: "all" | "shell" | "heart", out: Uint8Array,
): void {
  const { table, carved } = tableFor(seed);
  const half = step > 1 ? step >> 1 : 0;
  const coarse = clumpFor(step), fine = clumpFor(step) / 3;
  /* Where the block starts and how far one cell moves, in each octave's own
     coordinates. Both are the same at every level, which is why this works. */
  const bx = ((ox * step + half) / coarse), fxs = step / coarse;
  const by = ((oy * step + half) / coarse);
  const bz = ((oz * step + half) / coarse);
  const gx = ((ox * step + half) / fine), fxf = step / fine;
  const gy = ((oy * step + half) / fine);
  const gz = ((oz * step + half) / fine);
  /* ---- THE CACHE ONLY PAYS WHEN CORNERS ARE SHARED ----
     One cell to the next moves `step / CLUMP` through the coarse octave and
     `step / CLUMP_FINE` through the fine one. Below one, several cells share
     the same eight corners and hashing them once is worth a great deal. At or
     above one, each cell wants corners of its own and a lattice big enough to
     hold them is bigger than the chunk: at step 16 the fine octave asked for a
     161-cube lattice, four million hashes, to answer 39,000 cells. Measured,
     that took a step-16 chunk from under a millisecond to 14.5. So above the
     line each octave is simply asked directly, which is what `solid` does. */
  const SHARES = 0.75;
  const Lc = fxs < SHARES ? lattice(bx, by, bz, fxs, size, seed + 1) : null;
  const Lf = fxf < SHARES ? lattice(gx, gy, gz, fxf, size, seed + 2) : null;
  const coarseAt = Lc
    ? (a: number, j: number, k: number) => fromLattice(Lc, bx + a * fxs, by + j * fxs, bz + k * fxs)
    : (a: number, j: number, k: number) => noise(bx + a * fxs, by + j * fxs, bz + k * fxs, seed + 1);
  const fineAt = Lf
    ? (a: number, j: number, k: number) => fromLattice(Lf, gx + a * fxf, gy + j * fxf, gz + k * fxf)
    : (a: number, j: number, k: number) => noise(gx + a * fxf, gy + j * fxf, gz + k * fxf, seed + 2);
  void table; void carved;

  const heartThreshold = thresholdFor(0.8, seed);
  let i = 0;
  for (let k = 0; k < size; k++) {
    const z = (oz + k) * step + half;
    for (let j = 0; j < size; j++) {
      const y = (oy + j) * step + half;
      for (let a = 0; a < size; a++, i++) {
        const x = (ox + a) * step + half;
        const r2 = x * x + y * y + z * z;
        if (r2 > R_OUTER * R_OUTER) { out[i] = 0; continue; }
        const r = Math.sqrt(r2);
        if (part !== "shell" && r <= R_HEART) {
          const v = (1 - FINE_WEIGHT) * coarseAt(a, j, k) + FINE_WEIGHT * fineAt(a, j, k);
          out[i] = v < heartThreshold ? 1 : 0;
          continue;
        }
        if (part === "heart") { out[i] = 0; continue; }
        if (r < R_INNER) { out[i] = part === "all" && inSpoke(x, y, z, r) ? 1 : 0; continue; }
        const v = (1 - FINE_WEIGHT) * coarseAt(a, j, k) + FINE_WEIGHT * fineAt(a, j, k);
        if (v >= thresholdAfterCarving(crustFill(r), seed)) { out[i] = 0; continue; }
        out[i] = channel(x, y, z, r, seed) <= CHANNEL_CUT ? 1 : 0;
      }
    }
  }
}



/**
 * The heart ALONE: the ball at the centre, and not the spokes that leave it.
 *
 * The heart's chunk reaches two cubes past the heart itself, and a spoke
 * starts exactly where the heart ends, so those two cubes were meshed into the
 * heart AND drawn again by the spoke's own box: two surfaces in one place at
 * each of the twenty-four spoke roots. Geoff, on 69.9.55: "the orange heart is
 * still flickering in some places, but not all." Twenty-four places.
 */
/**
 * The same question, but only about the SHELL: no heart and no spokes.
 *
 * The heart is meshed once as its own orange body and the spokes are drawn as
 * stretched boxes, so a chunk that also meshed them drew the same rock twice,
 * in two materials, in the same place. Two surfaces in one place is z-fighting,
 * and the pair that lost was usually the orange one: the heart went grey and
 * speckled from anywhere inside the cavity.
 *
 * Collision still asks `solid`, which knows about all three. This is only for
 * the chunk meshes.
 */
export function solidHeartAt(cx: number, cy: number, cz: number, step: number, seed = 0): boolean {
  const half = step > 1 ? step >> 1 : 0;
  const x = cx * Math.max(1, step) + half, y = cy * Math.max(1, step) + half, z = cz * Math.max(1, step) + half;
  if (x * x + y * y + z * z > R_HEART * R_HEART) return false;
  return solidAt(cx, cy, cz, step, seed);
}

export function solidShellAt(cx: number, cy: number, cz: number, step: number, seed = 0): boolean {
  const half = step > 1 ? step >> 1 : 0;
  const x = cx * Math.max(1, step) + half, y = cy * Math.max(1, step) + half, z = cz * Math.max(1, step) + half;
  if (x * x + y * y + z * z < R_INNER * R_INNER) return false;
  return solidAt(cx, cy, cz, step, seed);
}

/* ---- THE SKIN TRICK, AND WHY IT IS GONE ----
   There used to be a solidSkinAt() here that treated everything below a depth
   as solid rock, so a distant chunk drew only its outer surface. It was worth
   ten times, and it was wrong in two ways that matter more than that.

   It made the planet look SOLID from outside, which is the opposite of the
   brief: Geoff asked for three cubes in four to be holes and said so again
   after seeing it. And it assumed the viewer was always outside, so from within
   the cavity the entire shell was "below the depth" and vanished: "From inside
   of the planet, the entire planet is invisible and you see right through it
   except for the spikes."

   The honest saving is the one above: grow the clumps with the detail level, so
   a coarse level is a blurred planet rather than a noisier one. */

