// Spikeworld: deciding what to draw, and never drawing more than it may.
//
// This is the file that keeps the planet inside its budget. Everything it does
// is arithmetic on positions, so it is testable in node and it has no idea what
// a renderer is: it answers one question, "which chunks, at which detail", and
// hands back a list.
//
// FIVE THINGS IT DOES, in order of how much they save
//
//   1. The dust. Geoff: "Space dust as a type of fog." Anything that has faded
//      into it is not drawn at all. Inside the shell this is nearly everything,
//      and it is why being in a tunnel is the cheapest place to be.
//   2. Rings of detail. Full cubes only close by; further out one cube stands
//      for 2, 4 then 8. A coarse chunk covers eight times the ground for a
//      fraction of the triangles.
//   3. The far side of the planet. Standing outside it, half the shell is
//      behind nine thousand units of rock. Same horizon test the node towers
//      needed once instancing took their culling away.
//   4. Nothing outside the planet. A chunk that cannot touch the shell, the
//      spokes or the heart holds nothing and is skipped before it is built.
//   5. A HARD BUDGET. Chunks are taken nearest first and stop when the
//      allowance runs out, so the worst case is a slightly coarser planet and
//      never a dropped frame.
//
// No imports beyond the numbers and the field's own geometry.

import {
  R_OUTER, R_INNER, R_HEART, CHUNK, CUBE, LOD_STEPS, SPOKE_R,
} from "./voxelWorld";

/**
 * What the planet may cost in one frame.
 *
 * DFlow showed the live game in trouble above about 200,000 triangles on
 * Geoff's Mac, and the planet cannot have all of it: ships, shots, spikes and
 * effects need room. Two thirds is the planet's share.
 */
export const TRIANGLE_BUDGET = 120000;

/**
 * How far the dust lets you see, in world units.
 *
 * Two numbers because the dust is not a wall: geometry fades out between them
 * and is dropped past the far one. Fading is also what hides the seam where a
 * chunk swaps detail level, which is the usual ugliness in this kind of
 * renderer and the reason fog and detail levels belong together.
 *
 * 2,700 units is 300 cubes, which is more than a shell's thickness: standing
 * outside you see the silhouette and the spikes, and inside a tunnel you see
 * far further than the rock lets you anyway.
 */
export const DUST_NEAR = 1400;
export const DUST_FAR = 2700;

/**
 * How far the dust lets you see OUT IN THE OPEN, in world units.
 *
 * The dust cannot be one number, and the test caught that: at 1,200 cubes above
 * the surface a single 2,700-unit dust swallowed the entire planet, so a player
 * arriving would have seen nothing at all. Dust belongs to the planet, so it is
 * thick in the rock and thin in the sky: inside you cannot see past the next
 * wall anyway, and outside you have to be able to see the thing you came for.
 *
 * Nine thousand units is the planet's own width, which is enough to hold all of
 * it in view from the shard's sky edge.
 */
export const DUST_FAR_OPEN = 9000;

/** Which of the two applies where the viewer is. Fades between them across the
 *  crust, so there is no line in the sky where the view distance jumps. */
export function dustFarFor(radiusCubes: number): number {
  const t = Math.max(0, Math.min(1, (radiusCubes - R_OUTER * 0.9) / (R_OUTER * 0.2)));
  return DUST_FAR + (DUST_FAR_OPEN - DUST_FAR) * t;
}

/**
 * Where each detail level takes over, in CUBES from the viewer.
 *
 * Read off the measurements: a full-detail chunk is about 6,000 triangles, so
 * a couple of dozen of them is half the budget, and 64 cubes is about as far as
 * a player can see inside a tunnel anyway. The rings are a starting point and
 * the budget overrides them, so getting these wrong costs sharpness and never
 * frame rate.
 */
export const RING_CUBES = [64, 160, 380, 1e9] as const;

