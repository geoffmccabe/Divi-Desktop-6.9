// Swarms: formation flying, splitting, and what a fleet is worth.
//
// Run: sh scripts/run-rebels-flock-tests.sh
//
// A flock is the one part of this game where nothing is wrong until
// twenty-four things are on screen at once, which is exactly the moment it is
// hardest to see WHAT is wrong. So the interesting properties are asserted
// rather than eyeballed: that they never merge, never scatter, never sink into
// the planet, actually make passes, and cannot be turned into money.

import * as THREE from "three";
import { R } from "./orbitWorld";
import {
  slotOffsets, splitSizes, pickSplit, turnToward, avoidPlanet, resetFlockIds,
  FORM_SPACING, SPLIT_RANGE, DRONE_TIERS, DRONE_CAP, FLEET_SIZE,
  DRONE_RELOAD, DRONE_BULLET_SPEED, TOUCH_R,
} from "./rebelsFlock";
import {
  createCombat, stepCombat, spawnFleet, hurtEnemy, clearEvents,
  BULLET_SPEED, type CombatState, type Enemy,
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
const home = new THREE.Vector3(0, 0, R + 40);

function world(at = home, fwd = new THREE.Vector3(1, 0, 0)) {
  return {
    tips: [] as THREE.Vector3[],
    playerPos: at.clone(),
    playerFwd: fwd.clone(),
    playerUp: at.clone().normalize(),
    homeIndex: -1,
    guard: false,
    grace: 0,
    damageScale: 1,
  };
}

function drones(c: CombatState): Enemy[] {
  return c.enemies.filter((e) => e.drone);
}
function finite(v: THREE.Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/* ------------------------------------------------- the formation lattice */
{
  for (const n of [2, 4, 6, 8, 12, 24]) {
    const slots = slotOffsets(n);
    ok(`lattice ${n}: right number of places`, slots.length === n);

    /* Every drone's nearest neighbour should sit about one spacing away. That
       is the whole of "keeping a certain distance from each other", and it is
       the property that a random scatter does NOT have. */
    let worstNear = Infinity, worstFar = 0;
    for (let i = 0; i < n; i++) {
      let near = Infinity;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        near = Math.min(near, slots[i].distanceTo(slots[j]));
      }
      worstNear = Math.min(worstNear, near);
      worstFar = Math.max(worstFar, near);
    }
    /* Generous bounds: a Fibonacci sphere is even, not perfect, and the poles
       are always a little tighter than the equator. */
    ok(`lattice ${n}: no two on top of each other`,
      worstNear > FORM_SPACING * 0.45, `closest ${worstNear.toFixed(2)}`);
    ok(`lattice ${n}: nobody stranded`,
      worstFar < FORM_SPACING * 2.4, `loneliest ${worstFar.toFixed(2)}`);
  }

  const a = slotOffsets(24);
  const b = slotOffsets(24);
  ok("lattice is cached, not rebuilt every frame", a === b);

  const c24 = slotOffsets(24).reduce((v, p) => v.add(p), new THREE.Vector3()).length();
  ok("lattice is centred on the group", c24 < FORM_SPACING * 0.6, `off by ${c24.toFixed(2)}`);
}

/* ------------------------------------------------------------ the splits */
{
  ok("24 into 2 is 12 and 12", JSON.stringify(splitSizes(24, 2)) === "[12,12]");
  ok("24 into 3 is 8, 8, 8", JSON.stringify(splitSizes(24, 3)) === "[8,8,8]");
  ok("24 into 4 is 6, 6, 6, 6", JSON.stringify(splitSizes(24, 4)) === "[6,6,6,6]");
  ok("24 into 6 is four each", JSON.stringify(splitSizes(24, 6)) === "[4,4,4,4,4,4]");

  /* The honest case: some were shot down before the fleet came apart. */
  for (const total of [23, 19, 17, 13, 7]) {
    for (const parts of [2, 3, 4, 6]) {
      const sizes = splitSizes(total, parts);
      const sum = sizes.reduce((x, y) => x + y, 0);
      ok(`${total} into ${parts} loses nobody`, sum === total, `got ${sizes.join("+")}`);
    }
  }

  let sawParts = new Set<number>();
  for (let i = 0; i < 400; i++) {
    const sizes = pickSplit(24);
    sawParts.add(sizes.length);
    ok("a split never strands a single drone", sizes.every((n) => n >= 2));
  }
  ok("all four of Geoff's splits come up",
    [2, 3, 4, 6].every((p) => sawParts.has(p)), [...sawParts].join(","));

  /* Five left cannot split into six, and must not pretend to. */
  ok("too few to split just presses on", pickSplit(3).length === 1);
}

/* ---------------------------------------------------------- steering maths */
{
  const fwd = new THREE.Vector3(0, 0, 1);
  const back = new THREE.Vector3(0, 0, -1);
  turnToward(fwd, back, 0.5);
  ok("a half turn is not a dead end", fwd.dot(back) > -0.9 && finite(fwd),
    `dot ${fwd.dot(back).toFixed(3)}`);

  /* Diving straight at the planet. "Away" is straight behind, so a plain
     radial push would only brake. What comes out must actually turn it. */
  const at = new THREE.Vector3(0, 0, R + 5);
  const down = new THREE.Vector3(0, 0, -1);
  const steer = new THREE.Vector3(0, 0, -1);
  avoidPlanet(at, down, 5, steer, 3);
  ok("head-on at the planet still turns", steer.length() > 0.5 && Math.abs(steer.z) < 0.98,
    `z ${steer.z.toFixed(3)}`);
  ok("head-on avoidance stays finite", finite(steer));
}

/* --------------------------------------------------------- a fleet arrives */
{
  resetFlockIds();
  const c = createCombat();
  const made = spawnFleet(c, 1, home, new THREE.Vector3(1, 0, 0));
  ok("a fleet is twenty-four", made.length === FLEET_SIZE, `${made.length}`);
  ok("one formation to begin with", c.flocks.length === 1);
  ok("every drone has fifty health",
    made.every((e) => e.shield === 50 && e.cls.shieldMax === 50));
  ok("tier one is grey", made[0].cls.colour === DRONE_TIERS[0].colour);
  ok("they all know their formation",
    made.every((e) => e.group === c.flocks[0].id) && new Set(made.map((e) => e.slot)).size === 24);
  ok("they start well out",
    made[0].pos.distanceTo(home) > SPLIT_RANGE, `${made[0].pos.distanceTo(home).toFixed(0)}`);

  /* The cap. A stuck key must not be able to fill the sky. */
  for (let i = 0; i < 20; i++) spawnFleet(c, 1, home, new THREE.Vector3(1, 0, 0));
  ok("never more drones than the cap", drones(c).length <= DRONE_CAP, `${drones(c).length}`);
}

/* ------------------------------------------- flying in, splitting, passing */
{
  resetFlockIds();
  const c = createCombat();
  const w = world();
  spawnFleet(c, 1, home, new THREE.Vector3(1, 0, 0), { cheat: true });

  const startGap = drones(c)[0].pos.distanceTo(home);
  let splitAt = -1;
  let mostGroups = 1;
  let closest = Infinity;
  let farthest = 0;
  let tightest = Infinity;
  let looseness = 0, looseSamples = 0;
  let lowest = Infinity;
  let passes = 0;
  let wasClose = false;

  /* Three minutes. Long enough for several full cycles of run and break-off. */
  for (let step = 0; step < 60 * 180; step++) {
    stepCombat(c, DT, w);
    clearEvents(c);
    const ds = drones(c);
    if (!ds.length) break;

    if (splitAt < 0 && c.flocks.length > 1) splitAt = step;
    mostGroups = Math.max(mostGroups, c.flocks.length);

    /* Sampled rather than measured every frame: the assertions are about the
       whole run, and forty-eight thousand all-pairs passes would make the test
       slower than the thing it tests. */
    if (step % 7 === 0) {
      for (let i = 0; i < ds.length; i++) {
        const gap = ds[i].pos.distanceTo(home);
        closest = Math.min(closest, gap);
        farthest = Math.max(farthest, gap);
        lowest = Math.min(lowest, ds[i].pos.length() - R);
        for (let j = i + 1; j < ds.length; j++) {
          tightest = Math.min(tightest, ds[i].pos.distanceTo(ds[j].pos));
        }
      }
      /* How far each drone sits from the centre of its own group: the measure
         of whether this is a formation or a cloud. */
      for (const g of c.flocks) {
        const mine = ds.filter((d) => d.group === g.id);
        if (mine.length < 2) continue;
        const mid = new THREE.Vector3();
        for (const d of mine) mid.add(d.pos);
        mid.divideScalar(mine.length);
        for (const d of mine) { looseness += d.pos.distanceTo(mid); looseSamples++; }
      }
    }

    /* A pass is a run in and a break-off out. */
    const near = ds.some((d) => d.pos.distanceTo(home) < 30);
    if (near && !wasClose) { passes++; wasClose = true; }
    if (wasClose && ds.every((d) => d.pos.distanceTo(home) > 90)) wasClose = false;
  }

  ok("the fleet closes on the player", closest < startGap * 0.3,
    `from ${startGap.toFixed(0)} to ${closest.toFixed(0)}`);
  ok("the fleet comes apart", splitAt > 0, splitAt > 0 ? `at ${(splitAt / 60).toFixed(1)}s` : "never");
  ok("into one of Geoff's splits", [2, 3, 4, 6].includes(mostGroups), `${mostGroups} groups`);
  ok("they make repeated strafing runs", passes >= 3, `${passes} passes in 3 min`);
  ok("and they really do break off", farthest > 120, `out to ${farthest.toFixed(0)}`);

  /* THE ONE THAT MATTERS. Twenty-four spheres that can occupy the same bit of
     sky look like one sphere, and no amount of tuning elsewhere hides it. */
  /* Not "mostly apart": never closer than two bodies, at any point in three
     minutes of running, splitting and crossing. The hard pass promises it. */
  ok("no two drones ever merge", tightest > TOUCH_R * 0.97,
    `closest pair ${tightest.toFixed(2)}, floor ${TOUCH_R.toFixed(2)}`);
  /* And the opposite failure: a flock that quietly turns into a cloud. */
  const mean = looseness / Math.max(1, looseSamples);
  ok("they stay a formation, not a cloud", mean < FORM_SPACING * 3.5,
    `mean ${mean.toFixed(2)} from centre`);

  ok("nobody sinks into the planet", lowest > 0, `lowest ${lowest.toFixed(1)}`);
  ok("nothing went to NaN", drones(c).every((d) => finite(d.pos) && finite(d.fwd)));
}

/* ------------------------------------------------------------- their fire */
{
  resetFlockIds();
  const c = createCombat();
  /* Parked right on top of the player so every one of them is in range the
     whole time, which is the worst case for the rate of fire. */
  const w = world();
  const made = spawnFleet(c, 1, home, new THREE.Vector3(1, 0, 0), { cheat: true });
  for (const d of made) {
    d.pos.copy(home).add(new THREE.Vector3().randomDirection().multiplyScalar(35));
    d.fireAt = 0;
  }

  let shots = 0;
  const seen: Bullet[] = [] as never;
  let orbSpeed = 0, orbs = 0, hostileOrbs = 0;
  const before = c.bullets.length;
  for (let step = 0; step < 60 * 60; step++) {
    const had = c.bullets.length;
    stepCombat(c, DT, w);
    for (const b of c.bullets) {
      if (b.orb && !(b as { counted?: boolean }).counted) {
        (b as { counted?: boolean }).counted = true;
        orbs++;
        orbSpeed = b.vel.length();
        if (b.hostile) hostileOrbs++;
      }
    }
    clearEvents(c);
    void had; void before; void seen;
  }
  shots = orbs;

  /* Sixty seconds, twenty-four drones, one round each per thirty seconds.
     Two rounds each is the ceiling; the first is staggered, so the real figure
     lands under that. */
  ok("nobody fires faster than once per thirty seconds",
    shots <= made.length * 2 + 1, `${shots} rounds from ${made.length} drones in 60s`);
  ok("but they do shoot", shots >= made.length, `${shots} rounds`);
  ok("their rounds are eighty percent speed",
    Math.abs(orbSpeed - BULLET_SPEED * DRONE_BULLET_SPEED) < 0.01,
    `${orbSpeed.toFixed(1)} vs ${(BULLET_SPEED * DRONE_BULLET_SPEED).toFixed(1)}`);
  ok("their rounds hurt the player, not each other", hostileOrbs === orbs);
  ok("the reload really is thirty seconds", DRONE_RELOAD === 30);
}
type Bullet = never;

/* ---------------------------------------------------------- ANTI-CHEAT */
{
  resetFlockIds();
  const cheated = createCombat();
  const conjured = spawnFleet(cheated, 1, home, new THREE.Vector3(1, 0, 0), { cheat: true });
  for (const d of [...conjured]) hurtEnemy(cheated, d, 999, home, "me");
  ok("a conjured fleet drops no DIVI", cheated.coins.length === 0, `${cheated.coins.length} coins`);
  ok("a conjured fleet scores nothing", cheated.kills === 0, `${cheated.kills} kills`);
  ok("and never lands in the fighter tier counts",
    cheated.tierKills.every((n) => n === 0));
  ok("but it still comes apart into wreckage", cheated.junk.length > 0);
  ok("a drone sheds no wings", cheated.junk.every((j) => j.kind === "body"));

  /* The same fleet, earned rather than conjured, is worth the usual. */
  resetFlockIds();
  const earned = createCombat();
  const real = spawnFleet(earned, 1, home, new THREE.Vector3(1, 0, 0));
  for (const d of [...real]) hurtEnemy(earned, d, 999, home, "me");
  ok("an earned fleet does pay", earned.coins.length > 0 && earned.kills === real.length,
    `${earned.kills} kills, ${earned.coins.length} coins`);
  ok("drone kills never inflate the fighter tiers",
    earned.tierKills.every((n) => n === 0));
}

/* ------------------------------------------------------- tiers and health */
{
  ok("six tiers, grey first", DRONE_TIERS.length === 6 && DRONE_TIERS[0].name === "Grey");
  ok("then gold, green, blue, purple, red",
    DRONE_TIERS.map((t) => t.name).join(",") === "Grey,Gold,Green,Blue,Purple,Red");
  ok("tier one has fifty health", DRONE_TIERS[0].shieldMax === 50);
  ok("higher tiers are tougher and quicker",
    DRONE_TIERS.every((t, i) => i === 0
      || (t.shieldMax > DRONE_TIERS[i - 1].shieldMax && t.speed > DRONE_TIERS[i - 1].speed)));

  resetFlockIds();
  const c = createCombat();
  const red = spawnFleet(c, 6, home, new THREE.Vector3(1, 0, 0), { cheat: true });
  ok("a tier six fleet is red", red[0].cls.colour === 0xff4d4d);
  ok("a tier out of range is clamped, not crashed",
    spawnFleet(createCombat(), 99, home, new THREE.Vector3(1, 0, 0)).length === FLEET_SIZE);
}

/* --------------------------------------------------------- what it costs */
{
  resetFlockIds();
  const c = createCombat();
  const w = world();
  spawnFleet(c, 1, home, new THREE.Vector3(1, 0, 0), { cheat: true });
  /* Warm the compiler up before timing anything. */
  for (let i = 0; i < 600; i++) { stepCombat(c, DT, w); clearEvents(c); }
  const t0 = performance.now();
  for (let i = 0; i < 1800; i++) { stepCombat(c, DT, w); clearEvents(c); }
  const per = (performance.now() - t0) / 1800;
  /* The whole combat step, not only the flocking, and node is slower at this
     than a release build. A frame is 16.7ms; a fifth of that would be a real
     problem and anything under a millisecond is not worth optimising. The
     naive all-pairs loop is deliberate: measured, it beats a spatial grid
     until well past a hundred agents, and building the grid each frame costs
     more than the loop it would replace. */
  ok("a fleet of twenty-four is cheap", per < 1.0, `${per.toFixed(3)} ms per step`);
  out.push(`      (${drones(c).length} drones, ${c.flocks.length} groups, ${per.toFixed(3)} ms/step)`);
}

console.log(out.join("\n"));
console.log(`${out.filter((l) => l.startsWith("PASS")).length} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
