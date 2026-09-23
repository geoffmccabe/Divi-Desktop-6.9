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
  CUBE, CHUNK, R_OUTER, R_INNER, R_HEART, WORLD_RADIUS, SKY_EDGE, HEART_HP, toWorld,
} from "./voxelWorld";
import { spokeDirections } from "./voxelField";
import { meshChunk, FACE_SHADE, type ChunkMesh } from "./voxelMesh";
import { dustFarFor, DUST_FAR_OPEN, type ChunkRef } from "./voxelView";
import { LodSet, keyOf } from "./voxelLod";
import { DissolvePool, DISSOLVE_SECONDS } from "./voxelDissolve";
import { spikes, SPIKE_COUNT } from "./voxelSpikes";

/**
 * How many chunks may be built in one frame, and how many are kept once built.
 *
 * A chunk is a few milliseconds, so three is about as many as a frame can take
 * without showing. Keeping two hundred means turning round does not rebuild
 * what was behind you: they are hidden and shown again, which is free.
 */
/**
 * How long chunk building may take in one frame, in milliseconds.
 *
 * TWO NUMBERS, because the right answer is not the same in the two situations.
 *
 * In steady flight almost nothing is missing and a long build is a stutter for
 * no reason, so the frame gives it very little. But when a great deal of new
 * ground arrives at once, which is what crossing into the cavity is, holding
 * to that little means a second of flying at a wall that is not drawn: over a
 * measured flight, one frame in eighty had a real hole in it and the worst had
 * three quarters of the view missing. Geoff: "giant holes ... you can see right
 * through it from one side to the other."
 *
 * So the allowance rises with the size of the queue. A long queue means
 * something dramatic just changed, and in that moment a frame or two of
 * stutter is much the better bargain: a stutter passes, a hole in the planet
 * is the planet being wrong. Measured, this takes the frames with holes in
 * them from 129 of 10,678 to 27, and the remaining worst is the single frame
 * where nothing could have been built yet whatever the allowance.
 */
const BUILD_MS_EASY = 5;
const BUILD_MS_BUSY = 24;
/** Above this many waiting, the frame stops being precious about it. */
const BUSY_QUEUE = 12;
/**
 * How many built chunks are kept.
 *
 * Reaching this is now the ONLY way a chunk can stop being drawn with nothing
 * covering its ground, and measured over a flight it accounted for 48 of the
 * 58 that did. So it is generous, and it can afford to be: dropping the
 * normals, which an unlit material never reads, took a quarter off what each
 * chunk costs on the card, and a chunk nothing is looking at costs memory and
 * nothing else.
 */
const CACHE_CHUNKS = 760;
/** How far past the dust a chunk stays drawn once it is up. A third again. */
const KEEP = 1.35;

/** The rock, and the dust it fades into. */
const ROCK_COLOUR = 0x8a90a0;
const HEART_COLOUR = 0xff8a4a;
const SPIKE_COLOUR = 0x585d68;

/** The heart, as something that can be shot. */
export interface Heart {
  /** Where it is, in WORLD units, and how big. */
  centre: THREE.Vector3;
  radius: number;
  hp: number;
  max: number;
}

