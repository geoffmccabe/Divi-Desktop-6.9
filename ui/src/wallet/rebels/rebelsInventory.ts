// What the player HOLDS: dropped items, stacked by key.
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

function clean(raw: unknown): Held {
  const out: Held = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Math.floor(Number(v));
    if (itemByKey(k) && Number.isFinite(n) && n > 0) out[k] = Math.min(n, 1_000_000);
  }
  return out;
}

export function heldItems(): Held {
  try { return clean(JSON.parse(localStorage.getItem(ITEMS_KEY) || "null")); } catch { return {}; }
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
  if (!itemByKey(key) || !(n > 0)) return false;
  const h = heldItems();
  h[key] = (h[key] ?? 0) + Math.floor(n);
  writeHeld(h);
  return true;
}

/** Take n away. False, and nothing taken, if there are not that many. */
export function takeHeld(key: string, n = 1): boolean {
  const h = heldItems();
  if ((h[key] ?? 0) < n) return false;
  h[key] -= n;
  if (h[key] <= 0) delete h[key];
  writeHeld(h);
  return true;
}

/** Fold the account's copy in. True if anything rose. */
export function mergeHeld(remote: unknown): boolean {
  const theirs = clean(remote);
  const h = heldItems();
  let moved = false;
  for (const [k, n] of Object.entries(theirs)) {
    if (n > (h[k] ?? 0)) { h[k] = n; moved = true; }
  }
  if (moved) writeHeld(h);
  return moved;
}

/** Every stack, best tier first, then by name: the inventory's order. */
export function heldSorted(): Array<{ key: string; count: number }> {
  return Object.entries(heldItems())
    .map(([key, count]) => ({ key, count, spec: itemByKey(key)! }))
    .sort((a, b) => (b.spec.tier - a.spec.tier) || a.spec.name.localeCompare(b.spec.name))
    .map(({ key, count }) => ({ key, count }));
}

export function resetInventoryForTests(): void {
  try { localStorage.removeItem(ITEMS_KEY); } catch { /* fine */ }
}
