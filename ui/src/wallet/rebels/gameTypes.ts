// What a GAME is: a place, a sequence of rounds, and what they are worth.
//
// Geoff's own definition, which the whole shape follows:
//
//   "Games can be on Earth (current world) or at any of the planets or other
//    space objects already placed near to earth. Or to a code-created world
//    such as the Spikeworld... So games are a combination of both a place, and
//    a set of waves with (usually) increasing difficulty and perhaps a boss at
//    the end."
//
//       A GAME  =  a PLACE  +  a SEQUENCE OF ROUNDS  +  REWARDS
//
// See docs/DIVI-REBELS-GAME-BUILDER-PLAN.md. This file is phase one of eight
// and deliberately changes nothing a player can see: it is the SHAPE, the
// validator, and today's game expressed in it. Nothing reads it to decide a
// fight yet. Getting the shape flowing end to end before anything depends on it
// is the point - a pipe proved with nothing riding on it.
//
// NO IMPORTS, and that is deliberate, the same rule voxelWorld.ts follows. The
// room (a Cloudflare Worker), the admin panel, the cockpit and the tests all
// need this, and the moment it imports the simulation it drags three.js into
// places that have no business with it. Where a number here has to agree with
// the simulation - and the built-in game's numbers all do - the TEST asserts
// they agree rather than this file importing them.

/* ================= THE PIECES ================= */

/** Where a game is played. One room per place; see rebelsRegions.ts and the
 *  plan's phase two, which turns this list into real rooms. Earth and
 *  Spikeworld exist today; the planets are named but not yet reachable. */
export type PlaceId =
  | "earth"
  | "spike"
  | "p1" | "p2" | "p3" | "p4" | "p5" | "p6" | "p7"
  | "p8" | "p9" | "p10" | "p11" | "p12" | "p13" | "p14";

export const PLACES: PlaceId[] = [
  "earth", "spike",
  "p1", "p2", "p3", "p4", "p5", "p6", "p7",
  "p8", "p9", "p10", "p11", "p12", "p13", "p14",
];

/** Which places a game can actually be played in TODAY. The rest are named so
 *  a game can be written for them before the room exists, but a game pointed at
 *  one cannot be published yet. */
export const PLACES_LIVE: PlaceId[] = ["earth", "spike"];

/**
 * An enemy, by name.
 *
 * Strings rather than an enum because phase three lets Geoff define his own,
 * and a custom type has to be nameable here the moment it exists without this
 * file changing. The built-ins are the seven fighter tiers, the flock drone and
 * the dragon; a name that is not one of those is a custom type and is checked
 * against the enemy table rather than against this list.
 */
export const BUILT_IN_ENEMIES = [
  /* ---- "fighters" IS A MIX, and it is what the game has always sent ----
     A wave has never been one kind of ship. Every wave rolls a difficulty
     bias, and the seven tiers are weighted by it, so a wave is about nine
     tenths tier one at the easy end and closer to six tenths at the hard end.
     That per-wave roll is what makes some waves noticeably harder than others.

     The first draft of this file described the built-in game as pure tier1,
     which is a flatter and much easier game than the one running. It got
     through because the tests pinned how MANY and WHEN and said nothing about
     WHAT. Naming the mix rather than adding a "mixed" flag beside the enemy
     keeps `enemy` meaning exactly one thing: what arrives. */
  "fighters",
  "tier1", "tier2", "tier3", "tier4", "tier5", "tier6", "tier7",
  "flock", "dragon",
] as const;

/** How the things in a round turn up. */
export type Arrival = "once" | "spread" | "clumps";
export const ARRIVALS: Arrival[] = ["once", "spread", "clumps"];

