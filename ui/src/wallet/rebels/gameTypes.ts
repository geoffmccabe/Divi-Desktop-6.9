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

/**
 * What to CALL each place, for anything a player reads.
 *
 * The ids are for the wire and the database; "p7" is not a destination
 * anybody wants to see on a card. The planet names are the sky's own, from
 * PLANET_NAMES in spaceEnvironment.ts - written out here rather than imported
 * because that file reaches for three.js, with a test standing on them
 * matching.
 */
export const PLACE_NAMES: Record<string, string> = {
  earth: "Earth orbit",
  spike: "Spikeworld",
  p1: "Ceralt", p2: "Bhoro", p3: "Ixion Minor", p4: "Kelvarr", p5: "Ondrus",
  p6: "Tessimar", p7: "Halcyne", p8: "Vaskir Prime", p9: "Ormundi", p10: "Threx",
  p11: "Calladon", p12: "Sepharis", p13: "Yggdral", p14: "Morrowain",
};

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
  /* ---- THE SEVEN DRONE TIERS BELONG HERE TOO ----
     They were missing, and it was not harmless. builtInEnemies() in
     enemyTypes.ts offers all seven in the panel and the room's spawner can
     build any of them, but a game naming one was REFUSED here as an enemy
     nobody had heard of - and one bad game condemns the whole set on purpose,
     so picking "Blue Drone" in the panel would have dropped every other game in
     the room back to Wave Defence with no error anybody would see.

     "flock" stays beside them and is not a duplicate: it means one formation of
     the DEFAULT tier, which is what the game has always sent. "drone3" means a
     formation of that tier. */
  "drone1", "drone2", "drone3", "drone4", "drone5", "drone6", "drone7",
  "flock", "dragon",
] as const;

/** How the things in a round turn up. */
export type Arrival = "once" | "spread" | "clumps";
export const ARRIVALS: Arrival[] = ["once", "spread", "clumps"];

/* ---- WHICH GAME A PLACE RUNS WHEN NOBODY PICKED ONE ----
   See `main` on GameType below. */

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
  /**
   * NEVER ENDS: when the written rounds run out, keep going, climbing.
   *
   * Geoff, asked whether Wave Defence should stop after thirty rounds or go on
   * for ever: "Wave Defence can keep going after 30 rounds, I think it can just
   * keep getting harder in a linear way?"
   *
   * The rounds listed are still the DESCRIPTION, and everything that reads a
   * game reads them: how long it is, what it pays, what the editor shows. Past
   * the last one `roundAt` continues the same straight line rather than
   * stopping or starting over. See roundAt for how the line is measured.
   *
   * ⚠ ONLY THE BUILT-IN MAY SET THIS, and the validator refuses it on anything
   * else. The reason is money, not taste: payoutRefusal bounds a game by what
   * ONE CLEAR credits a player, and an endless game has no clear, so the
   * ceiling would be computed over the thirty described rounds and pass while
   * the real game paid for ever. That is exactly the shape of mistake this file
   * already carries a warning about: a bound that covers a fraction reads as a
   * bound that is complete. The built-in is code, so it cannot be edited into a
   * money printer by anybody the ceiling exists to stop.
   */
  endless?: boolean;
  /**
   * THE GAME THIS PLACE RUNS WHEN NOBODY PICKED ONE.
   *
   * ⚠ WITHOUT THIS IT WAS DECIDED BY THE ALPHABET, and that shipped. The
   * chooser ended `return here[0]` over a list fetched `order=id`, so the
   * default Earth fight was whichever published game's id sorted first.
   * Adding a game called "scavengers-run" silently replaced the five-round
   * tutorial "shakedown" as the fight every new player lands in, because "sc"
   * precedes "sh". Measured live before this was written: /room/earth ran
   * scavengers-run, six rounds, which assumes you have already met a Shrike.
   *
   * Nobody wrote that policy. It fell out of a sort, and it would have come
   * back the first time a game was named "adventure-one".
   *
   * So the default is now SAID rather than inferred. One game per place marks
   * itself; the alphabet is only ever the last resort, and when it is used the
   * room says so on /state rather than leaving it to be discovered.
   */
  main?: true;
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
/**
 * How many rounds are WRITTEN OUT. The game itself does not stop there: it is
 * `endless`, and roundAt carries the same straight line on past the last
 * written round for as long as anybody keeps flying.
 *
 * ⚠ THE COMMENT HERE USED TO SAY "the real thing runs for ever, escalating"
 * AND THAT WAS NOT TRUE. It described the old hand-rolled waves, which did
 * climb for ever. Once the waves became a described game the runner read
 * `rounds[n]`, found nothing after thirty, and ended; the room then started the
 * game again from ten enemies, so an hour of climbing fell off a cliff back to
 * wave one. The comment survived the change that falsified it, which is the
 * only reason it took a direct question from Geoff to notice.
 *
 * Thirty is kept because a description has to stop somewhere and thirty rounds
 * is an hour, which is enough for the editor to show the shape of the climb.
 */
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
    endless: true,
  };
}

