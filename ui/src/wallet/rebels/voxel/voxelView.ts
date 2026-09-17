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
 *
 * BACK DOWN TO 900,000. Holding the level steady around a boundary turned out
 * to cost LESS as well as flicker less: defaulting to the coarse answer where
 * nothing has been drawn yet takes the worst viewpoint from 1.27 million real
 * triangles to 705,000. The allowance sits above that because a chunk not yet
 * built is charged an average that runs high.
 *
 * The note below is kept because the reasoning still holds; only the number
 * moved. It read:
 *
 * RAISED AGAIN, to 560,000, when the detail levels were made exclusive. What
 * the allowance buys is not this number: a chunk not yet built is charged the
 * average, 4,600, and the REAL total for the worst viewpoint, measured by
 * meshing every chunk it asks for, is 443,000. The estimate runs about a
 * quarter high, so the allowance has to stand a quarter above what is really
 * wanted or the last chunks are refused and the planet has holes in it again.
 * The capture that prompted all this drew 378,000 triangles and spent three
 * milliseconds a frame doing it, so there is room.
 */
/* ---- RAISED TO 1.35 MILLION, AND WHAT IT BOUGHT ----
   Three times what it was, and it is a trade made with eyes open.

   The detail levels used to be different noise fields, which made them cheap
   (a coarse chunk merged into few big rectangles) and made every crossing
   between them replace 74% to 179% of a chunk's cubes with different ones.
   That is the popping, and it is the thing Geoff has reported in four
   successive versions.

   Making the levels ONE field fixes the shape - 25 to 29% changes at the first
   boundary instead of 130%, and the fill holds at 17-25% everywhere instead of
   swinging from 37% to nothing - and the price is that a coarse level samples
   ten-cube clumps every eight cubes, so much less merges. Measured over five
   viewpoints, the worst wants 1.27 million triangles where it used to want
   443,000. Declining to draw cubes standing entirely alone (see deSpeckle)
   gives 8% of that back and no more: the cost is small clusters, not specks.

   So the allowance covers it rather than refusing chunks, because a refused
   chunk is a hole and a hole is worse. About half of what is admitted is
   culled by the frustum before it is drawn, and the capture this came from
   drew 378,000 triangles in 3ms of a frame with the machine 62% idle, so there
   is headroom. DFlow will say whether there is enough. If not, the dial to
   turn is the rings, not this number: pulling them in costs sharpness, and
   refusing chunks costs the planet.
*/
export const TRIANGLE_BUDGET = 1050000;

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
 *
 * TIGHTENED AGAIN when the detail levels were made exclusive. The old numbers
 * were tuned against a scheme that drew some ground twice and skipped other
 * ground entirely; asking an octree for that much fine detail wants 758,000
 * triangles at the worst viewpoint, which is nearly twice the allowance, and
 * an allowance that runs out is a planet with holes in it. Measured over five
 * viewpoints, these want 443,000 at the worst and refuse twenty chunks;
 * tightening them further saves nothing, because what is left is the far side
 * of the shell seen across the cavity and it has to be drawn at SOME level.
 */
export const RING_CUBES = [36, 96, 230, 520, 1e9] as const;

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
export const COST_BY_STEP: Record<number, number> = {
  1: 4800, 2: 7500, 4: 12800, 8: 13600, 16: 10000,
};

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
 * The band around a detail boundary in which the decision holds still.
 *
 * Split only when clearly inside it, merge only when clearly outside it, and
 * in between keep drawing whatever is already drawn. VERY wide, and measured
 * rather than chosen: on a forty-cube drift the chunks that came and went more
 * than twice fell from 79 to 16 as the band widened, and the total appearances
 * and disappearances from 546 to 178.
 *
 * With one asymmetry that matters as much as the width. Inside the band, if
 * NOTHING has been drawn for this ground yet, the coarse answer wins. A band
 * that defaulted the other way kept fine chunks alive far out and cost 2.45
 * million triangles for the same steadiness; defaulting coarse costs 705,000,
 * which is less than the scheme it replaces.
 */
