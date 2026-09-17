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
import { meshChunk, FACE_SHADE, type ChunkMesh } from "./voxelMesh";
import { visibleChunks, dustFarFor, ringFor, parentOf, type ChunkRef } from "./voxelView";
import { spikes, SPIKE_COUNT } from "./voxelSpikes";

/**
 * How many chunks may be built in one frame, and how many are kept once built.
 *
 * A chunk is a few milliseconds, so three is about as many as a frame can take
 * without showing. Keeping two hundred means turning round does not rebuild
 * what was behind you: they are hidden and shown again, which is free.
 */
/**
 * How long chunk building may take in one frame, in milliseconds, and how many
 * chunks are kept once built.
 *
 * A BUDGET IN TIME, not a count. It was three chunks a frame, on the belief
 * that a chunk is "a few milliseconds"; the measurement in the plan says a
 * coarse chunk is seventeen, so three of them is fifty milliseconds and a
 * guaranteed hitch every time the view moved onto new ground. One is always
 * built, however long it takes, or a slow chunk would never be built at all;
 * after that the clock decides.
 */
const BUILD_MS = 6;
/**
 * How many built chunks are kept.
 *
 * It was 260 and that was too few, which DFlow caught at once: "261 chunks up
 * ... 1 waiting", a chunk built every tenth of a second, for ever. The cap was
 * below what the hysteresis wanted to keep on screen, so every frame threw one
 * away and built it again. A chunk destroyed and rebuilt is a chunk that
 * BLINKS, which is the thing the hysteresis was added to stop.
 *
 * It is also cheap to be generous: an empty chunk is a few bytes and a chunk
 * out of range is not drawn, so the cost of keeping one is memory alone.
 */
const CACHE_CHUNKS = 520;
/** How far past its ring a chunk stays drawn once it is up. A third again. */
const KEEP = 1.35;

/** The rock, and the dust it fades into. */
const ROCK_COLOUR = 0x8a90a0;
const HEART_COLOUR = 0xff8a4a;
const SPIKE_COLOUR = 0x585d68;

export interface VoxelPlanet {
  group: THREE.Group;
  /** Where its centre sits in the game's world. */
  centre: THREE.Vector3;
  /** Move it on. `eye` is the camera in WORLD units. */
  step(eye: THREE.Vector3, look: THREE.Vector3): void;
  /** For DFlow: what it is costing right now. */
  stats(): {
    chunks: number; triangles: number; queued: number; built: number;
    dropped: number; shown: number;
  };
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

  /* ---- NO LIGHTS. THE SHADING IS IN THE MESH ----
     Geoff: the things that did draw were "all identical color with no shading
     at all so they have no 3D appearance". Quite right, and the first answer
     to it was a directional light and an ambient light of the planet's own.
     That worked, and it cost far too much.

     Three.js builds a DIFFERENT SHADER for every number of lights in a scene,
     so adding two of them recompiled every lit material in the whole game the
     moment the ship arrived: the ships, the globe's towers, the effects, all
     of it. DFlow, 69.9.54: twenty shader compiles and one frame that spent
     791 milliseconds inside the renderer. That is a freeze you can feel, and
     I put it there.

     So a face's brightness is baked into the mesh by the way it points (see
     FACE_SHADE) and the materials are unlit. Cheaper per pixel, no recompiles,
     nothing else in the scene disturbed, and the rock cannot go black on a
     side no light reaches. */

  const grid = gridTexture();
  /* Lambert rather than Basic: Basic has no shading at all, which is exactly
     what was wrong. Lambert is the cheapest material that has any, and on flat
     cube faces it is all that is needed. */
  const material = new THREE.MeshBasicMaterial({
    ...(grid ? { map: grid } : {}),
    color: ROCK_COLOUR,
    /* The baked light. Three.js multiplies it into the colour and the map. */
    vertexColors: true,
  });
  /* The mesh AND where it is, so a chunk that has fallen off the list can still
     be measured for the hysteresis below. */
  const live = new Map<string, { mesh: THREE.Mesh; ref: ChunkRef; triangles: number }>();
  let queue: ChunkRef[] = [];
  let built = 0;
  let triangleCount = 0;
  let dropped = 0;

