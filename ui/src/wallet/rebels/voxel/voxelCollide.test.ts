// Flying into Spikeworld: does it stop you, and does it feel like billiards?
//
// Run: sh scripts/run-voxel-collide-tests.sh
export {};
import { hitRock, bounceVelocity, bounceDamage, BOUNCE_KEEP, HIT_MIN, HIT_MAX } from "./voxelCollide";
import { solid } from "./voxelField";
import { CUBE, R_OUTER, R_INNER } from "./voxelWorld";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/** A cube known to be solid, somewhere in the crust, and one known to be air. */
function findCube(wanted: boolean): [number, number, number] {
  for (let r = R_OUTER - 40; r > R_INNER; r--) {
    for (let y = -30; y < 30; y++) {
      for (let z = -30; z < 30; z++) {
        if (solid(r, y, z) === wanted) return [r, y, z];
      }
    }
  }
  throw new Error(`no ${wanted ? "rock" : "air"} found`);
}

const [sx, sy, sz] = findCube(true);
const [ax, ay, az] = findCube(false);

/* ---- NOTHING WHERE THERE IS NOTHING ---- */
{
  ok("empty space out past the planet is empty",
     hitRock((R_OUTER + 200) * CUBE, 0, 0, -10, 0, 0, 2) === null);
  ok("and so is a hole in the rock",
     hitRock((ax + 0.5) * CUBE, (ay + 0.5) * CUBE, (az + 0.5) * CUBE, 0, 0, 0, 0.2) === null,
     `cube ${ax},${ay},${az}`);
}

/* ---- AND SOMETHING WHERE THERE IS ---- */
{
  /* Dead in the middle of a solid cube, flying along +x. */
  const b = hitRock((sx + 0.5) * CUBE, (sy + 0.5) * CUBE, (sz + 0.5) * CUBE, 30, 0, 0, 1.5);
  ok("a cube of rock is hit", !!b, `cube ${sx},${sy},${sz}`);
  if (b) {
    ok("the face it reports is one of the six",
       Math.abs(b.nx) + Math.abs(b.ny) + Math.abs(b.nz) === 1,
       `${b.nx},${b.ny},${b.nz}`);
    ok("and the ship is closing on it", b.into > 0, `${b.into.toFixed(1)}`);
  }
}

/* ---- BILLIARDS ----
   The part along the surface is kept, the part into it is reversed, and the
   whole loses its thirty percent. */
{
  const b = { nx: 1, ny: 0, nz: 0, depth: 1, into: 20 };
  const v = { x: 0, y: 0, z: 0 };
  bounceVelocity(-20, 5, 0, b, v);
  ok("the speed into the wall comes back out of it", v.x > 0, `${v.x.toFixed(2)}`);
  ok("at seventy percent of what went in",
     Math.abs(v.x - 20 * BOUNCE_KEEP) < 1e-9, `${v.x.toFixed(4)} against ${20 * BOUNCE_KEEP}`);
  ok("and the speed along it is only slowed, not turned",
     Math.abs(v.y - 5 * BOUNCE_KEEP) < 1e-9 && v.z === 0, `${v.y.toFixed(4)}`);
  /* A straight-on hit reverses exactly; a glancing one barely turns. */
  const head = { x: 0, y: 0, z: 0 };
  bounceVelocity(-30, 0, 0, b, head);
  ok("head on, it comes straight back", head.x > 0 && head.y === 0 && head.z === 0);
  const graze = { x: 0, y: 0, z: 0 };
  bounceVelocity(-1, 30, 0, b, graze);
  ok("a graze mostly carries on along the wall",
     graze.y > Math.abs(graze.x) * 10, `${graze.x.toFixed(2)} across, ${graze.y.toFixed(2)} along`);
  /* And the whole speed drops by thirty percent, which is the promise. */
  const before = Math.hypot(-20, 5, 0), after = Math.hypot(v.x, v.y, v.z);
  ok("a bounce keeps seventy percent of the speed",
     Math.abs(after - before * BOUNCE_KEEP) < 1e-9,
     `${before.toFixed(2)} -> ${after.toFixed(2)}`);
}

/* ---- THE DAMAGE, WHICH MUST NOT KILL YOU FOR A SCRAPE ---- */
{
  const TOP = 44;
  ok("a scrape is one point", bounceDamage(0.2, TOP) <= 2, `${bounceDamage(0.2, TOP)}`);
  ok("flying straight in at full speed is forty",
     bounceDamage(TOP, TOP) === HIT_MAX, `${bounceDamage(TOP, TOP)}`);
  ok("and never more, however fast",
     bounceDamage(TOP * 4, TOP) === HIT_MAX, `${bounceDamage(TOP * 4, TOP)}`);
  ok("never less than one when it touches at all",
     bounceDamage(0.001, TOP) >= HIT_MIN, `${bounceDamage(0.001, TOP)}`);
  ok("nothing at all when it is not closing", bounceDamage(0, TOP) === 0);
  /* A third of the speed does far less than a third of the damage: the point
     of squaring it. */
  const third = bounceDamage(TOP / 3, TOP);
  ok("a third of the speed is a small knock", third < 8, `${third} points`);
  /* And a dozen scrapes must not kill a full hull. */
  ok("a dozen scrapes is survivable", bounceDamage(TOP / 4, TOP) * 12 < 100,
     `${bounceDamage(TOP / 4, TOP) * 12} of a hundred`);
}

/* ---- THE FACE IS THE ONE IT CAME THROUGH ----
   A ball clipping the corner of a cube must be sent back the way it came, not
   fired off sideways, which is what the least-penetration rule is for. */
{
  /* Just outside the -x face of a solid cube, moving in. */
  const b = hitRock((sx - 0.02) * CUBE, (sy + 0.5) * CUBE, (sz + 0.5) * CUBE, 25, 0, 0, 0.1 * CUBE);
  ok("coming in through a face, that face is the one reported",
     !!b && b.nx === -1 && b.ny === 0 && b.nz === 0,
     b ? `${b.nx},${b.ny},${b.nz}` : "no hit");
}

/* ---- AND A SHIP LEAVING IS NOT BOUNCED BACK IN ---- */
{
  const b = hitRock((sx + 0.5) * CUBE, (sy + 0.5) * CUBE, (sz + 0.5) * CUBE, 0, 0, 0, 0.1);
  ok("a ship sitting still inside rock reports no bounce", b === null,
     "nothing to reflect, so nothing to report");
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
