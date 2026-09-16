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
 * 400,000, not 120,000. The smaller figure was two thirds of what the live game
 * can carry in Earth orbit, where it shares the frame with ships, shots, coins
 * and effects. Spikeworld is its OWN shard: the fight is not there, Earth is
 * beyond the far plane, and the planet is very nearly the only thing being
 * drawn. A capture of the live game sat at sixty frames a second with 300,000
 * triangles, so this leaves room and buys a planet with no holes in it.
 *
 * And the two frames are not alike in the way that matters. The 200,000 that
 * gave Geoff's Mac trouble was the Earth scene: fifty shader programs, hundreds
 * of draw calls, additive glow over most of the frame. Spikeworld is ONE
 * material, no transparency, no overdraw and about seventy draw calls, which a
 * card eats far more cheaply per triangle.
 *
 * With every level at about 4,600 triangles a chunk this is room for eighty or
 * so, which is what covering the view takes from inside the cavity, where the
 * shell wraps right round you. DFlow will say whether it was too generous.
 */
export const TRIANGLE_BUDGET = 400000;

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

/**
 * Which of the two applies where the viewer is.
 *
 * THICK ONLY IN THE ROCK. It used to thicken by radius alone, on the reasoning
 * that "inside the planet" means "in a tunnel where you cannot see far". That
 * is true of the shell and false of the CAVITY, which is four and a half
 * thousand units of open space with a heart floating in it: from there the far
 * side of the shell is 690 cubes away and the dust was stopping at 300, so
 * half the planet simply was not drawn. Geoff: "when I'm inside the planet, an
 * entire side of the planet is missing."
 *
 * So it is measured from the nearer FACE of the shell rather than from the
 * centre: open at both faces, thick sixty cubes in, fading between so there is
 * no line where the view distance jumps.
 */
export function dustFarFor(radiusCubes: number): number {
  const intoRock = Math.min(radiusCubes - R_INNER, R_OUTER - radiusCubes);
  if (intoRock <= 0) return DUST_FAR_OPEN;              /* cavity, or space */
  const t = Math.min(1, intoRock / 60);
  return DUST_FAR_OPEN + (DUST_FAR - DUST_FAR_OPEN) * t;
}

/**
 * Where each detail level takes over, in CUBES from the viewer.
 *
 * Read off the measurements: a full-detail chunk is about 6,800 triangles, so
 * a couple of dozen of them is most of the budget, and forty-eight cubes is
 * further than a player can see inside a tunnel anyway. The rings are a
 * starting point and the budget overrides them, so getting these wrong costs
 * sharpness and never frame rate.
 *
 * They were wider (64, 160, 380) and the near bands ate the whole allowance,
 * which left the far ones dropped and the planet full of holes.
 */
export const RING_CUBES = [48, 140, 340, 700, 1e9] as const;

/**
 * What a chunk costs, by detail level. MEASURED, and the AVERAGE rather than
 * the 90th percentile.
 *
 * The 90th was the wrong statistic and it cost the planet its horizon. A
 * budget is spent on forty or fifty chunks at once, and a sum that large
 * converges on the average: charging every chunk the 90th percentile
 * overstates the total by nearly half, so the allowance ran out early and the
 * furthest chunks were dropped. The test that compares the REAL total against
 * the allowance is what keeps this honest, and it passes with room to spare.
 *
 * They are all about the same now, and that is the point: growing the clumps
 * with the level means every level is equally clumpy, so a coarse chunk costs
 * what a fine one does and covers eight times the ground. Before, subsampling
 * a fine field made the coarse levels DEARER (14,763 against 6,054), which is
 * backwards and is what the skin trick was papering over.
 */
export const COST_BY_STEP: Record<number, number> = { 1: 4600, 2: 4400, 4: 4500, 8: 4900, 16: 5200 };

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

/** How far out the band for a given detail level reaches, in cubes. */
export function ringFor(step: number): number {
  const i = LOD_STEPS.indexOf(step as (typeof LOD_STEPS)[number]);
  return i < 0 ? RING_CUBES[RING_CUBES.length - 1] : RING_CUBES[i];
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
 * Half the angle of the cone kept in view, in cosine.
 *
 * A frame is about 55 degrees tall and around 75 across the diagonal, so 63
 * degrees off the nose covers it with room to spare. It was 78, which is a
 * 156-degree view and meant paying for a great deal that was never on screen:
 * from inside the cavity that was the difference between drawing the far side
 * of the shell and dropping it.
 *
 * Turning is safe at this angle because a chunk already up STAYS up whatever
 * the angle (see the hysteresis in voxelPlanet): the cone decides what is worth
 * building, never what is worth hiding.
 */
const LOOK_COS = 0.45;

/**
 * Which chunks to draw, from where the viewer is.
 *
 * `viewer` is in CUBES. The result is ordered nearest first, which is both what
 * the budget wants and the order a renderer should build them in.
 */
export function visibleChunks(
  viewer: readonly [number, number, number],
  opts: {
    budget?: number; dustFar?: number;
    /**
     * Which way the eye is looking, as a unit vector. When given, the budget is
     * only spent on chunks that could be ON SCREEN.
     *
     * Without it the allowance was going on chunks behind the ship, which the
     * renderer then culled anyway: from inside the cavity the shell wraps right
     * round you, so more than half of everything in range was being paid for
     * and never drawn, and what was actually in front went without.
     */
    look?: readonly [number, number, number];
  } = {},
): ViewResult {
  const budget = opts.budget ?? TRIANGLE_BUDGET;
  const look = opts.look;
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
          /* On screen, or near enough to it. A chunk is a box, so its own
             angular size is allowed for: one close enough to fill the view is
             kept even when its middle is off to the side. */
          if (look && d > 1e-3) {
            const half = cell * 0.87;
            const cos = ((mx - viewer[0]) * look[0] + (my - viewer[1]) * look[1]
              + (mz - viewer[2]) * look[2]) / d;
            /* sin of the chunk's angular radius, near enough for a margin. */
            const slack = Math.min(0.95, half / d);
            if (cos < LOOK_COS - slack) continue;
          }
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

/**
 * How much the dust has swallowed something this far off, from 0 to 1. For the
 * renderer's fade, and for nothing else here.
 *
 * `far` is how far the dust reaches WHERE THE VIEWER IS, which is not one
 * number: dustFarFor gives 9,000 units out in the open and 2,700 deep in the
 * rock. Fading everything out by 2,700 regardless would have hidden the whole
 * planet from anyone approaching it, which is the same fault dustFarFor was
 * written to fix; the two have to be given the same answer or the fade and the
 * view distance disagree.
 */
export function dustAt(distanceUnits: number, far = DUST_FAR): number {
  /* The clear part keeps its proportion when the dust closes in, and never
     grows past the 1,400 units it is out in the open. */
  const near = Math.min(DUST_NEAR, far * (DUST_NEAR / DUST_FAR));
  if (distanceUnits <= near) return 0;
  if (distanceUnits >= far) return 1;
  return (distanceUnits - near) / (far - near);
}