  /* ---- the spikes, and the spokes ----
     Boxes, not cubes. Three thousand rods as one instanced draw is about
     36,000 triangles; the same rods as voxels would be most of the planet's
     whole allowance. A rod one cube wide and a hundred long IS a box, so
     nothing is lost. */
  const rodGeo = new THREE.BoxGeometry(1, 1, 1);
  /* The rods get the same treatment, painted onto the base box: a box has four
     corners to a face and all three thousand instances share the one geometry,
     so this is twenty-four numbers for the lot of them. */
  {
    const n = rodGeo.getAttribute("normal");
    const c = new Float32Array(n.count * 3);
    for (let i = 0; i < n.count; i++) {
      const key = `${Math.round(n.getX(i))},${Math.round(n.getY(i))},${Math.round(n.getZ(i))}`;
      const shade = FACE_SHADE[key] ?? 0.8;
      c[i * 3] = shade; c[i * 3 + 1] = shade; c[i * 3 + 2] = shade;
    }
    rodGeo.setAttribute("color", new THREE.BufferAttribute(c, 3));
  }
  const rodMat = new THREE.MeshBasicMaterial({ color: SPIKE_COLOUR, vertexColors: true });
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
    /* ---- NEVER CULLED ----
       One instanced draw covers the whole planet, so there is no view from
       which most of it is off screen and nothing to win by testing it. What
       there is to LOSE is the whole set of rods disappearing: an instanced
       mesh has a single bounding volume, and one built from the base box
       rather than from the instances is a unit cube at the centre, which is
       off screen whenever the middle of the planet is. The node towers taught
       this same lesson on the globe. */
    rods.frustumCulled = false;
  }
  cubes.add(rods);

  /* ---- the heart ----
     Small, always there, and always worth drawing: it is the thing the spokes
     point at. Meshed once at full detail. */
  const heartMesh = (() => {
    /* The heart ALONE. It used to be meshed from the field the collision uses,
       which also says yes to the spokes, so the two cubes where each spoke
       leaves the heart were drawn twice: once here and once by the spoke's own
       box. Twenty-four of those, which is what Geoff saw still flickering. */
    const m = meshChunk(-R_HEART - 2, -R_HEART - 2, -R_HEART - 2, (R_HEART + 2) * 2, 1, seed, "heart");
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(m.uvs, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(m.colours, 3));
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
    /* Brighter than the rock and unlit like it, so it reads as a glow without
       an emissive channel and without a light to pay for. */
    const mat = new THREE.MeshBasicMaterial({
      color: HEART_COLOUR, vertexColors: true,
      ...(grid ? { map: grid } : {}),
    });
    const mesh = new THREE.Mesh(geo, mat);
    cubes.add(mesh);
    return { mesh, geo, mat };
  })();

  const keyOf = (c: ChunkRef) => `${c.step}:${c.ox},${c.oy},${c.oz}`;

  /** Turn one chunk into geometry. The seam a worker would replace. */
  function build(c: ChunkRef): void {
    /* The shell only: the heart has its own mesh and the spokes are drawn as
       boxes, and a chunk that meshed them too put two surfaces in one place. */
    const m: ChunkMesh = meshChunk(c.ox, c.oy, c.oz, CHUNK, c.step, seed, "shell");
    built++;
    if (!m.indices.length) {
      /* An EMPTY chunk is still worth remembering, and worth remembering as
         costing nothing: a great many of them are, and charging them the
         average is what used to eat the allowance. */
      live.set(keyOf(c), { mesh: new THREE.Mesh(), ref: c, triangles: 0 });
      return;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(m.uvs, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(m.colours, 3));
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    cubes.add(mesh);
    live.set(keyOf(c), { mesh, ref: c, triangles: m.indices.length / 3 });
  }

  function drop(key: string): void {
    const held = live.get(key);
    if (!held) return;
    live.delete(key);
    cubes.remove(held.mesh);
    held.mesh.geometry?.dispose();
  }

  const _eye = new THREE.Vector3();
  return {
    group,
    centre: centre.clone(),
    step(eye, look) {
      /* Where the eye is, in the planet's own cubes. */
      _eye.copy(eye).sub(group.position).divideScalar(CUBE);
      const view = visibleChunks([_eye.x, _eye.y, _eye.z], {
        look: [look.x, look.y, look.z],
        /* What it really costs, for everything already built. */
        costOf: (ox, oy, oz, step) => live.get(`${step}:${ox},${oy},${oz}`)?.triangles,
      });
      const wanted = new Set(view.chunks.map(keyOf));
      /* ---- AND THE HYSTERESIS MUST NOT UNDO THE EXCLUSIVITY ----
         The view now promises that no two chunks it asks for cover the same
         ground. A chunk kept on screen out of hysteresis is NOT in that list
         and can quietly break the promise: it is the parent, or a child, of
         something that is. Both directions have to give way, so every wanted
         chunk marks the whole line of boxes above it as already covered by
         something finer. */
      const coveredByFiner = new Set<string>();
      for (const c of view.chunks) {
        let up = parentOf(c.ox, c.oy, c.oz, c.step);
        while (up) {
          coveredByFiner.add(`${up.step}:${up.ox},${up.oy},${up.oz}`);
          up = parentOf(up.ox, up.oy, up.oz, up.step);
        }
      }
      /** Is some other level already drawing this chunk's ground? */
      const overlapped = (c: ChunkRef): boolean => {
        if (coveredByFiner.has(keyOf(c))) return true;      /* finer is up */
        let up = parentOf(c.ox, c.oy, c.oz, c.step);
        while (up) {
          if (wanted.has(`${up.step}:${up.ox},${up.oy},${up.oz}`)) return true;  /* coarser is up */
          up = parentOf(up.ox, up.oy, up.oz, up.step);
        }
        return false;
      };
      /* ---- ONCE SHOWN, IT STAYS SHOWN ----
         Hiding a chunk the moment it falls off the list is the popping, and
         keeping the geometry did nothing about it: the flicker was never the
         rebuild, it was the LIST changing as the ship moved, so a chunk on the
         edge of a ring or of the allowance blinked in and out frame by frame.
         Geoff, twice: "big chunks of cubes appearing and disappearing right in
         front of me and everywhere."

         So a chunk that is already up stays up until it is well out of range:
         a third again past where it would have been admitted, which is the same
         hysteresis the room uses to stop other ships flickering at the edge of
         view. Nothing is hidden while the ship is anywhere near it. */
      const keepFar = dustFarFor(_eye.length()) / CUBE * KEEP;
      for (const [key, held] of live) {
        if (wanted.has(key)) { held.mesh.visible = true; continue; }
        const c = held.ref;
        const mx = (c.ox + CHUNK / 2) * c.step;
        const my = (c.oy + CHUNK / 2) * c.step;
        const mz = (c.oz + CHUNK / 2) * c.step;
        const d = Math.hypot(mx - _eye.x, my - _eye.y, mz - _eye.z);
        /* Its own ring, plus the slack. Beyond the dust it goes whatever, and
           it goes at once if another level is already drawing its ground. */
        const ring = ringFor(c.step) * KEEP;
        held.mesh.visible = d <= Math.min(ring, keepFar) && !overlapped(c);
      }
      /* ---- THE CACHE HAS TO HAVE A CEILING ----
         It used to drop only chunks that were both off the list and already
         hidden, and the hysteresis above keeps nearly everything visible, so
         in practice nothing was ever dropped: fly across the planet and the
         geometry piles up until the card runs out. Now the furthest ones go,
         list or no list, which is both the right choice and the one that
         cannot be starved. */
      if (live.size > CACHE_CHUNKS) {
        const far: Array<{ key: string; d: number }> = [];
        for (const [key, held] of live) {
          if (wanted.has(key)) continue;
          /* ---- NEVER TAKE AWAY SOMETHING ON SCREEN ----
             The hysteresis above decides what stays up, and this used to
             overrule it: the furthest chunks went whatever they were doing,
             and the furthest chunks are exactly the ones the hysteresis is
             holding. They vanished in front of the ship and were rebuilt a
             moment later. Only what is already hidden may go. */
          if (held.mesh.visible) continue;
          const c = held.ref;
          far.push({
            key,
            d: Math.hypot(
              (c.ox + CHUNK / 2) * c.step - _eye.x,
              (c.oy + CHUNK / 2) * c.step - _eye.y,
              (c.oz + CHUNK / 2) * c.step - _eye.z,
            ),
          });
        }
        far.sort((a, b) => b.d - a.d);
        for (const f of far) {
          if (live.size <= CACHE_CHUNKS) break;
          drop(f.key);
        }
      }
      /* And the nearest that are missing are built, for as long as the frame
         can spare. One at a time is why a turn used to fill in visibly. */
      queue = view.chunks.filter((c) => !live.has(keyOf(c)));
      const until = performance.now() + BUILD_MS;
      for (let i = 0; i < queue.length; i++) {
        build(queue[i]);
        if (performance.now() >= until) break;
      }

      triangleCount = view.triangles;
      dropped = view.dropped;
      /* The dust is what decides how far chunks are built at all (see
         voxelView), so with the shader gone it still sets the view distance;
         what it no longer does is fade the far ones out. That is the next
         thing to put back, once the cubes are known to draw. */
      void dustFarFor(_eye.length());
    },
    stats: () => ({
      chunks: live.size, triangles: triangleCount, queued: queue.length, built,
      /* How many the allowance refused. A number that stays above zero means
         the rings are too generous for this viewpoint, and it is the number
         that goes with things blinking, so it belongs in the report. */
      dropped,
      shown: (() => { let n = 0; for (const h of live.values()) if (h.mesh.visible) n++; return n; })(),
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
