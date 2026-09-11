// Forging: four of one tier into one of the next, decided by the server.
//
// The client asks by key; the account's row in the DD69 Supabase project rolls
// the odds (90% +1, 9% +2, 1% +3), spends four, adds one, and hands the
// counters back. They are merged here the same way the loadout is, so the
// local copy and the account agree without a second round trip. Offline there
// is no forging: the answer says so.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../exchanges";
import { playerName } from "./rebelsScores";
import { saveLoadoutRemote } from "./rebelsLoadout";
import { mergeHeld, heldCount } from "./rebelsInventory";
import { itemByKey, forgeable, FORGE_COST } from "./itemCatalog";

const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

export type ForgeAnswer = { ok: true; result: string } | { ok: false; why: string };

export async function forge(key: string, who = playerName(), fetchFn: typeof fetch = fetch): Promise<ForgeAnswer> {
  const spec = itemByKey(key);
  if (!spec || !forgeable(spec)) return { ok: false, why: "that cannot be forged" };
  if (heldCount(key) < FORGE_COST) return { ok: false, why: `needs ${FORGE_COST}` };
  if (!who) return { ok: false, why: "no account to forge on" };
  /* The account must have what this machine has, or the server will refuse
     for want of four. */
  await saveLoadoutRemote(who);
  try {
    const res = await fetchFn(`${SUPABASE_URL}/rest/v1/rpc/rebels_forge`, {
      method: "POST", headers, body: JSON.stringify({ p_owner_key: who, p_key: key }),
    });
    if (!res.ok) {
      let why = `the forge is unreachable (${res.status})`;
      try { const j = (await res.json()) as { message?: string }; if (j.message) why = j.message; } catch { /* plain */ }
      return { ok: false, why };
    }
    const j = (await res.json()) as { result?: string; items?: unknown };
    mergeHeld(j.items);
    return j.result ? { ok: true, result: j.result } : { ok: false, why: "no answer" };
  } catch (e) {
    return { ok: false, why: String((e as Error)?.message ?? e) };
  }
}
