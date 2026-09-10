// Bullets, fighters and what happens when they meet.
//
// Run: sh scripts/run-rebels-combat-tests.sh

import * as THREE from "three";
import { R, cruiseScale } from "./orbitWorld";
import { MAX_SHIELD, CRUISE, BOOST } from "./orbitFlight";
import {
  createCombat, stepCombat, fireGuns, gunMuzzles, enemyFire,
  AIM_ERROR, AIM_SPREAD, aimErrorFor, scatterAim, PLAYER_HIT_R,
  fireTorpedo, detonateOldest, clearEvents, fireMini, miniMuzzle,
  startWave, waveSize, WAVE_SECONDS,
  BULLET_SPEED, CONVERGE, ENEMY_R, TORPEDO_BLAST, TORPEDO_FUSE, TORPEDO_SPEED,
  TRACER_LIFE, TRACER_MAX, COIN_VALUE, COIN_PER_KILL, COIN_TOP, COIN_MU,
  FIGHTER, LASER_MIN, LASER_MAX, rollLaserDamage, hurtEnemy, TIERS, rollTier,
  type CombatState, type Enemy,
  ENEMY_SPEED,
  stepFlockSpawns,
  setFlockRandomForTests,
  COIN_MAGNET,
  COIN_RADIUS,
  COIN_KICK,
  spawnFleet,
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
  damageScale: 1,
  ...over,
});

/** A fighter for a test, made of paper unless told otherwise, so a single
 *  laser hit settles it and the test measures the thing it is about. */
function fighter(at: THREE.Vector3, over: Partial<Enemy> = {}): Enemy {
  return {
    pos: at.clone(), fwd: fwd.clone().negate(), roll: 0,
    cls: FIGHTER, shield: 1,
    vel: new THREE.Vector3(), tumble: new THREE.Vector3(), spin: new THREE.Vector3(),
    flash: 0, ammo: 60, reload: 0, fireAt: 1e9, weave: 1e9, weaveDir: 1, wave: 0,
    /* Set up mid-approach, and with a long fuse on the break-off, so a test
       measuring a single pass is not interrupted by the fighter deciding to
       leave halfway through it. */
    mode: "in", breakAt: 0, rejoinAt: 1e9, escape: new THREE.Vector3(), passFor: 1e9,
    ...over,
  };
}

