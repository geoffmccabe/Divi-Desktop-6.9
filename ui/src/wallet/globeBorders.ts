// Country outlines on the globe.
//
// The flat map has had these all along, drawn from worldmap.json; the globe
// never has. Geoff asked for the detailed map to keep "the country lines like
// they are", and the honest answer was that on the globe there were none to
// keep, so here they are, from the same 279 outlines the flat map uses and in
// the same colour, so the two views finally agree with each other.
//
// LINES, NOT PAINT
// ----------------
// They could have been drawn into the map's picture, which is what most globes
// do. They are real geometry instead, and that is the whole point: painted
// borders are exactly as blurry as everything else in the picture, and get
// blurrier the closer you fly. These are lines, so they are one pixel wide at
// any height, and stay crisp at the altitude where the old map fell apart.
// They also survive a change of imagery, because they are not part of it.

import * as THREE from "three";
import worldmap from "../assets/worldmap.json";

const POLYS: number[][][] = (worldmap as { polys: number[][][] }).polys;

/** How far above the surface, as a fraction of the globe's radius. Enough to
 *  clear the detail patch, which sits a little above the globe itself. */
const LIFT = 0.0012;
/**
 * The longest a single straight segment may be, in degrees.
 *
 * Outlines are stored as points that were only ever meant to be joined by
 * straight lines on a FLAT map, and some of them are a long way apart. Drawn
 * straight on a sphere those chords cut through the ground and disappear into
 * it. So anything long is split, and each piece put back on the surface.
 */
const MAX_STEP = 2.0;

export interface Borders {
  object: THREE.LineSegments;
  setColour(css: string, opacity: number): void;
  dispose(): void;
}

export function createBorders(
  coords: (lat: number, lng: number, alt: number) => { x: number; y: number; z: number },
): Borders {
  const pts: number[] = [];
  const push = (lat: number, lon: number) => {
    const p = coords(lat, lon, LIFT);
    pts.push(p.x, p.y, p.z);
  };

  for (const ring of POLYS) {
    for (let i = 0; i < ring.length; i++) {
      const [lon0, lat0] = ring[i];
      const [lon1, lat1] = ring[(i + 1) % ring.length];
      /* A ring wraps at the date line as a jump most of the way round the
         world. Joining those two points would draw a line straight across the
         Pacific through every country in between. */
      if (Math.abs(lon1 - lon0) > 180) continue;
      const span = Math.max(Math.abs(lon1 - lon0), Math.abs(lat1 - lat0));
      const steps = Math.max(1, Math.ceil(span / MAX_STEP));
      for (let s = 0; s < steps; s++) {
        const a = s / steps;
        const b = (s + 1) / steps;
        push(lat0 + (lat1 - lat0) * a, lon0 + (lon1 - lon0) * a);
        push(lat0 + (lat1 - lat0) * b, lon0 + (lon1 - lon0) * b);
      }
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({
    transparent: true, opacity: 0.18, depthWrite: false,
  });
  const object = new THREE.LineSegments(geom, mat);
  object.renderOrder = 2;
  /* One object covering the whole planet, so culling it as a whole is either
     pointless or wrong. */
  object.frustumCulled = false;

  return {
    object,
    setColour(css, opacity) {
      mat.color.set(css);
      mat.opacity = opacity;
      mat.needsUpdate = true;
    },
    dispose() {
      geom.dispose();
      mat.dispose();
    },
  };
}

/** How many segments the outlines come to. Exposed for the tests, which care
 *  that the date line is not crossed and that long chords were split. */
export function borderStats(): { rings: number; points: number } {
  return { rings: POLYS.length, points: POLYS.reduce((n, r) => n + r.length, 0) };
}
