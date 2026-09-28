// The live game types: read by the picker and by the room, written by the
// admin panel. Same arrangement as rebels_drops and rebels_enemies - one row
// holding JSON, a shared validator, and a fallback so a bad save can never
// stop the game existing.
//
// THE TABLE DOES NOT EXIST YET. The migration is written and not applied;
// until it is, every read falls back to the built-in Wave Defence, which is
// exactly what the game plays today.

import { accountRead, accountCall } from "./rebelsAccount";
import { DEFAULT_GAMES, validateGames, type GameType } from "./gameTypes";
import { builtInIds } from "./enemyTypes";

export interface GameLoad {
  games: GameType[];
  live: boolean;
  error?: string;
}

const fallback = (error?: string): GameLoad =>
  ({ games: DEFAULT_GAMES, live: false, ...(error ? { error } : {}) });

/**
 * Every game, or the built-in alone. Never throws.
 *
 * `knownEnemies` is what makes a game naming a custom enemy valid: the
 * validator refuses a name nothing defines, so the caller passes the enemies
 * it has. Given none, only the built-in enemy names are accepted - which is
 * the safe direction, because a game referring to an enemy that has since been
 * deleted should be refused rather than silently sent with nothing in it.
 */
export async function fetchGameTypes(
  knownEnemies: string[] = builtInIds(),
  fetchFn: typeof fetch = fetch,
): Promise<GameLoad> {
  try {
    const res = await accountRead("rebels_games?id=eq.live&select=config", fetchFn);
    if (!res.ok) return fallback(`http ${res.status}`);
    const rows = (await res.json()) as Array<{ config?: unknown }>;
    if (!rows.length) return fallback("no live row yet");
    const v = validateGames(rows[0].config, knownEnemies);
    if ("errors" in v) return fallback(v.errors.join("; "));
    /* The built-in is always offered, and always first: it is the game that
       exists in code and cannot be deleted by an edit going wrong. */
    const saved = v.ok.filter((g) => !DEFAULT_GAMES.some((d) => d.id === g.id));
    return { games: [...DEFAULT_GAMES, ...saved], live: true };
  } catch (e) {
    return fallback(String((e as Error)?.message ?? e));
  }
}

/** Save, with the admin secret. See saveEnemyTypes for why a secret and not a
 *  role, and what replaces it when LW-Auth lands. */
export async function saveGameTypes(
  secret: string,
  games: GameType[],
  knownEnemies: string[] = builtInIds(),
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true } | { error: string }> {
  const v = validateGames(games, knownEnemies);
  if ("errors" in v) return { error: v.errors.join("; ") };
  try {
    const res = await accountCall("rebels_games_save", { p_secret: secret, p_config: v.ok }, fetchFn);
    if (res.ok) return { ok: true };
    let why = `http ${res.status}`;
    try { const j = (await res.json()) as { message?: string }; if (j.message) why = j.message; } catch { /* plain */ }
    return { error: why };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  }
}