function run(c: CombatState, frames: number, w = world()) {
  const seen: string[] = [];
  for (let i = 0; i < frames; i++) {
    stepCombat(c, DT, w);
    for (const e of c.events) seen.push(e.kind);
    clearEvents(c);
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
  /* A top-tier gunner, so the shot is a sure thing: this test is about what a
     round that ARRIVES does, and a tier-one round now misses half the time
     at this range by design (see AIM_ERROR). */
  e.cls = { ...e.cls, tier: 7 };
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
  const w = world();
  startWave(c, 1);
  run(c, 60 * 40, w);
  ok("fighters spawn", c.enemies.length > 0, `${c.enemies.length} in the air`);
  ok("no more than the wave sends", c.enemies.length <= waveSize(1), `${c.enemies.length}`);
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
  const w = world({ tips: [pos.clone().addScaledVector(fwd, 25)] });
  startWave(c, 1);
  let hits = 0, incoming = 0;
  for (let i = 0; i < 60 * 90; i++) {
    if (i % 7 === 0) fireGuns(c, pos, fwd, up, FOV, ASPECT);
    stepCombat(c, DT, w);
    for (const e of c.events) {
      if (e.kind === "enemyHit") hits++;
      if (e.kind === "playerHit") incoming++;
    }
    /* CLEARED, as the game clears it. Without this the list grows all run and
       every frame re-counts everything before it, so a handful of real events
       reads as tens of thousands — this loop reported 67,209 rounds taken in
       ninety seconds, which is 747 a second. Counting a growing array is not
       counting. */
    clearEvents(c);
  }
  ok("bullets do not pile up over 90 seconds", c.bullets.length < 120, `${c.bullets.length} alive`);
  ok("nor does wreckage", c.junk.length <= 60, `${c.junk.length} pieces`);
  ok("fighters stay within what the waves have sent",
     c.enemies.length <= waveSize(1) + waveSize(2), `${c.enemies.length}`);
  /* A FIGHT HAPPENS, measured by what the fighters do rather than by what a
     fixed gun hits.
     This used to assert that blind fire from a stationary point landed
     something, and that stopped being true the day the fighters started making
     strafing runs: they now spend most of a fight away from the player and
     arrive at speed, so a gun that never moves and never leads hits nothing.
     That is the intended difference, not a regression — so what is asserted is
     that they came, engaged and shot back. */
  ok("the fighters engage during it", incoming > 0, `${incoming} rounds taken`);
  void hits;
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
  /* Full shields: a torpedo has to get through all of them. */
  c.enemies.push(fighter(at.clone(), {
    fwd: fwd.clone(), shield: FIGHTER.shieldMax,
  }));
  c.torpedoes.push({ pos: at.clone(), vel: fwd.clone(), life: 1 });
  detonateOldest(c, w);
  ok("one torpedo is worth five bullets", c.kills === 1);
}

// 8b. Events belong to whoever reads them.
{
  const c = createCombat();
  const w = world();
  fireTorpedo(c, pos, fwd);
  stepCombat(c, DT, w);
  clearEvents(c);
  detonateOldest(c, w);
  ok("setting off a torpedo raises its explosion", c.events.some((e) => e.kind === "torpedoBlast"));
  /* THE BUG: stepCombat used to clear on entry, so this next call ate the
     explosion before anything could draw it and torpedoes silently vanished. */
  stepCombat(c, DT, w);
  ok("and the next step does not eat it before it is read",
     c.events.some((e) => e.kind === "torpedoBlast"));
  clearEvents(c);
  ok("clearing is what empties it", c.events.length === 0);
}

// 8c. Points can never run ahead of the damage actually done.
{
  const c = createCombat();
  const nearlyDead = fighter(pos.clone(), { shield: 10 });
  c.enemies.push(nearlyDead);
  const landed = hurtEnemy(c, nearlyDead, 80, pos);
  ok("a big hit on a nearly-dead fighter only scores what was there",
     landed === 10, `landed ${landed}`);
  const fresh = fighter(pos.clone(), { shield: FIGHTER.shieldMax });
  c.enemies.push(fresh);
  ok("and a normal hit scores all of itself", hurtEnemy(c, fresh, 45, pos) === 45);
  ok("the hit event carries the same figure",
     c.events.filter((e) => e.kind === "enemyHit").pop()?.damage === 45);
}

// 9. Shields, knockback and wreckage.
{
  const c = createCombat();
  const e = fighter(pos.clone().addScaledVector(fwd, 30), {
    shield: FIGHTER.shieldMax,
  });
  c.enemies.push(e);
  const before = e.pos.clone();
  hurtEnemy(c, e, 40, pos);
  ok("damage comes off the shield", e.shield === FIGHTER.shieldMax - 40, `shield ${e.shield}`);
  ok("a hit reports the new shield level", c.events.some((x) => x.kind === "enemyHit" && x.shield === 0.6));
  ok("a hit knocks them back", e.vel.length() > 1, `impulse ${e.vel.length().toFixed(1)}`);
  ok("a hit sets them spinning", e.tumble.length() > 0.1, `tumble ${e.tumble.length().toFixed(2)}`);
  ok("and it is knocked AWAY from the shooter", e.vel.dot(before.clone().sub(pos)) > 0);

  const hard = fighter(pos.clone(), { shield: FIGHTER.shieldMax });
  c.enemies.push(hard);
  hurtEnemy(c, hard, 100, pos);
  ok("a harder hit spins them faster", hard.tumble.length() > e.tumble.length(),
     `${e.tumble.length().toFixed(2)} vs ${hard.tumble.length().toFixed(2)}`);
}
{
  /* Geoff: "The enemy ships often go to 0% and don't die." They had a hull
     under the shield, so nought percent meant another hundred damage into
     something invisible. Now the shield is the whole of it. */
  const c = createCombat();
  const e = fighter(pos.clone(), { shield: 30 });
  c.enemies.push(e);
  hurtEnemy(c, e, 80, pos);
  ok("a shot that takes the shield past nought destroys the ship",
     !c.enemies.includes(e), `shield ${e.shield}`);
  ok("and it is counted as a kill", c.kills === 1);
  ok("and it broke apart", c.junk.length === 3, `${c.junk.length} pieces`);
}
{
  /* Exactly nought is dead too, not one point from it. */
  const c = createCombat();
  const e = fighter(pos.clone(), { shield: 40 });
  c.enemies.push(e);
  hurtEnemy(c, e, 40, pos);
  ok("a shield taken to exactly nought is a kill too", !c.enemies.includes(e));
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
  const e = fighter(pos.clone().addScaledVector(fwd, 30), { shield: 0 });
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
  const e = fighter(pos.clone().addScaledVector(fwd, 30), { shield: FIGHTER.shieldMax });
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
  const e = fighter(pos.clone(), { shield: FIGHTER.shieldMax });
  c.enemies.push(e);
  hurtEnemy(c, e, 20 * 3, pos);
  ok("a tripled hit takes triple the shield", e.shield === FIGHTER.shieldMax - 60, `shield ${e.shield}`);
}

// 10. The seven tiers.
{
  ok("there are seven of them", TIERS.length === 7, `${TIERS.length}`);
  ok("each is rarer than the last",
     TIERS.every((t, i) => i === 0 || t.weight < TIERS[i - 1].weight));
  ok("each is faster than the last",
     TIERS.every((t, i) => i === 0 || t.speed > TIERS[i - 1].speed));
  ok("each has more shield than the last",
     TIERS.every((t, i) => i === 0 || t.shieldMax > TIERS[i - 1].shieldMax));
  /* Geoff's figures: 100%, 130%, 160%, 190%, 220%, carried on to seven. */
  ok("speed goes up thirty points a tier",
     TIERS.map((t) => Math.round(t.speed * 100)).join(",") === "100,130,160,190,220,250,280",
     TIERS.map((t) => Math.round(t.speed * 100)).join(","));
  ok("shields do the same",
     TIERS.map((t) => t.shieldMax).join(",") === "100,130,160,190,220,250,280");

  /* And the roll actually follows the weights. */
  const seen = new Array(7).fill(0);
  const N = 200000;
  for (let i = 0; i < N; i++) seen[rollTier().tier - 1]++;
  const total = TIERS.reduce((a, t) => a + t.weight, 0);
  const want = TIERS.map((t) => (t.weight / total) * N);
  ok("tier one turns up about four fifths of the time",
     Math.abs(seen[0] / N - 0.8) < 0.02, `${((seen[0] / N) * 100).toFixed(1)}%`);
  ok("tier two about a sixth",
     Math.abs(seen[1] / N - 0.16) < 0.02, `${((seen[1] / N) * 100).toFixed(2)}%`);
  ok("the rare ones are rare but not impossible",
     seen[2] > 0 && seen[2] < want[2] * 2, `tier three seen ${seen[2]} of ${N}`);
  ok("every roll lands on a real tier",
     seen.reduce((a, b) => a + b, 0) === N);
}
{
  /* A rarer fighter really is tougher: the same shots that finish a grey one
     leave a red one flying. */
  const c = createCombat();
  const grey = fighter(pos.clone(), { cls: TIERS[0], shield: TIERS[0].shieldMax });
  const red = fighter(pos.clone(), { cls: TIERS[4], shield: TIERS[4].shieldMax });
  c.enemies.push(grey, red);
  for (let i = 0; i < 2; i++) { hurtEnemy(c, grey, 50, pos); hurtEnemy(c, red, 50, pos); }
  ok("a hundred damage finishes a grey one", !c.enemies.includes(grey));
  ok("but not a red one", c.enemies.includes(red), `shield ${red.shield}`);
}
{
  /* Kills are counted per tier. */
  const c = createCombat();
  const blue = fighter(pos.clone(), { cls: TIERS[2], shield: 0 });
  c.enemies.push(blue);
  hurtEnemy(c, blue, 10, pos);
  ok("a kill is counted against its own tier",
     c.tierKills[2] === 1 && c.tierKills.reduce((a, b) => a + b, 0) === 1,
     c.tierKills.join(","));
  ok("and the event says which tier it was",
     c.events.find((e) => e.kind === "enemyDown")?.tier === 3);
}

// 11. How long does a player actually last?
//
//     Geoff: "The player's ship is being destroyed within a few seconds every
//     time." This measures it rather than guessing: four fighters, all in
//     range, all aligned, firing as fast as the game lets them, against a
//     player who never dodges and never guards. That is the worst case, and it
//     should be survivable for a while rather than for a moment.
{
  const w = world();
  const c = createCombat();
  for (let i = 0; i < 4; i++) {
    c.enemies.push(fighter(
      pos.clone().addScaledVector(fwd, 30 + i * 4),
      { fwd: fwd.clone().negate(), shield: FIGHTER.shieldMax,
        fireAt: 0.2 * i, weave: 1e9 },
    ));
  }
  let shield = MAX_SHIELD;
  let seconds = 0;
  let grace = 0;
  let hits = 0;
  for (let i = 0; i < 60 * 120 && shield > 0; i++) {
    /* Pinned in front of them, so this is a player making no attempt to live. */
    for (let k = 0; k < c.enemies.length; k++) {
      c.enemies[k].pos.copy(pos).addScaledVector(fwd, 30 + k * 4);
      c.enemies[k].fwd.copy(fwd).negate();
    }
    stepCombat(c, DT, w);
    grace = Math.max(0, grace - DT);
    for (const e of c.events) {
      if (e.kind !== "playerHit" || grace > 0) continue;
      shield -= e.damage ?? 25;
      grace = 0.45;
      hits++;
    }
    clearEvents(c);
    seconds += DT;
  }
  ok("a sitting duck lasts more than a moment", seconds > 8,
     `died after ${seconds.toFixed(1)}s and ${hits} hits`);
  ok("but is not immortal either", seconds < 90, `${seconds.toFixed(1)}s`);
}

// 12. The mini gun's own rounds.
{
  /* ---- ASSERTED ON THE SCREEN, NOT IN THE MATHS ----
     What a player sees is WHERE ON THE PICTURE the round comes from, so that
     is what is measured: a real camera, posed the way the game poses it, and
     the muzzle projected through it into screen coordinates.

     The old version of this test compared the muzzle against the ship's own
     right and up vectors, which is not the same question. It passed happily
     while the rounds were coming out of the middle of the frame in third
     person, because relative to the SHIP they really were up and to the right.
     Geoff: "the minigun shots are going from the cursor." */
  const camera = new THREE.PerspectiveCamera(FOV, ASPECT, 0.1, 5000);
  /** Pose a camera exactly as the flight loop does, and give back the screen
   *  position of a point: -1 to 1 across, -1 to 1 up. */
  const onScreen = (camPos: THREE.Vector3, look: THREE.Vector3, camUp: THREE.Vector3) => {
    const m4 = new THREE.Matrix4().lookAt(camPos, camPos.clone().add(look), camUp);
    camera.position.copy(camPos);
    camera.quaternion.setFromRotationMatrix(m4);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    return (p: THREE.Vector3) => p.clone().project(camera);
  };
  const axes = (q: THREE.Quaternion) => ({
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
    fwd: new THREE.Vector3(0, 0, -1).applyQuaternion(q),
  });

  /* ---- first person: the camera is the ship ---- */
  const m = new THREE.Vector3();
  {
    const project = onScreen(pos, fwd, up);
    const a = axes(camera.quaternion);
    miniMuzzle(camera.position, a.fwd, a.right, a.up, FOV, ASPECT, m);
    const ndc = project(m);
    ok("the mini gun sits in the TOP RIGHT of the screen",
       ndc.x > 0.8 && ndc.y > 0.7,
       `screen ${ndc.x.toFixed(2)}, ${ndc.y.toFixed(2)}`);
  }

  /* ---- and it stays there through a bank ----
     The camera rolls with the bank; the ship's own up does not. Reading the
     corner off the ship put the muzzle off the corner for exactly the
     manoeuvres anybody would be shooting through. */
  {
    const rolled = up.clone().applyAxisAngle(fwd, 0.5);
    const project = onScreen(pos, fwd, rolled);
    const a = axes(camera.quaternion);
    miniMuzzle(camera.position, a.fwd, a.right, a.up, FOV, ASPECT, m);
    const ndc = project(m);
    ok("and stays in the corner through a hard bank",
       ndc.x > 0.8 && ndc.y > 0.7,
       `screen ${ndc.x.toFixed(2)}, ${ndc.y.toFixed(2)}`);
  }

  /* ---- third person: out of the nose ----
     The camera is well behind the ship. A corner measured from the SHIP's
     position subtends a much smaller angle from back here, which is how the
     rounds ended up near the middle of the frame. */
  {
    const back = pos.clone().addScaledVector(fwd, -6).addScaledVector(up, 1.8);
    const project = onScreen(back, fwd, up);
    const a = axes(camera.quaternion);

    /* What the old code did, kept as the thing being guarded against. */
    const wrong = new THREE.Vector3();
    const halfH = Math.tan((FOV * Math.PI) / 360) * 2.2;
    wrong.copy(pos).addScaledVector(fwd, 2.2)
      .addScaledVector(new THREE.Vector3().crossVectors(fwd, up).normalize(), halfH * ASPECT * 0.94)
      .addScaledVector(up, halfH * 0.86);
    const bad = project(wrong);
    ok("(the old way really did put it near the middle)",
       Math.abs(bad.x) < 0.6, `screen ${bad.x.toFixed(2)}, ${bad.y.toFixed(2)}`);

    const nose = pos.clone().addScaledVector(fwd, 1.3);
    miniMuzzle(camera.position, a.fwd, a.right, a.up, FOV, ASPECT, m, nose);
    ok("in third person it comes out of the nose", m.distanceTo(nose) < 1e-9);
    const ndc = project(m);
    ok("which is on screen ahead of the camera", Math.abs(ndc.x) < 0.5 && ndc.z < 1,
       `screen ${ndc.x.toFixed(2)}, ${ndc.y.toFixed(2)}`);
  }

  /* It follows the pointer, not the ship's axis: aimed off to one side, the
     round has to go that way. */
  const c = createCombat();
  const aimDir = fwd.clone().addScaledVector(up, 0.4).normalize();
  fireMini(c, m, pos, aimDir);
  ok("it fires one round, not two", c.bullets.length === 1);
  ok("marked as a mini round", c.bullets[0].mini === true);
  ok("half again as fast as a normal one",
     Math.abs(c.bullets[0].vel.length() - BULLET_SPEED * 1.5) < 1e-6,
     `${c.bullets[0].vel.length().toFixed(1)}`);
  const target = pos.clone().addScaledVector(aimDir, CONVERGE);
  const b = c.bullets[0];
  const t = target.clone().sub(b.pos).dot(b.vel) / b.vel.lengthSq();
  ok("and it crosses where the pointer is aiming",
     b.pos.clone().addScaledVector(b.vel, t).distanceTo(target) < 0.01);
}
{
  /* A quarter of the damage. Enough shots to average out the roll. */
  const w = world();
  let normal = 0, mini = 0;
  for (let k = 0; k < 300; k++) {
    for (const isMini of [false, true]) {
      const c = createCombat();
      const e = fighter(pos.clone().addScaledVector(fwd, 30), { shield: 100000 });
      c.enemies.push(e);
      c.bullets.push({
        pos: pos.clone(), vel: fwd.clone().multiplyScalar(BULLET_SPEED * (isMini ? 1.5 : 1)),
        life: 3, hostile: false, mini: isMini,
      });
      const before = e.shield;
      for (let i = 0; i < 60 && c.bullets.length; i++) stepCombat(c, DT, w);
      const dealt = before - e.shield;
      if (isMini) mini += dealt; else normal += dealt;
    }
  }
  const ratio = mini / normal;
  ok("a mini round does a quarter of the damage", Math.abs(ratio - 0.25) < 0.03,
     `${(ratio * 100).toFixed(1)}% of a normal round`);
}

// 13. Tracers, and enemy shots being reported so they can be heard.
{
  const c = createCombat();
  const w = world();
  fireGuns(c, pos, fwd, up, FOV, ASPECT);
  ok("firing leaves a trail per round", c.tracers.length === 2, `${c.tracers.length}`);
  ok("a trail starts where the round started",
     c.tracers[0].from.distanceTo(c.bullets[0].pos) < 0.01);
  ok("and is live while the round is flying", c.tracers.every((t) => t.live));

  const start = c.tracers[0].to.clone();
  run(c, 20, w);
  ok("the trail follows the round out", c.tracers[0].to.distanceTo(start) > 5,
     `${c.tracers[0].to.distanceTo(start).toFixed(1)} units`);

  /* Once the round is gone the trail stays put and starts counting down. */
  for (let i = 0; i < 60 * 3 && c.bullets.length; i++) stepCombat(c, DT, w);
  clearEvents(c);
  const frozen = c.tracers[0]?.to.clone();
  ok("a spent round leaves its trail behind", c.tracers.length > 0 && !c.tracers[0].live);
  run(c, 60, w);
  ok("and the trail does not move afterwards",
     !frozen || c.tracers.length === 0 || c.tracers[0].to.distanceTo(frozen) < 1e-9);
}
{
  /* Three seconds, then gone. */
  const c = createCombat();
  const w = world();
  fireGuns(c, pos, fwd, up, FOV, ASPECT);
  for (let i = 0; i < 60 * 3 && c.bullets.length; i++) stepCombat(c, DT, w);
  clearEvents(c);
  ok("a trail is still there a second after the round has gone",
     (run(c, 60, w), c.tracers.length > 0), `${c.tracers.length}`);
  run(c, 60 * TRACER_LIFE, w);
  ok("and gone after three", c.tracers.length === 0, `${c.tracers.length} left`);
}
{
  /* They do not pile up for ever. */
  const c = createCombat();
  for (let i = 0; i < 400; i++) fireGuns(c, pos, fwd, up, FOV, ASPECT);
  ok("trails are capped", c.tracers.length <= TRACER_MAX, `${c.tracers.length}`);
}
{
  /* Every enemy shot is announced, so it can be heard where it happened. */
  const c = createCombat();
  const e = fighter(pos.clone().addScaledVector(fwd, 30));
  c.enemies.push(e);
  enemyFire(c, e, pos);
  const shot = c.events.find((x) => x.kind === "enemyShot");
  ok("an enemy shot is reported", !!shot);
  ok("at the ship that fired it", !!shot && shot.at.distanceTo(e.pos) < 0.01);
  ok("and its trail is marked hostile",
     c.tracers.length === 1 && c.tracers[0].hostile);
}

// 14. DIVI in orbit.
{
  const c = createCombat();
  const e = fighter(pos.clone().addScaledVector(fwd, 30), { shield: 1 });
  c.enemies.push(e);
  hurtEnemy(c, e, 50, pos);
  ok("a dead fighter scatters coins", c.coins.length === COIN_PER_KILL, `${c.coins.length}`);
  ok("five coins is a tenth of a DIVI, the payout rate",
     Math.abs(c.coins.reduce((a, k) => a + k.value, 0) - 0.1) < 1e-9);
  ok("each is worth two hundredths", c.coins.every((k) => k.value === COIN_VALUE));
}
{
  /* The number that decides whether this is a game: can a player catch one?
     Cruise is 16 and boost is 38, so a coin has to sit under that. */
  const c = createCombat();
  const e = fighter(new THREE.Vector3(0, 0, R + 12), { shield: 1 });
  c.enemies.push(e);
  hurtEnemy(c, e, 50, pos);
  const speeds = c.coins.map((k) => k.vel.length());
  /* Against the REAL speeds rather than numbers typed in once. Both of these
     read 16 and 30 until the world was halved and the ship slowed to match,
     after which they were asserting against a game that no longer existed. */
  ok("coins move slower than a boosting player can fly",
     Math.max(...speeds) < BOOST, `fastest ${Math.max(...speeds).toFixed(1)} of ${BOOST}`);
  ok("but faster than the player cruises, so they take chasing",
     Math.min(...speeds) > CRUISE, `slowest ${Math.min(...speeds).toFixed(1)} of ${CRUISE}`);
}
{
  /* They have to STAY up. A coin that falls in ten seconds is not a pickup, it
     is a light show. */
  const c = createCombat();
  const w = world({ playerPos: new THREE.Vector3(0, 900, 0) });   /* far away */
  const e = fighter(new THREE.Vector3(0, 0, R + 12), { shield: 1 });
  c.enemies.push(e);
  hurtEnemy(c, e, 50, pos);
  clearEvents(c);
  const before = c.coins.length;
  let lowest = Infinity, highest = 0, travelled = 0;
  const start = c.coins[0].pos.clone();
  for (let i = 0; i < 60 * 120; i++) {
    stepCombat(c, DT, w);
    clearEvents(c);
    if (!c.coins[0]) break;
    const r = c.coins[0].pos.length();
    lowest = Math.min(lowest, r);
    highest = Math.max(highest, r);
    travelled = Math.max(travelled, c.coins[0].pos.distanceTo(start));
  }
  ok("coins stay in orbit for two minutes", c.coins.length === before,
     `${c.coins.length} of ${before} left`);
  ok("without falling in", lowest > R, `lowest ${lowest.toFixed(1)}`);
  ok("or flying off", highest < R + 60, `highest ${highest.toFixed(1)}`);
  ok("and they go right round the planet", travelled > 150,
     `${travelled.toFixed(0)} units from where they started`);
}
{
  /* Flying into one collects it. */
  const c = createCombat();
  const at = new THREE.Vector3(0, 0, R + 12);
  const w = world({ playerPos: at.clone() });
  c.coins.push({ pos: at.clone().add(new THREE.Vector3(1, 0, 0)), vel: new THREE.Vector3(), spin: 0, value: COIN_VALUE });
  stepCombat(c, DT, w);
  const got = c.events.find((x) => x.kind === "coin");
  ok("flying into a coin collects it", !!got && c.coins.length === 0);
  ok("and it says what it was worth", got?.value === COIN_VALUE);
}
{
  /* And one just out of reach is pulled in rather than needing to be threaded. */
  const at = new THREE.Vector3(0, 0, R + 12);
  const w = world({ playerPos: at.clone() });
  const c = createCombat();
  c.coins.push({ pos: at.clone().add(new THREE.Vector3(8, 0, 0)), vel: new THREE.Vector3(), spin: 0, value: COIN_VALUE });
  let collected = false;
  for (let i = 0; i < 60 * 3 && !collected; i++) {
    stepCombat(c, DT, w);
    collected = c.events.some((x) => x.kind === "coin");
    clearEvents(c);
  }
  ok("a coin nearby comes to the player", collected);
}

// 15. Waves.
{
  ok("the first wave is ten", waveSize(1) === 10);
  ok("and each is two bigger", waveSize(2) === 12 && waveSize(3) === 14 && waveSize(4) === 16);
}
{
  const c = createCombat();
  const w = world();
  startWave(c, 1);
  ok("starting a wave announces it",
     c.events.some((e) => e.kind === "waveStart" && e.wave === 1));
  clearEvents(c);
  run(c, 60 * 10, w);
  const early = c.enemies.length;
  ok("they trickle in rather than arriving together", early > 0 && early < waveSize(1),
     `${early} after ten seconds`);
}
{
  /* Keeping up with a wave means the next one starts on a clear sky.
     A wave cannot finish EARLY: its ships are spread across the whole two
     minutes, so the soonest it can be cleared is when the last one arrives.
     Keeping up decides what is LEFT OVER, not when the wave ends. */
  const c = createCombat();
  const w = world();
  startWave(c, 1);
  clearEvents(c);
  let started = 0;
  for (let i = 0; i < 60 * (WAVE_SECONDS + 4); i++) {
    stepCombat(c, DT, w);
    for (const e of c.events) if (e.kind === "waveStart") started = e.wave ?? started;
    clearEvents(c);
    for (const e of [...c.enemies]) hurtEnemy(c, e, 1e6, pos);
    clearEvents(c);
  }
  ok("keeping up gets you to the next wave", started >= 2, `reached wave ${started}`);
  ok("with nothing left over", c.enemies.length === 0, `${c.enemies.length} left`);
}

{
  /* Falling behind lets the next wave arrive on top of the leftovers. */
  const c = createCombat();
  const w = world();
  startWave(c, 1);
  clearEvents(c);
  run(c, 60 * (WAVE_SECONDS + 2), w);
  ok("a wave that runs out of time hands over anyway", (c.wave?.n ?? 0) >= 2, `wave ${c.wave?.n}`);
  ok("and the ships it sent are still out there", c.enemies.length > 0,
     `${c.enemies.length} left over`);
}
{
  /* Waves differ in weight, not just in count. */
  const bias: number[] = [];
  for (let i = 0; i < 200; i++) {
    const c = createCombat();
    startWave(c, 1);
    bias.push(c.wave!.bias);
  }
  ok("some waves are harder than others",
     Math.max(...bias) > Math.min(...bias) * 2,
     `bias ${Math.min(...bias).toFixed(2)} to ${Math.max(...bias).toFixed(2)}`);
  const count = (b: number) => {
    let rare = 0;
    for (let i = 0; i < 20000; i++) if (rollTier(b).tier > 1) rare++;
    return rare;
  };
  ok("a harder wave sends more rare ships", count(3) > count(0.5) * 2,
     `${count(3)} vs ${count(0.5)} of 20000`);
}

// 16. Calling out a round that is going to hit, and HOW CLOSE IT IS.
//
//     Geoff: "make the warning alarm start lower volume and rise in volume as
//     the bullet approaches which helps to get the sense of how close it is."
//
//     It used to call each round once, at a fixed strength, half a second out.
//     One pip cannot say anything about distance. The alarm is now continuous
//     while a round is on course, and its strength is the distance.
{
  const c = createCombat();
  const w = world();
  /* Dead on line and well out, so the whole approach can be watched. */
  const away = pos.clone().addScaledVector(fwd, 140);
  c.bullets.push({
    pos: away.clone(), vel: fwd.clone().negate().multiplyScalar(70),
    life: 6, hostile: true,
  });

  const powers: number[] = [];
  for (let i = 0; i < 130; i++) {
    stepCombat(c, DT, w);
    for (const e of c.events) if (e.kind === "incoming") powers.push(e.power);
    clearEvents(c);
  }

  ok("a round on course is called out", powers.length > 0, `${powers.length} calls`);
  ok("and it keeps calling as the round closes", powers.length > 20,
     `${powers.length} calls over the approach`);

  /* THE POINT: it starts quiet and ends loud. It no longer starts at nothing,
     because the alarm is not raised at all until a round is genuinely near:
     see WARN_RANGE. It begins a fifth of the way up and climbs from there,
     which through the volume curve is still a threefold rise. */
  ok("it starts quiet", powers[0] < 0.3, `${powers[0]?.toFixed(3)}`);
  ok("and finishes loud", powers[powers.length - 1] > 0.85,
     `${powers[powers.length - 1]?.toFixed(3)}`);

  /* And rises the whole way rather than wandering: every step forward, within
     a frame's worth of rounding. */
  let drops = 0;
  for (let i = 1; i < powers.length; i++) if (powers[i] < powers[i - 1] - 1e-6) drops++;
  ok("rising the whole way in", drops === 0, `${drops} of ${powers.length} went backwards`);
}
{
  /* ---- A WALL OF FIRE IS ONE ALARM ----
     Forty rounds on course must not be forty alarms in the same frame. Only
     the nearest is reported, because the loudest pip is the only one anybody
     would hear and overlapping copies of one tone are the smeared noise that
     got reported the first time round. */
  const c = createCombat();
  const w = world();
  /* All inside the range at which a round counts as near, or the gate would
     be what silenced them rather than the one-alarm rule under test. */
  for (let i = 0; i < 40; i++) {
    c.bullets.push({
      pos: pos.clone().addScaledVector(fwd, 6 + i * 0.6),
      vel: fwd.clone().negate().multiplyScalar(70), life: 6, hostile: true,
    });
  }
  stepCombat(c, DT, w);
  const calls = c.events.filter((e) => e.kind === "incoming");
  ok("forty rounds raise one alarm, not forty", calls.length === 1, `${calls.length}`);
  /* And it is the NEAREST one that sets the level. */
  ok("and it is the closest of them that sets the level",
     calls[0] && calls[0].power > 0.5, `${calls[0]?.power.toFixed(3)}`);
}
{
  /* Far enough away to be outside the window: no call yet. */
  const c = createCombat();
  const w = world();
  const away = pos.clone().addScaledVector(fwd, 300);
  c.bullets.push({
    pos: away.clone(), vel: fwd.clone().negate().multiplyScalar(70),
    life: 8, hostile: true,
  });
  stepCombat(c, DT, w);
  ok("a round still seconds away is not called out yet",
     !c.events.some((e) => e.kind === "incoming"));
  clearEvents(c);
  /* Let it close, and then it is. Four hundred units at seventy a second is
     nearly six seconds out, and the window is WARN_LEAD wide. */
  const seen = run(c, Math.round(60 * (300 / 70 + 0.5)), w);
  ok("but it is once it comes inside the window", seen.includes("incoming"));
}
{
  /* One that will miss is never called out, however close it passes. */
  const c = createCombat();
  const w = world();
  const away = pos.clone().addScaledVector(fwd, 25).add(new THREE.Vector3(0, 6, 0));
  c.bullets.push({
    pos: away.clone(), vel: fwd.clone().negate().multiplyScalar(70),
    life: 3, hostile: true,
  });
  const seen = run(c, 60, w);
  ok("a round that will miss is not called out", !seen.includes("incoming"));
}
{
  /* And the player's own fire never sets it off. */
  const c = createCombat();
  const w = world();
  const away = pos.clone().addScaledVector(fwd, 25);
  c.bullets.push({
    pos: away.clone(), vel: fwd.clone().negate().multiplyScalar(70),
    life: 3, hostile: false,
  });
  const seen = run(c, 60, w);
  ok("your own rounds never warn you", !seen.includes("incoming"));
}
{
  /* Half a second really is the lead: the warning has to come before the hit. */
  const c = createCombat();
  const w = world();
  const away = pos.clone().addScaledVector(fwd, 30);
  c.bullets.push({
    pos: away.clone(), vel: fwd.clone().negate().multiplyScalar(70),
    life: 3, hostile: true,
  });
  let warnedAt = -1, hitAt = -1, t = 0;
  for (let i = 0; i < 120; i++) {
    stepCombat(c, DT, w);
    t += DT;
    for (const e of c.events) {
      if (e.kind === "incoming" && warnedAt < 0) warnedAt = t;
      if (e.kind === "playerHit" && hitAt < 0) hitAt = t;
    }
    clearEvents(c);
  }
  ok("the warning arrives before the round does", warnedAt > 0 && hitAt > warnedAt,
     `warned at ${warnedAt.toFixed(2)}s, hit at ${hitAt.toFixed(2)}s`);
  ok("with about half a second in hand", hitAt - warnedAt > 0.3 && hitAt - warnedAt <= 0.6,
     `${(hitAt - warnedAt).toFixed(2)}s of warning`);
}

// THE FIGHTERS MUST BE ABLE TO CATCH YOU.
//
// The player's cruise is multiplied out among the planets so the sky can be
// crossed at all. Leaving the fighters on their old flat speed meant that above
// about two hundred units the player outran every one of them and they were
// culled ten seconds later for being too far away — and with free flight the
// ship climbs past that height on its own within seconds, so the sky emptied
// itself. Geoff: "there also seem to be no enemies... they aren't chasing me."
{
  const at = (alt: number) => {
    const c = createCombat();
    const pos = new THREE.Vector3(0, 0, R + alt);
    const fwd = new THREE.Vector3(0, 1, 0);
    startWave(c, 1);
    const w = { tips: [], playerPos: pos, playerFwd: fwd, damageScale: 1 };
    /* Long enough for the wave to send something. */
    for (let i = 0; i < 60 * 4; i++) { stepCombat(c, 1 / 60, w); clearEvents(c); }
    return c;
  };

  /* How fast a fighter actually moves, measured rather than read off a
     constant: what matters is whether it gains on a ship at the same height. */
  const chaseSpeed = (alt: number) => {
    const c = at(alt);
    if (c.enemies.length === 0) return 0;
    const e = c.enemies[0];
    const was = e.pos.clone();
    const w = {
      tips: [], playerPos: new THREE.Vector3(0, 0, R + alt),
      playerFwd: new THREE.Vector3(0, 1, 0), damageScale: 1,
    };
    stepCombat(c, 1 / 60, w);
    clearEvents(c);
    return c.enemies[0] ? was.distanceTo(c.enemies[0].pos) * 60 : 0;
  };

  const low = chaseSpeed(8);
  const high = chaseSpeed(500);
  /* Around cruise, which is 8 since the world was doubled in size by halving
     the speeds. A fighter is a little quicker, or it could never close. */
  ok("fighters fly at their own pace near the towers", low > CRUISE && low < CRUISE * 3,
     `${low.toFixed(1)} units a second against cruise ${CRUISE}`);
  /* Twice, not the full multiplier: a fighter's own height varies as it weaves
     around the player, so the measured figure sits under the ceiling. What is
     asserted below is the property that matters. */
  ok("and much faster out among the planets", high > low * 1.8,
     `${low.toFixed(0)} near home, ${high.toFixed(0)} out there`);

  /* THE ONE THAT MATTERS: at any height a fighter has to be quicker than a
     cruising ship, or it can never close. */
  for (const alt of [8, 200, 500, 1000]) {
    const player = CRUISE * cruiseScale(alt);
    const enemy = chaseSpeed(alt);
    ok(`a fighter can still catch a cruising ship at ${alt} units`, enemy > player,
       `fighter ${enemy.toFixed(0)} vs ship ${player.toFixed(0)}`);
  }
}

// FIGHTERS MAKE PASSES. THEY DO NOT SWARM.
//
// Geoff: "they are swarming around me like bugs and not moving like a spaceship
// with a limited ability to turn... they need limited speed and turning ability
// and need to make strafing runs like a reasonable spaceship."
//
// Two things caused it. They turned toward the player every single frame with a
// turn radius of eight units, tighter than the range they shoot from, so they
// could hold station on anyone; and they flew HALF AGAIN AS FAST inside eight
// units, so the closer they got the harder they were to shake.
{
  /* One fighter, one stationary player, three minutes. What is measured is the
     SHAPE of what it does. */
  const c = createCombat();
  const player = new THREE.Vector3(0, 0, R + 40);
  const e = fighter(player.clone().add(new THREE.Vector3(0, 0, 90)), {
    shield: 1e9, breakAt: 12, rejoinAt: 70, passFor: 9, fireAt: 1e9,
  });
  e.fwd.copy(player).sub(e.pos).normalize();
  c.enemies.push(e);

  const w = { tips: [], playerPos: player, playerFwd: new THREE.Vector3(0, 1, 0), damageScale: 1 };
  const ranges: number[] = [];
  let closest = Infinity, furthest = 0, passes = 0, wasIn = true;
  for (let i = 0; i < 60 * 180; i++) {
    stepCombat(c, 1 / 60, w);
    clearEvents(c);
    if (c.enemies.length === 0) break;
    const r = player.distanceTo(c.enemies[0].pos);
    ranges.push(r);
    closest = Math.min(closest, r);
    furthest = Math.max(furthest, r);
    const isIn = c.enemies[0].mode === "in";
    if (wasIn && !isIn) passes++;
    wasIn = isIn;
  }

  ok("the fighter is still in the fight after three minutes", c.enemies.length === 1);
  ok("it makes repeated passes rather than one", passes >= 3, `${passes} passes`);

  /* THE ONE THAT MATTERS: it must actually go away between passes. A swarming
     fighter's range barely changes; one making runs swings between close and
     far. */
  ok("it breaks off to a real distance", furthest > 60, `furthest ${furthest.toFixed(0)}`);
  ok("and it does get close on the way in", closest < 20, `closest ${closest.toFixed(0)}`);
  ok("so the range genuinely swings", furthest - closest > 45,
     `${closest.toFixed(0)} to ${furthest.toFixed(0)}`);

  /* And it does not simply sit at one distance, which is what an orbit looks
     like in this measurement: count how much of the time it spends close. */
  const near = ranges.filter((r) => r < 25).length / ranges.length;
  ok("and it does not loiter on top of the player", near < 0.4,
     `${Math.round(near * 100)}% of the time inside 25 units`);
}

// A fighter cannot turn tighter than the range it shoots from.
//
// That is the whole difference between a spaceship and a wasp: if its turn
// radius is smaller than its firing range it can hold station on you for ever.
{
  const c = createCombat();
  const player = new THREE.Vector3(0, 0, R + 40);
  const e = fighter(player.clone().add(new THREE.Vector3(120, 0, 0)), { shield: 1e9 });
  /* Pointing straight away, so what is measured is purely how fast it comes
     round. */
  e.fwd.set(1, 0, 0);
  c.enemies.push(e);
  const w = { tips: [], playerPos: player, playerFwd: new THREE.Vector3(0, 1, 0), damageScale: 1 };

  const start = e.fwd.clone();
  for (let i = 0; i < 30; i++) { stepCombat(c, 1 / 60, w); clearEvents(c); }
  const turned = start.angleTo(c.enemies[0].fwd) * 2;      /* radians a second */
  const radius = (ENEMY_SPEED * cruiseScale(40)) / turned;
  ok("a fighter's turn is limited", turned < 0.9, `${turned.toFixed(2)} radians a second`);
  /* Wider than the distance it breaks off at, which is the property that
     matters: a fighter that can turn inside its own merge never leaves. It used
     to come round in eight units at a turn rate of 1.1. */
  ok("and it cannot turn inside its own break-off", radius > 10,
     `${radius.toFixed(0)} units to come round`);
}

// 14. WHEN A WAVE ARRIVES, and whether it arrives at all.
{
  /* Geoff: "each wave is 120 seconds and if there's 10 of them then they should
     spawn at t=0, t=12, t=24, t=36 etc."

     It used to be a countdown that recomputed the gap from whatever time was
     left and then multiplied it by a random 0.6 to 1.4. The arrivals drifted,
     could bunch, could leave a thirty-second hole, and could not be checked
     against anything. */
  const c = createCombat();
  const w = world();
  startWave(c, 1);
  const times: number[] = [];
  let t = 0;
  let count = c.enemies.length + c.kills;
  for (let i = 0; i < 60 * 118; i++) {
    stepCombat(c, DT, w);
    clearEvents(c);
    const now = c.enemies.length + c.kills;
    if (now > count) { times.push(t); count = now; }
    t += DT;
  }
  ok("a first wave is ten", waveSize(1) === 10, `${waveSize(1)}`);
  ok("and ten of them arrive", times.length === 10, `${times.length}`);
  ok("the first is immediate", times[0] < 0.05, `t=${times[0]?.toFixed(2)}`);

  /* Every twelve seconds, to within a frame. */
  const every = WAVE_SECONDS / 10;
  let worst = 0;
  for (let i = 0; i < times.length; i++) worst = Math.max(worst, Math.abs(times[i] - i * every));
  ok("and they come every twelve seconds on the nose", worst < 0.05,
     `worst drift ${worst.toFixed(3)}s across ${times.join(", ")}`);

  /* Wave two is twelve of them, so ten seconds apart, and the rate has to
     follow the count rather than being a fixed number. */
  const c2 = createCombat();
  startWave(c2, 2);
  ok("a second wave is twelve", waveSize(2) === 12);
  ok("and its interval follows the count", Math.abs((c2.wave?.every ?? 0) - WAVE_SECONDS / 12) < 1e-9,
     `${c2.wave?.every}`);
}

// 15. AND THEY HAVE TO REACH YOU, WHEREVER YOU ARE FLYING.
{
  /* Geoff: "there seem to be few if any enemies chasing and strafing me. I
     don't know where they are but I don't see them."

     Out among the planets everything moves up to ten times faster: the
     player's cruise, the fighters' speed, the range they fire from, the range
     they are given up at. The SPAWN offsets did not, so a fighter still
     arrived a hundred units ahead, which at that speed is half a second, and
     it was passed before it had finished turning. Measured at the time:
     something inside the view 94% of the way round down low, and 24% at
     altitude. */
  const HALF = Math.cos(36 * Math.PI / 180);
  const seenAt = (alt: number) => {
    const c = createCombat();
    const at = new THREE.Vector3(0, 0, R + alt);
    const ahead = new THREE.Vector3(1, 0, 0);
    const open = cruiseScale(alt);
    const w2 = world({ playerPos: at, playerFwd: ahead });
    startWave(c, 1);
    let inView = 0;
    const frames = 60 * 150;
    for (let i = 0; i < frames; i++) {
      stepCombat(c, DT, w2);
      clearEvents(c);
      at.addScaledVector(ahead, CRUISE * open * DT);
      at.setLength(R + alt);
      for (const e of c.enemies) {
        const d = e.pos.clone().sub(at);
        /* Distances judged in units of how fast things move out here, or the
           question quietly changes with altitude and answers nothing. */
        if (d.length() < 150 * open && d.normalize().dot(ahead) > HALF) { inView++; break; }
      }
    }
    return { pct: inView / frames, alive: c.enemies.length };
  };

  for (const alt of [14, 300, 1200]) {
    const r = seenAt(alt);
    ok(`at ${alt} units up, the sky is not empty`, r.pct > 0.5,
       `${Math.round(r.pct * 100)}% of frames had something in view, ${r.alive} alive`);
    ok(`and nothing is thrown away at ${alt}`, r.alive >= 10, `${r.alive} alive of 16 sent`);
  }
}

// 17. A COIN YOU CAN ACTUALLY CATCH.
{
  /* Geoff: "for the red Divi balls, they seem to move too fast and I can't
     catch up to them. Make their maximum velocity 80% of the player."

     They orbited at sqrt(mu/r), and at sixty thousand that is twenty-three
     units a second at the height they sit, against a ship that cruises at
     eight and boosts to nineteen. The coins were faster than the ship. */
  ok("the cap really is eighty percent of a boosting ship",
     Math.abs(COIN_TOP - BOOST * 0.8) < 1e-9, `${COIN_TOP} vs ${(BOOST * 0.8).toFixed(2)}`);

  /* And that number is written out in the combat file rather than imported,
     because orbitFlight already imports from it and closing that loop reads a
     constant before it exists: a white screen that typechecks. This is the
     assertion that keeps the two copies honest. */

  /* The orbit itself is now gentle enough, which is the part that matters most
     because it is where a coin spends its life. */
  const orbital = Math.sqrt(COIN_MU / (R + 14));
  ok("a coin in its orbit is slower than a boosting ship", orbital <= BOOST,
     `${orbital.toFixed(1)} u/s against ${BOOST}`);

  /* And the hard limit holds however a coin got its speed: thrown clear by a
     dying fighter, or dragged by the magnet on the way in. */
  const c = createCombat();
  const w = world();
  let worst = 0;
  for (let n = 0; n < 40; n++) {
    c.coins.push({
      pos: pos.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(30 + n)),
      /* Absurd, on purpose: nothing may leave this loop still going this fast. */
      vel: new THREE.Vector3().randomDirection().multiplyScalar(400),
      spin: 0, value: COIN_VALUE,
    });
  }
  for (let i = 0; i < 60 * 20; i++) {
    stepCombat(c, DT, w);
    clearEvents(c);
    for (const k of c.coins) worst = Math.max(worst, k.vel.length());
  }
  ok("no coin ever outruns the cap", worst <= COIN_TOP + 1e-6,
     `fastest was ${worst.toFixed(2)} against a cap of ${COIN_TOP}`);
  ok("and a boosting ship can always run one down", worst < BOOST,
     `${worst.toFixed(2)} vs ${BOOST}`);
}

