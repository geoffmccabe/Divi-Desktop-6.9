// The player's ship, the palette it is drawn in, and the constants that tie the
// game to the globe it flies.
//
// There is deliberately NO planet in here. An earlier version built its own
// sphere, its own towers and its own links, which came out looking nothing like
// the Node Map even though it was made from the same data. The map's globe IS
// the world: the game borrows its scene, its towers and its live animations
// through GlobeMap's `flight` hook and only adds a ship.

import * as THREE from "three";

/** Planet radius in globe units. Must match GlobeMap's own R.
 *
 *  The globe stands in for Earth, so one unit is about 64 km and the whole
 *  planet is 628 units around: a mini-globe you can fly right around in about
 *  forty seconds at cruise. That scale is the point of the game. */
export const R = 100;
/** Towers are 3 units tall (your own node's is 6), so the floor sits below
 *  them: you fly BETWEEN the towers, not over their tips. */
export const MIN_ALT = 0.8;
export const MAX_ALT = 30;

/** Latitude and longitude in degrees to a point on a sphere of this radius. */
export function llToVec(lat: number, lon: number, radius: number, out = new THREE.Vector3()): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return out.set(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

/** A theme token, read once at build time, as something THREE can swallow. */
function tokenColor(name: string, fallback: string): THREE.Color {
  /* No document means no theme, which is the case in the headless tests. Fall
     back rather than throw: a colour is not worth failing to start over. */
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
    return new THREE.Color(fallback);
  }
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return new THREE.Color(fallback);
  /* Tokens are stored as bare HSL triplets ("280 80% 60%"), not as colours. */
  const parts = raw.split(/\s+/);
  if (parts.length === 3 && parts[1].endsWith("%")) {
    return new THREE.Color(`hsl(${parts[0]}, ${parts[1]}, ${parts[2]})`);
  }
  try {
    return new THREE.Color(raw);
  } catch {
    return new THREE.Color(fallback);
  }
}

export interface Palette {
  land: THREE.Color;
  grid: THREE.Color;
  ocean: THREE.Color;
  self: THREE.Color;
  peer: THREE.Color;
  net: THREE.Color;
  link: THREE.Color;
  ship: THREE.Color;
  bolt: THREE.Color;
}

export function readPalette(): Palette {
  return {
    land: tokenColor("--rebels-land", "#57e0c0"),
    grid: tokenColor("--rebels-grid", "#2b2068"),
    ocean: tokenColor("--rebels-ocean", "#05040c"),
    self: tokenColor("--rebels-home", "#ffd24a"),
    peer: tokenColor("--accent", "#ff4d9d"),
    net: tokenColor("--primary", "#b45cf5"),
    link: tokenColor("--rebels-link", "#8f6cff"),
    ship: tokenColor("--rebels-ship", "#e6c2ff"),
    bolt: tokenColor("--rebels-bolt", "#c77dff"),
  };
}

/** The player's fighter, as line work so it belongs to the same picture. */
export function buildShip(pal: Palette): THREE.Object3D {
  const seg: number[] = [];
  const line = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) =>
    seg.push(ax, ay, az, bx, by, bz);

  /* Nose forward is -Z, matching the way the camera looks down its own -Z. */
  line(0, 0, -1.6, -0.9, 0, 0.7);
  line(0, 0, -1.6, 0.9, 0, 0.7);
  line(-0.9, 0, 0.7, 0.9, 0, 0.7);
  line(0, 0, -1.6, 0, 0.42, 0.4);
  line(0, 0.42, 0.4, -0.9, 0, 0.7);
  line(0, 0.42, 0.4, 0.9, 0, 0.7);
  /* Wingtip cannons, where the bolts come from. */
  line(-0.9, 0, 0.7, -1.05, 0, -0.5);
  line(0.9, 0, 0.7, 1.05, 0, -0.5);
  /* Engine bar. */
  line(-0.55, 0, 0.72, 0.55, 0, 0.72);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
  const m = new THREE.LineBasicMaterial({ color: pal.ship });
  return new THREE.LineSegments(g, m);
}
