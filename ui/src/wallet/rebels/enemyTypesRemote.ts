// The live enemy definitions: read by the panel and by the room, written by
// the admin panel.
//
// ONE ROW PER ENEMY, matching rebels_games. The first version held the whole
// list in one row, the way rebels_drops does, and the two tables in the same
// feature ended up shaped differently - which cost exactly what that always
// costs: the other session built the room's reader against the games shape,
// reasonably, and would have loaded no custom enemies at all. Not a crash;
// Geoff's enemies simply never appearing.
//
// Enemies carry no pictures, so the size argument that forced the games table
// apart does not apply and one row would have worked. It is shaped this way
// for consistency and for per-row saves, so two people editing cannot silently
// overwrite each other.
//
// Built-ins live in the code, not the table, so an empty table means the game
// has exactly the enemies it has today.

import { accountRead, accountCall } from "./rebelsAccount";
import { builtInEnemies, validateEnemies, validateEnemy, type EnemyType } from "./enemyTypes";

export interface EnemyLoad {
  /** The built-ins, then whatever has been defined. Never empty, so callers
   *  need no null case. */
  enemies: EnemyType[];
  /** Just the ones somebody made, which is what the panel edits. */
  custom: EnemyType[];
  live: boolean;
  error?: string;
}

const fallback = (error?: string): EnemyLoad =>
  ({ enemies: builtInEnemies(), custom: [], live: false, ...(error ? { error } : {}) });

/** The live definitions, or the built-ins alone. Never throws. */
export async function fetchEnemyTypes(fetchFn: typeof fetch = fetch): Promise<EnemyLoad> {
  try {
    const res = await accountRead("rebels_enemies?select=id,enemy&order=id", fetchFn);
    if (!res.ok) return fallback(`http ${res.status}`);
    const rows = (await res.json()) as Array<{ id: string; enemy: unknown }>;
    const v = validateEnemies(rows.map((r) => r.enemy));
    if ("errors" in v) return fallback(v.errors.join("; "));
    return { enemies: [...builtInEnemies(), ...v.ok], custom: v.ok, live: true };
  } catch (e) {
    return fallback(String((e as Error)?.message ?? e));
  }
}

/**
 * Save ONE enemy.
 *
 * The secret and not a role, for now. Geoff asked for the panel to sit behind
 * a role on his account, and a role cannot AUTHORISE anything here: every one
 * of these calls goes out under the shared public key and the client picks
 * which account it claims to be. So the server checks a secret it knows, the
 * way rebels_drops_save already does, and when LW-Auth lands the check moves
 * to the identity it gives us and the secret goes.
 */
export async function saveEnemyType(
  secret: string, enemy: EnemyType, fetchFn: typeof fetch = fetch,
): Promise<{ ok: true } | { error: string }> {
  const v = validateEnemy(enemy);
  if ("errors" in v) return { error: v.errors.join("; ") };
  try {
    const res = await accountCall("rebels_enemy_save",
      { p_secret: secret, p_id: v.ok.id, p_enemy: v.ok }, fetchFn);
    return res.ok ? { ok: true } : { error: await why(res) };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  }
}

/** Remove one. */
export async function deleteEnemyType(
  secret: string, id: string, fetchFn: typeof fetch = fetch,
): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await accountCall("rebels_enemy_delete", { p_secret: secret, p_id: id }, fetchFn);
    return res.ok ? { ok: true } : { error: await why(res) };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  }
}

async function why(res: Response): Promise<string> {
  let out = `http ${res.status}`;
  try { const j = (await res.json()) as { message?: string }; if (j.message) out = j.message; } catch { /* plain */ }
  return out;
}
