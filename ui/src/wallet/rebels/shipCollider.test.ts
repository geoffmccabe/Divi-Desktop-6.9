// Does the hit shape follow the hull?
//
// The point of fitting spheres to the geometry rather than drawing one big ball
// round the ship is that a round past a wingtip should miss. If the fit is
// sloppy that is exactly what stops being true, and nothing on screen would say
// so — a bullet that clips thin air looks like lag.
//
// Run: sh scripts/run-rebels-collider-tests.sh

import * as THREE from "three";
import {
  fitCollider, placeCollider, colliderBound, noseOf, HULL_FORWARD, HULL_UP,
  mountsFromPoints, fitMounts, halfSpan,
} from "./shipCollider";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/** A stand-in for a fighter: a long thin fuselage with a pair of wings halfway
 *  down it. Built rather than downloaded, so the test needs no network and the
 *  right answer is known in advance. */
function fighter(): THREE.Object3D {
  const g = new THREE.Group();
  /* Longer than it is wide, and the wings set BACK from the nose, so "along the
     ship" is unambiguous and the front slices are genuinely narrower. Nose at
     +Z, matching the pack: see HULL_FORWARD. */
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 5));
  const wings = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.15, 0.9));
  wings.position.z = -1.2;
  g.add(body, wings);
  return g;
}

/**
 * A fighter with a bigger WINGSPAN than it has length.
 *
 * This is not a corner case, it is most of the pack. Fighter 04 is 19.3 across
 * and 15.2 long; twelve of the thirty-two hulls are like it. The collider used
 * to slice a hull along its longest axis, so on these it sliced across the
 * wings, put one fat sphere on each wingtip and nothing down the fuselage, and
 * called a wingtip the nose. The ship then flew sideways.
 *
 * Geoff: "instead of rotating it 180 degrees you rotated it 90 degrees so now
 * it's facing sideways and worse than before."
 *
 * This fixture reproduces that shape, so nothing can quietly go back to
 * choosing an axis by length.
 */
function wideWing(): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 4));
  const wings = new THREE.Mesh(new THREE.BoxGeometry(6, 0.15, 1.2));
  wings.position.z = -1;
  g.add(body, wings);
  return g;
}

// 1. The chain follows the shape rather than boxing it.
{
  const fitted = fitCollider(fighter());
  ok("it fits several spheres, not one", fitted.length >= 4, `${fitted.length}`);

  /* The widest sphere should be at the wings and the narrow ones fore and aft.
     A single bounding sphere would make every one of them the same. */
  const widest = Math.max(...fitted.map((s) => s.radius));
  const narrowest = Math.min(...fitted.map((s) => s.radius));
  ok("and they are not all the same size", widest > narrowest * 1.6,
     `${narrowest.toFixed(2)} to ${widest.toFixed(2)}`);

  ok("and the chain still covers the ship", colliderBound(fitted) > 1.5,
     colliderBound(fitted).toFixed(2));
}

// 1b. THE ONE THAT MATTERS: does a shot past the wingtip miss?
//
//     Comparing radii was the first version of this and it was a proxy for the
//     thing anyone actually notices. What a player sees is whether a round that
//     visibly cleared the ship took their shield off, so that is what is asked.
{
  const fitted = fitCollider(fighter());
  const placed: Array<{ at: THREE.Vector3; r: number }> = [];
  placeCollider(fitted, new THREE.Vector3(), new THREE.Quaternion(), 1, placed);

  /* The fighter is 5 long with its nose at +z, 3.5 across the wings which sit
     back at z = -1.2, and its fuselage is half a unit wide. A ball round the
     whole thing would be about 2.6. */
  const hits = (p: THREE.Vector3) => placed.some((s) => p.distanceTo(s.at) <= s.r);

  ok("a round into the nose hits", hits(new THREE.Vector3(0, 0, 2.2)));
  ok("a round into the fuselage hits", hits(new THREE.Vector3(0, 0, 0)));
  ok("a round into a wing hits", hits(new THREE.Vector3(1.5, 0, -1.2)));

  /* And these are the ones a bounding ball would get wrong: out where the wings
     are not. */
  ok("a round abreast of the NOSE, out at wing width, misses",
     !hits(new THREE.Vector3(1.6, 0, 2.2)));
  ok("a round beyond the wingtip misses", !hits(new THREE.Vector3(2.4, 0, -1.2)));
  ok("a round well above the hull misses", !hits(new THREE.Vector3(0, 1.6, 0)));

  /* Which is only meaningful if a bounding ball really would have caught them. */
  const ball = colliderBound(fitted);
  ok("a bounding ball would have caught all three",
     new THREE.Vector3(1.6, 0, -2.2).length() < ball
     && new THREE.Vector3(2.4, 0, 1.2).length() < ball
     && new THREE.Vector3(0, 1.6, 0).length() < ball,
     `ball radius ${ball.toFixed(2)}`);
}