export interface Spawn {
  /** A built-in name, or a custom enemy type's id. */
  enemy: string;
  count: number;
  /** "once" is all of them at the start, "spread" is evenly across the round
   *  (which is what the waves do today), "clumps" is in bursts. */
  arrive: Arrival;
  /**
   * How hard the mix is, for `enemy: "fighters"` and meaningless otherwise.
   *
   * Two numbers, a range, rolled once per round the way the waves roll one per
   * wave: the low end is mostly tier ones, the high end has a real share of
   * everything else. A range rather than a single number because the variation
   * between rounds IS the texture - every round at the same bias reads as
   * mechanical in exactly the way the original waves deliberately do not.
   *
   * Absent means the historical range, WAVE_BIAS in rebelsCombat.ts, which is
   * what the built-in uses. An admin building a "hard wave" sets the numbers up.
   */
  bias?: [number, number];
}

/** What something is worth. Applied in phase six, carried in the shape now so
 *  the admin panel and the validator do not have to change again to gain it. */
export interface Reward {
  /** DIVI, on top of whatever the enemies themselves dropped. */
  divi?: number;
  /** Item keys, as itemCatalog.ts names them. */
  items?: string[];
}

export interface Round {
  /**
   * How long it lasts. Rounds end ON THE CLOCK, always - Geoff's answer when
   * asked what ends one. A round cleared early leaves the sky empty until the
   * time is up; a round not cleared rolls its survivors into the next.
   */
  seconds: number;
  spawns: Spawn[];
  /** What surviving it pays. */
  award?: Reward;
}

export interface GameType {
  /** Stable and never reused: rows elsewhere will point at it. */
  id: string;
  name: string;
  /** The card picture, 3:2, as a small WebP data URL. Shrunk on the way in by
   *  the same machinery ship skins use. Absent until one is uploaded. */
  image?: string;
  place: PlaceId;
  /** Whether other players are in it with you. */
  crew: "solo" | "multiplayer";
  rounds: Round[];
  /** What finishing the whole thing pays. */
  award?: Reward;
  /** Unpublished games are visible to admins and to nobody else. */
  published: boolean;
}

/* ================= TODAY'S GAME, IN THE NEW SHAPE =================
   The one that has always run: Earth orbit, two-minute waves, ten fighters in
   the first and two more every wave after.

   It is GENERATED rather than typed out, for the reason the plan gives: the
   built-in has to keep behaving exactly as it does through the phases that
   follow, and the surest way to keep one code path is for the old behaviour to
   be a product of the new description rather than a special case beside it. */

/** Wave one's size, the step per wave, how long a wave lasts, and how mixed it
 *  is. These MUST equal WAVE_FIRST, WAVE_STEP, WAVE_SECONDS, WAVE_BIAS_MIN and
 *  WAVE_BIAS_MAX in rebelsCombat.ts; the test stands on that rather than this
 *  file importing the simulation. */
export const WAVE_DEFENCE_FIRST = 10;
export const WAVE_DEFENCE_STEP = 2;
export const WAVE_DEFENCE_SECONDS = 120;
export const WAVE_DEFENCE_BIAS: [number, number] = [0.5, 3.0];
/** How many rounds are written out. The real thing runs for ever, escalating;
 *  a description has to stop somewhere, and thirty rounds is an hour. */
export const WAVE_DEFENCE_ROUNDS = 30;

/** How many enemies wave `n` sends, counting from one. */
export function waveDefenceSize(n: number): number {
  return WAVE_DEFENCE_FIRST + (n - 1) * WAVE_DEFENCE_STEP;
}

export function waveDefence(): GameType {
  const rounds: Round[] = [];
  for (let n = 1; n <= WAVE_DEFENCE_ROUNDS; n++) {
    rounds.push({
      seconds: WAVE_DEFENCE_SECONDS,
      /* Evenly across the round, which is exactly what startWave does: the
         first at once and then one every window divided by the count. */
      spawns: [{
        /* A MIX, as the waves have always sent, not a wall of tier ones. */
        enemy: "fighters",
        count: waveDefenceSize(n),
        arrive: "spread",
        bias: [...WAVE_DEFENCE_BIAS] as [number, number],
      }],
    });
  }
  return {
    id: "wave-defence",
    name: "Wave Defence",
    place: "earth",
    crew: "multiplayer",
    rounds,
    published: true,
  };
}

/** What the game falls back to when the live table cannot be reached or holds
 *  something the validator refuses. A bad save must never stop the game. */
export const DEFAULT_GAMES: GameType[] = [waveDefence()];

