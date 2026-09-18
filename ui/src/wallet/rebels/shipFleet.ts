// A ship's own things: its name, and the upgrades fitted to it.
//
// Geoff, 2026-Sep-13: "if you right-click on one of the items that is applied to
// a ship, such as a Strafe+1 or whatever, then it will ask 'Apply to Ship?
// (y/n)' and if they do then that particular ship gets the benefit permanently.
// Also there needs to be a place to name the ships, so each ship can have a name
// in addition to the user having a name. Ships are independent of users and can
// be bought/sold in the future."
//
// So an upgrade belongs to a SHIP, not to the player: fitting one uses the item
// up and the hull keeps it for good, which is what lets a ship be sold later
// with its upgrades on it. A ship is identified by its hull model, the same as
// the account's ship rows (one hull per owner per model, rebels_ship_save).
//
// Kept on this device through the door's storage (IndexedDB on the web,
// localStorage in the app) and on the account in the ship's own row
// (rebels_ships.name and .upgrades). Upgrades only ever get added, so merging two
// copies is a union and a stale copy can never take one away.

import { platform } from "./platform/current";
import { itemByKey } from "./itemCatalog";
import { heldCount, takeHeld } from "./rebelsInventory";
import { notify } from "./rebelsSignals";

const NAMES_KEY = "dd69.rebels.shipNames";
const UPGRADES_KEY = "dd69.rebels.shipUpgrades";

/** The kinds of item that are fitted to a hull rather than carried or used up.
 *  Wingmen fly with the pilot, recharges are used with Y, portals are placed:
 *  those stay in the inventory and work from there as before. */
export const SHIP_UPGRADE_KINDS: ReadonlySet<string> = new Set(["strafe", "vstrafe", "hull", "reargun"]);

export function isShipUpgrade(key: string): boolean {
  const spec = itemByKey(key);
  return !!spec && SHIP_UPGRADE_KINDS.has(spec.kind);
}

/** Longest ship name, and what may be in one. */
export const SHIP_NAME_MAX = 24;
export function cleanShipName(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} '\-.!]/gu, "").replace(/\s+/g, " ").trim().slice(0, SHIP_NAME_MAX);
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(platform().storage.getItem(key) || "null");
    return v && typeof v === "object" ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown): void {
  platform().storage.setItem(key, JSON.stringify(value));
  notify("armoury");
}

const MODEL_OK = /^space_SM_Ship_[A-Za-z0-9_]{1,60}$/;

/** What the owner calls this hull, or "" for "call it whatever the class is". */
export function shipName(model: string): string {
  const names = readJson<Record<string, string>>(NAMES_KEY, {});
  return typeof names[model] === "string" ? cleanShipName(names[model]) : "";
}

export type FleetAnswer = { ok: true } | { ok: false; why: string };

export function setShipName(model: string, raw: string): FleetAnswer {
  if (!platform().limits.customiseShips) return { ok: false, why: platform().limits.why };
  if (!MODEL_OK.test(model)) return { ok: false, why: "not a ship" };
  const names = readJson<Record<string, string>>(NAMES_KEY, {});
  const name = cleanShipName(raw);
  if (name) names[model] = name; else delete names[model];
  writeJson(NAMES_KEY, names);
  return { ok: true };
}

/** The upgrades fitted to this hull, as item keys. */
export function shipUpgrades(model: string): string[] {
  const all = readJson<Record<string, unknown>>(UPGRADES_KEY, {});
  const list = all[model];
  return Array.isArray(list) ? [...new Set(list.filter((k): k is string => typeof k === "string" && isShipUpgrade(k)))] : [];
}

/**
 * Fit one held item to this hull, for good. The item is used up (its "used"
 * counter rises, so the account copy cannot bring it back) and the hull keeps
 * the upgrade.
 */
export function applyToShip(model: string, key: string): FleetAnswer {
  if (!platform().limits.customiseShips) return { ok: false, why: platform().limits.why };
  if (!MODEL_OK.test(model)) return { ok: false, why: "not a ship" };
  if (!isShipUpgrade(key)) return { ok: false, why: "that is not something a ship can be fitted with" };
  const fitted = shipUpgrades(model);
  if (fitted.includes(key)) return { ok: false, why: "this ship already has that fitted" };
  if (heldCount(key) < 1) return { ok: false, why: "none of those held" };
  if (!takeHeld(key, 1)) return { ok: false, why: "none of those held" };
  const all = readJson<Record<string, string[]>>(UPGRADES_KEY, {});
  all[model] = [...fitted, key];
  writeJson(UPGRADES_KEY, all);
  return { ok: true };
}

/** Fold in the account's copy of the fleet: a name fills in where this device
 *  has none, and upgrades are the union. True if anything changed. */
export function mergeFleet(ships: Array<{ model: string; name?: string; upgrades?: unknown }>): boolean {
  const names = readJson<Record<string, string>>(NAMES_KEY, {});
  const ups = readJson<Record<string, string[]>>(UPGRADES_KEY, {});
  let moved = false;
  for (const s of ships) {
    if (!s || !MODEL_OK.test(s.model)) continue;
    const name = cleanShipName(String(s.name ?? ""));
    if (name && !names[s.model]) { names[s.model] = name; moved = true; }
    const theirs = Array.isArray(s.upgrades) ? s.upgrades.filter((k): k is string => typeof k === "string" && isShipUpgrade(k)) : [];
    const mine = shipUpgrades(s.model);
    const union = [...new Set([...mine, ...theirs])];
    if (union.length > mine.length) { ups[s.model] = union; moved = true; }
  }
  if (moved) {
    platform().storage.setItem(NAMES_KEY, JSON.stringify(names));
    writeJson(UPGRADES_KEY, ups);
  }
  return moved;
}

export function resetFleetForTests(): void {
  platform().storage.removeItem(NAMES_KEY);
  platform().storage.removeItem(UPGRADES_KEY);
}
