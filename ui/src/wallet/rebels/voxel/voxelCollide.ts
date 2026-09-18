// Spikeworld: flying into it.
//
// Geoff: "the cubes in the game need colliders and ships should bounce off of
// them and take a small amount of damage based on velocity. I don't want the
// ships destroyed by taking a few points, like 1-40 based on their speed and
// angle ... impart the correct momentum and reduce speed by 30% when colliding
// and bouncing off at the correct angle (classic physics like billiards)."
//
// WHY THIS IS ITS OWN FILE, and pure
// ---------------------------------
// The field already answers "is there a cube here" as a pure function of the
// cube's coordinates, which is what lets the room and the cockpit agree about
// the planet without either holding one. Collision is the same shape of
// problem, so it is the same shape of answer: numbers in, numbers out, no
// three.js and no DOM. When the room becomes the authority out here it calls
// this, unchanged.
//
// HOW A BOUNCE OFF VOXELS WORKS
// -----------------------------
// A cube world has only six possible surface normals, which makes this much
// simpler than a general mesh. Find the cube the ship is inside; work out which
// of its six faces the ship crossed to get there, which is the face it is least
// deep through; push it back out along that face and reflect the velocity in
// it. That "least penetration" rule is what stops a ship that clips a corner
// being fired off sideways: the shallowest face is the one it actually touched.

import { CUBE, R_OUTER } from "./voxelWorld";
import { solid } from "./voxelField";

/** How much speed a bounce keeps. Geoff: "reduce speed by 30%". */
export const BOUNCE_KEEP = 0.7;

/**
 * The damage a bounce does, in hull points.
 *
 * Geoff: "1-40 based on their speed and angle", and explicitly not fatal from
 * a few knocks. So it is the speed INTO the surface that counts, not the speed
 * along it: clipping a wall at a glancing angle is a scrape, and flying
 * straight into it at full tilt is the forty. That is also what "based on
 * their speed and angle" means in one number, because the component along the
 * normal is exactly speed times the cosine of the angle.
 *
 * Squared rather than straight, so a gentle nudge is genuinely gentle: a third
 * of the closing speed does 5 points, not 14.
 */
export const HIT_MIN = 1;
export const HIT_MAX = 40;
export function bounceDamage(intoSurface: number, topSpeed: number): number {
  if (!(intoSurface > 0) || !(topSpeed > 0)) return 0;
  const share = Math.min(1, intoSurface / topSpeed);
  return Math.round(HIT_MIN + (HIT_MAX - HIT_MIN) * share * share);
}

/** What a bounce did. All in WORLD units, relative to the planet's centre. */
export interface Bounce {
  /** The face that was hit, as a unit vector: one axis, plus or minus. */
  nx: number; ny: number; nz: number;
  /** How far into the cube the ship had got, in world units. */
  depth: number;
  /** The speed straight into that face, before the bounce. */
  into: number;
}

/**
 * Has the ship hit rock, and if so on which face?
 *
 * `px, py, pz` and the velocity are in WORLD units, measured from the planet's
 * CENTRE, which is how the caller already holds them. `radius` is the ship's,
 * also in world units. Returns null when there is nothing there, which is the
 * overwhelmingly common answer and is why the cheap tests come first.
 */