/* ================= CHECKING ONE =================
   Same contract as validateDropConfig: every error collected and named, so the
   panel can show all of them at once rather than one per save. */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
/** A round can be twenty seconds or twenty minutes. Outside that it is a
 *  mistake, and a round of zero seconds would spin the controller. */
export const ROUND_MIN_SECONDS = 10;
export const ROUND_MAX_SECONDS = 1200;
/** Per round, across all its spawns. The simulation has its own cap on live
 *  drones; this stops a round DESCRIBING a thousand of them. */
export const ROUND_MAX_ENEMIES = 400;
export const MAX_ROUNDS = 60;
/** What a difficulty bias may be set to. Zero would be tier ones for ever;
 *  above about ten the rarest tiers stop being rare, and tier seven is meant
 *  to be one spawn in twenty thousand. */
export const BIAS_MIN = 0;
export const BIAS_MAX = 10;

export function validateGame(raw: unknown, knownEnemies: string[] = []): { ok: GameType } | { errors: string[] } {
  const errors: string[] = [];
  const g = raw as Partial<GameType> | null;
  const enemies = new Set<string>([...BUILT_IN_ENEMIES, ...knownEnemies]);

  if (!g || typeof g !== "object") return { errors: ["not a game"] };
  if (typeof g.id !== "string" || !SLUG.test(g.id)) {
    errors.push(`id must be lower-case letters, digits and dashes (got ${JSON.stringify(g.id)})`);
  }
  if (typeof g.name !== "string" || !g.name.trim() || g.name.length > 48) {
    errors.push("name must be 1 to 48 characters");
  }
  if (!PLACES.includes(g.place as PlaceId)) {
    errors.push(`place must be one of ${PLACES.join(", ")} (got ${JSON.stringify(g.place)})`);
  }
  if (g.crew !== "solo" && g.crew !== "multiplayer") {
    errors.push('crew must be "solo" or "multiplayer"');
  }
  if (g.image !== undefined && (typeof g.image !== "string" || !g.image.startsWith("data:image/webp;base64,"))) {
    errors.push("image must be a WebP data URL");
  }
  if (typeof g.published !== "boolean") errors.push("published must be true or false");
  /* A game pointed at a place that has no room yet can be written and saved,
     but not turned on. Better than hiding the place: somebody can build the
     game for a planet before the planet is reachable. */
  if (g.published && PLACES.includes(g.place as PlaceId) && !PLACES_LIVE.includes(g.place as PlaceId)) {
    errors.push(`${g.place} cannot be played yet, so this game cannot be published`);
  }

  if (!Array.isArray(g.rounds) || g.rounds.length === 0) {
    errors.push("a game needs at least one round");
  } else if (g.rounds.length > MAX_ROUNDS) {
    errors.push(`at most ${MAX_ROUNDS} rounds (got ${g.rounds.length})`);
  } else {
    g.rounds.forEach((r, i) => {
      const at = `round ${i + 1}`;
      if (!r || typeof r !== "object") { errors.push(`${at} is not a round`); return; }
      if (!Number.isFinite(r.seconds) || r.seconds < ROUND_MIN_SECONDS || r.seconds > ROUND_MAX_SECONDS) {
        errors.push(`${at}: seconds must be ${ROUND_MIN_SECONDS} to ${ROUND_MAX_SECONDS} (got ${r.seconds})`);
      }
      if (!Array.isArray(r.spawns) || r.spawns.length === 0) {
        errors.push(`${at}: needs something in it`);
        return;
      }
      let total = 0;
      r.spawns.forEach((s, j) => {
        const sat = `${at}, entry ${j + 1}`;
        if (!s || typeof s !== "object") { errors.push(`${sat} is not an entry`); return; }
        if (typeof s.enemy !== "string" || !enemies.has(s.enemy)) {
          errors.push(`${sat}: no enemy called ${JSON.stringify(s.enemy)}`);
        }
        if (!Number.isInteger(s.count) || s.count < 1) {
          errors.push(`${sat}: count must be a whole number, at least 1 (got ${s.count})`);
        } else total += s.count;
        if (!ARRIVALS.includes(s.arrive)) {
          errors.push(`${sat}: arrive must be ${ARRIVALS.join(", ")} (got ${JSON.stringify(s.arrive)})`);
        }
        if (s.bias !== undefined) {
          if (s.enemy !== "fighters") {
            errors.push(`${sat}: bias only means something for "fighters"; ${JSON.stringify(s.enemy)} is one kind of ship`);
          } else if (!Array.isArray(s.bias) || s.bias.length !== 2
                     || !s.bias.every((n) => Number.isFinite(n) && n >= BIAS_MIN && n <= BIAS_MAX)) {
            errors.push(`${sat}: bias must be two numbers between ${BIAS_MIN} and ${BIAS_MAX}`);
          } else if (s.bias[0] > s.bias[1]) {
            errors.push(`${sat}: bias runs low to high, and ${s.bias[0]} is above ${s.bias[1]}`);
          }
        }
      });
      if (total > ROUND_MAX_ENEMIES) {
        errors.push(`${at}: ${total} enemies is more than the ${ROUND_MAX_ENEMIES} a round may hold`);
      }
      const rw = rewardErrors(r.award, at);
      errors.push(...rw);
    });
  }
  errors.push(...rewardErrors(g.award, "the game's award"));

  return errors.length ? { errors } : { ok: raw as GameType };
}

