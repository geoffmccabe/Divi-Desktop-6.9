// Spikeworld: the rods and spikes on the skin.
//
// Geoff: "The outer skin of the planet would also have a random assortment of
// rods and spikes radiating out from it, a few thousand of them from 1 to 10
// cubes wide and up to 100 cubes long... so it will look like a spiked voxel
// planet."
//
// WHY THESE ARE NOT VOXELS
// ------------------------
// A rod one cube wide and a hundred long IS a box. Nothing is lost by drawing
// it as one, and everything is saved: a few thousand rods as stretched box
// instances are about 36,000 triangles in ONE draw call, where the same rods as
// voxels would be a chunk of the shell's whole budget. A repeating grid texture
// along the box draws the cube edges, so it still reads as stacked cubes.
//
// Collision is cheaper too: a point in a box in the box's own frame, rather
// than a walk through cells.
//
// Same rules as the rest of this folder: a pure function of the seed, nothing
// stored, no imports beyond the numbers.

import { R_OUTER, CUBE } from "./voxelWorld";

/** How many rods. Geoff: "a few thousand of them". */
export const SPIKE_COUNT = 3000;
/** Widths and lengths, in cubes, as briefed. */
export const SPIKE_W_MIN = 1, SPIKE_W_MAX = 10;
export const SPIKE_L_MIN = 8, SPIKE_L_MAX = 100;

/** One rod: where it starts, which way it points, and how big it is. All in
 *  CUBES, like everything else here; the renderer multiplies by CUBE. */
export interface Spike {
  /** Where it leaves the skin. */
  base: [number, number, number];
  /** Unit vector along the rod. */
  dir: [number, number, number];
  /** In cubes. */
  width: number;
  length: number;
}

/** One number from zero to one, from an index and a channel. The same hash the
 *  field uses, kept separate so a change to one cannot move the other. */
function rand(i: number, channel: number, seed: number): number {
  let h = Math.imul(i | 0, 1597334677) + Math.imul(channel | 0, 2654435761) + Math.imul(seed | 0, 374761393);
  h = Math.imul(h ^ (h >>> 15), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Every rod on the planet, worked out from the seed.
 *
 * Built in one pass and kept by the caller: three thousand small objects are
 * nothing to hold, and unlike the shell there is no reason to generate these
 * lazily.
 *
 * The directions are a golden-angle spiral, which spreads points over a sphere
 * without bunching at the poles, then jittered so they do not read as a
 * pattern. Widths and lengths are biased towards the small end by squaring the
 * random number: mostly thin spines with a few great tusks, rather than three
 * thousand rods all of middling size.
 */
export function spikes(seed = 0): Spike[] {
  const out: Spike[] = [];
  const GOLD = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < SPIKE_COUNT; i++) {
    const ct = 1 - (2 * i + 1) / SPIKE_COUNT;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const a = i * GOLD + (rand(i, 1, seed) - 0.5) * 0.08;
    /* The spot on the sphere, jittered off the lattice. */
    const jz = (rand(i, 2, seed) - 0.5) * 0.06;
    let px = Math.cos(a) * st, py = ct + jz, pz = Math.sin(a) * st;
    const pl = Math.hypot(px, py, pz) || 1;
    px /= pl; py /= pl; pz /= pl;

    /* Mostly radial, with a lean, so the planet looks grown rather than
       machined. */
    const lean = 0.22;
    let dx = px + (rand(i, 3, seed) - 0.5) * lean;
    let dy = py + (rand(i, 4, seed) - 0.5) * lean;
    let dz = pz + (rand(i, 5, seed) - 0.5) * lean;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;

    /* Squared, so thin and short are common and fat and long are rare. */
    const w = rand(i, 6, seed) ** 2, l = rand(i, 7, seed) ** 2;
    const width = Math.max(SPIKE_W_MIN, Math.round(SPIKE_W_MIN + w * (SPIKE_W_MAX - SPIKE_W_MIN)));
    const length = Math.max(SPIKE_L_MIN, Math.round(SPIKE_L_MIN + l * (SPIKE_L_MAX - SPIKE_L_MIN)));

    /* Rooted a little way INTO the crust, so no rod appears to float off the
       surface. How deep depends on how fat it is: a wide rod needs more of
       itself buried to look held. */
    const sunk = 2 + width * 0.6;
    const r = R_OUTER - sunk;
    out.push({ base: [px * r, py * r, pz * r], dir: [dx, dy, dz], width, length });
  }
  return out;
}

/** Triangles to draw them all, if each is one box. For the budget. */
export const spikeTriangles = (n = SPIKE_COUNT): number => n * 12;

/**
 * Is this point inside this rod?
 *
 * In the rod's own frame: how far along, and how far off the line. Used for
 * collision. Points are in CUBES.
 *
 * Every rod tested against every ship every tick would be three thousand tests;
 * the collision phase buckets them by direction first, and only the handful of
 * rods pointing anywhere near the ship are asked. That indexing is not here
 * yet, and this is the piece it will call.
 */
export function inSpike(s: Spike, x: number, y: number, z: number): boolean {
  const ox = x - s.base[0], oy = y - s.base[1], oz = z - s.base[2];
  const along = ox * s.dir[0] + oy * s.dir[1] + oz * s.dir[2];
  if (along < 0 || along > s.length) return false;
  const off2 = ox * ox + oy * oy + oz * oz - along * along;
  const half = s.width / 2;
  return off2 <= half * half;
}

/** The longest rod's reach past the surface, in world units. Whatever holds the
 *  planet has to be at least this much bigger than the planet. */
export function spikeReach(seed = 0): number {
  let far = 0;
  for (const s of spikes(seed)) {
    const tipx = s.base[0] + s.dir[0] * s.length;
    const tipy = s.base[1] + s.dir[1] * s.length;
    const tipz = s.base[2] + s.dir[2] * s.length;
    far = Math.max(far, Math.hypot(tipx, tipy, tipz));
  }
  return (far - R_OUTER) * CUBE;
}
