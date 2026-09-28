// Building one of Geoff's enemies into a ship that is actually flying.
//
// Run: sh scripts/run-rebels-customenemy-tests.sh
//
// THE TEST THAT MATTERS MOST IN THIS FILE is "a custom enemy does not rewrite
// the tier it was built from". e.cls is a reference into the module-level TIERS
// array, shared by every fighter of that tier, so the obvious way to give a
// custom enemy five thousand health gives it to every Blue Fighter in the room
// for the life of the worker. That is a one-line mistake with no error message
// and it would look exactly like a balance problem.
//
// Everything else here is the translation being honest: what the definition
// said is what the ship has, and what it did not say is left alone.

export {};
import { applyEnemyType, classFor, tierForType, typeById } from "../src/customEnemy";
import { TIERS, DRAGON_CLASS, spawnDragon, spawnFighter, hurtEnemy, createCombat } from "../../../ui/src/wallet/rebels/rebelsCombat";
import { DRONE_TIERS } from "../../../ui/src/wallet/rebels/rebelsFlock";
import { blankEnemy, builtInEnemies, DEFAULT_TUNE, tuneFor, type EnemyType } from "../../../ui/src/wallet/rebels/enemyTypes";
import * as THREE from "three";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

const custom = (over: Partial<EnemyType> = {}): EnemyType =>
  ({ ...blankEnemy("brute"), name: "Brute", ...over });

const at = () => new THREE.Vector3(0, 7000, 0);
const fwd = () => new THREE.Vector3(1, 0, 0);
const spawn = (tier = 3) => spawnFighter(createCombat(), at(), fwd(), { tier });

/* ================= THE ONE THAT MATTERS ================= */
{
  /* Health, colour, name and speed of the tier, recorded before anything
     touches it, so the comparison afterwards is against the real numbers and
     not against a copy of the damage. */
  const before = { ...TIERS[2] };

  const e = spawn(3);
  applyEnemyType(e, custom({ shieldMax: 5000, colour: 0x112233, speed: 4, name: "Brute" }));

  ok("the enemy itself got what the definition said",
     e.cls.shieldMax === 5000 && e.cls.colour === 0x112233 && e.cls.speed === 4,
     `${e.cls.shieldMax} hp, speed ${e.cls.speed}`);

  /* ---- AND THE TIER IS UNTOUCHED ---- */
  ok("a custom enemy does not rewrite the tier it was built from",
     TIERS[2].shieldMax === before.shieldMax
     && TIERS[2].colour === before.colour
     && TIERS[2].speed === before.speed
     && TIERS[2].name === before.name,
     `tier 3 is now ${TIERS[2].shieldMax} hp, was ${before.shieldMax}`);

  /* And the proof that actually matters: the NEXT ordinary fighter of that
     tier is still an ordinary fighter. Comparing the table is one thing;
     comparing a ship built from it afterwards is the thing players would see. */
  const plain = spawn(3);
  ok("and an ordinary fighter spawned afterwards is still ordinary",
     plain.cls.shieldMax === before.shieldMax && plain.shield === before.shieldMax,
     `${plain.cls.shieldMax} hp with ${plain.shield} in the bar`);

  ok("the class really is a different object, not the shared one",
     e.cls !== TIERS[2] && plain.cls === TIERS[2]);
}

/* ================= AND THE DRAGON'S CLASS, WHICH IS WORSE =================
   TIERS is at least an array somebody might think twice about. DRAGON_CLASS is
   a single exported object, and there is exactly one dragon at a time, so
   corrupting it would look like "the dragon is wrong now" with nothing to
   compare against. */
{
  const before = { ...DRAGON_CLASS };
  const c = createCombat();
  const d = applyEnemyType(spawnDragon(c, at(), fwd()),
                           custom({ id: "wyrm", name: "Wyrm", behaviour: "dragon", shieldMax: 9000 }));
  ok("a custom dragon gets its own health", d.cls.shieldMax === 9000 && d.shield === 9000,
     `${d.shield} of ${d.cls.shieldMax}`);
  ok("and the shared DRAGON_CLASS is untouched",
     DRAGON_CLASS.shieldMax === before.shieldMax && DRAGON_CLASS.name === before.name,
     `${DRAGON_CLASS.shieldMax}, was ${before.shieldMax}`);
  ok("the next dragon is an ordinary dragon again",
     spawnDragon(createCombat(), at(), fwd()).cls.shieldMax === before.shieldMax);
}

/* ================= THE SHIELD IS FILLED ================= */
{
  /* Left alone it would hold the TIER's health, so a five-thousand-health
     enemy would arrive with a hundred and sixty of it, die to one pass, and
     show three percent on its bar while doing so. */
  const e = applyEnemyType(spawn(3), custom({ shieldMax: 5000 }));
  ok("a custom enemy arrives at full health, not the tier's",
     e.shield === 5000, `${e.shield} of ${e.cls.shieldMax}`);
  ok("and its bar therefore reads full",
     e.shield / e.cls.shieldMax === 1);
}

