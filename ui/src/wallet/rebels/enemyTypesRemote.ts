// The live enemy definitions: read by the panel and (phase three, server half)
// by the room, written by the admin panel.
//
// One row in the DD69 Supabase project, rebels_enemies, id 'live'. Exactly the
// arrangement rebels_drops already uses, and deliberately so: a table row
// holding JSON, a validator that refuses anything malformed, and a fallback to
// the built-ins so a bad save - or a table that does not exist yet - can never
// stop enemies existing.
//
// THE TABLE DOES NOT EXIST YET. The migration is written
// (supabase/migrations/..._rebels_enemies.sql) and has not been applied to the
// live project; applying it is a change to the database the wallet shares and
// is Geoff's to make. Until then every read here falls back to the built-ins,
// which is exactly what the game does today, so nothing is broken by the wait.

import { accountRead, accountCall } from "./rebelsAccount";
import { builtInEnemies, validateEnemies, type EnemyType } from "./enemyTypes";

export interface EnemyLoad {
  /** The built-ins, then whatever has been defined. Always at least the
   *  built-ins, so this is never empty and callers need no null case. */
  enemies: EnemyType[];
  /** Just the ones somebody made, which is what the panel edits and saves. */
  custom: EnemyType[];
  live: boolean;
  error?: string;
}

function fallback(error?: string): EnemyLoad {
  return { enemies: builtInEnemies(), custom: [], live: false, ...(error ? { error } : {}) };
}

/** The live definitions, or the built-ins alone. Never throws. */
export async function fetchEnemyTypes(fetchFn: typeof fetch = fetch): Promise<EnemyLoad> {
  try {
    const res = await accountRead("rebels_enemies?id=eq.live&select=config", fetchFn);
    if (!res.ok) return fallback(`http ${res.status}`);
    const rows = (await res.json()) as Array<{ config?: unknown }>;
    if (!rows.length) return fallback("no live row yet");
    const v = validateEnemies(rows[0].config);
    if ("errors" in v) return fallback(v.errors.join("; "));
    return { enemies: [...builtInEnemies(), ...v.ok], custom: v.ok, live: true };
  } catch (e) {
    return fallback(String((e as Error)?.message ?? e));
  }
}

/**
 * Save, with the admin secret.
 *
 * The secret and not a role, for now. Geoff asked for the panel to sit behind
 * a role on his account, and a role cannot AUTHORISE anything here: every one
 * of these calls goes out under the shared public key and the client picks
 * which account it claims to be. So the server checks a secret it knows, the
 * way rebels_drops_save already does, and when LW-Auth lands the check moves to
 * the identity it gives us and the secret goes. A role today would gate the tab
 * and nothing else.
 */
export async function saveEnemyTypes(
  secret: string,
  enemies: EnemyType[],
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true } | { error: string }> {
  const v = validateEnemies(enemies);
  if ("errors" in v) return { error: v.errors.join("; ") };
  try {
    const res = await accountCall("rebels_enemies_save", { p_secret: secret, p_config: v.ok }, fetchFn);
    if (res.ok) return { ok: true };
    let why = `http ${res.status}`;
    try { const j = (await res.json()) as { message?: string }; if (j.message) why = j.message; } catch { /* plain */ }
    return { error: why };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  }
}
