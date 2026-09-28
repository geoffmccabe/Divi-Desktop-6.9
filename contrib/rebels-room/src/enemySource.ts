// Where the room gets the enemies Geoff has designed.
//
// The same contract as gameSource.ts, for the same reasons, and deliberately
// almost the same code: read the live rows, put them through the validator, and
// FALL BACK TO THE BUILT-INS ON ANY DOUBT. Never throws, never returns an empty
// list. A room that will not start because somebody saved an enemy with a typo
// in it is a worse outcome than a room flying the seven tiers it always had.
//
// THE ROOM READS, IT DOES NOT WRITE. Saving needs the admin secret and belongs
// with the panel doing the editing.
//
// WHY THIS HAS TO BE FETCHED BEFORE THE GAMES
// ------------------------------------------
// validateGame only accepts an enemy name it has heard of: the built-ins, plus
// whatever is passed to it as known. So the moment a game description names a
// custom enemy, that game is INVALID unless the enemies were loaded first and
// their ids handed over - and because one bad game condemns the whole set on
// purpose (see gameSource.ts), a single game using a single custom enemy would
// otherwise drop the room back to the built-in Wave Defence and take every
// other game with it.
//
// That is an ordering dependency and not an obvious one, so it is written down
// here, asserted in the test, and the room does it in one call - `fetchWorld`
// below - rather than leaving two fetches for a caller to get in the wrong
// order.

import {
  builtInEnemies, builtInIds, validateEnemies, type EnemyType,
} from "../../../ui/src/wallet/rebels/enemyTypes";
import { payoutRefusal, DEFAULT_GAMES } from "../../../ui/src/wallet/rebels/gameTypes";
import { COIN_PER_KILL, COIN_VALUE } from "../../../ui/src/wallet/rebels/rebelsCombat";
import { accountRead } from "../../../ui/src/wallet/rebels/rebelsAccount";
import { fetchGames, type GamesResult } from "./gameSource";

/** One row per enemy, its definition in a jsonb column. The same shape as
 *  rebels_games, and for the same reason: a row per thing is the smallest
 *  useful fetch. */
const TABLE = "rebels_enemies?select=enemy&order=id";

export interface EnemiesResult {
  /** The built-ins ALWAYS, plus any custom ones. Never empty, and the
   *  built-ins are never replaced or hidden by a custom set - a game naming
   *  tier3 must keep working whatever is in the table. */
  enemies: EnemyType[];
  /** True when custom ones were read from the table. False means these are the
   *  built-ins alone, and `error` says why. */
  live: boolean;
  error?: string;
}

const onlyBuiltIn = (error?: string): EnemiesResult =>
  ({ enemies: builtInEnemies(), live: false, ...(error ? { error } : {}) });

/**
 * Every enemy the room can fly: the built-ins, plus Geoff's.
 *
 * The built-ins are ADDED TO rather than replaced. A custom set cannot take a
 * built-in's id (validateEnemies refuses that outright), so the two can simply
 * be concatenated with no question of which wins.
 */
export async function fetchEnemies(
  fetchFn: typeof fetch = fetch,
  hulls: string[] = [],
): Promise<EnemiesResult> {
  try {
    const res = await accountRead(TABLE, fetchFn);
    if (!res.ok) return onlyBuiltIn(`http ${res.status}`);
    const rows = (await res.json()) as Array<{ enemy?: unknown }>;
    /* Told apart on purpose, as in gameSource: "nothing saved yet" is Tuesday,
       "the answer was not a list" means something that is not the table is
       answering, and whoever reads the state page needs to know which. */
    if (!Array.isArray(rows)) {
      return onlyBuiltIn("the table answered with something that is not a list");
    }
    if (rows.length === 0) return onlyBuiltIn("no enemies saved yet");
    const v = validateEnemies(rows.map((r) => r.enemy), hulls);
    if ("errors" in v) return onlyBuiltIn(v.errors.slice(0, 4).join("; "));
    if (v.ok.length === 0) return onlyBuiltIn("table is empty");
    return { enemies: [...builtInEnemies(), ...v.ok], live: true };
  } catch (e) {
    return onlyBuiltIn(String((e as Error)?.message ?? e));
  }
}

/** What the room needs before it can run a game: both halves, in the right
 *  order, so a game naming a custom enemy validates. */
export interface WorldResult {
  enemies: EnemiesResult;
  games: GamesResult;
}

/**
 * The enemies and then the games, with the enemies' names carried into the
 * games' validation.
 *
 * ONE CALL ON PURPOSE. The order matters (see the note at the top) and an
 * ordering rule that lives in a caller is an ordering rule waiting to be got
 * wrong by the next caller.
 */
export async function fetchWorld(
  fetchFn: typeof fetch = fetch,
  hulls: string[] = [],
): Promise<WorldResult> {
  const enemies = await fetchEnemies(fetchFn, hulls);
  /* Only the CUSTOM ids need passing: validateGame already knows the built-ins,
     and handing it a list that disagreed with its own would be a second source
     of truth for the same thing. */
  const known = new Set(builtInIds());
  const custom = enemies.enemies.filter((e) => !known.has(e.id)).map((e) => e.id);
  const games = await fetchGames(fetchFn, custom);

  /* ---- AND WHAT THEY PAY ----
     The one bound that could not live in validateGame, because it needs the
     enemy table and the simulation's constants and that file is deliberately
     dependency-free. Checked HERE rather than in the panel alone, because the
     panel is the one thing that cannot be trusted to have run: a row written by
     hand, or saved before this ceiling existed, reaches the room all the same.

     Refused the same way any other bad game is - the whole set falls back to
     the built-in, loudly - because a game that promises more than a player can
     ever be credited is worse than one nobody can play. See GAME_MAX_PAYOUT. */
  if (games.live) {
    const worth = new Map(enemies.enemies.map((e) => [e.id, e.worth]));
    const refusals = games.games
      .map((g) => payoutRefusal(g, worth, COIN_PER_KILL, COIN_VALUE))
      .filter((x): x is string => x !== null);
    if (refusals.length > 0) {
      return {
        enemies,
        games: { games: DEFAULT_GAMES, live: false, error: refusals.slice(0, 2).join("; ") },
      };
    }
  }
  return { enemies, games };
}
