// Enemies Geoff can define, and the ones that already exist described in the
// same shape.
//
// Run: sh scripts/run-rebels-enemytypes-tests.sh
//
// Phase three of docs/DIVI-REBELS-GAME-BUILDER-PLAN.md, data half. Two jobs.
// First, the built-ins must be TODAY'S enemies and not an approximation of
// them, so they are checked against the real tables in the simulation rather
// than against numbers typed in here - the same trap that let the built-in
// game be described as pure tier-one fighters. Second, the bounds: these
// numbers are typed by a person into a box and handed to a simulation that
// will believe them, so every one is tested at BOTH ends.
export {};

import {
  builtInEnemies, builtInIds, validateEnemy, validateEnemies, blankEnemy, duplicateEnemy,
  BEHAVIOURS, PAINT_PARTS, WORTH_MAX, RESISTANCE_MAX,
  HEALTH_MIN, HEALTH_MAX, SPEED_MIN, SPEED_MAX,
  FIRE_EVERY_MIN, FIRE_EVERY_MAX, FIRE_RANGE_MIN, FIRE_RANGE_MAX,
  SHOT_SPEED_MIN, SHOT_SPEED_MAX, DAMAGE_MIN, DAMAGE_MAX,
  type EnemyType,
} from "./enemyTypes";
import { TIERS, DRAGON_HP } from "./rebelsCombat";
import { DRONE_TIERS, DRONE_KILL_WORTH, DRONE_FIRE_RANGE, DRONE_BULLET_SPEED } from "./rebelsFlock";
import { PART_ORDER } from "./shipColours";
import { ROUND_MAX_ENEMIES } from "./gameTypes";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/* ================= THE BUILT-INS ARE TODAY'S ENEMIES ================= */
{
  const all = builtInEnemies();
  const by = (id: string) => all.find((e) => e.id === id)!;

  ok("there are seven fighters, seven drones and the dragon", all.length === 15, `${all.length}`);
  ok("and every one of them is marked built-in", all.every((e) => e.builtIn === true));

  /* Against the real tables, tier by tier. If somebody retunes an enemy and
     not its description, this says so. */
  let same = true, firstBad = "";
  TIERS.forEach((t, i) => {
    const e = by(`tier${i + 1}`);
    if (e.shieldMax !== t.shieldMax || Math.abs(e.speed - t.speed) > 1e-9 || e.colour !== t.colour) {
      if (same) firstBad = `tier${i + 1}: described ${e.shieldMax}hp/${e.speed}x, real ${t.shieldMax}hp/${t.speed}x`;
      same = false;
    }
  });
  ok("every fighter tier matches the simulation's own table", same, firstBad);

  same = true; firstBad = "";
  DRONE_TIERS.forEach((t, i) => {
    const e = by(`drone${i + 1}`);
    if (e.shieldMax !== t.shieldMax || Math.abs(e.speed - t.speed) > 1e-9 || e.colour !== t.colour) {
      if (same) firstBad = `drone${i + 1}: described ${e.shieldMax}hp, real ${t.shieldMax}hp`;
      same = false;
    }
  });
  ok("and every drone tier does too", same, firstBad);

  ok("the dragon's health is the dragon's health",
     by("dragon").shieldMax === DRAGON_HP, `${by("dragon").shieldMax} against ${DRAGON_HP}`);
  ok("a drone kill is worth a fifth of a fighter's, as it is in the fight",
     by("drone1").worth === DRONE_KILL_WORTH, `${by("drone1").worth} against ${DRONE_KILL_WORTH}`);
  ok("a drone shoots from further than a fighter, as it does in the fight",
     by("drone1").fireRange === DRONE_FIRE_RANGE, `${by("drone1").fireRange} against ${DRONE_FIRE_RANGE}`);
  ok("and its shots are slower", by("drone1").shotSpeed === DRONE_BULLET_SPEED,
     `${by("drone1").shotSpeed} against ${DRONE_BULLET_SPEED}`);
  /* Every brain that exists has something flying it, and nothing flies a brain
     that does not. An unused BEHAVIOURS import was the compiler telling me
     this test was missing - the same signal that caught a one-sided bound
     check in the game tests. */
  ok("every behaviour the game knows has a built-in that uses it",
     BEHAVIOURS.every((b) => all.some((e) => e.behaviour === b)), BEHAVIOURS.join(", "));
  ok("and no built-in flies a brain nobody wrote",
     all.every((e) => BEHAVIOURS.includes(e.behaviour)));

  ok("fighters fly with the fighter brain and drones with the drone one",
     by("tier1").behaviour === "fighter" && by("drone1").behaviour === "drone"
       && by("dragon").behaviour === "dragon");
  ok("they escalate, which is the point of tiers",
     by("tier1").shieldMax < by("tier7").shieldMax && by("tier1").speed < by("tier7").speed,
     `${by("tier1").shieldMax}hp -> ${by("tier7").shieldMax}hp`);

  /* The paint parts have to be the ones the shader knows, or an enemy painted
     in the panel comes out wrong or not at all. */
  ok("the paint parts are the shader's own five",
     PAINT_PARTS.length === PART_ORDER.length && PAINT_PARTS.every((k, i) => k === PART_ORDER[i]),
     `${PAINT_PARTS.join(",")} against ${PART_ORDER.join(",")}`);

  /* Every built-in's name is usable in a game description, and the game
     validator has to accept it. */
  ok("every built-in has a usable id", builtInIds().every((id) => /^[a-z0-9-]+$/.test(id)));
  ok("and no two share one", new Set(builtInIds()).size === builtInIds().length);
}