/**
 * How deep each detail level bothers with, in cubes.
 *
 * Zero is the real planet, caves and all, which is what you need when you are
 * flying through them. Further out only the outer skin can be seen, so below
 * that depth the rock is filled in and no cave walls are generated. This is
 * worth more than any other single thing at distance: the Phase 3 test found a
 * view estimated at 100,000 triangles really costing 251,000, and nearly all of
 * the difference was cave wall nothing could look at.
 */
export const SKIN_BY_STEP: Record<number, number> = { 1: 0, 2: 0, 4: 60, 8: 40 };

/**
 * What a chunk costs, by detail level. MEASURED, at the 90th percentile of a
 * hundred and twenty chunks spread over the shell, not averaged: the budget has
 * to hold for an expensive view and not merely for a typical one.
 *
 * The first version of this table was one reading each and was wrong by two and
 * a half times at the coarsest level, which is how the estimate came to promise
 * 100,000 triangles and deliver 251,000.
 */
export const COST_BY_STEP: Record<number, number> = { 1: 6800, 2: 11600, 4: 12500, 8: 8400 };

/** One chunk to draw: its corner in CELLS at its own step, and that step. */
export interface ChunkRef {
  ox: number; oy: number; oz: number; step: number;
  /** Distance from the viewer to the chunk's middle, in cubes. For ordering
   *  and for the dust. */
  distance: number;
}

export interface ViewResult {
  chunks: ChunkRef[];
  /** What the list is expected to cost, before it is built. */
  triangles: number;
  /** How many were dropped for want of budget. Zero is the healthy case; a
   *  large number means the rings are too generous for this viewpoint. */
  dropped: number;
}

/** Which detail level a chunk that far away gets. */
export function stepFor(distanceCubes: number): number {
  for (let i = 0; i < LOD_STEPS.length; i++) {
    if (distanceCubes <= RING_CUBES[i]) return LOD_STEPS[i];
  }
  return LOD_STEPS[LOD_STEPS.length - 1];
}

/**
 * Could this chunk hold anything at all?
 *
 * A chunk is worth building if its box can reach the shell, a spoke or the
 * heart. Measured on the box's nearest and furthest corners from the centre,
 * so it is exact rather than approximate: no chunk that holds rock is ever
 * skipped.
 */
export function mightHoldRock(ox: number, oy: number, oz: number, step: number): boolean {
  const lo = [ox * step, oy * step, oz * step];
  const hi = [lo[0] + CHUNK * step, lo[1] + CHUNK * step, lo[2] + CHUNK * step];
  /* Nearest point of the box to the centre, and furthest corner from it. */
  let near2 = 0, far2 = 0;
  for (let a = 0; a < 3; a++) {
    const n = lo[a] > 0 ? lo[a] : (hi[a] < 0 ? -hi[a] : 0);
    const f = Math.max(Math.abs(lo[a]), Math.abs(hi[a]));
    near2 += n * n; far2 += f * f;
  }
  const near = Math.sqrt(near2), far = Math.sqrt(far2);
  if (near > R_OUTER) return false;                       /* all outside */
  if (far <= R_HEART) return true;                        /* all inside the heart */
  if (far < R_INNER - SPOKE_R && near > R_HEART) {
    /* Wholly within the cavity. Only a spoke can be in here, and a spoke is
       thin, so this is worth building only if the box straddles the middle in
       at least two axes: a spoke passes through the centre. */
    let straddles = 0;
    for (let a = 0; a < 3; a++) if (lo[a] <= SPOKE_R && hi[a] >= -SPOKE_R) straddles++;
    return straddles >= 2;
  }
  return true;
}

/**
 * Which chunks to draw, from where the viewer is.
 *
 * `viewer` is in CUBES. The result is ordered nearest first, which is both what
 * the budget wants and the order a renderer should build them in.
 */
