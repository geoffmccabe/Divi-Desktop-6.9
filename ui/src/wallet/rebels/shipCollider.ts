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

  /* The longest axis is the one to slice along: it is the length of the ship,
     and slicing across it would give one fat sphere per wing and nothing down
     the fuselage. */
  const box = new THREE.Box3().setFromPoints(points);
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);
  const axis: 0 | 1 | 2 = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
  const lo = box.min.getComponent(axis);
  const span = Math.max(1e-6, size.getComponent(axis));

  const buckets: THREE.Vector3[][] = Array.from({ length: SLICES }, () => []);
  for (const p of points) {
    const t = (p.getComponent(axis) - lo) / span;
    buckets[Math.min(SLICES - 1, Math.max(0, Math.floor(t * SLICES)))].push(p);
  }

  const out: HitSphere[] = [];
  for (const bucket of buckets) {
    if (bucket.length === 0) continue;
    const c = new THREE.Vector3();
    for (const p of bucket) c.add(p);
    c.divideScalar(bucket.length);
    let r = 0;
    for (const p of bucket) r = Math.max(r, c.distanceTo(p));
    /* A slice's sphere reaches every vertex in it, which makes the chain a
       little generous where the hull tapers. Pulled in so a shot just past a
       wingtip misses rather than clipping an invisible edge. */
    out.push({ local: c.sub(centre), radius: r * 0.82 });
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

/** Where the guns and the tubes are, in the model's own space: the front of the
 *  hull on its longest axis, which is the nose of everything in this pack. */
export function noseOf(fitted: HitSphere[]): THREE.Vector3 {
  if (fitted.length === 0) return new THREE.Vector3();
  let best = fitted[0];
  for (const s of fitted) if (s.local.z < best.local.z) best = s;
  return best.local.clone();
}
