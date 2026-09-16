// Spikeworld, on screen.
//
// The one file in this folder that knows what three.js is. Everything else is
// arithmetic and runs anywhere; this turns the arithmetic into geometry and
// holds it. Keeping the line here is what lets the field and the budget be
// tested in node and run in the room's Cloudflare Worker.
//
// HOW IT HOLDS TOGETHER
// ---------------------
// One group at the planet's place in the world, with the chunk meshes inside it
// in CUBE coordinates. Vertices therefore stay small numbers even though the
// planet is two hundred thousand units from Earth: the group's matrix does the
// carrying, in double precision on the processor, and only the short local
// offsets are handed to the card as floats.
//
// Chunks are built on demand from the list voxelView asks for, kept in a map,
// and thrown away when they fall out of the list. Building is synchronous for
// now and that is a known cost: one chunk is about twenty milliseconds, so a
// burst of new chunks will stutter. A worker is the next step and the seam for
// it is one function, `build`.

import * as THREE from "three";
import {
  CUBE, CHUNK, R_OUTER, R_INNER, R_HEART, WORLD_RADIUS, SKY_EDGE, toWorld,
} from "./voxelWorld";
import { spokeDirections } from "./voxelField";
import { meshChunk, type ChunkMesh } from "./voxelMesh";
import {
  visibleChunks, dustFarFor, SKIN_BY_STEP, type ChunkRef,
} from "./voxelView";
import { spikes, SPIKE_COUNT } from "./voxelSpikes";

/** How many chunks may be built in one frame. A chunk is about twenty
 *  milliseconds, so more than one is a visible hitch. */
const BUILD_PER_FRAME = 1;

/** The rock, and the dust it fades into. */
const ROCK_COLOUR = 0x8a90a0;
const HEART_COLOUR = 0xff8a4a;
const SPIKE_COLOUR = 0x585d68;

export interface VoxelPlanet {
  group: THREE.Group;
  /** Where its centre sits in the game's world. */
  centre: THREE.Vector3;
  /** Move it on. `eye` is the camera in WORLD units. */
  step(eye: THREE.Vector3, dt: number): void;
  /** For DFlow: what it is costing right now. */
  stats(): { chunks: number; triangles: number; queued: number; built: number };
  dispose(): void;
}

/**
 * The cube grid, as a small repeating picture.
 *
 * A merged face can be thirty cubes wide and is ONE rectangle, so the grid
 * cannot come from the mesh: it comes from the texture, and the face's own
 * coordinates are measured in cubes, so one tile lands on one cube however
 * large the rectangle is. The same trick the sealed spheres use.
 *
 * This replaced a custom shader that did the same job in one pass and drew
 * nothing at all on Geoff's machine: spikes, spokes and heart appeared and the
 * cubes did not, and the only thing that told them apart was that material.
 * A stock material with a texture is less clever and it works.
 */
function gridTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const N = 64;
  const canvas = document.createElement("canvas");
  canvas.width = N; canvas.height = N;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, N, N);
  /* A darker edge on two sides, so a wall of cubes reads as stacked blocks
     rather than as one flat sheet. */
  ctx.strokeStyle = "rgba(0,0,0,0.42)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0.5, 0); ctx.lineTo(0.5, N);
  ctx.moveTo(0, 0.5); ctx.lineTo(N, 0.5);
  ctx.stroke();
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Shade each face by the way it points, baked into the geometry.
 *
 * Six flat tones rather than a light: cheaper, it cannot be got wrong by
 * whatever else is in the scene, and the six sides of a cube read apart, which
 * is the whole point of drawing cubes.
 */
function shadeColours(normals: Float32Array): Float32Array {
  const out = new Float32Array(normals.length);
  const base = new THREE.Color(ROCK_COLOUR);
  for (let i = 0; i < normals.length; i += 3) {
    const nx = normals[i], ny = normals[i + 1], nz = normals[i + 2];
    /* Up brightest, down darkest, the four sides between. */
    const lit = 0.58 + 0.30 * Math.max(0, ny) + 0.12 * Math.abs(nx) + 0.06 * Math.abs(nz);
    out[i] = base.r * lit; out[i + 1] = base.g * lit; out[i + 2] = base.b * lit;
  }
  return out;
}

/**
 * Build the planet.
 *
 * `centre` is where it sits in the game's world, in world units. Nothing is
 * generated here: the first `step` decides what is worth building.
 */