// 2. Placing it in the world turns it with the ship.
{
  const fitted = fitCollider(fighter());
  const placed: Array<{ at: THREE.Vector3; r: number }> = [];
  const pos = new THREE.Vector3(10, 20, 30);
  const level = new THREE.Quaternion();

  placeCollider(fitted, pos, level, 1, placed);
  ok("every sphere is placed", placed.length === fitted.length);
  const centre = new THREE.Vector3();
  for (const s of placed) centre.add(s.at);
  centre.divideScalar(placed.length);
  ok("and the chain sits where the ship is", centre.distanceTo(pos) < 0.6,
     `${centre.distanceTo(pos).toFixed(2)} out`);

  /* Turned a quarter turn about the vertical, the chain has to turn with it:
     what was along z is now along x. */
  const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const before = placed.map((s) => s.at.clone());
  placeCollider(fitted, pos, turned, 1, placed);
  const moved = placed.some((s, i) => s.at.distanceTo(before[i]) > 0.5);
  ok("turning the ship turns the chain", moved);

  /* And scaling scales it, or a station would be hit like a fighter. */
  placeCollider(fitted, pos, level, 3, placed);
  ok("scaling the ship scales the chain",
     Math.max(...placed.map((s) => s.r)) > Math.max(...fitted.map((s) => s.radius)) * 2.5);

  /* Reused array, no leak: a flight loop calls this sixty times a second. */
  const len = placed.length;
  placeCollider(fitted, pos, level, 1, placed);
  ok("and the array is reused rather than regrown", placed.length === len, `${placed.length}`);
}

// 3. The nose is at the front, which is where the guns go.
{
  const fitted = fitCollider(fighter());
  const nose = noseOf(fitted);
  ok("the nose is at the front", nose.z > 0, `z ${nose.z.toFixed(2)}`);
  ok("and it is off the ship's centre", nose.length() > 0.8, nose.length().toFixed(2));
}

// 3b. A HULL WIDER THAN IT IS LONG. Twelve of the thirty-two are.
{
  const wide = wideWing();
  const fitted = fitCollider(wide);

  /* Sliced down the FUSELAGE, not across the wings. If it went across the
     wings there would be two fat spheres and a thin middle; down the fuselage
     the wing slice is the fat one and the nose is thin. */
  const nose = noseOf(fitted);
  ok("a wide-winged hull still faces forwards", nose.z > 0, `z ${nose.z.toFixed(2)}`);
  ok("and forward is not a wingtip",
     Math.abs(nose.x) < Math.abs(nose.z), `x ${nose.x.toFixed(2)} z ${nose.z.toFixed(2)}`);

  /* And the hit shape follows the fuselage: a round straight up the middle
     hits, one out past a wingtip does not. Sliced the old way, both of those
     answers came out backwards. */
  const placed: Array<{ at: THREE.Vector3; r: number }> = [];
  placeCollider(fitted, new THREE.Vector3(), new THREE.Quaternion(), 1, placed);
  const hits = (x: number, y: number, z: number) =>
    placed.some((s) => s.at.distanceTo(new THREE.Vector3(x, y, z)) < s.r);
  ok("a round up the middle of a wide hull hits", hits(0, 0, 1.2));
  ok("a round past its wingtip misses", !hits(4.2, 0, 1.2));
}

// 3c. The convention itself, stated once and asserted here.
{
  ok("hulls face +Z", HULL_FORWARD.z === 1 && HULL_FORWARD.x === 0 && HULL_FORWARD.y === 0);
  ok("and +Y is up", HULL_UP.y === 1);
  /* A right-handed frame, or the ship comes out mirrored. */
  const right = new THREE.Vector3().crossVectors(HULL_UP, HULL_FORWARD);
  ok("up cross forward is right", Math.abs(right.x - 1) < 1e-6, right.toArray().join(","));
}

// 4. Nothing to fit is not a crash.
{
  ok("an empty model fits nothing", fitCollider(new THREE.Group()).length === 0);
  const placed: Array<{ at: THREE.Vector3; r: number }> = [];
  placeCollider([], new THREE.Vector3(), new THREE.Quaternion(), 1, placed);
  ok("and placing nothing places nothing", placed.length === 0);
  ok("and its reach is zero", colliderBound([]) === 0);
}

/* ---- halfSpan ----
   The capture ball's radius: the farthest point out to either side. */
{
  const g = new THREE.BoxGeometry(19.3, 2, 15.2);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(g));
  ok("half the width, not half the length", Math.abs(halfSpan(root) - 9.65) < 1e-6, `${halfSpan(root)}`);
  const off = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 1));
  m.position.x = 3;
  off.add(m);
  ok("measured from the ship's own centre line, wherever the mesh sits", Math.abs(halfSpan(off) - 2) < 1e-6, `${halfSpan(off)}`);
  ok("nothing in it is nothing", halfSpan(new THREE.Group()) === 0);
}

