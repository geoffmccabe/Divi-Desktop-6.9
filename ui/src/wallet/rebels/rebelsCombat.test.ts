// Bullets, fighters and what happens when they meet.
//
// Run: sh scripts/run-rebels-combat-tests.sh

import * as THREE from "three";
import { R } from "./orbitWorld";
import {
  createCombat, stepCombat, fireGuns, gunMuzzles, enemyFire,
  fireTorpedo, detonateOldest,
  BULLET_SPEED, CONVERGE, ENEMY_R, TORPEDO_BLAST, TORPEDO_FUSE, TORPEDO_SPEED,
  FIGHTER, LASER_MIN, LASER_MAX, rollLaserDamage, hurtEnemy,
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
  damageScale: 1,
  ...over,
});

/** A fighter for a test, made of paper unless told otherwise, so a single
 *  laser hit settles it and the test measures the thing it is about. */
function fighter(at: THREE.Vector3, over: Partial<Enemy> = {}): Enemy {
  return {
    pos: at.clone(), fwd: fwd.clone().negate(), roll: 0,
    cls: FIGHTER, shield: 0, hull: 1,
    vel: new THREE.Vector3(), tumble: new THREE.Vector3(), spin: new THREE.Vector3(),
    flash: 0, fireAt: 1e9, weave: 1e9, weaveDir: 1,
    ...over,
  };
}

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
  const enemy: Enemy = fighter(pos.clone().addScaledVector(fwd, 40));
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
  c.enemies.push(fighter(pos.clone().addScaledVector(fwd, 40).add(new THREE.Vector3(0, 30, 0))));
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
    c.enemies.push(fighter(pos.clone().addScaledVector(fwd, dist)));
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
  const e: Enemy = fighter(pos.clone().addScaledVector(fwd, 30));
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
  let hits = 0;
  for (let i = 0; i < 60 * 90; i++) {
    if (i % 7 === 0) fireGuns(c, pos, fwd, up, FOV, ASPECT);
    stepCombat(c, DT, w);
    for (const e of c.events) if (e.kind === "enemyHit") hits++;
  }
  ok("bullets do not pile up over 90 seconds", c.bullets.length < 120, `${c.bullets.length} alive`);
  ok("nor does wreckage", c.junk.length <= 60, `${c.junk.length} pieces`);
  ok("fighters stay capped", c.enemies.length <= 4, `${c.enemies.length}`);
  /* Shots land. Kills are not asserted any more: a fighter now carries a
     hundred of shield and a hundred of hull, so blind fire from a fixed point
     lands hits without finishing anyone, which is the point of shields. */
  ok("shots land during it", hits > 0, `${hits} hits`);
  ok("hit radius is a sane size next to a fighter", ENEMY_R > 0.5 && ENEMY_R < 3);
}

