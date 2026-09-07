// Lit windows on the node towers, and a slowly turning beacon on top.
//
// The technique is lifted from Divi Kaiju's city facades
// (~/dreadroot/src/components/siege/globe/cityWindows.ts), which solved this
// properly once already. Two things from there are not optional and are the
// reason this file is longer than it looks like it needs to be:
//
//   * ANTI-ALIASING. A procedural pattern has no mipmaps, so at distance every
//     pixel independently asks "am I in a window?" of a grid finer than a pixel
//     and the answer flips as the camera moves. That is the scintillation Geoff
//     has already objected to once. fwidth tells us how much of the pattern
//     falls inside this pixel; we soften the edges by that much, and once a
//     whole window is smaller than a pixel we stop resolving windows at all and
//     fade to their AVERAGE, so a distant tower keeps its brightness instead of
//     either sparkling or going dark.
//   * BLINKING IS RARE. About one window in forty is on a slow cycle, each with
//     its own period and phase. Everything else is fixed for the session. Make
//     that fraction larger and it stops being a lit tower and becomes a
//     Christmas tree, which is exactly what was asked against.
//
// Cost: nothing per tower. No extra mesh, no texture, no per-object animation,
// and materials are shared by colour and size, so there are at most six of them
// no matter how many nodes the map has ever seen. The distance fade IS the level
// of detail: from the map's usual orbit the windows are under a pixel and cost
// only the instructions to fade them out.

import * as THREE from "three";

/** Roughly one window across, in globe units. Windows come out the same size on
 *  every tower because the grid is derived from each tower's real dimensions. */
const WINDOW_M = 0.19;
/** Smaller on the beacon, which is only about a third of a unit across. */
const BEACON_WINDOW_M = 0.055;
/** Two rotations a minute, as asked. */
const SPHERE_RPM = 2;

const HELPERS = /* glsl */ `
  uniform float uTime;
  uniform float uHeight;
  uniform float uCirc;
  varying vec3 vLocalPos;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // Shared by both shapes: given a cell grid, return how much light comes out
  // of this pixel. Everything about aliasing lives in here.
  vec3 facade(vec2 cell) {
    vec2 id = floor(cell);
    vec2 f = fract(cell);

    // Clamped, because a pixel straddling a hard seam spans two unrelated cell
    // values and the derivative there comes out enormous.
    vec2 w = min(fwidth(cell), vec2(4.0)) + 1e-5;

    float win =
        smoothstep(0.20 - w.x, 0.20 + w.x, f.x) * (1.0 - smoothstep(0.80 - w.x, 0.80 + w.x, f.x))
      * smoothstep(0.24 - w.y, 0.24 + w.y, f.y) * (1.0 - smoothstep(0.78 - w.y, 0.78 + w.y, f.y));

    // Once a whole window is near a pixel, stop resolving them and fade to the
    // average, which is what a mipmap would have handed back.
    float detail = 1.0 - smoothstep(0.30, 0.85, max(w.x, w.y));

    float h = hash21(id + 13.7);
    float lit = step(0.44, h);
    // One in forty, on its own clock. This is the whole of the blinking and it
    // is meant to be missable.
    if (h > 0.975) {
      float period = 5.0 + hash21(id * 3.1) * 16.0;
      lit = step(0.5, fract(uTime / period + h * 17.0));
    }

    const float MEAN_WIN = 0.336;
    const float MEAN_LIT = 0.56;
    float winF = mix(MEAN_WIN, win, detail);
    float litF = mix(MEAN_LIT, lit, detail);

    vec3 glow = mix(vec3(1.0, 0.84, 0.55), vec3(0.72, 0.86, 1.0),
                    mix(0.5, hash21(id + 9.1), detail));
    return vec3(glow * winF * litF);
  }
`;

/* The spire. Bays run round it and floors up it, both counted from the tower's
   real size, so a double-size tower gets twice as many windows rather than
   windows twice as big. */