/**
 * A reward, checked.
 *
 * THE CEILING IS THE POINT and it is enforced here rather than in the panel,
 * because the panel is the one place that cannot be trusted to have run. An
 * enemy worth a lot multiplied by a round holding a thousand of them is a money
 * printer; see the plan's phase six. The real backstop is the payout service's
 * own daily cap, and this is the guard that stops a game DESCRIBING a payout
 * nobody intended.
 */
export const MAX_REWARD_DIVI = 500;

function rewardErrors(r: Reward | undefined, at: string): string[] {
  if (r === undefined) return [];
  const out: string[] = [];
  if (typeof r !== "object" || r === null) return [`${at}: not a reward`];
  if (r.divi !== undefined) {
    if (!Number.isFinite(r.divi) || r.divi < 0) out.push(`${at}: divi must be zero or more`);
    else if (r.divi > MAX_REWARD_DIVI) out.push(`${at}: ${r.divi} DIVI is over the ${MAX_REWARD_DIVI} limit`);
  }
  if (r.items !== undefined) {
    if (!Array.isArray(r.items)) out.push(`${at}: items must be a list`);
    else if (r.items.length > 8) out.push(`${at}: at most 8 items`);
    else if (r.items.some((k) => typeof k !== "string" || !k)) out.push(`${at}: an item key is empty`);
  }
  return out;
}

/** A whole set, checked. Ids must be unique: rows elsewhere point at them. */
export function validateGames(raw: unknown, knownEnemies: string[] = []): { ok: GameType[] } | { errors: string[] } {
  if (!Array.isArray(raw)) return { errors: ["not a list of games"] };
  if (raw.length > 100) return { errors: [`at most 100 games (got ${raw.length})`] };
  const errors: string[] = [];
  const seen = new Set<string>();
  const out: GameType[] = [];
  raw.forEach((g, i) => {
    const v = validateGame(g, knownEnemies);
    if ("errors" in v) { errors.push(...v.errors.map((e) => `game ${i + 1}: ${e}`)); return; }
    if (seen.has(v.ok.id)) errors.push(`game ${i + 1}: two games share the id ${v.ok.id}`);
    seen.add(v.ok.id);
    out.push(v.ok);
  });
  return errors.length ? { errors } : { ok: out };
}

/** How long a game lasts, in seconds. */
export const gameSeconds = (g: GameType): number =>
  g.rounds.reduce((n, r) => n + r.seconds, 0);

/** The most it could pay in awards, ignoring what enemies drop. What the panel
 *  shows beside a game so a payout is a decision rather than a surprise. */
export const gameMaxAward = (g: GameType): number =>
  (g.award?.divi ?? 0) + g.rounds.reduce((n, r) => n + (r.award?.divi ?? 0), 0);
