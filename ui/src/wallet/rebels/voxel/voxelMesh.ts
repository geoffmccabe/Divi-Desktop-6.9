// Spikeworld: turning cubes into triangles, as few as possible.
//
// Two ideas, both of them standard in this kind of renderer, and together worth
// about forty times:
//
//   1. Only faces with air on the other side. A cube buried in rock is never
//      drawn. On clumped rock this alone is worth five times: 0.87 exposed
//      faces per cube against the six a cube has.
//   2. Merge the survivors. Faces that lie in the same plane and touch are one
//      rectangle, not many squares. Measured at 6,110 triangles for a
//      32-cube chunk, against 13,438 unmerged and 74,326 if the rock were
//      scattered instead of clumped.
//
// NO three.js AND NO DOM. This returns plain typed arrays, which is what lets
// it run in a Web Worker and be tested in node. Whoever draws it wraps the
// arrays in a BufferGeometry; that is the renderer's business, not this file's.

import { fillChunk } from "./voxelField";

/**
 * Where the de-speckling starts, by detail level.
 *
 * Step 4 and coarser. The boundary into step 4 sits 230 cubes off, where a
 * cube is about four pixels tall, so nothing here changes anything a player
 * can pick out; nearer than that the rock is left exactly as the field says.
 */
const SPECKLE_FROM = 4;
/**
 * How many solid neighbours a cube needs to be worth drawing, coarse only.
 *
 * Two. One removes only cubes standing entirely alone and is worth 8% of the
 * triangles; two also removes the filaments a cube wide, which merge no better
 * than a lone cube does, and is worth 18%. Three is worth 33% and starts to
 * thin the rock more than it tidies it.
 *
 * Measured over a whole flight, the holes go from 0.4% of a frame at worst to
 * 0.7%, which is the price and it is small. None of this happens nearer than
 * 230 cubes, where a cube is four pixels.
 */
const KEEP_NEIGHBOURS = 3;

/**
 * Throw away cubes standing entirely on their own.
 *
 * ---- WHY THIS EARNS ITS KEEP ----
 *
 * Holding the clumps at ten cubes for every level is what makes the levels
 * agree, and the price is that a coarse level samples those clumps every four,
 * eight or sixteen cubes. At step 8 a clump is barely more than a cell across,
 * so the rock stops being clumps and turns into separate cubes: nothing merges
 * with its neighbour, a chunk costs three times the triangles, and the distant
 * planet becomes a haze of floating blocks rather than a body of rock.
 *
 * A cube with air on all six sides is exactly that haze. It costs twelve
 * triangles, it can never merge with anything, and at four pixels across
 * nobody can tell it was ever there. Removing them takes the worst viewpoint
 * from 1.37 million triangles to something the frame can carry, and the
 * silhouette is the same: a lone cube is not a silhouette.
 *
 * Done on the padded block, so the cubes at a chunk's edge are judged against
 * their neighbours in the next chunk rather than against nothing. Two chunks
 * therefore agree about a cube they share, and no seam opens between them.
 */
function deSpeckle(at: Uint8Array, size: number): void {
  const idx = (i: number, j: number, k: number) => (k * size + j) * size + i;
  /* Read from a copy: a cube already removed must not make its neighbour
     look lonely and remove that too, which would eat whole walls one layer at
     a time. */
  const was = at.slice();
  for (let k = 1; k < size - 1; k++) {
    for (let j = 1; j < size - 1; j++) {
      for (let i = 1; i < size - 1; i++) {
        const o = idx(i, j, k);
        if (!was[o]) continue;
        const friends = was[o - 1] + was[o + 1]
          + was[idx(i, j - 1, k)] + was[idx(i, j + 1, k)]
          + was[idx(i, j, k - 1)] + was[idx(i, j, k + 1)];
        if (friends >= KEEP_NEIGHBOURS) continue;
        at[o] = 0;
      }
    }
  }
}