export function visibleChunks(
  viewer: readonly [number, number, number],
  opts: { budget?: number; dustFar?: number } = {},
): ViewResult {
  const budget = opts.budget ?? TRIANGLE_BUDGET;
  const vr = Math.hypot(viewer[0], viewer[1], viewer[2]);
  const dustFarCubes = (opts.dustFar ?? dustFarFor(vr)) / CUBE;
  const outside = vr > R_OUTER;
  /* Which way the viewer is, for the horizon test. Only meaningful outside. */
  const vd = vr > 1e-6 ? [viewer[0] / vr, viewer[1] / vr, viewer[2] / vr] : [1, 0, 0];
  /* Anything whose direction dots with the viewer's below this is round the
     back of the planet. A tenth of slack keeps the limb, whose spikes and
     masts still show. */
  const horizon = outside ? Math.min(0.999, R_OUTER / vr) - 0.1 : -1.1;

  const found: ChunkRef[] = [];
  /* Walked at the FINEST step, so a chunk is never missed, but each one is
     assigned the step its distance earns and snapped to that step's grid.
     Chunks that land on the same coarse cell are kept once. */
  const seen = new Set<string>();

  for (const step of LOD_STEPS) {
    const cell = CHUNK * step;
    /* The band of distances this step serves. */
    const i = LOD_STEPS.indexOf(step);
    const inner = i === 0 ? 0 : RING_CUBES[i - 1];
    const outer = Math.min(RING_CUBES[i], dustFarCubes);
    if (outer <= inner) continue;
    /* Only the boxes that can reach that band. */
    const from = (v: number) => Math.floor((v - outer - cell) / cell);
    const to = (v: number) => Math.ceil((v + outer + cell) / cell);
    for (let cz = from(viewer[2]); cz <= to(viewer[2]); cz++) {
      for (let cy = from(viewer[1]); cy <= to(viewer[1]); cy++) {
        for (let cx = from(viewer[0]); cx <= to(viewer[0]); cx++) {
          const mx = cx * cell + cell / 2, my = cy * cell + cell / 2, mz = cz * cell + cell / 2;
          const d = Math.hypot(mx - viewer[0], my - viewer[1], mz - viewer[2]);
          if (d < inner || d > outer) continue;
          if (d > dustFarCubes) continue;
          /* The chunk's corner in CELLS at this step. */
          const ox = cx * CHUNK, oy = cy * CHUNK, oz = cz * CHUNK;
          if (!mightHoldRock(ox, oy, oz, step)) continue;
          /* Round the back of the planet, behind nine thousand units of rock. */
          const ml = Math.hypot(mx, my, mz) || 1;
          if ((mx * vd[0] + my * vd[1] + mz * vd[2]) / ml < horizon) continue;
          const key = `${step}:${cx},${cy},${cz}`;
          if (seen.has(key)) continue;
          seen.add(key);
          found.push({ ox, oy, oz, step, distance: d });
        }
      }
    }
  }

  found.sort((a, b) => a.distance - b.distance);
  /* Spend the budget nearest first. A chunk that does not fit is dropped, not
     drawn coarser: it is already the coarsest its distance allows, and a wrong
     detail level in the middle of the near field would look worse than a gap
     the dust is hiding anyway. */
  const chunks: ChunkRef[] = [];
  let triangles = 0, dropped = 0;
  for (const c of found) {
    const cost = COST_BY_STEP[c.step] ?? 6000;
    if (triangles + cost > budget) { dropped++; continue; }
    triangles += cost;
    chunks.push(c);
  }
  return { chunks, triangles, dropped };
}

/** How much the dust has swallowed something this far off, from 0 to 1. For
 *  the renderer's fade, and for nothing else here. */
export function dustAt(distanceUnits: number): number {
  if (distanceUnits <= DUST_NEAR) return 0;
  if (distanceUnits >= DUST_FAR) return 1;
  return (distanceUnits - DUST_NEAR) / (DUST_FAR - DUST_NEAR);
}