const SPIRE_BODY = /* glsl */ `
  {
    float ang = atan(vLocalPos.z, vLocalPos.x) / 6.2831853 + 0.5;
    float bays = max(4.0, floor(uCirc / ${WINDOW_M.toFixed(3)}));
    float floors = max(2.0, floor(uHeight / ${WINDOW_M.toFixed(3)}));
    vec3 light = facade(vec2(ang * bays, (vLocalPos.y / uHeight) * floors));
    gl_FragColor.rgb += light * 1.5;
  }
`;

/* The beacon. Same facade wrapped round a sphere, with the pattern itself
   turning: the mesh never moves, its surface does, which is one add in the
   shader rather than a rotation per tower per frame. */
const BEACON_BODY = /* glsl */ `
  {
    vec3 n = normalize(vLocalPos);
    float spin = uTime * ${(SPHERE_RPM / 60).toFixed(5)};
    float ang = atan(n.z, n.x) / 6.2831853 + 0.5 + spin;
    float pol = acos(clamp(n.y, -1.0, 1.0)) / 3.1415927;
    float bays = max(6.0, floor(uCirc / ${BEACON_WINDOW_M.toFixed(3)}));
    float rows = max(3.0, floor(uHeight / ${BEACON_WINDOW_M.toFixed(3)}));
    vec3 light = facade(vec2(ang * bays, pol * rows));
    gl_FragColor.rgb += light * 1.9;
  }
`;

interface Patched extends THREE.MeshStandardMaterial {
  userData: { shared: true; uTime: { value: number } };
}

function patch(
  base: THREE.MeshStandardMaterial,
  body: string,
  height: number,
  circ: number,
  tag: string,
): Patched {
  const uTime = { value: 0 };
  base.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uHeight = { value: height };
    shader.uniforms.uCirc = { value: circ };
    shader.vertexShader = "varying vec3 vLocalPos;\n" + shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\n  vLocalPos = position;",
    );
    shader.fragmentShader = HELPERS + shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      `#include <dithering_fragment>\n${body}`,
    );
  };
  /* Without its own key three reuses another variant's compiled program and the
     windows land on the wrong shape. */
  base.customProgramCacheKey = () => tag;
  base.userData.shared = true;
  base.userData.uTime = uTime;
  return base as Patched;
}

const cache = new Map<string, { spire: THREE.MeshStandardMaterial; beacon: THREE.MeshStandardMaterial }>();

/** Nudged 5% toward orange, so the beacon reads as a different part. */
function beaconColour(c: THREE.ColorRepresentation): THREE.Color {
  return new THREE.Color(c).lerp(new THREE.Color(0xff8c00), 0.05);
}

/**
 * Materials for a tower of this colour and size. Shared: every tower matching
 * both gets the same pair, so the count never grows with the number of nodes.
 */
export function towerMaterials(
  colour: THREE.ColorRepresentation,
  height: number,
  baseRadius: number,
  beaconRadius: number,
): { spire: THREE.MeshStandardMaterial; beacon: THREE.MeshStandardMaterial } {
  const key = `${new THREE.Color(colour).getHexString()}:${height.toFixed(2)}`;
  const found = cache.get(key);
  if (found) return found;

  const spire = patch(
    new THREE.MeshStandardMaterial({
      color: colour, emissive: colour, emissiveIntensity: 0.5, roughness: 0.5, metalness: 0.2,
    }),
    SPIRE_BODY, height, 2 * Math.PI * baseRadius, `towerspire:${key}`,
  );
  const bc = beaconColour(colour);
  const beacon = patch(
    new THREE.MeshStandardMaterial({
      color: bc, emissive: bc, emissiveIntensity: 0.6, roughness: 0.45, metalness: 0.25,
    }),
    BEACON_BODY, Math.PI * beaconRadius, 2 * Math.PI * beaconRadius, `towerbeacon:${key}`,
  );
  const pair = { spire, beacon };
  cache.set(key, pair);
  return pair;
}

/** One call a frame drives every window on the planet. */
export function tickTowerLights(seconds: number): void {
  for (const pair of cache.values()) {
    (pair.spire.userData.uTime as { value: number }).value = seconds;
    (pair.beacon.userData.uTime as { value: number }).value = seconds;
  }
}
