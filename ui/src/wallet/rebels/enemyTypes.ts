// What an ENEMY is, so Geoff can make his own.
//
// Geoff: "a panel for that tab for me to create enemy types with names, health,
// damage, fire rate, colors of firing, velocity of ship, velocity of firing,
// shields, damage resistance, flocking, etc... all of our current spaceships
// can be there as options for me to choose along with being able to design
// them as an admin (using our current designer and being able to define a ship
// using that system just as players design their ships)."
//
// Phase three of docs/DIVI-REBELS-GAME-BUILDER-PLAN.md, data half. This is the
// SHAPE and the validator; the panel that edits it and the simulation reading
// from it come next. Like gameTypes.ts it imports nothing, so the room, the
// panel, the cockpit and the tests can all have it without dragging three.js
// where it does not belong, and where a number here has to equal one in the
// simulation the TEST asserts it rather than the compiler.
//
// WHAT A CUSTOM ENEMY IS NOT: new geometry. It is one of the hulls the game
// already ships, wearing paint chosen with the same controls players use on
// their own ship, plus numbers. Nobody is modelling a spaceship in an admin
// panel, and pretending otherwise would be the fastest way to make this
// unbuildable.

/* ================= HOW IT BEHAVES ================= */

/**
 * Which brain it flies with. NOT a look: this decides which piece of the
 * simulation steps it, and there are exactly three because there are exactly
 * three written.
 *
 *  fighter - comes at you, shoots, commits to a pass and goes by
 *  drone   - flies as a flock, swarms, is individually weak
 *  dragon  - the big one, its own thing entirely
 */
export type Behaviour = "fighter" | "drone" | "dragon";
export const BEHAVIOURS: Behaviour[] = ["fighter", "drone", "dragon"];

/** A paint scheme, in the five parts the ship shader knows. Kept structurally
 *  rather than importing ShipPaint, because that file reaches for three.js and
 *  the room must be able to read an enemy. The test asserts the parts agree
 *  with PART_ORDER in shipColours.ts. */
export interface PaintPart {
  /** 0-360. */
  hue: number;
  /** 0-1. */
  sat: number;
  /** 0-6. A multiplier on the art's own brightness. */
  bright: number;
  /** "none" | "lines" | "hex" | "camo". */
  overlay: string;
}
export const PAINT_PARTS = ["hull1", "hull2", "accent", "highlight", "engine"] as const;
export type PaintKey = (typeof PAINT_PARTS)[number];
export type EnemyPaint = Record<PaintKey, PaintPart>;

export interface EnemyType {
  /** Stable and never reused: game descriptions point at it by name. */
  id: string;
  name: string;
  behaviour: Behaviour;

  /* ---- what it looks like ---- */
  /** A hull from the pack, e.g. "space_SM_Ship_Fighter_04". Absent means the
   *  behaviour's usual model. */
  hull?: string;
  /** Painted with the same controls players use. Absent means the tier colour. */
  paint?: EnemyPaint;
  /** The colour of its shield bubble and its tracer, as 0xRRGGBB. */
  colour: number;

  /* ---- what it takes ---- */
  /** Its health. The shield IS the health; there is deliberately no second
   *  layer under it, for the reason ShipClass gives. */
  shieldMax: number;
  /** 0 to 0.9. Damage is multiplied by (1 - this), so 0.5 is twice as tough
   *  without the health bar being twice as long. */
  resistance: number;

  /* ---- what it does ---- */
  /** Multiplier on the base flying speed for its behaviour. */
  speed: number;
  /** Seconds between shots. */
  fireEvery: number;
  /** How far it will shoot from, in world units. */
  fireRange: number;
  /** Multiplier on the speed of what it fires. */
  shotSpeed: number;
  /** Multiplier on what one of its shots takes off you. */
  damage: number;
  /** The colour of its fire. Absent means its own colour. */
  fireColour?: number;

