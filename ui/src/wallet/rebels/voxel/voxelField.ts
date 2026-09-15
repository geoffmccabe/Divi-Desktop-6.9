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
  CLUMP, CLUMP_FINE, FINE_WEIGHT,
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

/** The rock field: a coarse octave for the clumps and a fine one for
 *  roughness. Low means rock. */
export function rockField(x: number, y: number, z: number, seed: number): number {
  return (1 - FINE_WEIGHT) * noise(x / CLUMP, y / CLUMP, z / CLUMP, seed + 1)
    + FINE_WEIGHT * noise(x / CLUMP_FINE, y / CLUMP_FINE, z / CLUMP_FINE, seed + 2);
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
let table: Float64Array | null = null;
/**
 * What fraction of the rock the channels carve away again.
 *
 * Measured in the same pass, and it matters: the first report came back with a
 * shell 17.8% solid when it was meant to be 25%, because the threshold was set
 * to leave a quarter and THEN the channels cut a third of that quarter out.
 * The threshold has to aim high by exactly this much.
 */
let carved = 0;

function buildTable(seed: number): Float64Array {
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
  carved = cut / SAMPLES;
  v.sort();
  const out = new Float64Array(TABLE_STEPS + 1);
  for (let i = 0; i <= TABLE_STEPS; i++) {
    const at = Math.min(SAMPLES - 1, Math.round((i / TABLE_STEPS) * (SAMPLES - 1)));
    out[i] = v[at];
  }
  return out;
}

/** The field value below which a cell is rock, for a wanted fill from 0 to 1. */
export function thresholdFor(fill: number, seed = 0): number {
  if (!table) table = buildTable(seed);
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
  if (!table) table = buildTable(seed);
  return thresholdFor(fill / Math.max(0.05, 1 - carved), seed);
}

/** How much the channels carve. For the tests and the report. */
export function carvedFraction(seed = 0): number {
  if (!table) table = buildTable(seed);
  return carved;
}

/** Only for the tests, which check the table is stable. */
export function fillTable(seed = 0): Float64Array {
  if (!table) table = buildTable(seed);
  return table;
}
/** Only for the tests, which build the table under more than one seed. */
export function resetFieldForTests(): void { table = null; carved = 0; }

/**
 * How much rock there is at this depth, from 0 to 1.
 *
 * Leaning outwards: a skin on the outside and a ragged ceiling over the cavity,
 * averaging the briefed quarter across the shell's thickness.
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
export function solid(x: number, y: number, z: number, seed = 0): boolean {
  const r2 = x * x + y * y + z * z;
  /* 1. Outside the surface: nothing. Squared, to skip the square root for the
        majority of calls that end here. */
  if (r2 > R_OUTER * R_OUTER) return false;
  const r = Math.sqrt(r2);

  /* 2. The heart. Denser than the shell, so it reads as a solid body with
        detail rather than a smooth ball. */
  if (r <= R_HEART) {
    return rockField(x, y, z, seed) < thresholdFor(0.8, seed);
  }

  /* 3. The spokes, which cross the empty cavity. */
  if (r < R_INNER) return inSpoke(x, y, z, r);

  /* 4, 5. How much rock at this depth, and is this cell some of it. Aimed high
        by whatever the channels will carve back out, so the shell really ends
        up the briefed quarter. */
  if (rockField(x, y, z, seed) >= thresholdAfterCarving(crustFill(r), seed)) return false;

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
  return solid(cx * step + half, cy * step + half, cz * step + half, seed);
}