// 8. Torpedoes: one button launches and then sets off, they go off on their own
//    after the fuse, and they take out everything inside the blast rather than
//    only what they touched.
{
  const c = createCombat();
  const w = world();
  ok("nothing to detonate before one is launched", detonateOldest(c, w) === false);
  fireTorpedo(c, pos, fwd);
  ok("launching puts one in the air", c.torpedoes.length === 1);
  ok("it travels slower than a bullet, so you can time it",
     Math.abs(c.torpedoes[0].vel.length() - TORPEDO_SPEED) < 1e-6 && TORPEDO_SPEED < BULLET_SPEED);
  const seen = run(c, 30, w);
  ok("it does not go off on its own straight away", c.torpedoes.length === 1 && !seen.includes("torpedoBlast"));
  ok("a second press sets it off", detonateOldest(c, w) === true);
  ok("and it is gone afterwards", c.torpedoes.length === 0);
}
{
  const c = createCombat();
  const w = world();
  fireTorpedo(c, pos, fwd);
  const seen = run(c, Math.ceil((TORPEDO_FUSE + 0.5) * 60), w);
  ok("an unattended torpedo goes off on its fuse",
     seen.includes("torpedoBlast") && c.torpedoes.length === 0);
}
{
  /* Three fighters spread across the blast, none of them touched by it. */
  const c = createCombat();
  const w = world();
  const at = pos.clone().addScaledVector(fwd, 40);
  for (const off of [0, TORPEDO_BLAST * 0.6, TORPEDO_BLAST * 0.9]) {
    c.enemies.push(fighter(at.clone().add(new THREE.Vector3(0, off, 0)), { fwd: fwd.clone() }));
  }
  /* And one well outside it, which must survive. */
  c.enemies.push(fighter(at.clone().add(new THREE.Vector3(0, TORPEDO_BLAST * 2.5, 0)), { fwd: fwd.clone() }));
  c.torpedoes.push({ pos: at.clone(), vel: fwd.clone().multiplyScalar(TORPEDO_SPEED), life: 1 });
  detonateOldest(c, w);
  ok("a torpedo clears everything inside its blast", c.kills === 3, `${c.kills} killed`);
  ok("and nothing outside it", c.enemies.length === 1, `${c.enemies.length} left`);
}
{
  /* Five times a bullet: a fighter with more hit points than a bullet run
     could chew through still dies to one torpedo. */
  const c = createCombat();
  const w = world();
  const at = pos.clone().addScaledVector(fwd, 30);
  /* Full shields and full hull: a torpedo has to get through both. */
  c.enemies.push(fighter(at.clone(), {
    fwd: fwd.clone(), shield: FIGHTER.shieldMax, hull: FIGHTER.hullMax,
  }));
  c.torpedoes.push({ pos: at.clone(), vel: fwd.clone(), life: 1 });
  detonateOldest(c, w);
  ok("one torpedo is worth five bullets", c.kills === 1);
}

