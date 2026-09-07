// Bullets, fighters and what happens when they meet.
//
// Run: sh scripts/run-rebels-combat-tests.sh

import * as THREE from "three";
import { R } from "./orbitWorld";
import { MAX_SHIELD } from "./orbitFlight";
import {
  createCombat, stepCombat, fireGuns, gunMuzzles, enemyFire,
  fireTorpedo, detonateOldest, clearEvents, fireMini, miniMuzzle,
  startWave, waveSize, WAVE_SECONDS,
  BULLET_SPEED, CONVERGE, ENEMY_R, TORPEDO_BLAST, TORPEDO_FUSE, TORPEDO_SPEED,
  TRACER_LIFE, TRACER_MAX, COIN_VALUE, COIN_PER_KILL,
  FIGHTER, LASER_MIN, LASER_MAX, rollLaserDamage, hurtEnemy, TIERS, rollTier,
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
  let hits = 0;
  for (let i = 0; i < 60 * 90; i++) {
    if (i % 7 === 0) fireGuns(c, pos, fwd, up, FOV, ASPECT);
    stepCombat(c, DT, w);
    for (const e of c.events) if (e.kind === "enemyHit") hits++;
  }
  ok("bullets do not pile up over 90 seconds", c.bullets.length < 120, `${c.bullets.length} alive`);
  ok("nor does wreckage", c.junk.length <= 60, `${c.junk.length} pieces`);
  ok("fighters stay within what the waves have sent",
     c.enemies.length <= waveSize(1) + waveSize(2), `${c.enemies.length}`);
  /* Shots land. Kills are not asserted any more: a fighter now carries a
     hundred of shield and rarer ones more, so blind fire from a fixed point
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
  const m = new THREE.Vector3();
  miniMuzzle(pos, fwd, up, FOV, ASPECT, m);
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  ok("the mini gun sits in the top right",
     m.clone().sub(pos).dot(right) > 0 && m.clone().sub(pos).dot(up) > 0,
     `right ${m.clone().sub(pos).dot(right).toFixed(2)}, up ${m.clone().sub(pos).dot(up).toFixed(2)}`);

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
  ok("coins move slower than a boosting player can fly",
     Math.max(...speeds) < 30, `fastest ${Math.max(...speeds).toFixed(1)} u/s`);
  ok("but faster than the player cruises, so they take chasing",
     Math.min(...speeds) > 16, `slowest ${Math.min(...speeds).toFixed(1)} u/s`);
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

// 16. Calling out a round that is going to hit.
{
  /* Dead on line, and close enough that it lands inside half a second. */
  const c = createCombat();
  const w = world();
  const away = pos.clone().addScaledVector(fwd, 25);
  c.bullets.push({
    pos: away.clone(), vel: fwd.clone().negate().multiplyScalar(70),
    life: 3, hostile: true,
  });
  const seen = run(c, 30, w);
  ok("a round on course is called out", seen.includes("incoming"), seen.join(",") || "nothing");
  ok("and only once", seen.filter((k) => k === "incoming").length === 1,
     `${seen.filter((k) => k === "incoming").length} times`);
}
{
  /* Far enough away that it is more than half a second out: no call yet. */
  const c = createCombat();
  const w = world();
  const away = pos.clone().addScaledVector(fwd, 200);
  c.bullets.push({
    pos: away.clone(), vel: fwd.clone().negate().multiplyScalar(70),
    life: 6, hostile: true,
  });
  stepCombat(c, DT, w);
  ok("a round still seconds away is not called out yet",
     !c.events.some((e) => e.kind === "incoming"));
  clearEvents(c);
  /* Let it close, and then it is. */
  const seen = run(c, 60 * 3, w);
  ok("but it is once it is half a second out", seen.includes("incoming"));
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

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