/* ================= WHAT THE VALIDATOR REFUSES ================= */
{
  const good = (): EnemyType => blankEnemy("my-enemy");
  ok("a blank new enemy is valid, so the add button cannot make junk", "ok" in validateEnemy(good()));

  const bad = (f: (e: EnemyType) => void, why: string) => {
    const e = good(); f(e);
    const v = validateEnemy(e);
    ok(why, "errors" in v, "errors" in v ? v.errors[0] : "ACCEPTED, and should not have been");
  };
  const fine = (f: (e: EnemyType) => void, why: string) => {
    const e = good(); f(e);
    const v = validateEnemy(e);
    ok(why, "ok" in v, "errors" in v ? v.errors[0] : "");
  };

  bad((e) => { (e as { id: unknown }).id = "Not A Slug"; }, "an id with spaces is refused");
  bad((e) => { e.name = ""; }, "an empty name is refused");
  bad((e) => { (e as { behaviour: unknown }).behaviour = "sneaky"; }, "a brain nobody wrote is refused");
  bad((e) => { e.hull = "not-a-hull"; }, "a hull id of the wrong shape is refused");
  fine((e) => { e.hull = "space_SM_Ship_Fighter_04"; }, "a real hull id is accepted");
  bad((e) => { (e as { colour: unknown }).colour = -1; }, "a negative colour is refused");
  bad((e) => { (e as { colour: unknown }).colour = 0x1000000; }, "a colour past white is refused");

  /* ---- EVERY BOUND, AT BOTH ENDS ----
     A bound tested on one side is a bound half tested. */
  const ends: Array<[keyof EnemyType, number, number, string]> = [
    ["shieldMax", HEALTH_MIN, HEALTH_MAX, "health"],
    ["speed", SPEED_MIN, SPEED_MAX, "speed"],
    ["fireEvery", FIRE_EVERY_MIN, FIRE_EVERY_MAX, "seconds between shots"],
    ["fireRange", FIRE_RANGE_MIN, FIRE_RANGE_MAX, "firing range"],
    ["shotSpeed", SHOT_SPEED_MIN, SHOT_SPEED_MAX, "shot speed"],
    ["damage", DAMAGE_MIN, DAMAGE_MAX, "damage"],
  ];
  for (const [key, lo, hi, what] of ends) {
    bad((e) => { (e as unknown as Record<string, number>)[key] = lo - (lo > 0.5 ? 1 : 0.05); }, `${what} below the floor is refused`);
    bad((e) => { (e as unknown as Record<string, number>)[key] = hi + 1; }, `${what} above the ceiling is refused`);
    fine((e) => { (e as unknown as Record<string, number>)[key] = lo; }, `${what} exactly at the floor is allowed`);
    fine((e) => { (e as unknown as Record<string, number>)[key] = hi; }, `${what} exactly at the ceiling is allowed`);
  }
  bad((e) => { (e as unknown as Record<string, number>).shieldMax = NaN; }, "health that is not a number is refused");

  /* ---- THE TWO THAT ARE NOT JUST TIDINESS ---- */
  bad((e) => { e.resistance = 1; },
      "resistance of 1 is refused, because that is not a hard enemy, it is an unkillable one");
  fine((e) => { e.resistance = RESISTANCE_MAX; }, "and the most it may be is allowed");
  bad((e) => { e.worth = WORTH_MAX + 1; }, "an enemy worth more than the ceiling is refused");
  /* The reason that ceiling exists, said in numbers: a round may hold
     ROUND_MAX_ENEMIES of them. */
  ok("the worth ceiling keeps one round inside a sane payout",
     WORTH_MAX * ROUND_MAX_ENEMIES <= 4000,
     `${WORTH_MAX} x ${ROUND_MAX_ENEMIES} = ${WORTH_MAX * ROUND_MAX_ENEMIES} DIVI for one round at the limit`);

  /* Paint, when given, has to be paint the shader can use. */
  bad((e) => { (e as { paint: unknown }).paint = { hull1: { hue: 0, sat: 0, bright: 1, overlay: "none" } }; },
      "a paint scheme missing parts is refused");
  bad((e) => {
    const full = Object.fromEntries(PAINT_PARTS.map((k) => [k, { hue: 0, sat: 0, bright: 1, overlay: "none" }]));
    (full as Record<string, { hue: number }>).engine.hue = 999;
    (e as { paint: unknown }).paint = full;
  }, "a hue outside the wheel is refused");
  fine((e) => {
    (e as { paint: unknown }).paint =
      Object.fromEntries(PAINT_PARTS.map((k) => [k, { hue: 200, sat: 0.5, bright: 1, overlay: "none" }]));
  }, "a complete paint scheme is accepted");
}