// 9. Shields, knockback and wreckage.
{
  const c = createCombat();
  const e = fighter(pos.clone().addScaledVector(fwd, 30), {
    shield: FIGHTER.shieldMax, hull: FIGHTER.hullMax,
  });
  c.enemies.push(e);
  const before = e.pos.clone();
  hurtEnemy(c, e, 40, pos);
  ok("damage comes off the shield first", e.shield === FIGHTER.shieldMax - 40 && e.hull === FIGHTER.hullMax,
     `shield ${e.shield} hull ${e.hull}`);
  ok("a hit reports the new shield level", c.events.some((x) => x.kind === "enemyHit" && x.shield === 0.6));
  ok("a hit knocks them back", e.vel.length() > 1, `impulse ${e.vel.length().toFixed(1)}`);
  ok("a hit sets them spinning", e.tumble.length() > 0.1, `tumble ${e.tumble.length().toFixed(2)}`);
  ok("and it is knocked AWAY from the shooter", e.vel.dot(before.clone().sub(pos)) > 0);

  const hard = fighter(pos.clone(), { shield: FIGHTER.shieldMax, hull: FIGHTER.hullMax });
  c.enemies.push(hard);
  hurtEnemy(c, hard, 100, pos);
  ok("a harder hit spins them faster", hard.tumble.length() > e.tumble.length(),
     `${e.tumble.length().toFixed(2)} vs ${hard.tumble.length().toFixed(2)}`);
}
{
  /* Overflow: the shot that breaks the shield still reaches the hull. */
  const c = createCombat();
  const e = fighter(pos.clone(), { shield: 30, hull: FIGHTER.hullMax });
  c.enemies.push(e);
  hurtEnemy(c, e, 80, pos);
  ok("the shot that breaks a shield still hurts", e.shield === 0 && e.hull === FIGHTER.hullMax - 50,
     `shield ${e.shield} hull ${e.hull}`);
  ok("and once the shield is gone, one point gets through", (() => {
    hurtEnemy(c, e, 1, pos);
    return e.hull === FIGHTER.hullMax - 51;
  })(), `hull ${e.hull}`);
}
{
  /* Laser rolls stay inside the stated range. */
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 4000; i++) {
    const d = rollLaserDamage();
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  ok("laser damage stays between ten and a hundred", lo >= LASER_MIN && hi <= LASER_MAX,
     `${lo.toFixed(1)} to ${hi.toFixed(1)}`);
}
{
  /* Killing one leaves three pieces: body and two wings. */
  const c = createCombat();
  const e = fighter(pos.clone().addScaledVector(fwd, 30), { shield: 0, hull: 1 });
  c.enemies.push(e);
  hurtEnemy(c, e, 50, pos);
  ok("a dead fighter comes apart into three pieces", c.junk.length === 3, `${c.junk.length}`);
  ok("and they are the body and two wings",
     new Set(c.junk.map((j) => j.kind)).size === 3);
  ok("each piece is moving", c.junk.every((j) => j.vel.length() > 1));
  ok("each piece is spinning", c.junk.every((j) => j.spin.length() > 0.5));
}
{
  /* Wreckage orbits and eventually comes down: gravity and drag both real. */
  const c = createCombat();
  const w = world();
  const start = new THREE.Vector3(0, 0, R + 14);
  const upSpeed = Math.sqrt(44800 / start.length());
  c.junk.push({
    pos: start.clone(),
    vel: new THREE.Vector3(upSpeed, 0, 0),   /* a near-circular orbit */
    spin: new THREE.Vector3(1, 0, 0), rot: new THREE.Vector3(), life: 1e9, kind: "body",
  });
  let maxR = 0, far = 0, seconds = 0, gone = false;
  for (let i = 0; i < 60 * 200; i++) {
    stepCombat(c, 1 / 60, w);
    if (!c.junk[0]) { gone = true; break; }
    seconds += 1 / 60;
    const r = c.junk[0].pos.length();
    maxR = Math.max(maxR, r);
    far = Math.max(far, c.junk[0].pos.distanceTo(start));
  }
  ok("wreckage does not fly off into space", maxR < R + 60, `highest ${maxR.toFixed(0)}`);
  /* A full orbit at this altitude is about seven hundred units around, so
     getting two hundred from where it started means it is genuinely circling
     rather than lobbing up and dropping back. */
  ok("it circles the planet", far > 150, `travelled ${far.toFixed(0)} units from where it started`);
  ok("the orbit decays and it comes down", gone, "still up there");
  ok("but not straight away", seconds > 25, `orbited for ${seconds.toFixed(0)}s`);
}
{
  /* Junk is solid: shoot it and it goes. */
  const c = createCombat();
  const w = world();
  const at = pos.clone().addScaledVector(fwd, 30);
  c.junk.push({ pos: at.clone(), vel: new THREE.Vector3(), spin: new THREE.Vector3(),
                rot: new THREE.Vector3(), life: 1e9, kind: "body" });
  c.bullets.push({ pos: pos.clone(), vel: fwd.clone().multiplyScalar(BULLET_SPEED), life: 3, hostile: false });
  const seen = run(c, 60, w);
  ok("shooting wreckage destroys it", c.junk.length === 0 && seen.includes("junkGone"));
}
{
  /* And it hurts whatever it runs into. */
  const c = createCombat();
  const w = world();
  const e = fighter(pos.clone().addScaledVector(fwd, 30), { shield: FIGHTER.shieldMax, hull: FIGHTER.hullMax });
  c.enemies.push(e);
  c.junk.push({ pos: e.pos.clone(), vel: new THREE.Vector3(), spin: new THREE.Vector3(),
                rot: new THREE.Vector3(), life: 1e9, kind: "wingL" });
  stepCombat(c, 1 / 60, w);
  ok("wreckage damages a fighter it hits", e.shield < FIGHTER.shieldMax, `shield ${e.shield.toFixed(0)}`);
  ok("and is destroyed doing it", c.junk.length === 0);
}
{
  /* Winning a stake triples what the guns do. */
  const c = createCombat();
  const e = fighter(pos.clone(), { shield: FIGHTER.shieldMax, hull: FIGHTER.hullMax });
  c.enemies.push(e);
  hurtEnemy(c, e, 20 * 3, pos);
  ok("a tripled hit takes triple the shield", e.shield === FIGHTER.shieldMax - 60, `shield ${e.shield}`);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
