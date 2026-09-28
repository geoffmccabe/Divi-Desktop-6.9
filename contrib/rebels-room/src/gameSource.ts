// Where the room gets the games Geoff has built.
//
// Phase 1's server half. The gameplay session's admin panel writes game
// descriptions; this reads them, and decides which one a room is running.
//
// Built to the same contract as the drop charts (dropConfigRemote.ts), because
// that one has been carrying real config into this room for weeks and the shape
// is proven: read the live rows, put them through the validator, and FALL BACK
// TO THE BUILT-IN ON ANY DOUBT. A bad save, a table that has not been created,
// a network that is down, a row somebody edited by hand into nonsense - every
// one of those ends with Wave Defence running rather than with a room that will
// not start. A game that will not load must never be a game nobody can play.
//
// THE ROOM READS, IT DOES NOT WRITE. Saving needs the admin secret and belongs
// with the panel that does the editing; nothing here can change a game, so the
// worst a break-in at this end achieves is reading descriptions that are about
// to be shown to every player anyway.

import {
  DEFAULT_GAMES, validateGames, waveDefence, type GameType, type PlaceId,
} from "../../../ui/src/wallet/rebels/gameTypes";
import { accountRead } from "../../../ui/src/wallet/rebels/rebelsAccount";

/** The table, and the one column that matters. One row per game rather than one
 *  row holding all of them: a game carries a card image, and a dozen of those
 *  in a single row is a row nobody wants to read to find out about one game. */
const TABLE = "rebels_games?select=game&order=id";

export interface GamesResult {
  games: GameType[];
  /** True when these came from the table. False when they are the built-in,
   *  whatever the reason - and `error` says which reason. */
  live: boolean;
  error?: string;
}

/**
 * Every game Geoff has saved, or the built-in.
 *
 * Never throws and never returns an empty list: a room with no games is a room
 * with nothing to do, which is a worse failure than a room playing the game it
 * has always played.
 */
export async function fetchGames(
  fetchFn: typeof fetch = fetch,
  knownEnemies: string[] = [],
): Promise<GamesResult> {
  try {
    const res = await accountRead(TABLE, fetchFn);
    if (!res.ok) return { games: DEFAULT_GAMES, live: false, error: `http ${res.status}` };
    const rows = (await res.json()) as Array<{ game?: unknown }>;
    /* Told apart on purpose. "Nothing saved yet" is Tuesday; "the answer was
       not a list" means something is answering that is not the table, and
       somebody reading the state page needs to know which of those it is
       rather than chasing an empty table that is fine. */
    if (!Array.isArray(rows)) {
      return { games: DEFAULT_GAMES, live: false, error: "the table answered with something that is not a list" };
    }
    if (rows.length === 0) {
      return { games: DEFAULT_GAMES, live: false, error: "no games saved yet" };
    }
    const v = validateGames(rows.map((r) => r.game), knownEnemies);
    if ("errors" in v) {
      /* One bad game does not condemn the rest in the validator's eyes - it
         reports every error it found - but it does here, deliberately. A
         partially loaded set means some games silently missing and nobody
         knowing which, and "the list is wrong" is easier to act on than "the
         list is short". */
      return { games: DEFAULT_GAMES, live: false, error: v.errors.slice(0, 4).join("; ") };
    }
    if (v.ok.length === 0) return { games: DEFAULT_GAMES, live: false, error: "table is empty" };
    return { games: v.ok, live: true };
  } catch (e) {
    return { games: DEFAULT_GAMES, live: false, error: String((e as Error)?.message ?? e) };
  }
}

/**
 * Which game a room in this place should be running.
 *
 * The first PUBLISHED game written for this place, and the built-in if there is
 * none. Unpublished games are invisible here however they got into the table:
 * a half-finished game must not become the thing everybody is flying against
 * because somebody saved it and went to lunch.
 *
 * "The first" is deliberately simple and is the seam that changes when players
 * pick a game for themselves: then the room's NAME will say which game, the way
 * it already says which place, and this becomes a lookup by id rather than a
 * choice. Until then a place runs one game and this decides which.
 */
export function gameForPlace(
  games: readonly GameType[],
  place: PlaceId,
  wanted: string | null = null,
): GameType {
  const here = games.filter((g) => g.place === place && g.published);
  /* ---- THE ROOM'S NAME MAY SAY WHICH ONE ----
     "earth_shakedown" is a room playing shakedown. That is what lets Geoff have
     more than one Earth game: the choice is which ROOM to join, because a room
     is one simulation with one sky and two players in it cannot be playing
     different games.

     A name that matches nothing falls through to the place's own game rather
     than to an empty room. Somebody following a stale link to a game that has
     since been deleted or unpublished should find a fight, not a void. */
  if (wanted) {
    const named = here.find((g) => g.id === wanted);
    if (named) return named;
  }
  if (here.length > 0) return here[0];
  /* Earth falls back to the game it has always run. Anywhere else falls back to
     nothing, which the caller reads as "this place has no game" - Spikeworld's
     fight is a heart and its guards, not a sequence of rounds. */
  return waveDefence();
}

/** Whether any published game exists for this place at all. The room asks this
 *  before falling back, so "no game here" and "the built-in" stay distinct. */
export function hasGameFor(games: readonly GameType[], place: PlaceId): boolean {
  return games.some((g) => g.place === place && g.published);
}

/** Whether a game of this id is published for this place: what the door asks
 *  before it lets somebody into a room named after a game. */
export function hasGameNamed(
  games: readonly GameType[], place: PlaceId, id: string,
): boolean {
  return games.some((g) => g.id === id && g.place === place && g.published);
}
