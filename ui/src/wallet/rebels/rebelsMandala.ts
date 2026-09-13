// The shield, seen from the cockpit: a mandala you look through.
//
// Geoff, 2026-Sep-13: "change the shield effect, as seen from the cockpit. Look
// at how the screensaver mandala is drawn here: https://ao.anamaya.com/ in the
// anamayos project. I want the shield to duplicate this but make the mandalas
// spin 3x faster and make the lines much lighter and 50% transparent. So while
// the shield is activated, the user sees through this mandala energetic shield.
// From outside, it can still look like it does now."
//
// WHERE THIS CAME FROM
// --------------------
// AnamayOS draws its screensaver as an SVG, in
// /Users/geoffreymccabe/AnamayOS/src/components/shared/mandala-screensaver.tsx.
// Every ring below is the same ring, with the same radius, the same number of
// steps and the same spin, read straight off that file: a circle is a circle, a
// spoke ring is a ring of lines, a petal is the same teardrop curve. What is
// different is only what Geoff asked for:
//
//   - every spin is THREE TIMES the rate it runs at on the website;
//   - the lines are pale rather than the site's terracotta, and half
//     transparent, so the fight is still readable through them.
//
// It is built as LINES rather than as an SVG because this is a three.js scene.
// One LineSegments per ring, not one object per petal: a ring is a single draw
// however many petals it has, and the whole mandala is about twenty draws that
// only exist while the shield is up.
//
// WHY THE MANDALA IS NOT THE WHOLE SHIELD
// ---------------------------------------
// It replaces the red wire sphere the pilot saw from INSIDE. The bubble other
// ships wear, and the view of your own ship from the chase camera, are
// untouched: "From outside, it can still look like it does now."

import * as THREE from "three";

const DEG = Math.PI / 180;

/**
 * The website's own base rate, in degrees a second, and the multiplier Geoff
 * asked for. Kept as two numbers rather than one so the next person can see
 * what was taken from AnamayOS and what was changed here.
 */
export const SITE_ANGULAR_VELOCITY = 15;
export const SPIN_MULTIPLIER = 3;
export const BASE_AV = SITE_ANGULAR_VELOCITY * SPIN_MULTIPLIER;

/**
 * A quarter, not the half it started at.
 *
 * Geoff asked for half transparent and then, having flown with it: "is too
 * dark so reduce its opacity by 50% of whatever you have now." Half of a half.
 */
export const MANDALA_OPACITY = 0.25;
/** Pale, not the site's terracotta: this is drawn over a fight. */
export const STROKE_COLOUR = 0xffc2c2;
export const ACCENT_COLOUR = 0xdCEBff;

/** How finely a petal is drawn. The SVG walks one in whole degrees; there is no
 *  reason to do better on a line that is one pixel wide. */
const PETAL_STEPS = 72;
/**
 * How finely a CIRCLE is drawn, by its size.
 *
 * A flat count is wrong at both ends: the outer ring fills the screen and
 * would show its corners at 72 steps, while the forty-eight beads of r=10 in
 * the same picture are a few pixels across and were costing 72 steps each.
 * Between sixteen and a hundred and twenty-eight, by radius.
 */
function circleSteps(r: number): number {
  return Math.max(16, Math.min(128, Math.round(r * 0.36)));
}

/** The outermost ring of the SVG, which is what the mandala is measured in. */
export const OUTER_RADIUS = 500;

/* ---- the shapes, in the website's own units ---- */

/** A closed ring of points, as a flat [x,y,x,y,…] list. */
function circlePoints(r: number): number[] {
  const out: number[] = [];
  const steps = circleSteps(r);
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return out;
}

/**
 * The teardrop the site's petals are made of:
 *
 *     x = a·cos(θ),  y = b·sin(θ)·sin(θ/2)^m
 *
 * Exactly as `tearDrop` has it, closed back to its start.
 */
export function petalPoints(a: number, b: number, m: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= PETAL_STEPS; i++) {
    const rad = (i / PETAL_STEPS) * Math.PI * 2;
    out.push(a * Math.cos(rad), b * Math.sin(rad) * Math.pow(Math.sin(rad / 2), m));
  }
  return out;
}

