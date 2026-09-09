// What the ship is carrying, and how it is chosen.
//
// THE SHAPE, AND WHY IT IS THIS ONE
// ---------------------------------
// Two rules the genre has settled on, and both are worth copying exactly.
//
// PRIMARY IS ENERGY, SECONDARY IS AMMUNITION. Left button and right button.
// Star Citizen, Everspace, Squadrons, FreeSpace 2 and Star Conflict all do it;
// Freelancer is the one exception and only because left-drag was steering.
//
// SELECTION IS DIRECT, NOT CYCLED. Number keys pick a weapon outright rather
// than stepping through a list. Descent bound 1-5 to primaries and 6-0 to
// secondaries in 1995 and nobody has criticised it since; Elite's fire groups
// are the most criticised weapon interface in the genre, its own forum has a
// thread titled "Can't figure out weapons switching/firing logic", and the
// standard player workaround is to pull time-critical items OUT of the cycle
// onto their own keys — which is an admission that direct binding wins.
//
// So: 1-3 choose the primary, 4-6 the secondary. Six slots, because more than
// about five is more than anyone can reach mid-fight.
//
// Three of the six have something in them today. The rest are the frame for
// weapons that do not exist yet; an empty slot says so rather than silently
// doing nothing, because a key that appears to do nothing is indistinguishable
// from a bug.

export type SlotKind = "primary" | "secondary";

export interface Weapon {
  key: string;
  name: string;
  /** One line, for the HUD. */
  note: string;
  /** False until the weapon is built. Shown greyed rather than hidden, so the
   *  shape of the loadout is visible before it is full. */
  ready: boolean;
}

/** 1, 2, 3. Energy, and effectively unlimited: they draw on the magazine that
 *  a tower refills. */
export const PRIMARY: Weapon[] = [
  { key: "pulse", name: "Pulse Laser", note: "Twin barrels, one shot a press.", ready: true },
  { key: "mini", name: "Mini Gun", note: "Twenty a second while held, quarter damage.", ready: true },
  { key: "beam", name: "Beam", note: "Not yet fitted.", ready: false },
];

/** 4, 5, 6. Ammunition, and counted. */
export const SECONDARY: Weapon[] = [
  { key: "torpedo", name: "Torpedo", note: "Four carried. Press again to detonate.", ready: true },
  { key: "mine", name: "Mine", note: "Not yet fitted.", ready: false },
  { key: "bomb", name: "Bomb", note: "Not yet fitted.", ready: false },
];

export interface Loadout {
  /** Index into PRIMARY. */
  primary: number;
  /** Index into SECONDARY. */
  secondary: number;
}

export const DEFAULT_LOADOUT: Loadout = { primary: 0, secondary: 0 };

const KEY = "dd69.rebels.loadout";

export function loadLoadout(): Loadout {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && typeof v === "object") {
      return {
        primary: pick(v.primary, PRIMARY),
        secondary: pick(v.secondary, SECONDARY),
      };
    }
  } catch {
    /* nothing saved */
  }
  return { ...DEFAULT_LOADOUT };
}

export function saveLoadout(l: Loadout): void {
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* full */ }
}

/** A saved index is only usable if it points at a weapon that is fitted. */
function pick(n: unknown, list: Weapon[]): number {
  const i = typeof n === "number" ? Math.floor(n) : 0;
  return i >= 0 && i < list.length && list[i].ready ? i : 0;
}

/** The weapon in a slot, whether or not it is fitted. */
export function weaponAt(kind: SlotKind, index: number): Weapon | null {
  const list = kind === "primary" ? PRIMARY : SECONDARY;
  return list[index] ?? null;
}
