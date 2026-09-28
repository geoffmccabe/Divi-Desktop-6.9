// The live game types: read by the picker and by the room, written by the
// admin panel.
//
// ONE ROW PER GAME, with the card picture in its own column. Different from
// the drops and enemies tables, which each hold everything in one JSON row,
// and the difference is the picture: a card is capped at 82,000 characters, so
// twenty games in one row is 1.64 MB that every room, every browser and every
// edit would download in full - because the smallest thing you can fetch from
// one row is all of it. Split, each reader asks for what it needs.
//
// `image` stays on the GameType TYPE, because that is the natural shape in the
// panel and the picker. It is split off on the way to the database and put
// back on the way out, and that seam is the two small functions at the bottom
// of this file. The database shape and the program shape do not have to agree.
//
// THE TABLE MAY NOT EXIST YET. Until the migration is applied every read falls
// back to the built-in Wave Defence, which is what the server plays today.

import { accountRead, accountCall } from "./rebelsAccount";
import { DEFAULT_GAMES, validateGames, validateGame, type GameType } from "./gameTypes";
import { builtInIds } from "./enemyTypes";

export interface GameLoad {
  games: GameType[];
  live: boolean;
  error?: string;
}

const fallback = (error?: string): GameLoad =>
  ({ games: DEFAULT_GAMES, live: false, ...(error ? { error } : {}) });

/** A row as the table holds it. */
interface Row { id: string; game: unknown; image?: string | null }

/** Row -> GameType: put the picture back on. */
function fromRow(r: Row): unknown {
  const g = (r.game ?? {}) as Record<string, unknown>;
  return r.image ? { ...g, image: r.image } : g;
}

/** GameType -> row: take the picture off. */
export function toRow(g: GameType): { id: string; game: unknown; image: string | null } {
  const rest = { ...g } as Partial<GameType>;
  const image = rest.image ?? null;
  delete rest.image;
  return { id: g.id, game: rest, image };
}

/**
 * Every game, or the built-in alone. Never throws.
 *
 * `knownEnemies` is what makes a game naming a custom enemy valid: the
 * validator refuses a name nothing defines, so the caller passes the enemies
 * it has. A game naming an enemy that has since been deleted is refused rather
 * than silently sent with nothing in it, which is the safe direction.
 */
export async function fetchGameTypes(
  knownEnemies: string[] = builtInIds(),
  fetchFn: typeof fetch = fetch,
): Promise<GameLoad> {
  try {
    const res = await accountRead("rebels_games?select=id,game,image&order=id", fetchFn);
    if (!res.ok) return fallback(`http ${res.status}`);
    const rows = (await res.json()) as Row[];
    const v = validateGames(rows.map(fromRow), knownEnemies);
    if ("errors" in v) return fallback(v.errors.join("; "));
    /* The built-in is always offered, and always first: it is the game that
       exists in code and cannot be lost to an edit going wrong. */
    const saved = v.ok.filter((g) => !DEFAULT_GAMES.some((d) => d.id === g.id));
    return { games: [...DEFAULT_GAMES, ...saved], live: true };
  } catch (e) {
    return fallback(String((e as Error)?.message ?? e));
  }
}

/**
 * Just enough to draw the picker: names and cards, no round descriptions.
 *
 * The reason the table is shaped this way. A player choosing a game needs to
 * see what it is called and what it looks like; they do not need sixty rounds
 * of spawn tables for every game on the list.
 */
export async function fetchGameCards(
  fetchFn: typeof fetch = fetch,
): Promise<Array<{ id: string; name: string; place: string; image?: string }>> {
  try {
    const res = await accountRead("rebels_games?select=id,game,image&order=id", fetchFn);
    if (!res.ok) return [];
    const rows = (await res.json()) as Row[];
    return rows.map((r) => {
      const g = (r.game ?? {}) as { name?: string; place?: string; published?: boolean };
      return {
        id: r.id,
        name: String(g.name ?? r.id),
        place: String(g.place ?? "earth"),
        ...(r.image ? { image: r.image } : {}),
        published: g.published === true,
      };
    }).filter((c) => (c as { published: boolean }).published);
  } catch {
    return [];
  }
}

/** Save ONE game. See the migration for why the secret and not a role. */
export async function saveGameType(
  secret: string,
  game: GameType,
  knownEnemies: string[] = builtInIds(),
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true } | { error: string }> {
  const v = validateGame(game, knownEnemies);
  if ("errors" in v) return { error: v.errors.join("; ") };
  const row = toRow(v.ok);
  try {
    const res = await accountCall("rebels_game_save",
      { p_secret: secret, p_id: row.id, p_game: row.game, p_image: row.image }, fetchFn);
    if (res.ok) return { ok: true };
    return { error: await why(res) };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  }
}

/** Remove one. A single-row design got this for free; this does not. */
export async function deleteGameType(
  secret: string, id: string, fetchFn: typeof fetch = fetch,
): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await accountCall("rebels_game_delete", { p_secret: secret, p_id: id }, fetchFn);
    if (res.ok) return { ok: true };
    return { error: await why(res) };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  }
}

async function why(res: Response): Promise<string> {
  let out = `http ${res.status}`;
  try { const j = (await res.json()) as { message?: string }; if (j.message) out = j.message; } catch { /* plain */ }
  return out;
}
