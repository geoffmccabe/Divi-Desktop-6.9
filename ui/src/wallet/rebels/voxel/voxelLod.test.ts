// Spikeworld: the drawing rules, flown.
//
// Run: sh scripts/run-voxel-lod-tests.sh
//
// Two things must hold on every frame of every flight, and one number must
// not creep back up:
//   1. No ground is drawn at two detail levels at once (two surfaces in one
//      place is the flicker).
//   2. No wanted ground is left undrawn once something for it exists: a coarse
//      box never leaves before its replacements are ALL in (that is the hole).
//   3. The blocks that move on screen, per second of flight, stay under the
//      figure measured when the rules were written. Geoff, five releases
//      running: "it's still continuously changing all its blocks."

import { CHUNK, R_OUTER, R_INNER } from "./voxelWorld";
import { parentOf, COST_BY_STEP, DUST_FAR_OPEN } from "./voxelView";
import { CUBE } from "./voxelWorld";
import { LodSet, keyOf } from "./voxelLod";
import { standardLegs, fly, describe } from "./voxelFlight";

let passed = 0, failed = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) passed++; else failed++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

const KEEP_FAR = (DUST_FAR_OPEN / CUBE) * 1.35;

/* ---- the invariants, checked on every frame of a flight ---- */
{
  const boxOf = (c: { ox: number; oy: number; oz: number; step: number }) => {
    const lo = [c.ox * c.step, c.oy * c.step, c.oz * c.step];
    return { lo, hi: [lo[0] + CHUNK * c.step, lo[1] + CHUNK * c.step, lo[2] + CHUNK * c.step] };
  };
  const meets = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) =>
    a.lo[0] < b.hi[0] && b.lo[0] < a.hi[0] && a.lo[1] < b.hi[1] && b.lo[1] < a.hi[1]
    && a.lo[2] < b.hi[2] && b.lo[2] < a.hi[2];

  const lod = new LodSet();
  const mid = (R_OUTER + R_INNER) / 2;
  const from: [number, number, number] = [R_OUTER + 120, 0, 0];
  const to: [number, number, number] = [R_INNER - 40, 0, 0];
  const look: [number, number, number] = [-1, 0, 0];
  const frames = 60 * 30;
  let overlaps = 0, holes = 0, worstOverlap = "";
  for (let f = 0; f < frames; f++) {
    const t = f / frames;
    const eye: [number, number, number] = [from[0] + (to[0] - from[0]) * t, from[1], from[2]];
    const plan = lod.plan(eye, look);
    for (let i = 0; i < Math.min(2, plan.build.length); i++) {
      lod.add(plan.build[i], COST_BY_STEP[plan.build[i].step] ?? 6000);
    }
    lod.resolve(eye, KEEP_FAR);
    for (const k of lod.evictions(eye, 760)) lod.remove(k);
    /* 1. exclusivity, among what is shown */
    const shown = [...lod.live.values()].filter((h) => h.visible).map((h) => h.ref);
    const boxes = shown.map(boxOf);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (shown[i].step !== shown[j].step && meets(boxes[i], boxes[j])) {
          overlaps++;
          if (!worstOverlap) worstOverlap = `frame ${f}: ${keyOf(shown[i])} over ${keyOf(shown[j])}`;
        }
      }
    }
    /* 2. no hole: every wanted chunk that is built is shown, or has a shown
       ancestor standing in for it */
    for (const c of plan.chunks) {
      const held = lod.live.get(keyOf(c));
      if (!held || held.visible) continue;
      let covered = false;
      let up = parentOf(c.ox, c.oy, c.oz, c.step);
      while (up) {
        const a = lod.live.get(keyOf(up));
        if (a && a.visible) { covered = true; break; }
        up = parentOf(up.ox, up.oy, up.oz, up.step);
      }
      if (!covered) holes++;
    }
  }
  void mid;
  ok("no ground is ever drawn at two detail levels on the way in", overlaps === 0,
     overlaps ? `${overlaps} overlapping pairs, first ${worstOverlap}` : `${frames} frames clean`);
  ok("nothing built is hidden with nothing standing in for it", holes === 0, `${holes} holes`);
}

/* ---- a swap is all at once ----
   Build a coarse box, want its eight children, build them one at a time:
   the coarse box stays up and the children stay hidden until the last one
   is in, and then they trade places in one frame. */
{
  const lod = new LodSet();
  const eye: [number, number, number] = [R_OUTER - 40, 0, 0];
  const look: [number, number, number] = [-1, 0, 0];
  /* Fly far enough out that the nearest ground is coarse, build it, then
     come in close and watch the swap. */
  const far: [number, number, number] = [R_OUTER + 300, 0, 0];
  for (let f = 0; f < 400; f++) {
    const plan = lod.plan(far, look);
    for (let i = 0; i < Math.min(3, plan.build.length); i++) lod.add(plan.build[i], COST_BY_STEP[plan.build[i].step] ?? 6000);
    lod.resolve(far, KEEP_FAR);
  }
  const coarseUp = [...lod.live.values()].filter((h) => h.visible && h.ref.step > 1).length;
  ok("from a distance the ground is drawn coarse", coarseUp > 0, `${coarseUp} coarse boxes up`);
  let sawPartial = false, swapFrame = -1, hiddenAtSwap = 0, shownAtSwap = 0;
  for (let f = 0; f < 3000 && swapFrame < 0; f++) {
    const plan = lod.plan(eye, look);
    if (plan.build.length) lod.add(plan.build[0], COST_BY_STEP[plan.build[0].step] ?? 6000);
    const change = lod.resolve(eye, KEEP_FAR);
    /* A frame in which some but not all of a parent's children are shown
       while the parent is also shown would be a partial swap. */
    const byParent = new Map<string, { shown: number; total: number; parentShown: boolean }>();
    for (const h of lod.live.values()) {
      const up = parentOf(h.ref.ox, h.ref.oy, h.ref.oz, h.ref.step);
      if (!up) continue;
      const k = keyOf(up);
      const p = lod.live.get(k);
      const t = byParent.get(k) ?? { shown: 0, total: 0, parentShown: !!p && p.visible };
      t.total++;
      if (h.visible) t.shown++;
      byParent.set(k, t);
    }
    for (const t of byParent.values()) {
      if (t.parentShown && t.shown > 0) sawPartial = true;
    }
    if (change.hidden.length && change.shown.length) {
      swapFrame = f; hiddenAtSwap = change.hidden.length; shownAtSwap = change.shown.length;
    }
  }
  ok("coming close, a coarse box and its fine chunks trade places in one frame",
     swapFrame >= 0 && hiddenAtSwap >= 1 && shownAtSwap >= 2,
     `frame ${swapFrame}: ${hiddenAtSwap} hidden, ${shownAtSwap} shown together`);
  ok("and never while only some of the fine chunks are in", !sawPartial);
}

/* ---- how much the player sees change, flown ----
   Measured when the rules were written (2026-Sep-23, five levels, refine at
   0.6 of the ring): blocks moved per second in view, by leg. A rule change
   that pushes these up is a rule change that makes the planet busier, and
   the test says so before a player does. */
{
  const ceilings: Record<string, number> = {
    arriving: 3.5, tunnel: 2.2, cavity: 11.0, drift: 0.2,
  };
  for (const leg of standardLegs()) {
    const r = fly(leg);
    const key = leg.name.split(":")[0];
    ok(`${leg.name}: blocks moving in view stay under ${ceilings[key]}/s`,
       r.churnPerSecond <= ceilings[key], describe(r));
    ok(`${leg.name}: the allowance refuses nothing`, r.worstDropped === 0, `${r.worstDropped} dropped`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