console.log(out.join("\n"));
/* ---- where the guns are ----
   A fuselage with two swept wings, as a cloud of vertices: the barrels have to
   land on the wing tips, at their leading edge, and the nose at the front. */
{
  const pts: THREE.Vector3[] = [];
  /* Fuselage: a box 0.2 wide, 0.16 tall, 1.0 long, centred. */
  for (const x of [-0.1, 0.1]) for (const y of [-0.08, 0.08]) for (const z of [-0.5, -0.2, 0.1, 0.5]) pts.push(new THREE.Vector3(x, y, z));
  /* Wings: thin, out to +-0.6, leading edge at z = 0.05 at the tip, trailing at -0.4. */
  for (const side of [-1, 1]) for (const t of [0.3, 0.45, 0.6]) {
    pts.push(new THREE.Vector3(side * t, 0, 0.05 - (0.6 - t) * 0.2));   /* leading edge, swept back toward the root */
    pts.push(new THREE.Vector3(side * t, 0, -0.4));
  }
  const m = mountsFromPoints(pts.map((p) => p.clone()));
  ok("the nose is at the very front", m.nose.z === 0.5 && Math.abs(m.nose.x) < 1e-9, `${m.nose.toArray()}`);
  ok("the hull counts as winged", m.winged);
  ok("the left barrel is at the left wing tip's leading edge", m.gunL.x === -0.6 && Math.abs(m.gunL.z - 0.05) < 1e-9, `${m.gunL.toArray()}`);
  ok("the right barrel at the right", m.gunR.x === 0.6 && Math.abs(m.gunR.z - 0.05) < 1e-9, `${m.gunR.toArray()}`);
  ok("the belly is under the middle of the fuselage", m.belly.y === -0.08 && m.belly.x === 0, `${m.belly.toArray()}`);
  ok("the half-span is measured", m.halfSpan === 0.6);
}
{
  /* No wings: a needle. Barrels sit just off the nose. */
  const pts: THREE.Vector3[] = [];
  for (const x of [-0.05, 0.05]) for (const y of [-0.05, 0.05]) for (const z of [-0.5, 0, 0.5]) pts.push(new THREE.Vector3(x, y, z));
  const m = mountsFromPoints(pts);
  ok("a hull without wings is not winged", !m.winged);
  ok("its barrels flank the nose, a little back from it",
     m.gunL.x < 0 && m.gunR.x > 0 && m.gunR.x === -m.gunL.x && m.gunL.z < m.nose.z && m.gunL.z > m.nose.z - 0.1,
     `${m.gunL.toArray()} / ${m.nose.toArray()}`);
}
{
  /* From a real object: the same answer as from its points, in the unit frame. */
  const g = new THREE.Group();
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.3));
  wing.position.z = -0.1;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 1));
  g.add(body, wing);
  const m = fitMounts(g);
  ok("fitMounts reads a scene object", m.winged && Math.abs(m.halfSpan - 0.6) < 1e-6 && Math.abs(m.nose.z - 0.5) < 1e-6,
     `${m.halfSpan} ${m.nose.toArray()}`);
  ok("and puts the barrels on the wing's leading corners", Math.abs(m.gunL.x + 0.6) < 1e-6 && Math.abs(m.gunL.z - 0.05) < 1e-6,
     `${m.gunL.toArray()}`);
  ok("an empty object gives an empty answer", !fitMounts(new THREE.Group()).winged);
}

/* ---- the beam's cone points where it fires ----
   It was drawn backwards: the geometry opens along +Z and it was being turned
   to face minus the firing direction. */
{
  const { beamGeometry, beamOrientation } = await import("./rebelsFx");
  const g = beamGeometry();
  g.computeBoundingBox();
  ok("the cone's apex is at the origin and it opens along +Z",
     Math.abs(g.boundingBox!.min.z) < 1e-6 && Math.abs(g.boundingBox!.max.z - 1) < 1e-6,
     `${g.boundingBox!.min.z} .. ${g.boundingBox!.max.z}`);
  const m = new THREE.Mesh(g);
  const fwd = new THREE.Vector3(0, 0, -1);
  m.quaternion.copy(beamOrientation(fwd));
  m.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(m);
  ok("turned to fire down -Z it opens down -Z", b.max.z < 1e-6 && Math.abs(b.min.z + 1) < 1e-6, `${b.min.z} .. ${b.max.z}`);
  const side = new THREE.Vector3(1, 0, 0);
  m.quaternion.copy(beamOrientation(side));
  m.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(m);
  ok("and sideways it opens sideways", Math.abs(b2.max.x - 1) < 1e-6 && Math.abs(b2.min.x) < 1e-6, `${b2.min.x} .. ${b2.max.x}`);
}

console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