export function hitRock(
  px: number, py: number, pz: number,
  vx: number, vy: number, vz: number,
  radius: number, seed = 0,
): Bounce | null {
  /* Nowhere near the planet: the same first test the field makes, and it ends
     almost every call. */
  const r2 = px * px + py * py + pz * pz;
  const reach = (R_OUTER + 2) * CUBE + radius;
  if (r2 > reach * reach) return null;

  /* Into the planet's own grid. A cube spans [n, n+1) in these units, so the
     cube containing a point is the floor of it. */
  const cx = px / CUBE, cy = py / CUBE, cz = pz / CUBE;
  const rc = radius / CUBE;

  /* The ship is a ball, so every cube its box touches has to be asked about.
     At a radius under a cube that is at most eight of them. */
  const lo = [Math.floor(cx - rc), Math.floor(cy - rc), Math.floor(cz - rc)];
  const hi = [Math.floor(cx + rc), Math.floor(cy + rc), Math.floor(cz + rc)];

  let best: Bounce | null = null;
  for (let i = lo[0]; i <= hi[0]; i++) {
    for (let j = lo[1]; j <= hi[1]; j++) {
      for (let k = lo[2]; k <= hi[2]; k++) {
        if (!solid(i, j, k, seed)) continue;

        /* ---- WHICH FACE DID IT COME THROUGH? ----
           Not simply the shallowest of the six, which was the first attempt and
           is wrong in the commonest case of all: a ship dead in the middle of a
           cube overlaps all three axes equally, the tie picked an axis, and the
           sign rule then chose the face it was flying TOWARD - the way out. The
           ship was judged to be leaving and the hit was thrown away.

           A ship can only have entered through a face it was closing on, and
           which face that is on each axis is decided by the sign of its
           velocity, not by how deep it is: flying in +x, it came through the -x
           face. So there is one candidate per axis, and the shallowest of
           THOSE is the one it touched. That also keeps the corner case right,
           which is what the rule was for: clipping a corner, the axis it has
           barely entered on wins, and it is sent back the way it came rather
           than fired off sideways. */
        let nx = 0, ny = 0, nz = 0, depth = Infinity;
        /* x */
        if (vx > 0) { const d = cx + rc - i; if (d > 0 && d < depth) { depth = d; nx = -1; ny = 0; nz = 0; } }
        else if (vx < 0) { const d = i + 1 - (cx - rc); if (d > 0 && d < depth) { depth = d; nx = 1; ny = 0; nz = 0; } }
        /* y */
        if (vy > 0) { const d = cy + rc - j; if (d > 0 && d < depth) { depth = d; nx = 0; ny = -1; nz = 0; } }
        else if (vy < 0) { const d = j + 1 - (cy - rc); if (d > 0 && d < depth) { depth = d; nx = 0; ny = 1; nz = 0; } }
        /* z */
        if (vz > 0) { const d = cz + rc - k; if (d > 0 && d < depth) { depth = d; nx = 0; ny = 0; nz = -1; } }
        else if (vz < 0) { const d = k + 1 - (cz - rc); if (d > 0 && d < depth) { depth = d; nx = 0; ny = 0; nz = 1; } }
        /* Standing still inside rock: nothing was crossed, so there is nothing
           to reflect and nothing to report. */
        if (!Number.isFinite(depth)) continue;
        /* And it has to actually reach this cube on every axis, or a ball
           beside the cube would be judged to be in it. */
        if (overlap(cx, rc, i) <= 0 || overlap(cy, rc, j) <= 0 || overlap(cz, rc, k) <= 0) continue;

        const into = -(vx * nx + vy * ny + vz * nz);
        if (into <= 0) continue;
        /* The DEEPEST of the cubes touched, because that is the one holding the
           ship, and pushing out of it clears the shallower ones too. */
        if (!best || depth * CUBE > best.depth) {
          best = { nx, ny, nz, depth: depth * CUBE, into };
        }
      }
    }
  }
  return best;
}

/** How far a ball of radius `rc` at `c` overlaps the cube starting at `n`,
 *  in cube units. Zero or less means it does not reach. */
function overlap(c: number, rc: number, n: number): number {
  const low = c + rc - n;          /* past the near face */
  const high = n + 1 - (c - rc);   /* past the far face */
  return Math.min(low, high);
}

/**
 * The velocity after a bounce, written into `out`.
 *
 * Billiards: the part of the velocity along the surface is kept, the part into
 * it is reversed, and the whole thing then loses its 30%. The same formula a
 * ball off a cushion uses, which is what Geoff asked for, and with one cushion
 * per axis it is exact rather than approximated.
 */
export function bounceVelocity(
  vx: number, vy: number, vz: number, b: Bounce,
  out: { x: number; y: number; z: number },
): void {
  const dot = vx * b.nx + vy * b.ny + vz * b.nz;
  out.x = (vx - 2 * dot * b.nx) * BOUNCE_KEEP;
  out.y = (vy - 2 * dot * b.ny) * BOUNCE_KEEP;
  out.z = (vz - 2 * dot * b.nz) * BOUNCE_KEEP;
}