  /* ---- what it is worth ---- */
  /** DIVI it drops when killed, as a multiple of one Divi Sphere. */
  worth: number;

  /** Built-ins are shown in the panel and cannot be edited, only copied. */
  builtIn?: true;
}

/* ================= THE ONES THAT ALREADY EXIST =================
   Shown in the panel as read-only entries that can be duplicated and edited.
   Nothing here is new behaviour: these are today's numbers, written in the new
   shape, and the test stands them against the real tables. */

/** Fighter tiers: health 100 and thirty more per tier, speed 1 and three
 *  tenths more per tier. Must equal TIERS in rebelsCombat.ts. */
export const TIER_HEALTH_FIRST = 100;
export const TIER_HEALTH_STEP = 30;
export const TIER_SPEED_STEP = 0.3;
/** Drone tiers: fifty and twenty-five more, speed a seventh more per tier.
 *  Must equal DRONE_TIERS in rebelsFlock.ts. */
export const DRONE_HEALTH_FIRST = 50;
export const DRONE_HEALTH_STEP = 25;
export const DRONE_SPEED_STEP = 0.15;

const TIER_COLOURS = [0x9aa3ad, 0x57e06a, 0x4fa8ff, 0xa96bff, 0xff4d4d, 0xf2f6ff, 0xff45d0];
const TIER_NAMES = ["Grey", "Green", "Blue", "Purple", "Red", "White", "Fuchsia"];
const DRONE_COLOURS = [0xf5d90a, 0x57e06a, 0x4fa8ff, 0xa96bff, 0xff4d4d, 0xf2f6ff, 0xff45d0];
const DRONE_NAMES = ["Yellow", "Green", "Blue", "Purple", "Red", "White", "Fuchsia"];

/** A fighter's cadence and reach today, from rebelsCombat.ts. The fire gap is
 *  the middle of the 1.6-to-3.2 second spread a fighter actually rolls. */
export const FIGHTER_FIRE_EVERY = 2.4;
export const FIGHTER_FIRE_RANGE = 70;
/** And a drone's, from rebelsFlock.ts. */
export const DRONE_FIRE_EVERY = 30;
export const DRONE_FIRE_RANGE = 95;
export const DRONE_SHOT_SPEED = 0.8;
/** What a drone kill is worth against a fighter's, from DRONE_KILL_WORTH. */
export const DRONE_WORTH = 0.2;
/** The dragon, from rebelsCombat.ts. */
export const DRAGON_HEALTH = 2000;

export function builtInEnemies(): EnemyType[] {
  const out: EnemyType[] = [];
  for (let i = 0; i < 7; i++) {
    out.push({
      id: `tier${i + 1}`,
      name: `${TIER_NAMES[i]} Fighter`,
      behaviour: "fighter",
      colour: TIER_COLOURS[i],
      shieldMax: TIER_HEALTH_FIRST + i * TIER_HEALTH_STEP,
      resistance: 0,
      speed: 1 + i * TIER_SPEED_STEP,
      fireEvery: FIGHTER_FIRE_EVERY,
      fireRange: FIGHTER_FIRE_RANGE,
      shotSpeed: 1,
      damage: 1,
      worth: 1,
      builtIn: true,
    });
  }
  for (let i = 0; i < 7; i++) {
    out.push({
      id: `drone${i + 1}`,
      name: `${DRONE_NAMES[i]} Drone`,
      behaviour: "drone",
      colour: DRONE_COLOURS[i],
      shieldMax: DRONE_HEALTH_FIRST + i * DRONE_HEALTH_STEP,
      resistance: 0,
      speed: 1 + i * DRONE_SPEED_STEP,
      fireEvery: DRONE_FIRE_EVERY,
      fireRange: DRONE_FIRE_RANGE,
      shotSpeed: DRONE_SHOT_SPEED,
      damage: 1,
      worth: DRONE_WORTH,
      builtIn: true,
    });
  }
  out.push({
    id: "dragon",
    name: "Dragon",
    behaviour: "dragon",
    colour: 0xff8a4a,
    shieldMax: DRAGON_HEALTH,
    resistance: 0,
    speed: 1,
    fireEvery: FIGHTER_FIRE_EVERY,
    fireRange: FIGHTER_FIRE_RANGE,
    shotSpeed: 1,
    damage: 1,
    worth: 1,
    builtIn: true,
  });
  return out;
}

