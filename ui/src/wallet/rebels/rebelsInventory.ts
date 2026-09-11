// What the player HOLDS: dropped items, stacked by key.
//
// TWO COUNTERS PER KEY, both only ever rising: how many were GAINED ("hull2")
// and how many were USED ("used:hull2"). What is held is the difference. It
// has to be this way because the account copy is merged by "take the larger"
// (a stale copy can never take a thing away), and a single count that goes
// DOWN when a sphere is opened, a recharge used or four things forged would
// come straight back at the next merge. Same trick as points earned/spent.
//
// Ownership of bought things is a set (rebelsArmoury: you have the minigun or
// you do not). Found things are counts, because forging eats four of a kind,
// so they live here, keyed by catalogue key. Same shape of persistence as the
// armoury: this machine's copy in localStorage, the account's copy in the
// rebels_loadout row, merged by "take the larger count" so a stale copy cannot
// take anything away. Same trust too: it is the client's word. Room drops are
// the room's roll and the room's pickup, and the room banks a matching count to
// the ledger so the two can be compared later.

import { itemByKey } from "./itemCatalog";

const ITEMS_KEY = "dd69.rebels.items";
export const INVENTORY_CHANGED = "dd69-rebels-armoury";

export type Held = Record<string, number>;

/* ---- SEALED SPHERES ----
   Geoff (2026-Sep-11): "when someone gets an item sphere, it goes into their
   inventory and they need to go there to open it... later when we have a
   marketplace, they can sell it unopened." So a pickup is a SPHERE, counted
   under "sphere:<key>" in the same map; opening one moves it to "<key>".
   The item inside was decided when it dropped (the roll is the wreck's, not
   the opening's), which is what lets the room bank the same key. */
export const SPHERE_PREFIX = "sphere:";
export const USED_PREFIX = "used:";
export function isUsedKey(key: string): boolean { return key.startsWith(USED_PREFIX); }
export function sphereKey(key: string): string { return SPHERE_PREFIX + key; }
export function isSphereKey(key: string): boolean { return key.startsWith(SPHERE_PREFIX); }
/** The item a held key refers to, sealed or not. */
export function keyInside(key: string): string { return isSphereKey(key) ? key.slice(SPHERE_PREFIX.length) : key; }

function knownKey(k: string): boolean {
  const base = isUsedKey(k) ? k.slice(USED_PREFIX.length) : k;
  const spec = itemByKey(keyInside(base));
  if (!spec) return false;
  if (isSphereKey(base) && !spec.drop) return false;
  return true;
}

function clean(raw: unknown): Held {
  const out: Held = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Math.floor(Number(v));
    if (knownKey(k) && Number.isFinite(n) && n > 0) out[k] = Math.min(n, 1_000_000);
  }
  return out;
}

/** The two counters as saved: gained under the key, used under "used:key". */
export function rawHeld(): Held {
  try { return clean(JSON.parse(localStorage.getItem(ITEMS_KEY) || "null")); } catch { return {}; }
}

/** What is actually held: gained minus used, only the keys with something. */
export function heldItems(): Held {
  const raw = rawHeld();
  const out: Held = {};
  for (const [k, n] of Object.entries(raw)) {
    if (isUsedKey(k)) continue;
    const have = n - (raw[USED_PREFIX + k] ?? 0);
    if (have > 0) out[k] = have;
  }
  return out;
}

function writeHeld(h: Held): void {
  try { localStorage.setItem(ITEMS_KEY, JSON.stringify(h)); } catch { /* full */ }
  try { window.dispatchEvent(new Event(INVENTORY_CHANGED)); } catch { /* not a browser */ }
}

export function heldCount(key: string): number {
  return heldItems()[key] ?? 0;
}

/** One more (or n more) of this. Unknown keys are refused. */
export function addHeld(key: string, n = 1): boolean {
  if (!knownKey(key) || isUsedKey(key) || !(n > 0)) return false;
  const h = rawHeld();
  h[key] = (h[key] ?? 0) + Math.floor(n);
  writeHeld(h);
  return true;
}

/** Use n up. False, and nothing used, if there are not that many. */
export function takeHeld(key: string, n = 1): boolean {
  if (heldCount(key) < n) return false;
  const h = rawHeld();
  h[USED_PREFIX + key] = (h[USED_PREFIX + key] ?? 0) + n;
  writeHeld(h);
  return true;
}

/** Fold the account's copy in: both counters, the larger wins. True if
 *  anything rose. */
export function mergeHeld(remote: unknown): boolean {
  const theirs = clean(remote);
  const h = rawHeld();
  let moved = false;
  for (const [k, n] of Object.entries(theirs)) {
    if (n > (h[k] ?? 0)) { h[k] = n; moved = true; }
  }
  if (moved) writeHeld(h);
  return moved;
}

/** A picked-up sphere, sealed. */
export function addSphere(key: string, n = 1): boolean {
  return addHeld(sphereKey(key), n);
}

/** Open one sealed sphere of this item: the sphere is gone, the item is held.
 *  False, and nothing moves, when there is none to open. */
export function openSphere(key: string): boolean {
  const sk = sphereKey(key);
  if (heldCount(sk) < 1 || !itemByKey(key)) return false;
  const h = rawHeld();
  h[USED_PREFIX + sk] = (h[USED_PREFIX + sk] ?? 0) + 1;
  h[key] = (h[key] ?? 0) + 1;
  writeHeld(h);
  return true;
}

/** The opened items' keys, for the flight model and the room: what the
 *  passives read. */
export function heldKeys(): string[] {
  return Object.keys(heldItems()).filter((k) => !isSphereKey(k));
}

function sorted(keys: string[], h: Held): Array<{ key: string; count: number }> {
  return keys
    .map((key) => ({ key, count: h[key], spec: itemByKey(keyInside(key))! }))
    .sort((a, b) => (b.spec.tier - a.spec.tier) || a.spec.name.localeCompare(b.spec.name))
    .map(({ key, count }) => ({ key, count }));
}

/** Every OPENED stack, best tier first, then by name: the inventory's order. */
export function heldSorted(): Array<{ key: string; count: number }> {
  const h = heldItems();
  return sorted(Object.keys(h).filter((k) => !isSphereKey(k)), h);
}

/** Every SEALED stack, in the same order. `key` is the item inside. */
export function spheresSorted(): Array<{ key: string; count: number }> {
  const h = heldItems();
  return sorted(Object.keys(h).filter(isSphereKey), h).map(({ key, count }) => ({ key: keyInside(key), count }));
}

export function resetInventoryForTests(): void {
  try { localStorage.removeItem(ITEMS_KEY); } catch { /* fine */ }
}