/** What the game falls back to when the live table cannot be reached or holds
 *  something the validator refuses. A bad save must never stop the game. */
export const DEFAULT_GAMES: GameType[] = [waveDefence()];

/* ================= CHECKING ONE =================
   Same contract as validateDropConfig: every error collected and named, so the
   panel can show all of them at once rather than one per save. */

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/* ---- THE CARD PICTURE ----
   Checked here as well as where it is made, because this file is what the
   server-side saver runs and a cap enforced only by the thing doing the
   uploading is not a cap. Kept as a copy of the rule rather than an import so
   this file stays dependency-free; gameImage.test.ts asserts the two agree. */
export const IMAGE_MAX_CHARS = 82_000;
function imageOk(v: unknown): boolean {
  if (typeof v !== "string" || v.length > IMAGE_MAX_CHARS) return false;
  if (!v.startsWith("data:image/webp;base64,")) return false;
  const body = v.slice("data:image/webp;base64,".length);
  return body.length > 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(body);
}
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
  if (g.image !== undefined && !imageOk(g.image)) {
    errors.push(`image must be an uploaded WebP card under ${IMAGE_MAX_CHARS} characters`);
  }
  if (typeof g.published !== "boolean") errors.push("published must be true or false");
  /* ---- ENDLESS IS THE BUILT-IN'S ALONE ----
     Not a style rule: payoutRefusal bounds a game by what one CLEAR credits a
     player, and an endless game is never cleared. The ceiling would be worked
     out over the written rounds, pass, and bound a fraction of a game that goes
     on paying for ever. Refused here, where a game is accepted, rather than
     left to be noticed. Revisit by giving payoutRefusal a per-hour bound for
     endless games; until something needs it, this is the honest answer. */
  if (g.endless !== undefined && typeof g.endless !== "boolean") {
    errors.push("endless must be true or false");
  }
  if (g.endless && !DEFAULT_GAMES.some((d) => d.id === g.id)) {
    errors.push("only the built-in game may be endless, because the payout "
      + "ceiling is worked out per clear and an endless game is never cleared");
  }
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
  /* ---- ONE MAIN FIGHT PER PLACE ----
     Two games both claiming to be what a place runs by default is somebody
     saving the flag twice and forgetting the first, and the chooser would then
     fall back to the alphabet to break the tie - which is the very thing the
     flag exists to stop. Named here, where it can be shown in the panel before
     it is saved, rather than discovered by a player landing in the wrong game.
     Only PUBLISHED games count: an unpublished draft is invisible anyway. */
  const mains = new Map<string, string[]>();
  for (const g of out) {
    if (!g.main || !g.published) continue;
    const list = mains.get(g.place) ?? [];
    list.push(g.id);
    mains.set(g.place, list);
  }
  for (const [place, ids] of mains) {
    if (ids.length > 1) {
      errors.push(`${place} has more than one main fight: ${ids.join(", ")}`);
    }
  }
  return errors.length ? { errors } : { ok: out };
}