/** Every name a game description may use for a built-in. */
export const builtInIds = (): string[] => builtInEnemies().map((e) => e.id);

/**
 * Names that are not enemy TYPES but that the room's spawner handles itself,
 * so no custom enemy may take one.
 *
 * "fighters" is the weighted mix of all seven tiers and "flock" is one
 * formation of the default one. Neither is a row anybody can edit, but both are
 * names the spawner tests BEFORE it looks anything up - so a custom enemy
 * called "fighters" would have saved without complaint and then quietly spawned
 * the built-in mix instead of itself, for ever, with its own numbers never once
 * being used and nothing at all to say why.
 */
export const RESERVED_ENEMY_IDS = ["fighters", "flock"] as const;

/* ================= CHECKING ONE =================
   Same contract as validateGame: every error collected and named, so the panel
   shows all of them at once. The bounds exist because these numbers are typed
   by a person into a box and then handed to a simulation that will believe
   them - an enemy with a fire gap of zero is a wall of bullets, and one with
   resistance 1 cannot be killed at all. */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const HULL = /^space_SM_Ship_[A-Za-z0-9_]{1,60}$/;

export const HEALTH_MIN = 1, HEALTH_MAX = 100_000;
export const SPEED_MIN = 0.1, SPEED_MAX = 5;
export const FIRE_EVERY_MIN = 0.25, FIRE_EVERY_MAX = 120;
export const FIRE_RANGE_MIN = 5, FIRE_RANGE_MAX = 400;
/**
 * ⚠ THE FLOOR IS NOT ARBITRARY and must not be lowered without reading this.
 *
 * A slow round is given a longer life so it still reaches the range it was
 * told to shoot from, but that stretching stops at SHOT_SPEED_FLOOR in
 * rebelsCombat.ts. Below that an enemy's rounds die before they arrive: at a
 * tenth speed a fighter reaches 29% of its stated firing range, silently, and
 * the panel would be offering a setting the fight does not honour.
 *
 * It was 0.1, which allowed exactly that. enemyTypes.test.ts asserts this is
 * at or above the fight's floor, so lowering one without the other fails.
 */
export const SHOT_SPEED_MIN = 0.35, SHOT_SPEED_MAX = 5;
export const DAMAGE_MIN = 0, DAMAGE_MAX = 10;
/** 0.9 and not 1: at 1 nothing can hurt it, which is not a hard enemy, it is a
 *  broken game with no error message. */
export const RESISTANCE_MAX = 0.9;
/**
 * The most DIVI one kill may drop.
 *
 * The ceiling that matters most in this file. A sphere is one whole DIVI, a
 * fighter drops five of them, and a round may hold four hundred enemies - so
 * an enemy worth fifty would make one round worth twenty thousand DIVI, which
 * is ten times the treasury's entire daily cap. Enforced here rather than in
 * the panel because the panel is the one thing that cannot be trusted to have
 * run. See the plan's phase six.
 */
export const WORTH_MAX = 10;

