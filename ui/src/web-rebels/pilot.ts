// A guest: who someone is before they sign up.
//
// Someone who presses LAUNCH has told us nothing, so the page makes them two
// things, once, and keeps both:
//   - a NAME, "Pilot" and four digits, which other players see;
//   - an ID, random and private, which the room banks their DIVI under. It is
//     never shown to anyone, so nobody else can reach that balance.
// Both live in IndexedDB (webStore.ts) with a copy in localStorage for instant
// reads, and restoreGuest() puts back whichever copy survived before the game
// starts. When the player signs up, this ID is how their guest progress is
// found and carried into the account.

import { idbAll, idbPut } from "./webStore";

const NAME_KEY = "rebels.web.pilot";
const ID_KEY = "rebels.web.guest";

type Kv = Pick<Storage, "getItem" | "setItem">;

function safeStorage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

const NAME_OK = /^Pilot \d{4}$/;
const ID_OK = /^[A-Za-z0-9-]{16,64}$/;

function newId(random = Math.random): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* fall through */ }
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(random() * 16).toString(16);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

function keep(storage: Kv | null, key: string, value: string): void {
  try { storage?.setItem(key, value); } catch { /* not kept; still usable */ }
  void idbPut(key, value);
}

export function guestName(storage: Kv | null = safeStorage(), random = Math.random): string {
  try {
    const kept = storage?.getItem(NAME_KEY);
    if (kept && NAME_OK.test(kept)) return kept;
  } catch { /* storage blocked: a fresh name this visit */ }
  const name = `Pilot ${String(Math.floor(random() * 9000) + 1000)}`;
  keep(storage, NAME_KEY, name);
  return name;
}

export function guestId(storage: Kv | null = safeStorage(), random = Math.random): string {
  try {
    const kept = storage?.getItem(ID_KEY);
    if (kept && ID_OK.test(kept)) return kept;
  } catch { /* storage blocked */ }
  const id = newId(random);
  keep(storage, ID_KEY, id);
  return id;
}

/**
 * Before the game starts: if the quick copy was cleared but IndexedDB still
 * holds the guest, put the guest back; and make sure IndexedDB holds whatever
 * the quick copy has. Never makes a NEW guest when one exists in either place.
 */
export async function restoreGuest(
  storage: Kv | null = safeStorage(),
  all: () => Promise<Map<string, string>> = idbAll,
): Promise<{ id: string; name: string }> {
  const saved = await all().catch(() => new Map<string, string>());
  for (const key of [ID_KEY, NAME_KEY]) {
    let quick: string | null = null;
    try { quick = storage?.getItem(key) ?? null; } catch { /* blocked */ }
    const kept = saved.get(key) ?? null;
    if (!quick && kept) { try { storage?.setItem(key, kept); } catch { /* blocked */ } }
    else if (quick && quick !== kept) void idbPut(key, quick);
  }
  return { id: guestId(storage), name: guestName(storage) };
}