/**
 * The round numbered `n`, counting from one, or undefined when the game is over.
 *
 * For every game this is just `rounds[n - 1]`. For an `endless` one, past the
 * last written round it CONTINUES THE SAME STRAIGHT LINE instead of returning
 * nothing, which is what Geoff asked for: "it can just keep getting harder in a
 * linear way".
 *
 * ---- HOW THE LINE IS MEASURED ----
 * From the written rounds themselves, not from the wave constants. The step per
 * round for each spawn is (its count in the LAST written round minus its count
 * in the FIRST) divided by the number of gaps between them, so a game that was
 * described as climbing keeps climbing at the rate it was described as
 * climbing. On Wave Defence that is (68 - 10) / 29 = 2 enemies a round, and
 * roundAt(31) gives 70, exactly what waveDefenceSize(31) gives. A test stands
 * on those agreeing rather than on this comment.
 *
 * Reading the step from the description rather than from WAVE_DEFENCE_STEP is
 * deliberate: it is the same "one code path" reason the built-in is generated
 * rather than typed out. Change the written climb and the endless tail follows
 * it, with nothing to keep in step by hand.
 *
 * Everything other than the counts is carried from the last written round: how
 * long it lasts, the enemy mix, the arrival pattern, the difficulty bias, and
 * its award if it has one.
 *
 * ---- IT PLATEAUS, IT DOES NOT END ----
 * ⚠ A round may not hold more than ROUND_MAX_ENEMIES, and a straight line
 * reaches that: Wave Defence hits 400 at round 196, about six and a half hours.
 * From there the rounds stop growing and stay at the cap rather than the game
 * ending, because "keep going" was the decision and a game that quietly stops
 * after six hours would be the same cliff that prompted this, just further out.
 * When the cap bites, the counts are scaled down to fit together rather than
 * one spawn being allowed to eat the whole allowance.
 */
export function roundAt(g: GameType, n: number): Round | undefined {
  if (!Number.isFinite(n) || n < 1) return undefined;
  const written = g.rounds[n - 1];
  if (written) return written;
  if (!g.endless || g.rounds.length === 0) return undefined;

  const len = g.rounds.length;
  const last = g.rounds[len - 1];
  const first = g.rounds[0];
  /* How many rounds past the written description this one is: 1 for the first. */
  const beyond = n - len;

  const counts = last.spawns.map((sp, i) => {
    const was = first.spawns[i];
    /* No gap to measure (a one-round game), or a spawn the first round did not
       have: that spawn simply does not grow. Guessing a step from a single
       round would be inventing the climb rather than continuing it. */
    const step = len > 1 && was ? (sp.count - was.count) / (len - 1) : 0;
    return Math.max(1, Math.round(sp.count + step * beyond));
  });

  /* The cap, shared out. Scaled rather than truncated so a round of fighters
     and bombers keeps its proportions at the plateau. */
  const total = counts.reduce((a, c) => a + c, 0);
  const fit = total > ROUND_MAX_ENEMIES ? ROUND_MAX_ENEMIES / total : 1;

  return {
    seconds: last.seconds,
    ...(last.award ? { award: last.award } : {}),
    spawns: last.spawns.map((sp, i) => ({
      ...sp,
      count: Math.max(1, Math.floor(counts[i] * fit)),
      ...(sp.bias ? { bias: [...sp.bias] as [number, number] } : {}),
    })),
  };
}

/** How long a game lasts, in seconds. For an `endless` one this is the length
 *  of the DESCRIBED rounds, which is what the editor and the cards should show;
 *  the game itself does not stop there. */
export const gameSeconds = (g: GameType): number =>
  g.rounds.reduce((n, r) => n + r.seconds, 0);

/** The most it could pay in AWARDS alone, ignoring what enemies drop. */
export const gameMaxAward = (g: GameType): number =>
  (g.award?.divi ?? 0) + g.rounds.reduce((n, r) => n + (r.award?.divi ?? 0), 0);

/**
 * What clearing this game credits ONE player, drops and awards together.
 *
 * ⚠ THE AWARDS ARE THE SMALL HALF and showing them alone is misleading. On the
 * sample game Descent the awards are 295 DIVI and the drops are 964, so a
 * panel reporting "up to 295" is understating what a game costs by a factor of
 * four. That is not a rounding difference, it is the difference between a game
 * that fits the treasury's daily payout cap and one that is 63% of it on a
 * single clear.
 *
 * It is worth being precise about why the mistake was easy: the awards ARE
 * bounded, carefully, per round and per game, and a bound that is enforced
 * properly reads as a bound that is complete. The drops had no ceiling at all
 * and were three quarters of the total.
 *
 * `worth` is what each enemy drops, from the enemy table; anything unknown
 * counts as one, which is a fighter. `coinsPerKill` and `coinValue` come from
 * the simulation - passed in rather than imported so this file stays
 * dependency-free, with a test standing on them agreeing.
 */