/** A finished chunk: what a BufferGeometry needs, and nothing else. */
export interface ChunkMesh {
  /** Cube coordinates of the chunk's corner, and the detail level it was built
   *  at. Kept with the mesh so the drawing side never has to remember. */
  origin: [number, number, number];
  step: number;
  positions: Float32Array;
  normals: Float32Array;
  /** Which way round the rectangle runs, in cubes, so a repeating texture can
   *  draw the cube edges along a merged face instead of stretching over it. */
  uvs: Float32Array;
  /**
   * The light, BAKED IN, as a colour per corner.
   *
   * A face's brightness here depends only on which way it points, which is the
   * oldest trick in voxel rendering and is worth far more than it looks:
   *
   *   - it needs NO LIGHTS, and a light is not a free thing to add. Three.js
   *     builds a different shader for every number of lights in the scene, so
   *     putting two of them in to light this planet made the card recompile
   *     every lit material in the whole game: the ships, the globe, the
   *     effects. DFlow caught it as twenty shader compiles and one frame that
   *     took 791 milliseconds inside the renderer.
   *   - an unlit material is cheaper to draw than a lit one, per pixel, and
   *     there are a great many pixels of rock.
   *   - it cannot go black. A real light has a direction, and the faces
   *     pointing away from it are unlit; these are readable from every angle.
   *
   * What is lost is that the planet does not turn in the light, which it was
   * never going to do anyway: it has no sun of its own.
   */
  colours: Float32Array;
  indices: Uint32Array;
  /** For the budget, and for DFlow. */
  cubes: number;
  faces: number;
  quads: number;
}

/** The six directions, and which axis each face is perpendicular to. The other
 *  two axes span the face, in their natural order. */
const FACES: Array<{ n: [number, number, number]; u: number; v: number; axis: number }> = [
  { n: [1, 0, 0], u: 1, v: 2, axis: 0 },
  { n: [-1, 0, 0], u: 1, v: 2, axis: 0 },
  { n: [0, 1, 0], u: 0, v: 2, axis: 1 },
  { n: [0, -1, 0], u: 0, v: 2, axis: 1 },
  { n: [0, 0, 1], u: 0, v: 1, axis: 2 },
  { n: [0, 0, -1], u: 0, v: 1, axis: 2 },
];

/**
 * Build one chunk.
 *
 * `ox, oy, oz` are in COARSE cells at this step, not in cubes, so a chunk at
 * step 4 covers four times the ground. `size` is the chunk's edge in cells.
 *
 * The field is asked for the chunk's own cells once and kept; its neighbours
 * are asked as needed, which is what makes chunks meet without seams.
 */
