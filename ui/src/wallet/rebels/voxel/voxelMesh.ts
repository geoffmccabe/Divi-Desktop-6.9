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

import { solidAt } from "./voxelField";

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
): ChunkMesh {
  const field = (i: number, j: number, k: number) => solidAt(i, j, k, step, seed);
  const n3 = size * size * size;
  const at = new Uint8Array(n3);
  const idx = (i: number, j: number, k: number) => (k * size + j) * size + i;
  let cubes = 0;
  for (let k = 0; k < size; k++) {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const s = field(ox + i, oy + j, oz + k) ? 1 : 0;
        at[idx(i, j, k)] = s;
        cubes += s;
      }
    }
  }
  /* Inside the chunk from the array; outside it from the field. A chunk that
     guessed its neighbours were empty would draw a wall at every chunk edge. */
  const get = (i: number, j: number, k: number): number => {
    if (i >= 0 && j >= 0 && k >= 0 && i < size && j < size && k < size) return at[idx(i, j, k)];
    return field(ox + i, oy + j, oz + k) ? 1 : 0;
  };

  const pos: number[] = [], nor: number[] = [], uv: number[] = [], ind: number[] = [];
  let faces = 0, quads = 0;
  const mask = new Uint8Array(size * size);

  for (const face of FACES) {
    const [nx, ny, nz] = face.n;
    /* One slice at a time, perpendicular to the face. Within a slice the
       exposed faces are a flat picture, and merging them is a two-dimensional
       problem: find the widest run, then grow it downwards while every row
       under it matches. */
    for (let s = 0; s < size; s++) {
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
          quads++;
          emit(pos, nor, uv, ind, face, s, a, b, w, h, step, ox, oy, oz);
        }
      }
    }
  }

  return {
    origin: [ox, oy, oz], step,
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    uvs: new Float32Array(uv),
    indices: new Uint32Array(ind),
    cubes, faces, quads,
  };
}

/** One merged rectangle, as two triangles, in CUBE coordinates.
 *
 *  Written without allocating anything: the four corners go straight into the
 *  output arrays. The readable version built a small array per corner and per
 *  quad, which on a busy chunk is tens of thousands of throwaway objects. */
function emit(
  pos: number[], nor: number[], uv: number[], ind: number[],
  face: { n: [number, number, number]; u: number; v: number; axis: number },
  s: number, a: number, b: number, w: number, h: number,
  step: number, ox: number, oy: number, oz: number,
): void {
  const [nx, ny, nz] = face.n;
  const out = nx + ny + nz > 0;
  /* The face sits on the far side of the cell when the normal points outwards. */
  const lo = s + (out ? 1 : 0);
  const base = pos.length / 3;
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
  const da = anti ? [0, w, w, 0] : [0, 0, w, w];
  const db = anti ? [0, 0, h, h] : [0, h, h, 0];
  for (let c = 0; c < 4; c++) {
    const ua = a + da[c], vb = b + db[c];
    let x: number, y: number, z: number;
    if (face.axis === 0) { x = lo; y = ua; z = vb; }
    else if (face.axis === 1) { x = ua; y = lo; z = vb; }
    else { x = ua; y = vb; z = lo; }
    /* Out of the chunk's own cells and into cubes, which is what the game
       measures in. */
    pos.push((x + ox) * step, (y + oy) * step, (z + oz) * step);
    nor.push(nx, ny, nz);
  }
  /* Measured in cubes, so a repeating grid texture shows one square per cube
     however large the merged rectangle is. */
  const su = w * step, sv = h * step;
  if (out) uv.push(0, 0, su, 0, su, sv, 0, sv);
  else uv.push(0, 0, 0, sv, su, sv, su, 0);
  ind.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Triangles in a finished chunk. For the budget. */
export const triangles = (m: ChunkMesh): number => m.indices.length / 3;