export function validateEnemy(raw: unknown, hulls: string[] = []): { ok: EnemyType } | { errors: string[] } {
  const errors: string[] = [];
  const e = raw as Partial<EnemyType> | null;
  if (!e || typeof e !== "object") return { errors: ["not an enemy"] };

  if (typeof e.id !== "string" || !SLUG.test(e.id)) {
    errors.push(`id must be lower-case letters, digits and dashes (got ${JSON.stringify(e.id)})`);
  }
  if (typeof e.name !== "string" || !e.name.trim() || e.name.length > 40) {
    errors.push("name must be 1 to 40 characters");
  }
  if (!BEHAVIOURS.includes(e.behaviour as Behaviour)) {
    errors.push(`behaviour must be ${BEHAVIOURS.join(", ")} (got ${JSON.stringify(e.behaviour)})`);
  }
  if (e.hull !== undefined) {
    if (typeof e.hull !== "string" || !HULL.test(e.hull)) errors.push(`${JSON.stringify(e.hull)} is not a hull id`);
    else if (hulls.length && !hulls.includes(e.hull)) errors.push(`no hull called ${e.hull}`);
  }
  if (!Number.isInteger(e.colour) || (e.colour as number) < 0 || (e.colour as number) > 0xffffff) {
    errors.push("colour must be a number from 0x000000 to 0xffffff");
  }
  if (e.fireColour !== undefined
      && (!Number.isInteger(e.fireColour) || e.fireColour < 0 || e.fireColour > 0xffffff)) {
    errors.push("fireColour must be a number from 0x000000 to 0xffffff");
  }

  const range = (v: unknown, lo: number, hi: number, what: string) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) {
      errors.push(`${what} must be between ${lo} and ${hi} (got ${JSON.stringify(v)})`);
    }
  };
  range(e.shieldMax, HEALTH_MIN, HEALTH_MAX, "health");
  range(e.speed, SPEED_MIN, SPEED_MAX, "speed");
  range(e.fireEvery, FIRE_EVERY_MIN, FIRE_EVERY_MAX, "seconds between shots");
  range(e.fireRange, FIRE_RANGE_MIN, FIRE_RANGE_MAX, "firing range");
  range(e.shotSpeed, SHOT_SPEED_MIN, SHOT_SPEED_MAX, "shot speed");
  range(e.damage, DAMAGE_MIN, DAMAGE_MAX, "damage");
  range(e.resistance, 0, RESISTANCE_MAX, "damage resistance");
  range(e.worth, 0, WORTH_MAX, "what a kill drops");

  if (e.paint !== undefined) errors.push(...paintErrors(e.paint));

  return errors.length ? { errors } : { ok: raw as EnemyType };
}

function paintErrors(p: unknown): string[] {
  if (!p || typeof p !== "object") return ["paint is not a paint scheme"];
  const out: string[] = [];
  for (const key of PAINT_PARTS) {
    const part = (p as Record<string, unknown>)[key] as Partial<PaintPart> | undefined;
    if (!part || typeof part !== "object") { out.push(`paint is missing ${key}`); continue; }
    if (typeof part.hue !== "number" || part.hue < 0 || part.hue > 360) out.push(`${key}: hue must be 0 to 360`);
    if (typeof part.sat !== "number" || part.sat < 0 || part.sat > 1) out.push(`${key}: saturation must be 0 to 1`);
    if (typeof part.bright !== "number" || part.bright < 0 || part.bright > 6) out.push(`${key}: brightness must be 0 to 6`);
    if (typeof part.overlay !== "string") out.push(`${key}: overlay must be named`);
  }
  return out;
}

/** A whole set, checked. Ids unique, and none may take a built-in's name. */
export function validateEnemies(raw: unknown, hulls: string[] = []): { ok: EnemyType[] } | { errors: string[] } {
  if (!Array.isArray(raw)) return { errors: ["not a list of enemies"] };
  if (raw.length > 200) return { errors: [`at most 200 enemies (got ${raw.length})`] };
  const errors: string[] = [];
  const taken = new Set<string>([...builtInIds(), ...RESERVED_ENEMY_IDS]);
  const seen = new Set<string>();
  const out: EnemyType[] = [];
  raw.forEach((e, i) => {
    const v = validateEnemy(e, hulls);
    if ("errors" in v) { errors.push(...v.errors.map((x) => `enemy ${i + 1}: ${x}`)); return; }
    if (v.ok.builtIn) { errors.push(`enemy ${i + 1}: a saved enemy cannot mark itself built-in`); return; }
    if (taken.has(v.ok.id)) errors.push(`enemy ${i + 1}: ${v.ok.id} is a built-in's name`);
    if (seen.has(v.ok.id)) errors.push(`enemy ${i + 1}: two enemies share the id ${v.ok.id}`);
    seen.add(v.ok.id);
    out.push(v.ok);
  });
  return errors.length ? { errors } : { ok: out };
}

