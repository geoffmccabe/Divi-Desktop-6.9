// A hit shape that follows the hull, rather than a ball around it.
//
// WHY NOT THE MESH ITSELF
// -----------------------
// Geoff asked for mesh-based colliders so the ship can be hit where it actually
// is. Testing every bullet against every triangle of a Synty hull is the literal
// reading and the wrong one: a cruiser is thousands of triangles, there can be a
// hundred rounds in the air, and that is a hundred thousand triangle tests a
// frame for an answer nobody could see the difference of.
//
// What is done instead is derived FROM the mesh, once, when the model loads: the
// hull is sliced along its longest axis and each slice gets a sphere sized to the
// vertices actually in it. A fighter comes out as a chain of small spheres down
// its fuselage with wider ones at the wings; a station comes out as a chain of
// large ones. Bullets then test a handful of spheres, which is cheap enough to do
// properly, and a shot down the length of a ship hits while one past its wingtip
// misses.
//
// The honest limit: a hull with a hole through it — a ring, a fork — reads as
// solid. Nothing in the pack is shaped like that, and if something ever is, the
// answer is more slices rather than a different idea.

import * as THREE from "three";

export interface HitSphere {
  /** Centre in the model's own space, before it is placed in the world. */
  local: THREE.Vector3;
  radius: number;
}

/** How many slices down the hull. Enough to follow a fuselage, few enough that a
 *  bullet test stays a handful of distance checks. */
const SLICES = 7;

/**
 * Fit a chain of spheres to a model's geometry. Once per model.
 *
 * Reads positions straight off the buffers, so it sees the real shape rather
 * than the bounding box: the difference is a fighter whose nose is a point
 * rather than a slab.
 */
export function fitCollider(root: THREE.Object3D): HitSphere[] {
  const points: THREE.Vector3[] = [];
  const v = new THREE.Vector3();
  root.updateMatrixWorld(true);

  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const pos = m.geometry.getAttribute("position");
    if (!pos) return;
    /* Sampled rather than exhaustive: a station has tens of thousands of
       vertices and the shape of a sphere chain is settled by a few hundred. */
    const step = Math.max(1, Math.floor(pos.count / 900));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      points.push(v.clone());
    }
  });

  if (points.length === 0) return [];

  const box = new THREE.Box3().setFromPoints(points);
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);

  /* ---- which way is "along the ship" ----
     The longest axis, EXCEPT that on a fighter it is a coin toss: Fighter 01 is
     13.3 across the wings and 12.9 from nose to tail, and slicing across the
     wings would give one fat sphere per wingtip and nothing down the fuselage.
     So a near-tie goes to Z, which is the length axis for every hull in this
     pack. */
  const axis: 0 | 1 | 2 = (() => {
    const longest = Math.max(size.x, size.y, size.z);
    if (size.z >= longest * 0.85) return 2;
    return size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
  })();
  const lo = box.min.getComponent(axis);
  const span = Math.max(1e-6, size.getComponent(axis));

  /* ---- a SLIDING window, not disjoint buckets ----
     Bucketing vertices into slices sounds right and falls over on exactly the
     shapes this pack is made of. A long flat panel has vertices only at its
     corners, so the slices in between get nothing and vanish, and a hull that
     should be seven spheres comes out as three. Each slice therefore takes
     every vertex within one and a half slice widths of it, so a span with no
     vertices of its own still gets a sphere sized by the panel running past it.
     The test caught this; a box fuselage produced three spheres and I would not
     have noticed on a model that happens to be denser.

     One slice width either side rather than more: a window wide enough to never
     miss is also wide enough to smear the wings along the fuselage, and a shot
     that should pass behind a wing would then hit it. */
  const half = 1.2 / SLICES;
  const out: HitSphere[] = [];
  for (let i = 0; i < SLICES; i++) {
    const mid = (i + 0.5) / SLICES;
    const near = points.filter((p) => {
      const t = (p.getComponent(axis) - lo) / span;
      return Math.abs(t - mid) <= half;
    });
    if (near.length === 0) continue;

    /* Centred on the slice itself along the ship, and on the vertices across
       it: a sphere for the nose belongs at the nose, not at the average of
       whatever happened to fall in its window. */
    const c = new THREE.Vector3();
    for (const p of near) c.add(p);
    c.divideScalar(near.length);
    c.setComponent(axis, lo + mid * span);

    /* Sized by the CROSS-SECTION at this slice, not by the 3D distance to the
       furthest vertex in the window. The sphere is already centred on its
       slice, so a wing vertex a slice away should set the radius by how far out
       it reaches, not by how far away it is along the ship — measuring the
       diagonal made every sphere near a wing too big, and then pulling them all
       in to compensate left a quarter of the wing non-solid. */
    let r = 0;
    for (const p of near) {
      const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
      const along = axis === 0 ? dx : axis === 1 ? dy : dz;
      r = Math.max(r, Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - along * along)));
    }
    /* A touch under the true cross-section, so a round that visibly clears the
       hull clears it. Erring this way is deliberate: a shot that should have
       missed and hits is unfair, and one that should have hit and misses is
       merely lucky. */
    out.push({ local: c.sub(centre), radius: r * 0.9 });
  }
  return out;
}

/**
 * Place a fitted collider in the world.
 *
 * The spheres were fitted in the model's own space; this turns them by the
 * ship's orientation and moves them to where it is. Written into a caller-owned
 * array so a flight loop does not allocate eight vectors a frame.
 */
export function placeCollider(
  fitted: HitSphere[],
  pos: THREE.Vector3,
  quat: THREE.Quaternion,
  scale: number,
  out: Array<{ at: THREE.Vector3; r: number }>,
): void {
  while (out.length < fitted.length) out.push({ at: new THREE.Vector3(), r: 0 });
  out.length = fitted.length;
  for (let i = 0; i < fitted.length; i++) {
    out[i].at.copy(fitted[i].local).multiplyScalar(scale).applyQuaternion(quat).add(pos);
    out[i].r = fitted[i].radius * scale;
  }
}

/** How far the chain reaches from the ship's centre: a cheap reject before the
 *  spheres are tested one by one. */
export function colliderBound(fitted: HitSphere[]): number {
  let far = 0;
  for (const s of fitted) far = Math.max(far, s.local.length() + s.radius);
  return far;
}

/**
 * Where the guns and the tubes are: the front of the hull.
 *
 * The END of the chain, whichever axis it was sliced along, and the end with
 * the SMALLER sphere. A ship tapers to its nose and is widest at its engines,
 * so the narrower end is the front — which beats assuming a sign on an axis,
 * since half this pack could be modelled either way round.
 */
export function noseOf(fitted: HitSphere[]): THREE.Vector3 {
  if (fitted.length === 0) return new THREE.Vector3();
  const first = fitted[0];
  const last = fitted[fitted.length - 1];
  return (first.radius <= last.radius ? first : last).local.clone();
}