/* ================= RESISTANCE ================= */
{
  const c = createCombat();
  const soft = applyEnemyType(spawnFighter(c, at(), fwd(), { tier: 1 }), custom({ shieldMax: 1000, resistance: 0 }));
  const hard = applyEnemyType(spawnFighter(c, at(), fwd(), { tier: 1 }), custom({ id: "tank", shieldMax: 1000, resistance: 0.5 }));
  hurtEnemy(c, soft, 100, new THREE.Vector3(0, 6900, 0));
  hurtEnemy(c, hard, 100, new THREE.Vector3(0, 6900, 0));
  ok("resistance makes a shot land for less",
     hard.shield > soft.shield, `${hard.shield} against ${soft.shield}`);
  ok("and half resistance means exactly half the damage",
     1000 - hard.shield === (1000 - soft.shield) / 2,
     `took ${1000 - hard.shield} against ${1000 - soft.shield}`);

  /* The ceiling exists so that nothing is ever unkillable, and it is enforced
     at the point of use as well as in the validator - the validator is the one
     thing that cannot be trusted to have run. */
  const cheat = applyEnemyType(spawnFighter(c, at(), fwd(), { tier: 1 }),
                               { ...custom({ id: "god", shieldMax: 1000 }), resistance: 1 });
  hurtEnemy(c, cheat, 100, new THREE.Vector3(0, 6900, 0));
  ok("nothing can be made immune, even by a definition that says so",
     cheat.shield < 1000, `${cheat.shield} left after a hundred`);
}

/* ================= WHICH TIER IT IS BUILT AS ================= */
{
  /* By health, because the tier is what every cockpit DRAWS from - the wire
     carries the tier, not the colour. Nearest, so something enormous looks
     enormous. */
  ok("something frail is built as a low tier", tierForType(custom({ shieldMax: 90 })) === 1,
     `tier ${tierForType(custom({ shieldMax: 90 }))}`);
  ok("something enormous is built as the top tier",
     tierForType(custom({ shieldMax: 99_000 })) === TIERS.length,
     `tier ${tierForType(custom({ shieldMax: 99_000 }))}`);

  /* Every built-in must map back to ITSELF, or a built-in copied in the panel
     and saved unchanged would come out looking like a different ship. */
  const fighters = builtInEnemies().filter((e) => e.behaviour === "fighter");
  const wrong = fighters.filter((f, i) => tierForType(f) !== i + 1);
  ok("every built-in fighter maps back to its own tier", wrong.length === 0,
     wrong.map((w) => `${w.id}->${tierForType(w)}`).join(" "));

  /* Drones have their own health scale, so they must be measured against it:
     a fifty-health drone is tier one, not "frailer than every fighter". */
  const drones = builtInEnemies().filter((e) => e.behaviour === "drone");
  const wrongDrones = drones.filter((d, i) => tierForType(d) !== i + 1);
  ok("and so does every built-in drone, on the drone scale",
     wrongDrones.length === 0 && DRONE_TIERS.length === drones.length,
     wrongDrones.map((w) => `${w.id}->${tierForType(w)}`).join(" "));

  ok("a tier is always a real tier", [0, 1, 50, 1e9, 99999].every((h) => {
    const t = tierForType(custom({ shieldMax: h }));
    return Number.isInteger(t) && t >= 1 && t <= TIERS.length;
  }));
}

/* ================= WHAT IS LEFT ALONE ================= */
{
  const base = TIERS[4];
  const cls = classFor(custom({ shieldMax: 1, colour: 0, speed: 1 }), base);
  ok("the tier number is kept, not taken from the definition",
     cls.tier === base.tier, `${cls.tier} against ${base.tier}`);
  ok("and the spawn weight with it", cls.weight === base.weight);
  ok("the name comes from the definition, because that is what a panel shows",
     classFor(custom({ name: "Hornet" }), base).name === "Hornet");
}

/* ================= THE TUNE THAT TRAVELS ================= */
{
  const e = applyEnemyType(spawn(2), custom({
    resistance: 0.4, damage: 3, fireEvery: 0.5, fireRange: 200, shotSpeed: 2, worth: 7,
  }));
  ok("every number the class had nowhere to put travels on the ship",
     e.tune?.resistance === 0.4 && e.tune?.damage === 3 && e.tune?.fireEvery === 0.5
     && e.tune?.fireRange === 200 && e.tune?.shotSpeed === 2 && e.tune?.worth === 7);

  /* ---- A BUILT-IN TIER IS UNCHANGED BY ALL OF THIS ----
     No tune at all, and every read of it in the simulation falls back to the
     constant it replaced. This is what makes the whole feature additive. */
  ok("an ordinary fighter carries no tune whatsoever", spawn(5).tune === undefined);

  /* And a built-in written in the new shape tunes to today's numbers, so
     "tier 3, but as a custom enemy" is the same ship. */
  const tier3 = builtInEnemies().find((x) => x.id === "tier3")!;
  ok("a built-in's own tune is the default one",
     JSON.stringify(tuneFor(tier3)) === JSON.stringify(DEFAULT_TUNE),
     JSON.stringify(tuneFor(tier3)));
}

/* ================= LOOKING ONE UP ================= */
{
  const set = [custom({ id: "brute" }), custom({ id: "hornet", name: "Hornet" })];
  ok("an enemy is found by its id", typeById(set, "hornet")?.name === "Hornet");
  ok("and a name nobody has written is simply not there",
     typeById(set, "nothing") === undefined);
  ok("a built-in's name is found in the built-in set",
     typeById(builtInEnemies(), "dragon")?.behaviour === "dragon");
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