/** A new one, for the panel's "add" button: a plain grey fighter to edit. */
export function blankEnemy(id: string): EnemyType {
  return {
    id, name: "New enemy", behaviour: "fighter", colour: 0x9aa3ad,
    shieldMax: TIER_HEALTH_FIRST, resistance: 0, speed: 1,
    fireEvery: FIGHTER_FIRE_EVERY, fireRange: FIGHTER_FIRE_RANGE,
    shotSpeed: 1, damage: 1, worth: 1,
  };
}

/** A copy of one, ready to edit: same numbers, new id, no longer built-in. */
export function duplicateEnemy(e: EnemyType, id: string): EnemyType {
  const copy: EnemyType = { ...JSON.parse(JSON.stringify(e)) as EnemyType, id, name: `${e.name} copy` };
  delete copy.builtIn;
  return copy;
}

/* ================= WHAT THE SIMULATION READS =================
   The seam between a definition and a flying ship.
   
   An EnemyType describes a lot the simulation has nowhere to put. ShipClass
   carries a name, health, colour, speed and a spawn weight, and that is all -
   so resistance, cadence, reach, shot speed and worth had no home, and a custom
   enemy could only ever have been a recoloured tier with the wrong numbers.
   
   This is the part that travels WITH THE SHIP. Everything in it is a number the
   step loop reads every frame, and every one is optional at the point of use:
   an enemy with no tune behaves exactly as it did before this existed, which is
   what keeps the built-in tiers byte-for-byte unchanged.
   
   It lives here, in the file that imports nothing, because the room and the
   simulation and the panel all need it and none of them should have to reach
   through each other to get it. */

export interface EnemyTune {
  /** 0 to 0.9. Damage is multiplied by (1 - this) BEFORE anything else, so
   *  knockback, tumble and the points scored all scale with it too - a tough
   *  enemy is not also a heavier one. */
  resistance: number;
  /** Multiplier on what one of its shots takes off a player. Carried on the
   *  ROUND rather than read from the ship, because the ship is often dead by
   *  the time its last shot lands. */
  damage: number;
  /** Seconds between shots, as the MIDDLE of the spread it actually rolls. */
  fireEvery: number;
  /** How far it will shoot from, in world units. */
  fireRange: number;
  /** Multiplier on the speed of what it fires. */
  shotSpeed: number;
  /** What a kill is worth, as a multiple of one Divi Sphere: both the coins it
   *  scatters and the kill it counts for. */
  worth: number;
}

/** What today's fighter tiers do, for a test to stand a custom one against and
 *  for the panel to show as "the same as a normal fighter". */
export const DEFAULT_TUNE: EnemyTune = {
  resistance: 0,
  damage: 1,
  fireEvery: FIGHTER_FIRE_EVERY,
  fireRange: FIGHTER_FIRE_RANGE,
  shotSpeed: 1,
  worth: 1,
};

/** The flying half of a definition. The other half - name, health, colour,
 *  speed - goes onto the ship's own class, because ShipClass already has
 *  somewhere to put it. */
export function tuneFor(e: EnemyType): EnemyTune {
  return {
    resistance: e.resistance,
    damage: e.damage,
    fireEvery: e.fireEvery,
    fireRange: e.fireRange,
    shotSpeed: e.shotSpeed,
    worth: e.worth,
  };
}
