// Bullets, fighters and what happens when they meet.
//
// Run: sh scripts/run-rebels-combat-tests.sh

import * as THREE from "three";
import { R } from "./orbitWorld";
import {
  createCombat, stepCombat, fireGuns, gunMuzzles, enemyFire,
  BULLET_SPEED, CONVERGE, ENEMY_R,
  type CombatState, type Enemy,
} from "./rebelsCombat";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}
process.on("uncaughtException", (e) => {
  console.log(out.join("\n"));
  console.log("FAIL threw: " + (e as Error).message);
  process.exit(1);
});

const DT = 1 / 60;
const pos = new THREE.Vector3(0, 0, R + 8);
const fwd = new THREE.Vector3(1, 0, 0);
const up = pos.clone().normalize();
const FOV = 72, ASPECT = 1.6;

const world = (over: Partial<Parameters<typeof stepCombat>[2]> = {}) => ({
  tips: [] as THREE.Vector3[],
  playerPos: pos.clone(),
  playerFwd: fwd.clone(),
  wanted: 0,
  ...over,
});

function run(c: CombatState, frames: number, w = world()) {
  const seen: string[] = [];
  for (let i = 0; i < frames; i++) {
    stepCombat(c, DT, w);
    for (const e of c.events) seen.push(e.kind);
  }
  return seen;
}

// 1. The guns come from the edges of the screen, at eye level, and cross where
//    the player is aiming. This is the whole look of the thing.
{
  const m: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  gunMuzzles(pos, fwd, up, FOV, ASPECT, m);
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  const lateral = (v: THREE.Vector3) => v.clone().sub(pos).dot(right);
  const vertical = (v: THREE.Vector3) => v.clone().sub(pos).dot(up);
  ok("one gun each side", lateral(m[0]) < 0 && lateral(m[1]) > 0,
     `${lateral(m[0]).toFixed(2)} and ${lateral(m[1]).toFixed(2)}`);
  ok("both guns level with the eye", Math.abs(vertical(m[0])) < 1e-6 && Math.abs(vertical(m[1])) < 1e-6);
  ok("both the same distance out", Math.abs(Math.abs(lateral(m[0])) - Math.abs(lateral(m[1]))) < 1e-6);
  /* At the plane the muzzles sit on, the half-width of the view is
     tan(fov/2)*d*aspect. They should sit just inside that, on the edge. */
  const d = m[0].clone().sub(pos).dot(fwd);
  const halfW = Math.tan((FOV * Math.PI) / 360) * d * ASPECT;
  ok("they sit on the edges of the frame", Math.abs(Math.abs(lateral(m[1])) - halfW) < halfW * 0.1,
     `${Math.abs(lateral(m[1])).toFixed(2)} vs edge ${halfW.toFixed(2)}`);

  const c = createCombat();
  fireGuns(c, pos, fwd, up, FOV, ASPECT);
  ok("firing makes two bullets", c.bullets.length === 2);
  ok("bullets travel at speed", Math.abs(c.bullets[0].vel.length() - BULLET_SPEED) < 1e-6);
  /* Both should pass within a whisker of the convergence point. */
  const target = pos.clone().addScaledVector(fwd, CONVERGE);
  const miss = c.bullets.map((b) => {
    const t = target.clone().sub(b.pos).dot(b.vel) / b.vel.lengthSq();
    return b.pos.clone().addScaledVector(b.vel, t).distanceTo(target);
  });
  ok("the two streams cross on the crosshair", Math.max(...miss) < 0.01,
     `worst miss ${Math.max(...miss).toFixed(4)}`);
}

// 2. A bullet that reaches a fighter kills it, and one that does not, does not.
{
  const c = createCombat();
  const enemy: Enemy = {
    pos: pos.clone().addScaledVector(fwd, 40), fwd: fwd.clone().negate(),
    roll: 0, hp: 1, fireAt: 1e9, weave: 1e9, weaveDir: 1,
  };
  c.enemies.push(enemy);
  fireGuns(c, pos, fwd, up, FOV, ASPECT);
  const w = world();
  /* Nothing else moves: the fighter is pinned so this measures the bullet. */
  const seen: string[] = [];
  for (let i = 0; i < 60; i++) {
    enemy.pos.copy(pos).addScaledVector(fwd, 40);
    stepCombat(c, DT, w);
    for (const e of c.events) seen.push(e.kind);
  }
  ok("a bullet on target kills a fighter", seen.includes("enemyDown"), seen.join(",") || "nothing");
  ok("and it is counted", c.kills === 1, `${c.kills}`);
}
{
  const c = createCombat();
  c.enemies.push({
    pos: pos.clone().addScaledVector(fwd, 40).add(new THREE.Vector3(0, 30, 0)),
    fwd: fwd.clone(), roll: 0, hp: 1, fireAt: 1e9, weave: 1e9, weaveDir: 1,
  });
  fireGuns(c, pos, fwd, up, FOV, ASPECT);
  const seen = run(c, 60);
  ok("a bullet nowhere near does not", !seen.includes("enemyDown"));
}

