// Spikeworld: fly the rules and count what the player would see change.
//
// The planet was judged by eye for five releases and each time the eye said
// "still changing". This flies a ship along a fixed path at the game's real
// speeds, builds chunks at the real rate (one a frame), runs the same
// bookkeeping the renderer runs (voxelLod), and counts every chunk that
// appears or disappears INSIDE THE VIEW CONE, weighted by how big it is on
// screen. The number a test can hold, and the number a change can be judged by
// before it ships.

import { CHUNK, CUBE, R_OUTER, R_INNER, LOD_STEPS } from "./voxelWorld";
import { COST_BY_STEP, DUST_FAR_OPEN } from "./voxelView";
import { LodSet, type Plan } from "./voxelLod";

/** Ship speeds at Spikeworld, in cubes a second: cruise and boost. Cruise is
 *  8 units a second times the open-space factor of ten, in nine-unit cubes. */
export const CRUISE_CUBES = 80 / CUBE;
export const BOOST_CUBES = 190 / CUBE;
const FPS = 60;
/** Chunks built per frame: the renderer always builds at least one and
 *  seldom more in steady flight. */
const BUILT_PER_FRAME = 1;
/** Half-angle of the frame kept in view, cosine (about 63 degrees). */
const LOOK_COS = 0.45;
const KEEP_FAR = (DUST_FAR_OPEN / CUBE) * 1.35;

export interface FlightResult {
  seconds: number;
  /** Chunks that appeared or disappeared inside the view cone. */
  events: number;
  eventsPerSecond: number;
  /** Pops: coarse boxes that gave way in view (a refinement) or fine ones
   *  that gave way to a coarse box (a merge). What the eye counts. */
  pops: number;
  /** Pops weighted by how big the BLOCKS that moved were on screen: the
   *  coarser side's block edge over the distance. Per second. */
  churnPerSecond: number;
  /** The biggest block that moved in view, as block edge over distance. */
  worstApparent: number;
  /** The most triangles the view asked for in one frame, by its estimate. */
  peakTriangles: number;
  /** How many seconds had at least one change in view. */
  busySeconds: number;
  /** Chunks the budget refused at the worst moment. */
  worstDropped: number;
  built: number;
}

export interface Leg {
  name: string;
  from: [number, number, number];
  to: [number, number, number];
  speed: number;
}

/** The legs a player actually flies. */
export function standardLegs(): Leg[] {
  const mid = (R_OUTER + R_INNER) / 2;
  return [
    { name: "arriving: sky to surface, nose down", from: [R_OUTER + 140, 0, 0], to: [R_OUTER + 12, 0, 0], speed: CRUISE_CUBES },
    { name: "tunnel: through the shell, 20 s", from: [mid, -90, 0], to: [mid, 90, 0], speed: CRUISE_CUBES },
    { name: "cavity: across, boosting", from: [R_INNER - 15, 0, 0], to: [-(R_INNER - 15), 0, 0], speed: BOOST_CUBES },
    { name: "drift: hovering near a wall", from: [R_OUTER - 40, 0, 0], to: [R_OUTER - 40, 14, 0], speed: 1.4 },
  ];
}

function apparent(c: { ox: number; oy: number; oz: number; step: number }, eye: readonly [number, number, number]): { size: number; inView: (look: readonly [number, number, number]) => boolean } {
  const mx = (c.ox + CHUNK / 2) * c.step - eye[0];
  const my = (c.oy + CHUNK / 2) * c.step - eye[1];
  const mz = (c.oz + CHUNK / 2) * c.step - eye[2];
  const d = Math.hypot(mx, my, mz) || 1e-6;
  return {
    size: (CHUNK * c.step) / d,
    inView: (look) => (mx * look[0] + my * look[1] + mz * look[2]) / d > LOOK_COS,
  };
}

/** Fly one leg. `settle` seconds are flown first, standing still, so the
 *  planet is built before counting begins: arrival is its own leg. */
export function fly(leg: Leg, settleSeconds = 6): FlightResult {
  const lod = new LodSet();
  const dir = [leg.to[0] - leg.from[0], leg.to[1] - leg.from[1], leg.to[2] - leg.from[2]];
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const look: [number, number, number] = [dir[0] / len, dir[1] / len, dir[2] / len];
  const frames = Math.ceil((len / leg.speed) * FPS);
  const settle = Math.round(settleSeconds * FPS);
  let events = 0, pops = 0, churn = 0, worst = 0, worstDropped = 0, built = 0, peak = 0;
  const busy = new Set<number>();
  const refs = new Map<string, { ox: number; oy: number; oz: number; step: number }>();
  const eye: [number, number, number] = [...leg.from];
  for (let f = -settle; f < frames; f++) {
    if (f >= 0) {
      const t = f / frames;
      eye[0] = leg.from[0] + dir[0] * t;
      eye[1] = leg.from[1] + dir[1] * t;
      eye[2] = leg.from[2] + dir[2] * t;
    }
    const plan: Plan = lod.plan(eye, look);
    for (let i = 0; i < Math.min(BUILT_PER_FRAME, plan.build.length); i++) {
      const c = plan.build[i];
      lod.add(c, COST_BY_STEP[c.step] ?? 6000);
      refs.set(`${c.step}:${c.ox},${c.oy},${c.oz}`, c);
      built++;
    }
    const change = lod.resolve(eye, KEEP_FAR);
    for (const k of lod.evictions(eye, 760)) lod.remove(k);
    if (f < 0) continue;
    worstDropped = Math.max(worstDropped, plan.dropped);
    peak = Math.max(peak, plan.triangles);
    for (const k of [...change.shown, ...change.hidden]) {
      const c = refs.get(k);
      if (!c) continue;
      const a = apparent(c, eye);
      if (!a.inView(look)) continue;
      events++;
      busy.add(Math.floor(f / FPS));
    }
    /* A pop is something that GAVE WAY: the block size that moved is the
       coarser side's, whichever direction the swap went. */
    for (const k of change.hidden) {
      const c = refs.get(k);
      if (!c) continue;
      const a = apparent(c, eye);
      if (!a.inView(look)) continue;
      const coarser = Math.max(c.step, c.step === 1 ? 2 : c.step);
      const block = a.size * (coarser / (CHUNK * c.step)) * CHUNK;
      pops++;
      churn += block;
      worst = Math.max(worst, block);
    }
  }
  const seconds = frames / FPS;
  return {
    seconds, events, eventsPerSecond: events / seconds, pops, churnPerSecond: churn / seconds,
    worstApparent: worst, peakTriangles: peak, busySeconds: busy.size, worstDropped, built,
  };
}

export function describe(r: FlightResult): string {
  return `${r.seconds.toFixed(0)}s: ${r.pops} pops in view, blocks moved ${r.churnPerSecond.toFixed(3)}/s, `
    + `biggest ${r.worstApparent.toFixed(3)}, ${r.busySeconds} busy s, ${r.built} built, `
    + `peak ${Math.round(r.peakTriangles / 1000)}k tris, dropped ${r.worstDropped}`;
}

/** For the report: the levels in play. */
export const LEVELS = LOD_STEPS.length;
