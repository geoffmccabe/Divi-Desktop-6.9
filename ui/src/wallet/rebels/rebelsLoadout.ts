// The player's purchases, saved to their account and read back.
//
// The account is the same one the ships and scores already use: the row in
// the DD69 Supabase project keyed by the node's name (rebels_loadout). Saved
// whenever points or ownership move, debounced; read once when the game
// attaches and folded in with mergeLoadout, which cannot lose anything
// whichever copy is older. Offline, nothing here matters: the local copy is
// what the game plays from.
//
// It is the client's word, as the scores are. See the migration file for
// what that means and what the next step is.

import { accountRead, accountCall } from "./rebelsAccount";
import { playerName } from "./rebelsScores";
import { platform } from "./platform/current";

/** The key the account row is filed under: the node's name in the app, a
 *  guest's private id on the web. See RebelsIdentity.accountKey. */
const accountKey = () => platform().identity.accountKey();
import { loadoutSnapshot, mergeLoadout, subscribeArmoury, type Loadout } from "./rebelsArmoury";

/* Tests run in node with a working fetch, and a test must not write to the
   real account table. Off by a call, never by an environment check inside
   the logic. */
let remoteOn = true;
export function setLoadoutRemote(on: boolean): void { remoteOn = on; }


export async function saveLoadoutRemote(who = accountKey()): Promise<boolean> {
  if (!who || !remoteOn) return false;
  const l = loadoutSnapshot();
  try {
    const res = await accountCall("rebels_loadout_save", {
      p_owner_key: who,
      p_owner_name: playerName(),
      p_points_earned: Math.round(l.earned * 10000) / 10000,
      p_points_spent: Math.round(l.spent * 10000) / 10000,
      p_owned: l.owned,
      p_purchases: l.purchases,
      p_items: l.items,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function loadLoadoutRemote(who = accountKey()): Promise<boolean> {
  if (!who || !remoteOn) return false;
  try {
    const res = await accountRead(
      "rebels_loadout" +
        `?owner_key=eq.${encodeURIComponent(who.toLowerCase())}` +
        "&select=points_earned,points_spent,owned,purchases,items",
    );
    if (!res.ok) return false;
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    if (!rows.length) return false;
    const r = rows[0];
    return mergeLoadout({
      earned: Number(r.points_earned),
      spent: Number(r.points_spent),
      owned: Array.isArray(r.owned) ? (r.owned as string[]) : [],
      purchases: Array.isArray(r.purchases) ? (r.purchases as Loadout["purchases"]) : [],
      items: r.items && typeof r.items === "object" ? (r.items as Loadout["items"]) : {},
    });
  } catch {
    return false;
  }
}

/** Save whenever something changes, a moment after it stops changing. */
export function watchLoadout(): () => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  const off = subscribeArmoury(() => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; void saveLoadoutRemote(); }, 1200);
  });
  return () => { off(); if (t) clearTimeout(t); };
}