export interface VoxelPlanet {
  group: THREE.Group;
  /** Where its centre sits in the game's world. */
  centre: THREE.Vector3;
  /** Move it on. `eye` is the camera in WORLD units. */
  step(eye: THREE.Vector3, look: THREE.Vector3): void;
  /** The heart: where it is, how big, and what is left of it. */
  heart(): Heart;
  /**
   * Take a bite out of the heart, and return what is left.
   *
   * The heart dims as it goes, from its full orange down towards a dull ember,
   * which is the only feedback a player has at a distance that the million is
   * moving at all. It does not die at zero yet: what happens then is a design
   * question nobody has answered, and a boss that quietly vanishes would be
   * worse than one that sits there at nothing.
   */
  hitHeart(damage: number): number;
  /** For DFlow: what it is costing right now. */
  stats(): {
    chunks: number; triangles: number; queued: number; built: number;
    dropped: number; shown: number;
    /** Why chunks have stopped being drawn, by reason, since the start. */
    gone: Record<string, number>;
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

  /* ---- NOTHING HERE EVER MOVES ----
     A trace of the web build, navigating inside Spikeworld, spent 876ms in
     updateMatrixWorld and another 201ms in multiplyMatrices: nearly a tenth of
     all the CPU the page used, recomputing where things are. Three.js walks the
     whole scene every frame and rebuilds each object's world matrix, and it has
     to, because in general things move.

     Not these. A chunk's vertices carry their own place in the planet, so every
     chunk mesh sits at the origin with an identity matrix that will never
     change again; the group holding them is scaled once and put where the
     planet is, and the planet does not go anywhere either. So the matrices are
     worked out once, here, and three.js is told to stop asking. The camera
     still moves, which is what actually changes the picture.

     `matrixWorldNeedsUpdate` is set once after the parents are in place; the
     chunk meshes do the same as they are built. */
  group.updateMatrix();
  cubes.updateMatrix();
  group.matrixAutoUpdate = false;
  cubes.matrixAutoUpdate = false;

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
    /* The rods are placed by their instance matrices and the mesh itself never
       moves, so it does not need asking about either. */
    rods.matrixAutoUpdate = false;
    rods.updateMatrix();
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
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    cubes.add(mesh);
    return { mesh, geo, mat };
  })();

  /* The heart's own health, held here because the heart is drawn here and
     because the room will own this the moment the fight out here is the
     room's. See HEART_HP for why a million. */
  let heartHp = HEART_HP;
  const _heart: Heart = {
    centre: centre.clone(),
    radius: R_HEART * CUBE,
    hp: heartHp,
    max: HEART_HP,
  };

  /* ---- WHAT IS BUILT AND WHAT IS SHOWN ----
     Decided in voxelLod, which has no three.js in it and is flown in a test
     that counts what changes on screen. Five releases of rules written here
     and judged by eye did not hold the planet still; the rules are now where
     they can be measured. This file only turns its answers into meshes. */
  const lod = new LodSet();
  const meshes = new Map<string, THREE.Mesh>();
  /* ---- SWAPS DISSOLVE ----
     When a coarse box gives way to its fine chunks (or the other way), the
     two are crossfaded pixel by pixel (see voxelDissolve) rather than swapped
     in one frame. The outgoing mesh stays drawn, on the far side of the
     pattern, until the fade is over. */
  const pool = new DissolvePool(material);
  const fades = new Map<string, { incoming: boolean; t: number }>();
  let lastStep = -1;
  let queue: ChunkRef[] = [];
  let built = 0;
  let triangleCount = 0;
  let dropped = 0;

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
      lod.add(c, 0);
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
    /* Its place is in its vertices, so its matrix is the identity for ever.
       See the note where the groups are made. */
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    /* Built HIDDEN. It appears when the rules say so, which for a chunk
       replacing a coarser one is the frame all of its siblings are in. */
    mesh.visible = false;
    cubes.add(mesh);
    meshes.set(keyOf(c), mesh);
    lod.add(c, m.indices.length / 3);
  }

  function drop(key: string): void {
    lod.remove(key);
    fades.delete(key);
    const mesh = meshes.get(key);
    if (!mesh) return;
    pool.release(mesh);
    meshes.delete(key);
    cubes.remove(mesh);
    mesh.geometry?.dispose();
  }

  /** A chunk starts coming in or going out. A fade already running the other
      way is turned round from where it is, so nothing jumps. */
  function startFade(key: string, incoming: boolean): void {
    const mesh = meshes.get(key);
    if (!mesh) return;
    const f = fades.get(key);
    if (f) {
      if (f.incoming !== incoming) { f.incoming = incoming; f.t = 1 - f.t; }
    } else {
      fades.set(key, { incoming, t: 0 });
    }
    mesh.visible = true;
    pool.set(mesh, fades.get(key)!.t, incoming);
  }

  function advanceFades(dt: number): void {
    for (const [key, f] of fades) {
      f.t += dt / DISSOLVE_SECONDS;
      const mesh = meshes.get(key);
      if (!mesh) { fades.delete(key); continue; }
      if (f.t >= 1) {
        fades.delete(key);
        pool.release(mesh);
        mesh.visible = f.incoming;
      } else {
        pool.set(mesh, f.t, f.incoming);
      }
    }
  }

  const _eye = new THREE.Vector3();
  return {
    group,
    centre: centre.clone(),
    step(eye, look) {
      /* Where the eye is, in the planet's own cubes. */
      _eye.copy(eye).sub(group.position).divideScalar(CUBE);
      const at: [number, number, number] = [_eye.x, _eye.y, _eye.z];
      const plan = lod.plan(at, [look.x, look.y, look.z]);
      queue = plan.build;
      /* Build the nearest that are missing, for as long as the frame can
         spare: little in steady flight, more when a great deal is missing at
         once (see BUILD_MS_BUSY). */
      const until = performance.now()
        + (queue.length > BUSY_QUEUE ? BUILD_MS_BUSY : BUILD_MS_EASY);
      for (let i = 0; i < queue.length; i++) {
        build(queue[i]);
        if (performance.now() >= until) break;
      }
      /* Then decide what is shown, and apply only what changed. */
      const keepFar = (DUST_FAR_OPEN / CUBE) * KEEP;
      const change = lod.resolve(at, keepFar);
      for (const k of change.shown) startFade(k, true);
      for (const k of change.hidden) startFade(k, false);
      const now = performance.now();
      const dt = lastStep < 0 ? 1 / 60 : Math.min(0.1, (now - lastStep) / 1000);
      lastStep = now;
      advanceFades(dt);
      /* ---- THE CACHE HAS TO HAVE A CEILING ----
         The furthest hidden chunks go first, and only then the furthest shown
         ones that nothing wants; fly across the planet and the geometry would
         otherwise pile up until the card runs out. */
      for (const k of lod.evictions(at, CACHE_CHUNKS)) drop(k);
      triangleCount = plan.triangles;
      dropped = plan.dropped;
      /* The dust is what decides how far chunks are built at all (see
         voxelView), so with the shader gone it still sets the view distance;
         what it no longer does is fade the far ones out. That is the next
         thing to put back, once the cubes are known to draw. */
      void dustFarFor(_eye.length());
    },
    heart: () => { _heart.hp = heartHp; return _heart; },
    hitHeart: (damage) => {
      if (!(damage > 0)) return heartHp;
      heartHp = Math.max(0, heartHp - damage);
      /* Dimming, not reddening: the colour stays the heart's own so it is
         still recognisably the thing you came for, and only the brightness
         says how it is doing. */
      const left = heartHp / HEART_HP;
      heartMesh.mat.color.setHex(HEART_COLOUR).multiplyScalar(0.35 + 0.65 * left);
      return heartHp;
    },
    stats: () => ({
      chunks: lod.live.size, triangles: triangleCount, queued: queue.length, built,
      /* How many the allowance refused. A number that stays above zero means
         the rings are too generous for this viewpoint, and it is the number
         that goes with things blinking, so it belongs in the report. */
      dropped,
      shown: lod.shownCount(),
      gone: { ...lod.gone },
    }),
    dispose() {
      for (const key of [...lod.live.keys()]) drop(key);
      pool.dispose();
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