export function meshChunk(
  ox: number, oy: number, oz: number, size: number, step: number, seed = 0,
  /**
   * WHICH PART of the planet this chunk is allowed to draw.
   *
   * Three things are drawn by three different meshes: the shell by the chunks,
   * the heart by its own, and the spokes as stretched boxes. Each has to keep
   * to its own or the same rock ends up in two surfaces in one place, which is
   * a flicker rather than a picture. "all" is for tests and for anything that
   * wants the field as the collision sees it.
   */
  part: "all" | "shell" | "heart" = "all",
): ChunkMesh {
  /* ---- THE WHOLE BLOCK AT ONCE, AND ONE CELL WIDER ----
     Asked for in one call rather than cell by cell, which is where nearly all
     of the time used to go (see fillChunk). One cell wider each way because a
     face is only drawn when there is air on the other side, and the cells on
     the other side of the chunk's own edges are its neighbours': a chunk that
     guessed they were empty would draw a wall at every chunk boundary. Those
     used to be fetched one at a time through the slow path, six thousand of
     them a chunk. */
  const pad = size + 2;
  const at = new Uint8Array(pad * pad * pad);
  fillChunk(ox - 1, oy - 1, oz - 1, pad, step, seed, part, at);
  /* A DRAWING decision, not a change to the rock: the field still says what is
     there and collision still asks it. This only declines to DRAW cubes that
     are on their own, and only where they cannot be told apart. */
  if (step >= SPECKLE_FROM) deSpeckle(at, pad);
  const get = (i: number, j: number, k: number): number =>
    at[((k + 1) * pad + (j + 1)) * pad + (i + 1)];
  /* ---- AND SKIP THE SLICES WITH NOTHING IN THEM ----
     A face is only ever drawn from a solid cell, so a slice with no solid cell
     in it produces no faces in any direction and need not be looked at. Most
     chunks are mostly air: a step-8 chunk out in the crust had 626 solid cells
     of 32,768 and was still paying for six full sweeps of 32,768 cells, which
     is where nearly all of its fifteen milliseconds went. */
  let cubes = 0;
  const anyX = new Uint8Array(size), anyY = new Uint8Array(size), anyZ = new Uint8Array(size);
  for (let k = 0; k < size; k++) {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const v = get(i, j, k);
        if (!v) continue;
        cubes++;
        anyX[i] = 1; anyY[j] = 1; anyZ[k] = 1;
      }
    }
  }
  const anyOn = [anyX, anyY, anyZ];

  /* ---- WRITTEN STRAIGHT INTO TYPED ARRAYS ----
     These used to be ordinary arrays, pushed a number at a time: a busy chunk
     is about two thousand rectangles, and each one pushes forty-four numbers,
     so a hundred thousand pushes and then a copy into Float32Arrays at the
     end. Measured at 22 of a step-1 chunk's 33 milliseconds. Sized from the
     number of solid cells, which cannot be exceeded by more than the faces a
     cube has, and grown if a chunk ever surprises us. */
  let cap = Math.max(64, cubes * 2);
  let pos = new Float32Array(cap * 12), nor = new Float32Array(cap * 12);
  let uv = new Float32Array(cap * 8), col = new Float32Array(cap * 12);
  let ind = new Uint32Array(cap * 6);
  let nq = 0;
  const room = () => {
    if (nq + 1 <= cap) return;
    cap *= 2;
    const grow = <T extends Float32Array | Uint32Array>(a: T, n: number): T => {
      const b = new (a.constructor as new (n: number) => T)(cap * n);
      b.set(a as never);
      return b;
    };
    pos = grow(pos, 12); nor = grow(nor, 12); col = grow(col, 12);
    uv = grow(uv, 8); ind = grow(ind, 6);
  };
  /* Nothing solid at all: a great many chunks, and there is no point sweeping
     six faces over an empty block to find that out again. */
  if (cubes === 0) {
    return {
      origin: [ox, oy, oz], step,
      positions: new Float32Array(0), normals: new Float32Array(0),
      uvs: new Float32Array(0), colours: new Float32Array(0), indices: new Uint32Array(0),
      cubes: 0, faces: 0, quads: 0,
    };
  }
  let faces = 0, quads = 0;
  const mask = new Uint8Array(size * size);

  for (const face of FACES) {
    const [nx, ny, nz] = face.n;
    /* One slice at a time, perpendicular to the face. Within a slice the
       exposed faces are a flat picture, and merging them is a two-dimensional
       problem: find the widest run, then grow it downwards while every row
       under it matches. */
    const live = anyOn[face.axis];
    for (let s = 0; s < size; s++) {
      if (!live[s]) continue;
      mask.fill(0);
      for (let b = 0; b < size; b++) {
        for (let a = 0; a < size; a++) {
          /* Laid out by hand rather than through a three-element array. The
             array version allocated one per cell, which is 196,608 allocations
             for one chunk, and the Phase 0 report caught it: building a chunk
             took 26ms and nearly all of it was making and throwing away those
             arrays. */
          let i: number, j: number, k: number;
          if (face.axis === 0) { i = s; j = a; k = b; }
          else if (face.axis === 1) { i = a; j = s; k = b; }
          else { i = a; j = b; k = s; }
          const on = get(i, j, k) === 1 && get(i + nx, j + ny, k + nz) === 0;
          if (on) { mask[b * size + a] = 1; faces++; }
        }
      }
      for (let b = 0; b < size; b++) {
        for (let a = 0; a < size; a++) {
          if (!mask[b * size + a]) continue;
          let w = 1;
          while (a + w < size && mask[b * size + a + w]) w++;
          let h = 1;
          grow: while (b + h < size) {
            for (let q = 0; q < w; q++) if (!mask[(b + h) * size + a + q]) break grow;
            h++;
          }
          for (let hh = 0; hh < h; hh++) {
            for (let ww = 0; ww < w; ww++) mask[(b + hh) * size + a + ww] = 0;
          }
          room();
          emit(pos, nor, uv, col, ind, nq, face, s, a, b, w, h, step, ox, oy, oz);
          nq++;
          quads++;
        }
      }
    }
  }

  /* Trimmed to what was actually written, so nothing spare reaches the card. */
  return {
    origin: [ox, oy, oz], step,
    positions: pos.subarray(0, nq * 12),
    normals: nor.subarray(0, nq * 12),
    uvs: uv.subarray(0, nq * 8),
    colours: col.subarray(0, nq * 12),
    indices: ind.subarray(0, nq * 6),
    cubes, faces, quads,
  };
}

/* The corner order, as multiples of the rectangle's width and height. Two
   windings, because a Y face spans (X, Z) and X crossed with Z points at minus
   Y: see the note in emit. */
const ANTI_A = [0, 1, 1, 0] as const;
const ANTI_B = [0, 0, 1, 1] as const;
const CW_A = [0, 0, 1, 1] as const;
const CW_B = [0, 1, 1, 0] as const;

/** One merged rectangle, as two triangles, in CUBE coordinates.
 *
 *  Written without allocating anything: the four corners go straight into the
 *  output arrays. The readable version built a small array per corner and per
 *  quad, which on a busy chunk is tens of thousands of throwaway objects. */