console.log(out.join("\n"));
/* ---- enemy aim error, by tier ----
   Geoff: "adding some randomness to their aim ... T7 is right on target by
   only 0.3% off." */
{
  ok("seven figures for seven tiers", AIM_ERROR.length === 7, `${AIM_ERROR.length}`);
  ok("tier one is three percent", AIM_ERROR[0] === 0.03);
  ok("tier seven is 0.3 percent", AIM_ERROR[6] === 0.003);
  let tightening = true;
  for (let i = 1; i < AIM_ERROR.length; i++) if (!(AIM_ERROR[i] < AIM_ERROR[i - 1])) tightening = false;
  ok("every tier shoots straighter than the one below", tightening, AIM_ERROR.join(","));
  ok("the figures are scaled by three, for the reason in the source", AIM_SPREAD === 3);
  ok("tier lookups clamp at both ends", Math.abs(aimErrorFor(0) - 0.09) < 1e-12
     && Math.abs(aimErrorFor(99) - 0.009) < 1e-12 && Math.abs(aimErrorFor(4) - 0.045) < 1e-12,
     `${aimErrorFor(0)} ${aimErrorFor(99)} ${aimErrorFor(4)}`);

  const from = new THREE.Vector3(0, 0, R + 10);
  const at = new THREE.Vector3(30, 0, R + 10);        /* thirty units away, along x */
  const dead = scatterAim(from, at, 0.03, () => 0);
  ok("the best roll is dead on", dead.distanceTo(at) < 1e-9, `${dead.distanceTo(at)}`);
  const worst = scatterAim(from, at, 0.03, () => 1);
  ok("the worst roll at three percent and thirty units is 0.9 off",
     Math.abs(worst.distanceTo(at) - 0.9) < 1e-6, `${worst.distanceTo(at)}`);
  ok("and the miss is sideways, not along the line of fire",
     Math.abs(worst.x - at.x) < 1e-6, `${worst.x - at.x}`);
  const t1 = scatterAim(from, at, aimErrorFor(1), () => 1);
  ok("as flown, tier one at thirty units can be 2.7 off", Math.abs(t1.distanceTo(at) - 2.7) < 1e-6,
     `${t1.distanceTo(at)}`);
  ok("which is outside the hull, so a tier-one round can miss", 2.7 > PLAYER_HIT_R);
  const t7 = scatterAim(from, at, aimErrorFor(7), () => 1);
  ok("tier seven at the same range is off by 0.27 at worst", Math.abs(t7.distanceTo(at) - 0.27) < 1e-6,
     `${t7.distanceTo(at)}`);
  ok("which is well inside the hull, so it hits", 0.27 < PLAYER_HIT_R);

  /* Round the clock: the angle roll spreads the miss in every direction. */
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    const p = scatterAim(from, at, 0.03, (() => { let n = 0; return () => (n++ === 0 ? i / 8 : 1); })());
    seen.add(`${Math.sign(Math.round(p.y * 100))},${Math.sign(Math.round((p.z - at.z) * 100))}`);
  }
  ok("misses land all round the target, not on one side", seen.size >= 4, [...seen].join(" "));
  ok("no error means the target itself", scatterAim(from, at, 0).equals(at));
  ok("and the target passed in is never written to", at.x === 30 && at.y === 0);

  /* Fired for real: a tier-one round is no longer guaranteed to pass through
     the aim point, a tier-seven one as good as is. */
  let missesT1 = 0, missesT7 = 0;
  for (let i = 0; i < 400; i++) {
    for (const [tier, count] of [[1, 0], [7, 1]] as const) {
      const c = createCombat();
      const e = {
        pos: from.clone(), fwd: new THREE.Vector3(1, 0, 0), roll: 0,
        cls: { tier, name: "", shieldMax: 100, colour: 0, speed: 1, weight: 0 },
        shield: 100, vel: new THREE.Vector3(), tumble: new THREE.Vector3(), spin: new THREE.Vector3(),
        flash: 0, ammo: 9, reload: 0, fireAt: 0, weave: 0, weaveDir: 1, mode: "in" as const,
        breakAt: 0, rejoinAt: 0, escape: new THREE.Vector3(0, 0, 1), passFor: 0, wave: 0,
      };
      enemyFire(c, e as never, at);
      const b = c.bullets[0];
      /* Where the round passes x = 30. */
      const t = (at.x - b.pos.x) / b.vel.x;
      const y = b.pos.y + b.vel.y * t, z = b.pos.z + b.vel.z * t;
      const off = Math.hypot(y - at.y, z - at.z);
      if (off > PLAYER_HIT_R) { if (count === 0) missesT1++; else missesT7++; }
    }
  }
  /* Half the time, give or take: the miss distance is uniform up to 2.7 and
     the hull is 1.4, so a hit is 1.4 in 2.7. Wide bounds, since it is random. */
  ok("a tier-one fighter misses a still ship at thirty units about half the time",
     missesT1 > 120 && missesT1 < 280, `${missesT1}/400`);
  ok("a tier-seven fighter does not miss a still ship", missesT7 === 0, `${missesT7}/400`);
}

