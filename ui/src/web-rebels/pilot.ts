// A guest's name.
//
// Someone who presses PLAY NOW has told us nothing about themselves, so they
// fly as "Pilot" and four digits, picked once and kept in this browser. It is
// the name other players see and, until they sign in, the key their scores,
// ship and loadout are filed under, so it must not change between visits.

const KEY = "rebels.web.pilot";

export function guestName(storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage(), random = Math.random): string {
  try {
    const kept = storage?.getItem(KEY);
    if (kept && /^Pilot \d{4}$/.test(kept)) return kept;
  } catch { /* storage blocked: a fresh name this visit */ }
  const name = `Pilot ${String(Math.floor(random() * 9000) + 1000)}`;
  try { storage?.setItem(KEY, name); } catch { /* not kept; still a name */ }
  return name;
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