/** Turn a run of points into the pairs a LineSegments wants. */
function strip(points: number[], into: number[], ox: number, oy: number, rot: number): void {
  const c = Math.cos(rot), s = Math.sin(rot);
  const n = points.length / 2;
  for (let i = 0; i < n - 1; i++) {
    for (const k of [i, i + 1]) {
      const x = points[k * 2], y = points[k * 2 + 1];
      into.push(ox + c * x - s * y, oy + s * x + c * y, 0);
    }
  }
}

/**
 * One ring of `steps` copies of a shape, each pushed `dist` out and turned to
 * face outwards. This is the site's `ring()`: a child sits at rotVec(dist,0,θ)
 * and is rotated by θ, so a petal points away from the centre.
 */
function ringVerts(steps: number, dist: number, shape: number[], initDeg: number): number[] {
  const verts: number[] = [];
  const dTheta = 360 / steps;
  for (let i = 0; i < steps; i++) {
    const angle = (initDeg + dTheta * i) * DEG;
    strip(shape, verts, Math.cos(angle) * dist, Math.sin(angle) * dist, angle);
  }
  return verts;
}

/* ---- the mandala, ring by ring ---- */

/** A ring of the picture: what to draw, in which colour, and how fast it turns
 *  (in degrees a second, at the SITE's rate; the multiplier is applied once,
 *  where the rings are built). */
export interface RingSpec {
  /** For the tests and for anyone reading a diff. */
  name: string;
  accent?: boolean;
  /** Degrees a second on the website. Zero means it never turns. */
  siteAv: number;
  verts: number[];
}

/**
 * Every ring of the AnamayOS mandala, in the order it is drawn there.
 *
 * `av` values are the site's: 0, ±½ and ±1 times its base rate. They are
 * tripled once, in makeMandalaShield, so this table stays a faithful copy of
 * what the website does.
 */
export function mandalaRings(): RingSpec[] {
  const B = SITE_ANGULAR_VELOCITY;
  const rings: RingSpec[] = [];
  const still: number[] = [];
  const stillAccent: number[] = [];

  const addCircle = (r: number, accent = false) => {
    strip(circlePoints(r), accent ? stillAccent : still, 0, 0, 0);
  };
  /** A ring of little circles. None of these turn on the site. */
  const circleRing = (steps: number, dist: number, r: number) => {
    const v = ringVerts(steps, dist, circlePoints(r), 0);
    for (const n of v) still.push(n);
  };
  const lineRing = (name: string, steps: number, len: number, siteAv = 0) => {
    const verts = ringVerts(steps, 0, [0, 0, len, 0], 0);
    if (siteAv === 0) { for (const n of verts) still.push(n); return; }
    rings.push({ name, siteAv, verts });
  };
  const petalRing = (
    name: string, steps: number, dist: number,
    a: number, b: number, m: number, siteAv: number, initDeg: number, accent: boolean,
  ) => {
    const verts = ringVerts(steps, dist, petalPoints(a, b, m), initDeg);
    if (siteAv === 0) { for (const n of verts) (accent ? stillAccent : still).push(n); return; }
    rings.push({ name, siteAv, verts, accent });
  };

  /* ---- outer ---- */
  addCircle(500); addCircle(490); addCircle(475);
  circleRing(48, 450, 10);
  addCircle(430); addCircle(420);
  lineRing("outer-spokes-back", 48, 420, -0.5 * B);
  lineRing("outer-spokes-still", 48, 420);
  petalRing("outer-petals-1", 6, 350, 100, 150, 1.5, -0.5 * B, 30, true);
  petalRing("outer-petals-2", 6, 350, 120, 150, 1.25, -0.5 * B, 0, false);
  petalRing("outer-petals-3", 6, 350, 140, 220, 1.75, B, 0, true);
  petalRing("outer-petals-4", 6, 350, 110, 160, 1.5, B, 0, false);
  addCircle(300);
  circleRing(48, 330, 7);

  /* ---- middle ---- */
  addCircle(300); addCircle(290);
  circleRing(24, 258, 30);
  addCircle(260); addCircle(250);
  lineRing("mid-spokes", 24, 250, -B);
  addCircle(233);
  petalRing("mid-petals-1", 6, 160, 50, 130, 2.5, B, 0, true);
  petalRing("mid-petals-2", 6, 110, 100, 155, 2, B, 30, false);
  petalRing("mid-petals-3", 6, 110, 80, 120, 2.3, B, 30, true);
  circleRing(12, 150, 10);

  /* ---- inner ---- */
  addCircle(105); addCircle(95, true);
  petalRing("inner-petals-1", 6, 60, 40, 40, 2, 0, 30, true);
  petalRing("inner-petals-2", 6, 60, 40, 60, 1.5, B, 0, false);
  petalRing("inner-petals-3", 6, 63, 27, 41, 1.5, B, 0, true);
  addCircle(55); addCircle(45);
  lineRing("inner-spokes", 12, 45, B);
  addCircle(30, true); addCircle(20);

  /* Everything that never moves is ONE draw rather than thirty. */
  if (still.length) rings.unshift({ name: "still", siteAv: 0, verts: still });
  if (stillAccent.length) rings.unshift({ name: "still-accent", siteAv: 0, verts: stillAccent, accent: true });
  return rings;
}