/* ---- natural flocks: a roll every five seconds, from the nearest planet ---- */
{
  const c = createCombat();
  const w = world();
  const rolls: number[] = [];
  setFlockRandomForTests(() => rolls.shift() ?? 0.5);
  stepFlockSpawns(c, 4.9, w);
  ok("nothing before five seconds", c.flocks.length === 0);
  rolls.push(0.5);                       /* the spawn roll: fails (>= 1%) */
  stepFlockSpawns(c, 0.2, w);
  ok("a failed roll spawns nothing", c.flocks.length === 0 && c.flockClock < 5);
  rolls.push(0.005, 0.1);                /* spawn: yes; tier roll: one */
  c.flockClock = 5;
  const made = stepFlockSpawns(c, 0, w);
  ok("a one-in-a-hundred roll brings a flock", c.flocks.length === 1 && made.length === 24, `${c.flocks.length} groups, ${made.length} drones`);
  ok("of tier one, twenty-four strong", c.flocks[0].tier === 1 && c.enemies.filter((e) => e.drone).length === 24);
  ok("born in transit from a planet", c.flocks[0].phase === "transit");
  const home = c.flocks[0].home;
  ok("its home is a planet, far out", home.length() > 800, `${home.length().toFixed(0)}`);
  ok("and it starts just off that planet's surface, on the near side",
     made[0].pos.distanceTo(home) < 400 && made[0].pos.distanceTo(w.playerPos) < home.distanceTo(w.playerPos),
     `${made[0].pos.distanceTo(home).toFixed(0)}`);
  ok("not a cheat flock: it is worth something", !made[0].cheat);
  rolls.push(0.005, 0.9995);             /* spawn: yes; tier: seven */
  c.flockClock = 5;
  const big = stepFlockSpawns(c, 0, w);
  ok("a tier-seven roll brings forty-eight", big.length === 48 && c.flocks[1].tier === 7, `${big.length}`);
  setFlockRandomForTests(null);
}

