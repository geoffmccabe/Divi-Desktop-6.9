// The heart: a million points of it, and the sixty that guard it.
//
// Run: sh scripts/run-voxel-heart-tests.sh
//
// The controller's own suite flies a real cockpit against a real room and is
// the right place for "does pressing the key send the fleet"; this is the
// smaller question underneath it, which is whether the heart and the guard
// class are what Geoff asked for and whether a million actually counts down.
export {};
import * as THREE from "three";
import { makeVoxelPlanet } from "./voxelPlanet";
import { HEART_HP, R_HEART, CUBE } from "./voxelWorld";
import { HEART_GUARD, HEART_GUARD_COUNT, DRONE_TIERS, droneClass } from "../rebelsFlock";
import { createCombat, spawnFleet } from "../rebelsCombat";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/* ---- THE GUARD CLASS ---- */
{
  ok("the heart's guards are not one of the seven tiers",
     !DRONE_TIERS.some((t) => t.tier === HEART_GUARD.tier),
     `guard tier ${HEART_GUARD.tier}`);
  ok("they behave as tier one", HEART_GUARD.shieldMax === DRONE_TIERS[0].shieldMax
     && HEART_GUARD.speed === DRONE_TIERS[0].speed,
     `${HEART_GUARD.shieldMax} health, speed ${HEART_GUARD.speed}`);
  ok("and they are the heart's own orange, not tier one's yellow",
     HEART_GUARD.colour !== DRONE_TIERS[0].colour && HEART_GUARD.colour === 0xff8a4a,
     `0x${HEART_GUARD.colour.toString(16)}`);
  ok("asking for their class gives the guard, not a clamped tier",
     droneClass(HEART_GUARD.tier) === HEART_GUARD,
     `got 0x${droneClass(HEART_GUARD.tier).colour.toString(16)}`);
  ok("and there are sixty of them, as asked", HEART_GUARD_COUNT === 60,
     `${HEART_GUARD_COUNT}`);
}

/* ---- SENDING THEM ---- */
{
  const c = createCombat();
  const heart = new THREE.Vector3(0, 0, 0);
  const at = new THREE.Vector3(0, 0, R_HEART * CUBE + 300);
  const made = spawnFleet(c, HEART_GUARD.tier, at, new THREE.Vector3(0, 0, -1), {
    count: HEART_GUARD_COUNT,
    from: new THREE.Vector3(0, 0, R_HEART * CUBE + 40),
    home: heart.clone(),
  });
  ok("all sixty arrive", made.length === HEART_GUARD_COUNT, `${made.length}`);
  ok("they are drones, so every round and shield test already knows them",
     made.every((e) => e.drone === true));
  ok("they wear the guard's colour", made.every((e) => e.cls.colour === HEART_GUARD.colour));
  ok("they have tier one's health", made.every((e) => e.shield === DRONE_TIERS[0].shieldMax),
     `${made[0]?.shield}`);
  ok("and they are one flock, whose home is the heart",
     c.flocks.length === 1 && c.flocks[0].home.distanceTo(heart) < 1e-6,
     `${c.flocks.length} flocks`);
}

/* ---- THE MILLION ---- */
{
  const planet = makeVoxelPlanet(new THREE.Vector3(1000, 0, 0), 0);
  const h = planet.heart();
  ok("the heart starts at a million", h.hp === HEART_HP && h.max === HEART_HP,
     `${h.hp} of ${h.max}`);
  ok("it is a million, not a round guess", HEART_HP === 1_000_000, `${HEART_HP}`);
  ok("and it sits where the planet is, not at the origin",
     h.centre.x === 1000, `${h.centre.x}`);
  ok("its radius is the heart's own size in world units",
     Math.abs(h.radius - R_HEART * CUBE) < 1e-9, `${h.radius}`);

  const after = planet.hitHeart(2500);
  ok("shooting it counts down", after === HEART_HP - 2500, `${after}`);
  ok("and the heart itself reports the same", planet.heart().hp === after);
  ok("a hit of nothing does nothing", planet.hitHeart(0) === after);
  ok("and it never goes below nothing", planet.hitHeart(HEART_HP * 2) === 0);
  /* A million is meant to be a long job: a pulse round is 10 to 100, so the
     whole thing is tens of thousands of rounds and cannot be finished by
     accident on the way past. */
  ok("a million is tens of thousands of rounds, not a boss fight",
     HEART_HP / 100 > 9_000, `${Math.round(HEART_HP / 100)} rounds at the best roll`);
  planet.dispose();
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
