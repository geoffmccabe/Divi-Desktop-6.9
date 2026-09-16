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
  visibleChunks, dustFarFor, SKIN_BY_STEP, DUST_NEAR, type ChunkRef,
} from "./voxelView";
import { spikes, SPIKE_COUNT } from "./voxelSpikes";

/** How many chunks may be built in one frame. A chunk is about twenty
 *  milliseconds, so more than one is a visible hitch. */
const BUILD_PER_FRAME = 1;

/** The rock, and the dust it fades into. */
const ROCK_COLOUR = 0x6b6f7a;
const RIM_COLOUR = 0x9aa3b4;
const DUST_COLOUR = 0x141821;
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
 * A voxel-cube material that fades into the dust.
 *
 * Two things are wanted of it that a stock material will not do: the cube grid
 * has to show on merged faces (a rectangle thirty cubes wide is one quad, so
 * the grid comes from the coordinates rather than from a texture), and the
 * fade has to be by distance from the eye so the far rings dissolve rather than
 * pop when they change detail.
 */
function rockMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRock: { value: new THREE.Color(ROCK_COLOUR) },
      uRim: { value: new THREE.Color(RIM_COLOUR) },
      uDust: { value: new THREE.Color(DUST_COLOUR) },
      uNear: { value: DUST_NEAR },
      uFar: { value: 3000 },
      uCube: { value: CUBE },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying float vDist;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uRock; uniform vec3 uRim; uniform vec3 uDust;
      uniform float uNear; uniform float uFar;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying float vDist;
      void main() {
        /* The cube grid, from the face's own coordinates: one square per cube
           however many cubes the merged rectangle covers. */
        vec2 g = abs(fract(vUv) - 0.5);
        float line = 1.0 - smoothstep(0.42, 0.5, max(g.x, g.y));
        /* A plain directional shade so the six faces of a cube read apart.
           Cheaper than a light and it cannot be got wrong by the scene. */
        float lit = 0.55 + 0.45 * clamp(dot(vNormal, normalize(vec3(0.4, 0.8, 0.3))), 0.0, 1.0);
        vec3 c = mix(uRim, uRock, line) * lit;
        /* Into the dust, so the far rings dissolve instead of popping when
           their detail changes. */
        float dust = clamp((vDist - uNear) / max(1.0, uFar - uNear), 0.0, 1.0);
        gl_FragColor = vec4(mix(c, uDust, dust), 1.0);
      }`,
  });
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

  const material = rockMaterial();
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
      /* The dust follows the eye out of the rock and into the open. */
      const far = dustFarFor(_eye.length());
      (material.uniforms.uFar.value as number) = far;
      material.uniforms.uNear.value = Math.min(DUST_NEAR, far * 0.5);
    },
    stats: () => ({
      chunks: live.size, triangles: triangleCount, queued: queue.length, built,
    }),
    dispose() {
      for (const key of [...live.keys()]) drop(key);
      material.dispose();
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