/**
 * The most one clear of one game may credit a single player.
 *
 * ⚠ THE LAST UNBOUNDED NUMBER IN THE GAME. Every other ceiling was in place and
 * each bounded a fraction: MAX_REWARD_DIVI bounds one award, GAME_PURSE bounds
 * a run's awards, EARN_PER_DAY bounds a player's day, REBELS_DAILY_CAP bounds
 * what actually leaves the treasury. The DROPS had nothing, and they are three
 * quarters of what a game pays. The largest describable game is
 *
 *     60 rounds x 400 enemies x 5 spheres x worth 10  =  1,200,000 DIVI
 *
 * from a single clear, every number in it individually legal and every one of
 * them already validated. The real sample games are 318 and 1,259.
 *
 * TEN THOUSAND because that is EARN_PER_DAY, what one account may be credited
 * in a whole day. Past that the ledger silently refuses the remainder, so a
 * game promising more is a game whose extra nobody can ever receive: not
 * dangerous, because nothing over-pays, but dishonest, which is worse in a way
 * a player actually feels. A test stands on the two numbers agreeing rather
 * than on this comment.
 *
 * The bound is on what ONE PLAYER gets, matching what gamePayout returns. The
 * room's own purse handles the per-run total across everybody.
 */
export const GAME_MAX_PAYOUT = 10_000;

/**
 * Why this game may not be published, or null if it may.
 *
 * Separate from validateGame because it needs the enemy table and the
 * simulation's constants, and validateGame is deliberately dependency-free.
 * Called wherever a game is accepted: the panel before saving, and the room
 * before running.
 */
export function payoutRefusal(
  g: GameType,
  worth: Map<string, number>,
  coinsPerKill: number,
  coinValue: number,
): string | null {
  /* ---- THE BUILT-IN IS NEVER REFUSED ----
     It is not somebody's content, it is the FALLBACK: the game a room plays
     when it has none of Geoff's, and the one a place with nothing published
     drops back to. Applying a ceiling written for authored content to the
     thing that catches a failure is a category error with a very bad outcome.

     Concretely, because it is not obvious from here: Wave Defence pays 5,850
     a clear, which is 59% of the ceiling. Lower GAME_MAX_PAYOUT below that -
     an entirely reasonable thing to do one day - and the built-in is refused;
     a refused game condemns the whole set, deliberately; so EVERY game in the
     room goes with it, including ones well inside the ceiling, and the
     fallback they would have fallen back to is the thing that was refused.
     One number, edited for a good reason, empties the game.

     The exemption is safe in the direction that matters: the built-in is
     code, so it cannot be edited into a money printer by anybody the ceiling
     is there to stop. */
  if (DEFAULT_GAMES.some((d) => d.id === g.id)) return null;

  const p = gamePayout(g, worth, coinsPerKill, coinValue);
  if (p.total <= GAME_MAX_PAYOUT) return null;
  /* Says the DROPS separately, because that is the number nobody expects and
     the one somebody will otherwise go looking for in the awards. */
  return `"${g.name}" credits ${p.total.toLocaleString()} DIVI a clear `
    + `(${p.drops.toLocaleString()} in drops from ${p.enemies} enemies, `
    + `${p.awards.toLocaleString()} in awards), over the ${GAME_MAX_PAYOUT.toLocaleString()} `
    + `a player may be credited in a whole day`;
}

export function gamePayout(
  g: GameType,
  worth: Map<string, number>,
  coinsPerKill: number,
  coinValue: number,
): { drops: number; awards: number; total: number; enemies: number } {
  let drops = 0, enemies = 0;
  for (const r of g.rounds) {
    for (const s of r.spawns) {
      enemies += s.count;
      /* Exactly as the fight pays it, rounding included: a Shrike at worth
         1.5 drops round(7.5) = 8 coins and not 7.5. */
      drops += s.count * Math.max(0, Math.round(coinsPerKill * (worth.get(s.enemy) ?? 1))) * coinValue;
    }
  }
  const awards = gameMaxAward(g);
  return { drops, awards, total: drops + awards, enemies };
}