/* ================= A SET, AND THE BUILT-INS' NAMES ================= */
{
  const a = blankEnemy("reaper");
  const b = blankEnemy("wraith");
  ok("two different enemies are fine", "ok" in validateEnemies([a, b]));
  ok("two sharing an id are refused", "errors" in validateEnemies([a, { ...b, id: "reaper" }]));
  /* A custom enemy called tier3 would shadow a built-in in every game
     description, silently. */
  const shadow = validateEnemies([{ ...a, id: "tier3" }]);
  ok("a custom enemy cannot take a built-in's name",
     "errors" in shadow && shadow.errors[0].includes("built-in"),
     "errors" in shadow ? shadow.errors[0] : "accepted");
  /* Nor claim to be one, which would make it uneditable in the panel. */
  ok("and cannot mark itself built-in",
     "errors" in validateEnemies([{ ...a, builtIn: true as const }]));
  ok("something that is not a list is refused", "errors" in validateEnemies({ id: "x" }));
}

/* ================= COPYING ONE ================= */
{
  const tier5 = builtInEnemies().find((e) => e.id === "tier5")!;
  const copy = duplicateEnemy(tier5, "my-tier5");
  ok("a copy keeps the numbers", copy.shieldMax === tier5.shieldMax && copy.speed === tier5.speed);
  ok("takes the new id", copy.id === "my-tier5");
  ok("says it is a copy", copy.name.includes("copy"), copy.name);
  ok("and is no longer built-in, so it can be edited and saved",
     copy.builtIn === undefined && "ok" in validateEnemies([copy]));
  /* Deep, not shallow: editing the copy's paint must not reach the original. */
  const painted = duplicateEnemy(
    { ...tier5, paint: Object.fromEntries(PAINT_PARTS.map((k) => [k, { hue: 10, sat: 1, bright: 1, overlay: "none" }])) as EnemyType["paint"] },
    "painted",
  );
  painted.paint!.engine.hue = 300;
  ok("and copying is deep, so editing a copy does not change what it came from",
     tier5.paint === undefined, "the original is untouched");
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
