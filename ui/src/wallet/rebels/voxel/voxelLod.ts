// Spikeworld: which chunks are drawn, at which detail, and when they change.
//
// Pure bookkeeping, no three.js, so the rules can be flown in a test. This is
// the part of the planet that decides what the player SEES CHANGE, and every
// version of it before this one was judged by eye and by counting chunks.
// Geoff, over five releases: "it's still continuously changing all its
// blocks". So the rules live here, on their own, where a simulated flight can
// count the changes on screen and a test can refuse a regression.
//
// THE RULES
// ---------
// The view (voxelView) says which boxes it wants, one detail level per piece
// of ground. This module owns what is BUILT and what is SHOWN, and they are
// not the same thing:
//
//  1. Once shown, a chunk stays shown until it is far past the dust or until
//     something else is drawing its ground. Falling off the wanted list is
//     never on its own a reason to hide rock.
//  2. A coarse box is replaced by its finer boxes ALL AT ONCE. The fine ones
//     are built hidden, and in the frame the last of them arrives the coarse
//     one goes and they all appear. Before this, each fine chunk appeared as
//     it was built over the top of the coarse one (a shimmer of two surfaces
//     for a second), or the coarse one went first (holes). Neither is a
//     planet holding still.
//  3. The other way round is the same rule: fine chunks give way to a coarse
//     box only once that box is built, in the frame it is.
//  4. When a lot of ground is missing, the box one level up is built first
//     and shown as a stand-in while the fine ones come in behind it, hidden.
//
// Detail decisions themselves (split or merge, and the wide band in between
// where a box keeps whatever level it has) are voxelView's; this module tells
// it what is on screen so it can hold still.

import { CHUNK } from "./voxelWorld";
import { visibleChunks, parentOf, type ChunkRef } from "./voxelView";

export const keyOf = (c: { ox: number; oy: number; oz: number; step: number }): string =>
  `${c.step}:${c.ox},${c.oy},${c.oz}`;

export interface LodEntry {
  ref: ChunkRef;
  visible: boolean;
  /** Real triangle count once built. */
  triangles: number;
}

export interface Plan {
  /** What to build, in order: stand-ins first, then the nearest missing. */
  build: ChunkRef[];
  /** What the view asked for this frame. */
  wanted: Set<string>;
  /** The view's own estimate and refusals, for the stats. */
  triangles: number;
  dropped: number;
  chunks: ChunkRef[];
}

/** Below this many missing chunks the fine ones are simply built; above it
 *  the coarse box goes up first so there is never a hole. */
const STAND_IN_FROM = 4;

/**
 * The set of chunks that exist, and the rules for showing them.
 */
export class LodSet {
  readonly live = new Map<string, LodEntry>();
  /** Every box that has finer detail ON SCREEN beneath it. Rebuilt per plan. */
  private finerDrawn = new Set<string>();
  /** Why chunks stopped being drawn, by reason, since the start. */
  readonly gone: Record<string, number> = {};
  private lastWanted = new Set<string>();
  private lastChunks: ChunkRef[] = [];

  /** Ask the view what it wants from here, and say what to build. */
  plan(eye: readonly [number, number, number], look: readonly [number, number, number]): Plan {
    const finerDrawn = this.finerDrawn;
    finerDrawn.clear();
    for (const held of this.live.values()) {
      if (!held.visible) continue;
      const c = held.ref;
      let up = parentOf(c.ox, c.oy, c.oz, c.step);
      while (up) {
        finerDrawn.add(keyOf(up));
        up = parentOf(up.ox, up.oy, up.oz, up.step);
      }
    }
    const view = visibleChunks(eye, {
      look,
      costOf: (ox, oy, oz, step) => this.live.get(`${step}:${ox},${oy},${oz}`)?.triangles,
      lodHold: (ox, oy, oz, step) => {
        const k = `${step}:${ox},${oy},${oz}`;
        const held = this.live.get(k);
        if (held && held.visible) return true;
        if (finerDrawn.has(k)) return false;
        return undefined;
      },
    });
    const wanted = new Set(view.chunks.map(keyOf));
    this.lastWanted = wanted;
    this.lastChunks = view.chunks;

    const missing = view.chunks.filter((c) => !this.live.has(keyOf(c)));
    const standIns: ChunkRef[] = [];
    if (missing.length > STAND_IN_FROM) {
      const asked = new Set<string>();
      for (const c of missing) {
        const up = parentOf(c.ox, c.oy, c.oz, c.step);
        if (!up) continue;
        const k = keyOf(up);
        if (this.live.has(k) || asked.has(k) || finerDrawn.has(k)) continue;
        asked.add(k);
        standIns.push({ ...up, distance: c.distance });
      }
    }
    return { build: [...standIns, ...missing], wanted, triangles: view.triangles, dropped: view.dropped, chunks: view.chunks };
  }

  /** A chunk has been built. It starts hidden; `resolve` decides. */
  add(ref: ChunkRef, triangles: number): void {
    this.live.set(keyOf(ref), { ref, visible: false, triangles });
  }