export function makeVoxelPlanet(centre: THREE.Vector3, seed = 0): VoxelPlanet {
  const group = new THREE.Group();
  group.position.copy(centre);
  /* The whole planet is held in CUBES and scaled up once, which is what keeps
     the vertex numbers small. */
  const cubes = new THREE.Group();
  cubes.scale.setScalar(CUBE);
  group.add(cubes);

  const grid = gridTexture();
  const material = new THREE.MeshBasicMaterial({
    ...(grid ? { map: grid } : {}),
    color: 0xffffff,
    vertexColors: true,
  });
  const live = new Map<string, THREE.Mesh>();
  let queue: ChunkRef[] = [];
  let built = 0;
  let triangleCount = 0;

  /* ---- the spikes, and the spokes ----
     Boxes, not cubes. Three thousand rods as one instanced draw is about
     36,000 triangles; the same rods as voxels would be most of the planet's
     whole allowance. A rod one cube wide and a hundred long IS a box, so
     nothing is lost. */
  const rodGeo = new THREE.BoxGeometry(1, 1, 1);
  const rodMat = new THREE.MeshBasicMaterial({ color: SPIKE_COLOUR });
  const rods = new THREE.InstancedMesh(rodGeo, rodMat, SPIKE_COUNT + 24);
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const dir = new THREE.Vector3();
    let n = 0;
    for (const s of spikes(seed)) {
      dir.set(s.dir[0], s.dir[1], s.dir[2]);
      /* The box is built along Y and turned to the rod's direction, then
         placed at its middle. */
      q.setFromUnitVectors(up, dir);
      pos.set(
        s.base[0] + s.dir[0] * s.length * 0.5,
        s.base[1] + s.dir[1] * s.length * 0.5,
        s.base[2] + s.dir[2] * s.length * 0.5,
      );
      scale.set(s.width, s.length, s.width);
      rods.setMatrixAt(n++, m.compose(pos, q, scale));
    }
    /* The spokes: the same trick, from the heart to the shell. */
    const dirs = spokeDirections();
    for (let i = 0; i < dirs.length; i += 3) {
      dir.set(dirs[i], dirs[i + 1], dirs[i + 2]);
      q.setFromUnitVectors(up, dir);
      const len = R_INNER - R_HEART;
      pos.copy(dir).multiplyScalar(R_HEART + len * 0.5);
      scale.set(4, len, 4);
      rods.setMatrixAt(n++, m.compose(pos, q, scale));
    }
    rods.count = n;
    rods.instanceMatrix.needsUpdate = true;
  }
  cubes.add(rods);

  /* ---- the heart ----
     Small, always there, and always worth drawing: it is the thing the spokes
     point at. Meshed once at full detail. */
  const heartMesh = (() => {
    const m = meshChunk(-R_HEART - 2, -R_HEART - 2, -R_HEART - 2, (R_HEART + 2) * 2, 1, seed);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(m.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
    const mat = new THREE.MeshBasicMaterial({ color: HEART_COLOUR });
    const mesh = new THREE.Mesh(geo, mat);
    cubes.add(mesh);
    return { mesh, geo, mat };
  })();

  const keyOf = (c: ChunkRef) => `${c.step}:${c.ox},${c.oy},${c.oz}`;

  /** Turn one chunk into geometry. The seam a worker would replace. */
  function build(c: ChunkRef): void {
    const m: ChunkMesh = meshChunk(c.ox, c.oy, c.oz, CHUNK, c.step, seed, SKIN_BY_STEP[c.step] ?? 0);
    built++;
    if (!m.indices.length) { live.set(keyOf(c), new THREE.Mesh()); return; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(m.uvs, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(shadeColours(m.normals), 3));
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    cubes.add(mesh);
    live.set(keyOf(c), mesh);
  }

  function drop(key: string): void {
    const mesh = live.get(key);
    if (!mesh) return;
    live.delete(key);
    cubes.remove(mesh);
    mesh.geometry?.dispose();
  }

  const _eye = new THREE.Vector3();
  return {
    group,
    centre: centre.clone(),
    step(eye) {
      /* Where the eye is, in the planet's own cubes. */
      _eye.copy(eye).sub(group.position).divideScalar(CUBE);
      const view = visibleChunks([_eye.x, _eye.y, _eye.z]);
      const wanted = new Set(view.chunks.map(keyOf));
      /* Anything no longer wanted goes at once: holding it would be holding
         the budget open for geometry nobody is looking at. */
      for (const key of [...live.keys()]) if (!wanted.has(key)) drop(key);
      /* And the nearest few that are missing are built, a small number a frame
         so a burst of new chunks does not stall. */
      queue = view.chunks.filter((c) => !live.has(keyOf(c)));
      for (let i = 0; i < Math.min(BUILD_PER_FRAME, queue.length); i++) build(queue[i]);

      triangleCount = view.triangles;
      /* The dust is what decides how far chunks are built at all (see
         voxelView), so with the shader gone it still sets the view distance;
         what it no longer does is fade the far ones out. That is the next
         thing to put back, once the cubes are known to draw. */
      void dustFarFor(_eye.length());
    },
    stats: () => ({
      chunks: live.size, triangles: triangleCount, queued: queue.length, built,
    }),
    dispose() {
      for (const key of [...live.keys()]) drop(key);
      material.dispose();
      grid?.dispose();
      rodGeo.dispose(); rodMat.dispose(); rods.dispose();
      heartMesh.geo.dispose(); heartMesh.mat.dispose();
      group.removeFromParent();
    },
  };
}

/** Where a ship should arrive: just outside the surface, facing in. In WORLD
 *  units, relative to the planet's centre. */
export function arrivalOffset(): THREE.Vector3 {
  return new THREE.Vector3(0, 0, toWorld(R_OUTER + SKY_EDGE * 0.35));
}

/** How far from Earth's centre a ship has to be allowed to go to be here. */
export const CEILING_FOR_SPIKEWORLD = (distanceFromEarth: number): number =>
  distanceFromEarth + WORLD_RADIUS + toWorld(SKY_EDGE) + 200;