// 3. Fast bullets must not tunnel through small fighters. One frame of travel
//    is two units and a fighter is one across, so endpoint tests would miss.
{
  let hits = 0;
  for (let k = 0; k < 40; k++) {
    const c = createCombat();
    const dist = 25 + k * 1.7;
    c.enemies.push({
      pos: pos.clone().addScaledVector(fwd, dist), fwd: fwd.clone().negate(),
      roll: 0, hp: 1, fireAt: 1e9, weave: 1e9, weaveDir: 1,
    });
    /* Straight down the middle, so aim is not what is being tested. */
    c.bullets.push({ pos: pos.clone(), vel: fwd.clone().multiplyScalar(BULLET_SPEED), life: 3, hostile: false });
    const seen = run(c, 90);
    if (seen.includes("enemyDown")) hits++;
  }
  ok("bullets never tunnel through a fighter", hits === 40, `${hits}/40 ranges hit`);
}

// 4. Shooting a tower bangs, and leaves the tower alone: it is a real node.
{
  const c = createCombat();
  const tip = pos.clone().addScaledVector(fwd, 30);
  const w = world({ tips: [tip] });
  c.bullets.push({ pos: pos.clone(), vel: fwd.clone().multiplyScalar(BULLET_SPEED), life: 3, hostile: false });
  const seen = run(c, 60, w);
  ok("a bullet hitting a tower explodes", seen.includes("towerHit"), seen.join(",") || "nothing");
  ok("the tower is still there afterwards", w.tips.length === 1);
}

// 5. Enemy fire hurts the player, and their own bullets do not hurt them.
{
  const c = createCombat();
  const e: Enemy = {
    pos: pos.clone().addScaledVector(fwd, 30), fwd: fwd.clone().negate(),
    roll: 0, hp: 2, fireAt: 1e9, weave: 1e9, weaveDir: 1,
  };
  c.enemies.push(e);
  enemyFire(c, e, pos);
  ok("enemy fire is marked hostile", c.bullets[0].hostile);
  const seen = run(c, 120);
  ok("enemy fire that reaches you counts as a hit", seen.includes("playerHit"), seen.join(",") || "nothing");
  ok("their own fire does not kill them", c.enemies.length === 1);
}

// 6. Fighters spawn in front, chase, and give up if they get far away.
{
  const c = createCombat();
  const w = world({ wanted: 3 });
  run(c, 60 * 12, w);
  ok("fighters spawn", c.enemies.length > 0, `${c.enemies.length} in the air`);
  ok("no more than asked for", c.enemies.length <= 3, `${c.enemies.length}`);
  for (const e of c.enemies) {
    ok("a fighter never ends up inside the planet", e.pos.length() >= R, `radius ${e.pos.length().toFixed(1)}`);
  }
  /* Point one away and check it turns back toward the player. */
  const e = c.enemies[0];
  e.pos.copy(pos).addScaledVector(fwd, 60);
  e.fwd.copy(fwd);
  e.weave = 1e9;
  const before = e.fwd.dot(pos.clone().sub(e.pos).normalize());
  for (let i = 0; i < 60; i++) {
    e.pos.copy(pos).addScaledVector(fwd, 60);
    stepCombat(c, DT, w);
  }
  const after = e.fwd.dot(pos.clone().sub(e.pos).normalize());
  ok("a fighter turns to chase you", after > before, `${before.toFixed(2)} -> ${after.toFixed(2)}`);
}

// 7. A long fight leaks nothing.
{
  const c = createCombat();
  const w = world({ wanted: 4, tips: [pos.clone().addScaledVector(fwd, 25)] });
  for (let i = 0; i < 60 * 90; i++) {
    if (i % 7 === 0) fireGuns(c, pos, fwd, up, FOV, ASPECT);
    stepCombat(c, DT, w);
  }
  ok("bullets do not pile up over 90 seconds", c.bullets.length < 120, `${c.bullets.length} alive`);
  ok("fighters stay capped", c.enemies.length <= 4, `${c.enemies.length}`);
  ok("something actually died in all that", c.kills > 0, `${c.kills} kills`);
  ok("hit radius is a sane size next to a fighter", ENEMY_R > 0.5 && ENEMY_R < 3);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