  remove(key: string): void {
    const held = this.live.get(key);
    if (!held) return;
    if (held.visible) this.gone.evicted = (this.gone.evicted ?? 0) + 1;
    this.live.delete(key);
  }

  /**
   * Decide what is shown, after this frame's building. Returns the keys whose
   * visibility changed, so the renderer can apply exactly those.
   */
  resolve(eye: readonly [number, number, number], keepFar: number): { shown: string[]; hidden: string[] } {
    const wanted = this.lastWanted;
    const live = this.live;
    /* Every box above a wanted chunk, with how many of its wanted descendants
       are built. A box is REPLACED once all of them are. */
    const under = new Map<string, { wanted: number; built: number }>();
    for (const c of this.lastChunks) {
      const here = live.has(keyOf(c)) ? 1 : 0;
      let up = parentOf(c.ox, c.oy, c.oz, c.step);
      while (up) {
        const k = keyOf(up);
        const t = under.get(k) ?? { wanted: 0, built: 0 };
        t.wanted++;
        t.built += here;
        under.set(k, t);
        up = parentOf(up.ox, up.oy, up.oz, up.step);
      }
    }
    const replaced = (k: string): boolean => {
      const t = under.get(k);
      return !!t && t.built === t.wanted;
    };
    /* A live box that is COVERING ground this frame: it is wanted itself, or
       it stands above wanted chunks that are not all built yet, or it is an
       old stand-in still up with nothing having replaced it. Anything finer
       beneath a covering box stays hidden. */
    const covering = (k: string): boolean => {
      const held = live.get(k);
      if (!held) return false;
      if (wanted.has(k)) return true;
      const t = under.get(k);
      if (t) return t.built < t.wanted;
      return held.visible;
    };
    const hasCoveringAncestor = (c: ChunkRef): boolean => {
      let up = parentOf(c.ox, c.oy, c.oz, c.step);
      while (up) {
        if (covering(keyOf(up))) return true;
        up = parentOf(up.ox, up.oy, up.oz, up.step);
      }
      return false;
    };

    const next = new Map<string, { visible: boolean; why: string }>();
    for (const [key, held] of live) {
      const c = held.ref;
      const d = Math.hypot(
        (c.ox + CHUNK / 2) * c.step - eye[0],
        (c.oy + CHUNK / 2) * c.step - eye[1],
        (c.oz + CHUNK / 2) * c.step - eye[2],
      );
      let visible: boolean;
      let why = "";
      if (d > keepFar) {
        visible = false; why = "dust";
      } else if (hasCoveringAncestor(c)) {
        visible = false; why = wanted.has(key) ? "waiting" : "coarser";
      } else if (wanted.has(key)) {
        visible = true;
      } else if (replaced(key)) {
        visible = false; why = "replaced";
      } else if (held.visible || under.has(key)) {
        /* Up already (it stays up: hysteresis), or standing in for wanted
           chunks that are not all built yet. */
        visible = true;
      } else {
        /* Nobody wants it and it is not on screen. It does NOT come back on
           its own: the flown test caught a coarse box, replaced and hidden,
           reappearing over its own fine chunks the moment the ship moved on
           and neither was wanted any more. */
        visible = false; why = "unwanted";
      }
      next.set(key, { visible, why });
    }
    const shown: string[] = [];
    const hidden: string[] = [];
    for (const [key, held] of live) {
      const n = next.get(key)!;
      if (n.visible === held.visible) continue;
      held.visible = n.visible;
      if (n.visible) shown.push(key);
      else {
        hidden.push(key);
        this.gone[n.why] = (this.gone[n.why] ?? 0) + 1;
      }
    }
    return { shown, hidden };
  }

  /**
   * Which chunks to throw away to get under `cap`: the furthest hidden ones
   * first, and only then the furthest shown ones that are not wanted.
   */
  evictions(eye: readonly [number, number, number], cap: number): string[] {
    if (this.live.size <= cap) return [];
    const wanted = this.lastWanted;
    const dist = (c: ChunkRef) => Math.hypot(
      (c.ox + CHUNK / 2) * c.step - eye[0],
      (c.oy + CHUNK / 2) * c.step - eye[1],
      (c.oz + CHUNK / 2) * c.step - eye[2],
    );
    const hiddenFar: Array<{ key: string; d: number }> = [];
    const shownFar: Array<{ key: string; d: number }> = [];
    for (const [key, held] of this.live) {
      if (wanted.has(key)) continue;
      (held.visible ? shownFar : hiddenFar).push({ key, d: dist(held.ref) });
    }
    hiddenFar.sort((a, b) => b.d - a.d);
    shownFar.sort((a, b) => b.d - a.d);
    const out: string[] = [];
    let size = this.live.size;
    for (const f of [...hiddenFar, ...shownFar]) {
      if (size <= cap) break;
      out.push(f.key);
      size--;
    }
    return out;
  }

  shownCount(): number {
    let n = 0;
    for (const h of this.live.values()) if (h.visible) n++;
    return n;
  }
}