export interface MandalaShield {
  group: THREE.Group;
  /**
   * Put it in front of the eye and turn it.
   *
   * `seconds` drives the spin and `strength` fades the whole thing in and out
   * with the shield, the same two arguments the wire sphere took, so the
   * cockpit calls this exactly where it called that.
   */
  step(seconds: number, strength: number, camera: THREE.PerspectiveCamera): void;
  dispose(): void;
}

/** How far in front of the eye the mandala hangs, in world units. Inside the
 *  guard sphere (3.2) and well outside the near plane (0.05). */
export const MANDALA_DISTANCE = 2.2;

/**
 * Build the shield.
 *
 * Nothing here is added to a scene and nothing is positioned: the cockpit owns
 * where it goes, because only the cockpit knows where the eye is looking.
 */
export function makeMandalaShield(): MandalaShield {
  const group = new THREE.Group();
  group.visible = false;
  /* The site's y runs DOWN the screen and three's runs up. Flipping the whole
     picture once keeps every radius, every angle and every direction of spin
     below identical to the file it was copied from. */
  const flip = new THREE.Group();
  flip.scale.y = -1;
  group.add(flip);

  const made: { geo: THREE.BufferGeometry; line: THREE.LineSegments; av: number }[] = [];
  const materials: THREE.LineBasicMaterial[] = [];
  const material = (accent: boolean) => {
    const m = new THREE.LineBasicMaterial({
      color: accent ? ACCENT_COLOUR : STROKE_COLOUR,
      transparent: true,
      opacity: 0,
      /* Additive, so the mandala only ever ADDS light: a shield you look
         through cannot be allowed to darken what is behind it. */
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      /* Over everything. It sits on the eye, not in the world, so letting the
         ship's own nose cut holes in it would look like a fault. */
      depthTest: false,
    });
    materials.push(m);
    return m;
  };
  const strokeMat = material(false);
  const accentMat = material(true);

  for (const ring of mandalaRings()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(ring.verts, 3));
    const line = new THREE.LineSegments(geo, ring.accent ? accentMat : strokeMat);
    /* Culling is left ON, and on purpose: the rear-gun window renders this
       same scene from a camera at the tail looking back, and the mandala is
       hung on the MAIN camera. Being cullable is what keeps it out of that
       window instead of being smeared across it. */
    geo.computeBoundingSphere();
    line.renderOrder = 4;
    flip.add(line);
    made.push({ geo, line, av: ring.siteAv * SPIN_MULTIPLIER });
  }

  const _fwd = new THREE.Vector3();

  return {
    group,
    step(seconds, strength, camera) {
      const on = strength > 0.001;
      group.visible = on;
      if (!on) return;

      for (const m of made) {
        if (m.av) m.line.rotation.z = seconds * m.av * DEG;
      }
      for (const m of materials) m.opacity = MANDALA_OPACITY * Math.min(1, strength);

      /* On the eye: in front of the camera, square to it, and big enough that
         its outer ring reaches the CORNERS of the frame whatever shape the
         window is. Geoff's rule about filling the width applies here too: a
         mandala that fitted the height would leave the sides of a wide window
         empty. */
      camera.getWorldDirection(_fwd);
      group.position.copy(camera.position).addScaledVector(_fwd, MANDALA_DISTANCE);
      group.quaternion.copy(camera.quaternion);
      const halfH = Math.tan((camera.fov * DEG) / 2) * MANDALA_DISTANCE;
      const halfW = halfH * camera.aspect;
      const corner = Math.hypot(halfH, halfW);
      group.scale.setScalar(corner / OUTER_RADIUS);
    },
    dispose() {
      for (const m of made) m.geo.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