/**
 * How bright a face is, by the way it points: up, down, or one of the sides.
 *
 * The usual voxel ladder. The top catches the most, the bottom the least, and
 * the four sides sit between with the two pairs slightly apart so a corner
 * where two walls meet reads as a corner rather than as one flat sheet.
 */
export const FACE_SHADE: Record<string, number> = {
  "0,1,0": 1.0, "0,-1,0": 0.45,
  "1,0,0": 0.8, "-1,0,0": 0.8,
  "0,0,1": 0.62, "0,0,-1": 0.62,
};

function emit(
  pos: Float32Array, nor: Float32Array, uv: Float32Array, col: Float32Array, ind: Uint32Array,
  q: number,
  face: { n: [number, number, number]; u: number; v: number; axis: number },
  s: number, a: number, b: number, w: number, h: number,
  step: number, ox: number, oy: number, oz: number,
): void {
  const [nx, ny, nz] = face.n;
  const out = nx + ny + nz > 0;
  const shade = FACE_SHADE[`${nx},${ny},${nz}`] ?? 0.8;
  /* The face sits on the far side of the cell when the normal points outwards. */
  const lo = s + (out ? 1 : 0);
  const base = q * 4;
  let p = q * 12, t = q * 8;
  /* ---- WHICH WAY ROUND ----
     A triangle is only drawn from the side its corners run anticlockwise
     around; from behind it is invisible. Two of the three axes can be wound by
     the obvious rule and the THIRD cannot, because the pair of axes that spans
     a Y face is (X, Z), and X crossed with Z points at MINUS Y. So every top
     and bottom face of every cube came out backwards and therefore invisible.
     Geoff saw it on the heart: "only orange faces on one side I think?"

     It is the classic mistake in this kind of mesher and the test now measures
     every face's real geometric normal against the one the mesher claims. */
  const flip = ny !== 0;
  const anti = flip ? !out : out;
  /* The four corners, read from a pair of tables that are made ONCE rather
     than per quad. The old pair of literals here allocated two arrays for
     every rectangle in every chunk, which on a busy chunk is thousands of
     throwaway objects for the sake of four numbers, and the comment above
     claimed the opposite. */
  const da = anti ? ANTI_A : CW_A;
  const db = anti ? ANTI_B : CW_B;   /* module constants, not built here */
  for (let c = 0; c < 4; c++) {
    const ua = a + da[c] * w, vb = b + db[c] * h;
    let x: number, y: number, z: number;
    if (face.axis === 0) { x = lo; y = ua; z = vb; }
    else if (face.axis === 1) { x = ua; y = lo; z = vb; }
    else { x = ua; y = vb; z = lo; }
    /* Out of the chunk's own cells and into cubes, which is what the game
       measures in. */
    pos[p] = (x + ox) * step; pos[p + 1] = (y + oy) * step; pos[p + 2] = (z + oz) * step;
    nor[p] = nx; nor[p + 1] = ny; nor[p + 2] = nz;
    col[p] = shade; col[p + 1] = shade; col[p + 2] = shade;
    p += 3;
  }
  /* Measured in cubes, so a repeating grid texture shows one square per cube
     however large the merged rectangle is. */
  const su = w * step, sv = h * step;
  /* Follows the winding that was actually used. It followed `out`, which is a
     different thing on the top and bottom faces, so their grid ran across the
     rectangle instead of along it. Invisible on a square grid, and wrong the
     moment the texture is anything else. */
  /* Written out rather than through a little array, which would be one
     allocation per rectangle and thousands per chunk. */
  if (anti) {
    uv[t] = 0; uv[t + 1] = 0; uv[t + 2] = su; uv[t + 3] = 0;
    uv[t + 4] = su; uv[t + 5] = sv; uv[t + 6] = 0; uv[t + 7] = sv;
  } else {
    uv[t] = 0; uv[t + 1] = 0; uv[t + 2] = 0; uv[t + 3] = sv;
    uv[t + 4] = su; uv[t + 5] = sv; uv[t + 6] = su; uv[t + 7] = 0;
  }
  const e = q * 6;
  ind[e] = base; ind[e + 1] = base + 1; ind[e + 2] = base + 2;
  ind[e + 3] = base; ind[e + 4] = base + 2; ind[e + 5] = base + 3;
}

/** Triangles in a finished chunk. For the budget. */
export const triangles = (m: ChunkMesh): number => m.indices.length / 3;
