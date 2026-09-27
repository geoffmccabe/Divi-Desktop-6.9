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
import { DEFAULT_ROOM_BASE } from "../wallet/rebels/platform/defaults";

const NAME_KEY = "rebels.web.pilot";
const ID_KEY = "rebels.web.guest";

type Kv = Pick<Storage, "getItem" | "setItem">;

function safeStorage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/**
 * Pilot numbers, given out IN ORDER: 000001, then 000002, and up.
 *
 * Geoff: "can't you just start the pilot numbers at 000001 and go up from
 * there?" Yes, and it is the only thing that makes them truly unique. Random
 * numbers collide by the birthday problem long before the space is anywhere
 * near used up - four digits shares a number among any hundred players two
 * times in five, and even ten digits shares one among a hundred thousand - so
 * no amount of extra digits would have fixed it.
 *
 * The number comes from the room's ledger object, which is the only thing that
 * can see every number already given out and which handles one request at a
 * time, so it cannot issue the same one twice. See RebelsLedger.pilot.
 *
 * Padded to six so the early ones read as names rather than as ones and twos,
 * and free to grow past six when there are a million pilots, which would be a
 * good day.
 *
 * WHEN THE NUMBER CANNOT BE FETCHED - first run with no network, or a browser
 * that blocks it - a random six-digit one is used and KEPT. It is not retried
 * on a later visit, deliberately: a player's saved run is filed under their
 * name, so renaming them later would leave everything they had done behind
 * under a name nobody answers to. A name, once given, is theirs.
 *
 * Old four-digit names are accepted for exactly the same reason.
 */
const NAME_OK = /^Pilot \d{4,}$/;
const NAME_DIGITS = 6;
const pad = (n: number) => `Pilot ${String(n).padStart(NAME_DIGITS, "0")}`;
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
  /* The fallback, for a first run that could not reach the room. See the note
     on NAME_OK: it is kept rather than retried. */
  const lowest = 10 ** (NAME_DIGITS - 1);
  const name = pad(Math.floor(random() * lowest * 9) + lowest);
  keep(storage, NAME_KEY, name);
  return name;
}

/** Where the room lives, as something fetch can use. */
function pilotUrl(roomBase: string): string {
  return `${roomBase.replace(/^ws/, "http")}/pilot`;
}

/**
 * Ask the room for the next pilot number.
 *
 * Returns null on anything at all going wrong, because a name is not worth
 * failing to start over: the caller falls back to a random one.
 */
export async function claimPilot(
  guest: string,
  roomBase: string = DEFAULT_ROOM_BASE,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchFn(pilotUrl(roomBase), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guest }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { pilot?: unknown };
    const n = Number(body?.pilot);
    if (!Number.isFinite(n) || n < 1 || n > 1e15) return null;
    return pad(Math.floor(n));
  } catch {
    return null;
  }
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
  claim: (guest: string) => Promise<string | null> = (g) => claimPilot(g),
): Promise<{ id: string; name: string }> {
  const saved = await all().catch(() => new Map<string, string>());
  for (const key of [ID_KEY, NAME_KEY]) {
    let quick: string | null = null;
    try { quick = storage?.getItem(key) ?? null; } catch { /* blocked */ }
    const kept = saved.get(key) ?? null;
    if (!quick && kept) { try { storage?.setItem(key, kept); } catch { /* blocked */ } }
    else if (quick && quick !== kept) void idbPut(key, quick);
  }
  const id = guestId(storage);

  /* ---- A NUMBER IN ORDER, ONCE, FOR A PILOT WHO HAS NONE ----
     Only when neither copy held a name. Somebody already playing keeps theirs:
     their saved runs are filed under it, and renaming them would leave
     everything they had done behind under a name nobody answers to. */
  let held: string | null = null;
  try { held = storage?.getItem(NAME_KEY) ?? null; } catch { /* blocked */ }
  if (!held || !NAME_OK.test(held)) {
    const given = await claim(id).catch(() => null);
    if (given) {
      keep(storage, NAME_KEY, given);
      return { id, name: given };
    }
  }
  return { id, name: guestName(storage) };
}