const SPLIT_IN = 0.35;
const SPLIT_OUT = 2.8;

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
    look?: readonly [number, number, number];
    costOf?: (ox: number, oy: number, oz: number, step: number) => number | undefined;
    /**
     * What is being DRAWN for this box's ground right now?
     *
     * `true` when this very box is on screen, `false` when something finer is,
     * and undefined when neither: nothing here has been drawn yet. Asked only
     * inside the band where the decision is a close call, and it is what stops
     * a box changing its mind over and over. See SPLIT_IN below.
     */
    lodHold?: (ox: number, oy: number, oz: number, step: number) => boolean | undefined;
  } = {},
): ViewResult {
  const budget = opts.budget ?? TRIANGLE_BUDGET;
  const look = opts.look;
  const vr = Math.hypot(viewer[0], viewer[1], viewer[2]);
  const dustFarCubes = (opts.dustFar ?? dustFarFor(vr)) / CUBE;
  const outside = vr > R_OUTER;
  const vd = vr > 1e-6 ? [viewer[0] / vr, viewer[1] / vr, viewer[2] / vr] : [1, 0, 0];
  const horizon = outside ? Math.min(0.999, R_OUTER / vr) - 0.1 : -1.1;

  const found: ChunkRef[] = [];

  /**
   * ---- ONE PIECE OF GROUND, ONE DETAIL LEVEL ----
   *
   * This used to walk each detail level separately and keep the chunks whose
   * MIDDLE fell in that level's band of distances. The levels nest exactly (a
   * step-2 box is eight step-1 boxes), but their middles do not, so at every
   * band boundary a coarse chunk and the fine chunks inside it both passed
   * their own test and BOTH were drawn. Measured from inside the cavity: 32 of
   * 80 chunks overlapped another level, and 5 to 6.5% of the covered ground
   * carried two surfaces.
   *
   * That one fault produced every symptom Geoff reported at once. Two surfaces
   * in almost the same place fight over which is in front, which is the
   * flicker. The coarse one is a blurred copy of the fine one, so it fills in
   * the holes the fine one has: "mainly purely solid without any texture of
   * small caverns". And as the ship moves, one or the other leaves the list,
   * which is "big chunks of cubes appearing and disappearing, leaving giant
   * holes".
   *
   * So it walks DOWNWARDS instead, which is what the nesting was asking for.
   * Start with boxes big enough to hold the planet; throw away any box that is
   * out of range, out of the dust, round the back or empty; and split what is
   * left into eight only when it is near enough to deserve finer detail. A box
   * that is emitted is never split, so no two chunks can ever cover the same
   * ground. Throwing away a coarse box throws away everything inside it too,
   * which makes this quicker as well as right.
   */
  const deepest = LOD_STEPS[LOD_STEPS.length - 1];
  const visit = (ox: number, oy: number, oz: number, step: number): void => {
    const cell = CHUNK * step;
    const lo = [ox * step, oy * step, oz * step];
    const hi = [lo[0] + cell, lo[1] + cell, lo[2] + cell];
    /* Nearest point and middle, both wanted: the nearest decides range and how
       fine it should be, the middle is what the budget orders by. */
    let near2 = 0;
    for (let a = 0; a < 3; a++) {
      const gap = viewer[a] < lo[a] ? lo[a] - viewer[a] : (viewer[a] > hi[a] ? viewer[a] - hi[a] : 0);
      near2 += gap * gap;
    }
    const near = Math.sqrt(near2);
    if (near > dustFarCubes) return;                       /* lost in the dust */
    if (!mightHoldRock(ox, oy, oz, step)) return;          /* nothing in it */

    const mx = (lo[0] + hi[0]) / 2, my = (lo[1] + hi[1]) / 2, mz = (lo[2] + hi[2]) / 2;
    /* Round the back of the planet, with the box's own size allowed for so one
       straddling the limb is kept. */
    const ml = Math.hypot(mx, my, mz) || 1;
    const cosBack = (mx * vd[0] + my * vd[1] + mz * vd[2]) / ml;
    if (cosBack + Math.min(0.9, (cell * 0.87) / ml) < horizon) return;

    /* On screen, or near enough to it. */
    const d = Math.hypot(mx - viewer[0], my - viewer[1], mz - viewer[2]);
    if (look && d > 1e-3) {
      const cos = ((mx - viewer[0]) * look[0] + (my - viewer[1]) * look[1]
        + (mz - viewer[2]) * look[2]) / d;
      if (cos < LOOK_COS - Math.min(0.95, (cell * 0.87) / d)) return;
    }

    /* ---- FINE ENOUGH? AND, ONCE DECIDED, STICK TO IT ----
       This was a bare comparison: split if nearer than the inner edge of the
       level's band. No hysteresis at all, and that is the fault behind the
       thing Geoff could not believe anyone would write on purpose: "often the
       same groups of blocks appear and disappear multiple times ... it makes no
       sense that you would code the blocks to appear and disappear over and
       over all over the place."

       Quite right, and here is how it happens. A box whose nearest corner sits
       near that distance crosses it every time the ship drifts a little, and
       the two levels DRAW DIFFERENT ROCK - 28% of the cubes change at the first
       boundary, more at the others. So the box changes its mind, the rock
       rearranges, the ship drifts back, and it rearranges again. Measured on a
       gentle fourteen-cube drift: sixteen boxes changed level four times each
       in twenty seconds. In real flight the ship moves every way at once and
       dozens of boxes are near a boundary at any moment, which is why it is
       everywhere.

       There are four boundaries and a box can be near any of them, so the cure
       has to be at the decision: once a piece of ground is being drawn at a
       level, it KEEPS that level until the ship has moved decisively past the
       distance, not merely across it. */
    const i = LOD_STEPS.indexOf(step as (typeof LOD_STEPS)[number]);
    const splitAt = i > 0 ? RING_CUBES[i - 1] : -1;
    let wantSplit = false;
    if (step > 1) {
      if (near < splitAt * SPLIT_IN) wantSplit = true;
      else if (near > splitAt * SPLIT_OUT) wantSplit = false;
      /* In between, whatever is already being drawn stays, and if NOTHING is
         yet drawn here the coarse answer wins. That asymmetry matters: a band
         that defaulted to splitting kept fine chunks alive far out and cost
         twice the triangles for the same steadiness. */
      else wantSplit = opts.lodHold?.(ox, oy, oz, step) === false;
    }
    if (wantSplit) {
      /* ---- SPLIT BY THE REAL RATIO BETWEEN LEVELS ----
         This used to halve the step and produce eight children, which is right
         only when the levels are a factor of two apart. They are a factor of
         FOUR apart now, and halving quietly invented levels 8 and 2 that are
         not levels at all: LOD_STEPS.indexOf gave -1 for them, the ring lookup
         read past the end of the array, and they were emitted anyway. The
         planet drew itself at detail levels nobody had chosen. */
      const child = LOD_STEPS[i - 1];
      const ratio = step / child;
      const span = CHUNK / ratio;
      for (let a = 0; a < ratio; a++) {
        for (let b = 0; b < ratio; b++) {
          for (let c = 0; c < ratio; c++) {
            visit((ox + a * span) * ratio, (oy + b * span) * ratio, (oz + c * span) * ratio, child);
          }
        }
      }
      return;
    }
    found.push({ ox, oy, oz, step, distance: d });
  };

  /* The roots: boxes at the coarsest level, meeting at the centre, enough of
     them between them to hold the whole planet. */
  const rootCells = Math.ceil(R_OUTER / (CHUNK * deepest));
  /* Every emitted box must be one of the chosen levels: nothing invents one. */
  for (let cx = -rootCells; cx < rootCells; cx++) {
    for (let cy = -rootCells; cy < rootCells; cy++) {
      for (let cz = -rootCells; cz < rootCells; cz++) {
        visit(cx * CHUNK, cy * CHUNK, cz * CHUNK, deepest);
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
    const known = opts.costOf?.(c.ox, c.oy, c.oz, c.step);
    const cost = known ?? COST_BY_STEP[c.step] ?? 6000;
    if (triangles + cost > budget) { dropped++; continue; }
    triangles += cost;
    chunks.push(c);
  }
  return { chunks, triangles, dropped };
}

/**
 * The box one level up that contains this one, or null at the coarsest level.
 *
 * The levels nest exactly: a step-2S box is eight step-S boxes. Whoever holds
 * the built meshes needs this to keep the drawing exclusive, because a chunk it
 * is still showing out of hysteresis has to give way the moment another level
 * covering the same ground is asked for.
 */
export function parentOf(ox: number, oy: number, oz: number, step: number):
{ ox: number; oy: number; oz: number; step: number } | null {
  const i = LOD_STEPS.indexOf(step as (typeof LOD_STEPS)[number]);
  if (i < 0 || i >= LOD_STEPS.length - 1) return null;
  const parent = LOD_STEPS[i + 1];
  const ratio = parent / step;
  const up = (v: number) => CHUNK * Math.floor(v / (ratio * CHUNK));
  return { ox: up(ox), oy: up(oy), oz: up(oz), step: parent };
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
