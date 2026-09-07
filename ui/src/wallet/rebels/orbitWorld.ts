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
/* ---- the other worlds ----
   Geoff's layout, in his words: the first planet is 20% of Earth's diameter
   and five Earth diameters away, the next is 30% and six diameters, and each
   one after that is ten percent bigger and one diameter further out. Fourteen
   of them, which is exactly how many the Synty pack has.

   Written as functions rather than a table because the ceiling below is
   derived from them. Getting those two out of step is not a subtle bug: it is
   planets you can see and can never reach. */
export const PLANET_COUNT = 14;
/** An Earth diameter, which is the unit Geoff specified everything in. */
export const EARTH_D = R * 2;

/** How wide planet n is, for n from 1 to 14. 20% of Earth up to 150%. */
export function planetDiameter(n: number): number {
  return EARTH_D * (0.1 + 0.1 * n);
}

/** How far planet n sits from Earth's centre. Five Earth diameters up to 18. */
export function planetDistance(n: number): number {
  return EARTH_D * (4 + n);
}

/** The edge of the sky.
 *
 *  It used to be thirty units, which on a hundred-unit planet is a ceiling you
 *  can touch in three seconds: Geoff described it exactly, an invisible ceiling
 *  he could not fly through and no way to get out to space.
 *
 *  It is now set from the planets rather than picked, because the outermost one
 *  is 3,600 units out and a ceiling short of that would mean fourteen worlds
 *  hanging in the sky that could be looked at and never visited.
 *
 *  Three and a half of the outermost planet's own diameters past it, not two:
 *  the ring where a body announces its name is three diameters, so a smaller
 *  margin would have left the two outer worlds nameable only from a place the
 *  ship is not allowed to be. The test found that; the first guess was wrong.
 *  There is still an edge, so pointing at the stars and walking away cannot
 *  strand anybody. */
export const MAX_ALT = planetDistance(PLANET_COUNT) + planetDiameter(PLANET_COUNT) * 3.5 - R;

/* ---- getting anywhere ----
   Geoff: "I don't seem to be able to get any closer to the planets. They just
   never get closer even though the Earth gets farther away."

   He was right, and the arithmetic says so. The nearest planet is 1,000 units
   out. Cruise is 16 a second and the boost cells last six seconds, so reaching
   it meant a minute of holding a stick at a dot that barely grew; the furthest
   would have taken nearly four minutes.

   Shrinking the sky was not an option, because the spacing is what was asked
   for. So the ship goes faster the further it is from Earth instead. Nothing
   worth dogfighting is out there, so nothing is lost by it, and close-quarters
   fighting is completely untouched because the multiplier is exactly 1 out to
   sixty units, which is well above the towers.

   Five times at full stretch, which puts the nearest planet about sixteen
   seconds away and the furthest just under a minute. Squared rather than
   linear, so it stays slow around the towers and only really opens up once
   Earth is behind you. */
const OPEN_SPACE = 5;
export function cruiseScale(alt: number): number {
  const t = Math.min(1, Math.max(0, (alt - 60) / 700));
  return 1 + (OPEN_SPACE - 1) * t * t;
}

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
