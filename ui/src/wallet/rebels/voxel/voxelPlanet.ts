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
import { visibleChunks, dustFarFor, DUST_FAR_OPEN, parentOf, type ChunkRef } from "./voxelView";
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
  /* The mesh AND where it is, so a chunk that has fallen off the list can still
     be measured for the hysteresis below. */
  const live = new Map<string, { mesh: THREE.Mesh; ref: ChunkRef; triangles: number }>();
  let queue: ChunkRef[] = [];
  let built = 0;
  let triangleCount = 0;
  let dropped = 0;
  /** Why chunks stopped being drawn, counted since the planet was made. */
  const gone: Record<string, number> = {};
  /** Every box that has finer detail on screen beneath it. Rebuilt each frame. */
  const finerDrawn = new Set<string>();

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
      const blank = new THREE.Mesh();
      blank.matrixAutoUpdate = false;
      live.set(keyOf(c), { mesh: blank, ref: c, triangles: 0 });
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
    cubes.add(mesh);
    live.set(keyOf(c), { mesh, ref: c, triangles: m.indices.length / 3 });
  }

  function drop(key: string): void {
    const held = live.get(key);
    if (!held) return;
    if (held.mesh.visible) gone.evicted = (gone.evicted ?? 0) + 1;
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
      /* ---- WHICH GROUND ALREADY HAS FINER DETAIL ON SCREEN ----
         Every box above something that is being drawn. One pass over what is
         on screen, walking up, which is a few hundred steps; the same answer
         found by walking down would be thousands of lookups for every box the
         view considers. The view uses it to leave a coarse box alone while
         anything finer is still drawing that ground. */
      finerDrawn.clear();
      for (const [key, held] of live) {
        if (!held.mesh.visible) continue;
        const c = held.ref;
        void key;
        let up = parentOf(c.ox, c.oy, c.oz, c.step);
        while (up) {
          finerDrawn.add(`${up.step}:${up.ox},${up.oy},${up.oz}`);
          up = parentOf(up.ox, up.oy, up.oz, up.step);
        }
      }
      const view = visibleChunks([_eye.x, _eye.y, _eye.z], {
        look: [look.x, look.y, look.z],
        /* What it really costs, for everything already built. */
        costOf: (ox, oy, oz, step) => live.get(`${step}:${ox},${oy},${oz}`)?.triangles,
        /* What is on screen for this ground right now, so a box near a detail
           boundary keeps the level it already has instead of changing its mind
           every time the ship drifts across the line. */
        lodHold: (ox, oy, oz, step) => {
          const held = live.get(`${step}:${ox},${oy},${oz}`);
          if (held && held.mesh.visible) return true;        /* this box is up */
          /* ---- ANY DESCENDANT, NOT JUST THE CHILDREN ----
             This looked one level down and reasoned that anything finer would
             have kept the children up in turn. That is simply wrong. If the
             ground is being drawn at step 1, a step-4 box's step-2 children are
             not up at all, because nothing is drawn at step 2; so the search
             found nothing, the band defaulted to the coarse answer, the box
             merged, and every fine chunk beneath it was hidden as "coarser".

             A step-16 box has four thousand step-1 descendants. That is why
             Geoff saw whole layers go at once: "every few seconds all the cubes
             around me shift and change, as if they are being recreated
             differently" and "perhaps a new layer of cubes is appearing or
             disappearing". DFlow caught it exactly: shown fell from 284 to 93
             in one moment while the "coarser" count jumped by 280.

             So the answer comes from `finerDrawn`, built once a frame by
             walking UP from everything on screen. Walking down would mean
             thousands of lookups per box. */
          if (finerDrawn.has(`${step}:${ox},${oy},${oz}`)) return false;
          return undefined;                                  /* nothing here yet */
        },
      });
      const wanted = new Set(view.chunks.map(keyOf));
      /* ---- AND THE HYSTERESIS MUST NOT UNDO THE EXCLUSIVITY ----
         The view now promises that no two chunks it asks for cover the same
         ground. A chunk kept on screen out of hysteresis is NOT in that list
         and can quietly break the promise: it is the parent, or a child, of
         something that is. Both directions have to give way, so every wanted
         chunk marks the whole line of boxes above it as already covered by
         something finer. */
      /* ---- AND A PARENT ONLY STANDS DOWN WHEN ALL OF ITS REPLACEMENTS ARE THERE ----
         Twice wrong now, the same way, a little less each time.

         First I hid a coarse chunk the moment a finer one was ASKED FOR, so
         the big box vanished at once and the eight small ones arrived over the
         next several frames: "even more cubes are appearing and disappearing
         all over" (69.9.56).

         Then I hid it once a finer one had been BUILT, which sounds right and
         is still wrong, because a coarse box is replaced by EIGHT finer ones
         and one of them is not a replacement. Building the first child hid the
         parent and left seven eighths of that ground drawn by nothing. A box
         splits every time the ship moves a little closer, at every distance at
         once, which is exactly what Geoff then saw: "big groups appearing and
         disappearing as I move around. Some very close, some far away ... it
         looks terrible."

         So the count has to be kept. A parent gives way when every wanted
         child under it is built and not before; until then it keeps drawing,
         over the top of the few that have arrived. An overlap is a shimmer for
         a frame or two. A gap is the planet being wrong. */
      const under = new Map<string, { wanted: number; built: number }>();
      for (const c of view.chunks) {
        const here = live.has(keyOf(c)) ? 1 : 0;
        let up = parentOf(c.ox, c.oy, c.oz, c.step);
        while (up) {
          const k = `${up.step}:${up.ox},${up.oy},${up.oz}`;
          const tally = under.get(k) ?? { wanted: 0, built: 0 };
          tally.wanted++;
          tally.built += here;
          under.set(k, tally);
          up = parentOf(up.ox, up.oy, up.oz, up.step);
        }
      }
      /** Every finer chunk that replaces this one is built and drawing. */
      const replaced = (key: string): boolean => {
        const tally = under.get(key);
        return !!tally && tally.built === tally.wanted;
      };
      /** Is some other level already drawing this chunk's ground? */
      const overlapped = (c: ChunkRef): boolean => !!whyGone(c);
      /**
       * Why this chunk should stop being drawn, or "" to keep it.
       *
       * Named reasons rather than one boolean, because every version of this
       * file has hidden rock it should have kept and the reason was never
       * visible from outside. They are counted into DFlow, so "big groups
       * appearing and disappearing" becomes a number with a cause next to it
       * instead of something to reason about.
       */
      const whyGone = (c: ChunkRef): string => {
        if (replaced(keyOf(c))) return "replaced";          /* all the finer ones are up */
        let up = parentOf(c.ox, c.oy, c.oz, c.step);
        while (up) {
          const k = `${up.step}:${up.ox},${up.oy},${up.oz}`;
          /* Same rule the other way round: a coarser chunk only displaces this
             one once it is actually built and drawing. */
          if (wanted.has(k) && live.has(k)) return "coarser";
          up = parentOf(up.ox, up.oy, up.oz, up.step);
        }
        return "";
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
      /* ---- WHAT IS ALLOWED TO TAKE ROCK AWAY ----
         Measured over a flight: 498 chunks stopped being drawn because they
         were past their level's ring and 343 because the dust closed in, while
         only 5 went because something else had taken over their ground. So
         almost every one of Geoff's "big groups appearing and disappearing"
         was one of these two rules, not the exclusivity I kept re-fixing.

         Both are left over from the scheme that drew some ground twice. Now
         that exactly one level covers each piece of ground, there is only one
         honest reason to stop drawing a chunk: SOMETHING ELSE IS DRAWING IT.
         Being far for its own level is not a reason, because a chunk that has
         receded has a coarser box over it and that box says so itself once it
         is built. The ring test was hiding rock on the chance that something
         else was there.

         The dust is the other one. It decides how far chunks are ASKED for,
         which is right, and it was also deciding when to stop drawing them,
         which is a hard edge with no fade behind it: fly into the rock, the
         dust closes from a thousand cubes to three hundred, and everything
         past three hundred pops out in a body. So the keeping distance is now
         the open figure always, further than the planet is wide, and the dust
         goes back to being about what to ask for. */
      const keepFar = (DUST_FAR_OPEN / CUBE) * KEEP;
      for (const [key, held] of live) {
        if (wanted.has(key)) { held.mesh.visible = true; continue; }
        const c = held.ref;
        const mx = (c.ox + CHUNK / 2) * c.step;
        const my = (c.oy + CHUNK / 2) * c.step;
        const mz = (c.oz + CHUNK / 2) * c.step;
        const d = Math.hypot(mx - _eye.x, my - _eye.y, mz - _eye.z);
        /* Its own ring, plus the slack. Beyond the dust it goes whatever, and
           it goes at once if another level is already drawing its ground. */
        const was = held.mesh.visible;
        const why = d > keepFar ? "dust" : whyGone(c);
        held.mesh.visible = !why;
        if (was && why) gone[why] = (gone[why] ?? 0) + 1;
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
        /* Still over, because nothing is hidden any more? Then the furthest
           still-drawn chunks go, furthest first. This is the one remaining way
           a chunk can vanish with nothing covering it, so it is counted, and
           it should only ever happen a very long way off. */
        if (live.size > CACHE_CHUNKS) {
          const out: Array<{ key: string; d: number }> = [];
          for (const [key, held] of live) {
            if (wanted.has(key)) continue;
            const c = held.ref;
            out.push({
              key,
              d: Math.hypot(
                (c.ox + CHUNK / 2) * c.step - _eye.x,
                (c.oy + CHUNK / 2) * c.step - _eye.y,
                (c.oz + CHUNK / 2) * c.step - _eye.z,
              ),
            });
          }
          out.sort((a, b) => b.d - a.d);
          for (const f of out) {
            if (live.size <= CACHE_CHUNKS) break;
            drop(f.key);
          }
        }
      }
      /* And the nearest that are missing are built, for as long as the frame
         can spare. One at a time is why a turn used to fill in visibly. */
      /* ---- A COARSE STAND-IN, RATHER THAN A HOLE ----
         When a lot of new ground arrives at once, which is what crossing into
         the cavity is, the fine chunks for it take a second or more to build
         and until then there is nothing there at all. Measured over a whole
         flight: one frame in eighty had a real hole in it and the worst had
         three quarters of the view missing. That is Geoff's "giant holes ...
         you can see right through it from one side to the other".

         A chunk one level up covers eight times the ground for about a
         quarter of the cost, so it is built FIRST and shown while the fine
         ones come in behind it. A blurred wall for a moment is not the same
         kind of wrong as no wall at all. */
      const missing = view.chunks.filter((c) => !live.has(keyOf(c)));
      const standIns: ChunkRef[] = [];
      if (missing.length > 4) {
        const asked = new Set<string>();
        for (const c of missing) {
          const up = parentOf(c.ox, c.oy, c.oz, c.step);
          if (!up) continue;
          const k = `${up.step}:${up.ox},${up.oy},${up.oz}`;
          if (live.has(k) || asked.has(k)) continue;
          /* ---- ONLY WHERE THERE IS NOTHING TO STAND IN FOR ----
             A stand-in is a coarse box put up while the fine ones for its
             ground are still building. If some of that ground is ALREADY being
             drawn finely, the stand-in is not filling a gap, it is laying a
             second, blurrier surface over rock that is already there, and the
             two disagree about where the cubes are. It goes up and comes down
             again a moment later when the last fine chunk arrives.
             That is a new layer of cubes appearing and disappearing, which is
             what Geoff described, and it happens whenever more than four
             chunks are queued, which while flying is most of the time.
             Geoff: "every few seconds all the cubes around me shift and change
             ... perhaps a new layer of cubes is appearing or disappearing.
             Sometimes it happens 2-3 times very quickly, in a single second." */
          if (finerDrawn.has(k)) continue;
          asked.add(k);
          standIns.push({ ...up, distance: c.distance });
        }
      }
      queue = [...standIns, ...missing];
      const until = performance.now()
        + (queue.length > BUSY_QUEUE ? BUILD_MS_BUSY : BUILD_MS_EASY);
      for (let i = 0; i < queue.length; i++) {
        build(queue[i]);
        if (performance.now() >= until) break;
      }
      /* A stand-in has to be SHOWN the moment it exists, or it was built for
         nothing: it is not in the wanted list, so only the pass above would
         have looked at it, and that pass has already run this frame. */
      for (const c of standIns) {
        const held = live.get(keyOf(c));
        /* And not if something finer has arrived for that ground in the
           meantime: the gap it was built for has closed. */
        if (held && !overlapped(c) && !finerDrawn.has(keyOf(c))) held.mesh.visible = true;
      }
      /* And anything whose replacements were ALL completed by this frame's
         building can stand down now rather than next frame, because a frame of
         both is a frame of shimmer. The tally is simply taken again: building
         has just changed the answer, and counting it is one pass over a list
         we already have. */
      if (queue.length) {
        under.clear();
        for (const c of view.chunks) {
          const here = live.has(keyOf(c)) ? 1 : 0;
          let up = parentOf(c.ox, c.oy, c.oz, c.step);
          while (up) {
            const k = `${up.step}:${up.ox},${up.oy},${up.oz}`;
            const tally = under.get(k) ?? { wanted: 0, built: 0 };
            tally.wanted++;
            tally.built += here;
            under.set(k, tally);
            up = parentOf(up.ox, up.oy, up.oz, up.step);
          }
        }
        for (const [k, tally] of under) {
          if (tally.built !== tally.wanted) continue;
          const held = live.get(k);
          if (!held || !held.mesh.visible) continue;
          held.mesh.visible = false;
          gone.replaced = (gone.replaced ?? 0) + 1;
        }
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
      gone: { ...gone },
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