/* ---- what a flock member is worth ---- */
{
  const c = createCombat();
  const w = world();
  const [d] = spawnFleet(c, 1, w.playerPos, w.playerFwd, { count: 1 });
  const coinsBefore = c.coins.length;
  hurtEnemy(c, d, 999, d.pos.clone().add(new THREE.Vector3(0, 0, 1)), "me");
  ok("a flock member counts a fifth of a kill", Math.abs(c.kills - 0.2) < 1e-9, `${c.kills}`);
  ok("and drops one coin, not five", c.coins.length - coinsBefore === 1, `${c.coins.length - coinsBefore}`);
  const down = c.events.find((e) => e.kind === "enemyDown");
  ok("the event says so, for the room", down?.worth === 0.2, `${down?.worth}`);
  const hit = c.events.find((e) => e.kind === "enemyHit");
  ok("damage on a drone scores, capped at what it had", hit?.damage === 50, `${hit?.damage}`);

  const c2 = createCombat();
  const [cheat] = spawnFleet(c2, 1, w.playerPos, w.playerFwd, { count: 1, cheat: true });
  hurtEnemy(c2, cheat, 999, cheat.pos.clone().add(new THREE.Vector3(0, 0, 1)), "me");
  ok("a cheat drone is worth nothing at all", c2.kills === 0 && c2.coins.length === 0
     && c2.events.find((e) => e.kind === "enemyDown")?.worth === 0
     && c2.events.find((e) => e.kind === "enemyHit")?.damage === 0);
}

/* ---- coins: magnetic within twenty diameters, and shot away ---- */
{
  ok("the magnet reaches twenty diameters", Math.abs(COIN_MAGNET - COIN_RADIUS * 40) < 1e-9, `${COIN_MAGNET}`);
  const c = createCombat();
  const at = new THREE.Vector3(0, 0, R + 20);
  c.coins.push({ pos: at.clone(), vel: new THREE.Vector3(), spin: 0, value: 1 });
  /* A round through it. */
  c.bullets.push({ pos: at.clone().add(new THREE.Vector3(0, 0, -2)), vel: new THREE.Vector3(0, 0, 60), life: 3, hostile: false });
  stepCombat(c, 1 / 30, world());
  ok("the round is spent on the coin", c.bullets.length === 0);
  ok("the coin recoils along the round", c.coins[0].vel.z > COIN_KICK * 0.8, `${c.coins[0].vel.z.toFixed(1)}`);
  ok("and spins", Math.abs(c.coins[0].spinVel ?? 0) > 0);
  ok("with a hit event for the sound", c.events.some((e) => e.kind === "coinHit"));
}

console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
