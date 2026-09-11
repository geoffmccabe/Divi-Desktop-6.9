// Things a ship carries, as opposed to things it shoots with.
//
// Same shape as the weapons and bought through the same machinery, because
// from the player's side there is no difference: it is a thing you save for and
// it stays with the hull. Keeping them in their own file rather than adding a
// `kind: "item"` to the guns is about what changes together — a new beam tier
// touches the firing code, a new magazine does not.
//
// TIERS, LIKE THE GUNS. "+2 more" replaces "+1 more" rather than stacking on
// top of it, and has to be bought after it. That follows the rule already set
// for weapons: buy the weaker one first. It also means the prices read as an
// upgrade path rather than as three separate things that might be bought in
// any order and then argued about.

/* "super" and "strafe" are the two kinds nothing is sold under yet: a 3x
   boost or a 2x strafe is a row here with `amount` as the multiplier, and
   the flight model, the help card and the room all read it from
   superBoostMult / strafeMult below. Geoff: "Don't hardcode anything because
   we will add items such as a 3x boost item to buy or 1.5x or 2x strafe." */
export type ItemKind =
  | "torpedo" | "mag" | "vip" | "super" | "strafe"
  /* Found, not bought. See DROP_ITEMS below and docs/DIVI-REBELS-ITEMS-PLAN.md.
     "strafe" is the horizontal one; "vstrafe" is R and C. */
  | "recharge" | "supercharge" | "reargun" | "vstrafe" | "hull" | "portal" | "drone";

export interface ItemSpec {
  key: string;
  name: string;
  note: string;
  kind: ItemKind;
  /** What it costs in POINTS, and at the wallet's rate, in DIVI. */
  points: number;
  /** What must already be owned: the tier below it. */
  needs: string | null;
  /** Which tier of its own kind, counting from one. */
  tier: number;
  /**
   * What it actually does.
   *
   * For torpedoes, extra tubes. For magazines, a fraction more rounds. Read by
   * the game through torpedoBonus and magBonus rather than by any code that
   * knows these particular keys, so a fourth tier is a row.
   */
  amount: number;
  /** Comes out of a wreck rather than the store. Never priced. */
  drop?: true;
  /** Used up when it is picked up (or, held, when Y is pressed). */
  consumable?: true;
}

/* ---- ITEM TIERS ----
   Geoff: T1 yellow, T2 green, T3 blue, T4 purple, T5 red. Forging can push a
   thing past its family's top tier "by name": T6 is white and T7 fuchsia,
   with T5's power. These are the ITEM colours; the seven enemy tiers have
   their own list in rebelsCombat. */
export const ITEM_TIER_COLOURS = [0xf2d94a, 0x57e06a, 0x4fa8ff, 0xa96bff, 0xff4d4d, 0xf2f6ff, 0xff45d0];
export const ITEM_TIER_NAMES = ["yellow", "green", "blue", "purple", "red", "white", "fuchsia"];
export const ITEM_TIER_MAX = ITEM_TIER_COLOURS.length;
export function itemTierColour(tier: number): number {
  return ITEM_TIER_COLOURS[Math.min(ITEM_TIER_MAX, Math.max(1, Math.round(tier))) - 1];
}

/** The prices Geoff set: a thousand, two, then four. */
const PRICES = [1_000, 2_000, 4_000];

const torpedo = (n: number): ItemSpec => ({
  key: `torp${n}`,
  name: `Extra Torpedo +${n}`,
  note: `${n} more in the rack, refilled at your tower.`,
  kind: "torpedo",
  points: PRICES[n - 1],
  needs: n > 1 ? `torp${n - 1}` : null,
  tier: n,
  amount: n,
});

const mag = (n: number): ItemSpec => ({
  key: `mag${n}`,
  name: `Extra Mag +${n * 30}%`,
  note: `${n * 30}% more rounds before you have to go home.`,
  kind: "mag",
  points: PRICES[n - 1],
  needs: n > 1 ? `mag${n - 1}` : null,
  tier: n,
  amount: n * 0.3,
});

/* ---- RESPAWN ----
   Geoff: "people should be able to respawn into higher levels after a wait
   time and countdown... I think 30 seconds is good and then if they buy an
   item or VIP pass it could reduce to 10 seconds." The room keeps the same
   figures; a VIP Pass is a declared item like any other. */
export const RESPAWN_WAIT = 30;
export const RESPAWN_VIP = 10;
const VIP_PASS: ItemSpec = {
  key: "vip",
  name: "VIP Pass",
  note: `Back in the fight ${RESPAWN_VIP} seconds after you go down, not ${RESPAWN_WAIT}.`,
  kind: "vip",
  points: 5_000,
  needs: null,
  tier: 1,
  amount: RESPAWN_VIP,
};

/** What the store sells. */
export const ITEMS: ItemSpec[] = [
  torpedo(1), torpedo(2), torpedo(3),
  mag(1), mag(2), mag(3),
  VIP_PASS,
];

/* ---- DROPPED ITEMS ----
   What a wreck can leave behind. Each is a row: the drop charts refer to
   them by key, the inventory stacks them by key, and forging turns four of
   one tier into one of the next. Amounts are the multiplier or fraction
   the flight model and the room read; the strafe tiers are 1.5x, 2x, 2.5x,
   3x and the hull tiers +20% each (Geoff, 2026-Sep-11). Nothing here has a
   price: `drop` says so, and the store never lists them. */
const dropRow = (
  key: string, name: string, kind: ItemKind, tier: number, amount: number, note: string,
  extra: Partial<ItemSpec> = {},
): ItemSpec => ({ key, name, note, kind, points: 0, needs: null, tier, amount, drop: true, ...extra });

const STRAFE_MULTS = [1.5, 2, 2.5, 3];
const strafeRow = (kind: "strafe" | "vstrafe", n: number): ItemSpec => dropRow(
  `${kind}${n}`, `${kind === "strafe" ? "Horizontal" : "Vertical"} Strafe T${n}`, kind, n, STRAFE_MULTS[n - 1],
  `${kind === "strafe" ? "A and D" : "R and C"} slide ${STRAFE_MULTS[n - 1]}x as fast.`,
);
export const HULL_PER_TIER = 0.2;
const hullRow = (n: number): ItemSpec => dropRow(
  `hull${n}`, `Hull Boost T${n}`, "hull", n, HULL_PER_TIER * n,
  `${Math.round(HULL_PER_TIER * n * 100)}% more hull.`,
);
/* Wingmen: hull and damage as a share of the player's ship, and how many
   rounds they carry against the player's magazine. Geoff's table. */
export const DRONE_SHARE = [0.5, 0.8, 1.1, 1.4, 1.7];
export const DRONE_ROUNDS = [1, 1, 1.25, 1.5, 1.75];
const droneRow = (n: number): ItemSpec => dropRow(
  `drone${n}`, `Drone T${n}`, "drone", n, DRONE_SHARE[n - 1],
  `A wingman at ${Math.round(DRONE_SHARE[n - 1] * 100)}% of your hull and damage, ${DRONE_ROUNDS[n - 1]}x your rounds. Flies formation and fires when you fire.`,
);

export const DROP_ITEMS: ItemSpec[] = [
  dropRow("recharge", "Instant Recharge", "recharge", 1, 1,
    "Everything back to full on the spot, as at your tower.", { consumable: true }),
  dropRow("supercharge", "Supercharge", "supercharge", 1, 2,
    "A full charge on top of what you have, up to double.", { consumable: true }),
  dropRow("reargun", "Rear Gun", "reargun", 1, 1,
    "Press 7 for a rear view. Aim in it to fire backwards; right-click for a torpedo."),
  strafeRow("vstrafe", 1), strafeRow("vstrafe", 2), strafeRow("vstrafe", 3), strafeRow("vstrafe", 4),
  strafeRow("strafe", 1), strafeRow("strafe", 2), strafeRow("strafe", 3), strafeRow("strafe", 4),
  hullRow(1), hullRow(2), hullRow(3), hullRow(4), hullRow(5),
  dropRow("portal", "Local Portal", "portal", 1, 1,
    "Place it anywhere near Earth. Anyone can fly in and pick where to come out."),
  droneRow(1), droneRow(2), droneRow(3), droneRow(4), droneRow(5),
];

/** Everything, sold or found. */
export const ALL_ITEMS: ItemSpec[] = [...ITEMS, ...DROP_ITEMS];

/** The one-letter mark on a drop's placeholder model, so a drone and a
 *  strafe are told apart before real models exist. */
export function itemMark(spec: ItemSpec): string {
  switch (spec.kind) {
    case "recharge": return "R";
    case "supercharge": return "S";
    case "reargun": return "G";
    case "vstrafe": return "V";
    case "strafe": return "H";
    case "hull": return "B";
    case "portal": return "P";
    case "drone": return "D";
    default: return spec.name[0] ?? "?";
  }
}

/** How long this player waits to respawn, given what they own. */
export function respawnSeconds(owned: string[]): number {
  return owned.includes("vip") ? RESPAWN_VIP : RESPAWN_WAIT;
}

/** What TAB multiplies boost by: the best "super" item owned, else the base. */
export function superBoostMult(owned: string[], base: number): number {
  const best = bestOwned("super", owned);
  return best ? Math.max(base, best.amount) : base;
}

/** What the slides are multiplied by: the best "strafe" item owned, else one. */
export function strafeMult(owned: string[]): number {
  const best = bestOwned("strafe", owned);
  return best ? Math.max(1, best.amount) : 1;
}

export function itemByKey(key: string): ItemSpec | null {
  return ALL_ITEMS.find((i) => i.key === key) ?? null;
}

/**
 * The best of a kind this hull owns.
 *
 * The BEST rather than the sum, because the tiers replace each other: someone
 * who worked up from +1 to +3 has three extra tubes, not six. Reading it this
 * way means an upgrade never has to remember to take the old one away.
 */
export function bestOwned(kind: ItemKind, owned: string[]): ItemSpec | null {
  let best: ItemSpec | null = null;
  for (const key of owned) {
    const item = itemByKey(key);
    if (!item || item.kind !== kind) continue;
    if (!best || item.tier > best.tier) best = item;
  }
  return best;
}

/** Extra torpedo tubes this hull has bought. */
export function torpedoBonus(owned: string[]): number {
  return bestOwned("torpedo", owned)?.amount ?? 0;
}

/** How much bigger this hull's magazine is, as a fraction. */
export function magBonus(owned: string[]): number {
  return bestOwned("mag", owned)?.amount ?? 0;
}

/** What the store calls one that cannot be bought yet. */
export function itemUpgradeLabel(spec: ItemSpec): string {
  return spec.tier === 1 ? "Tier 1" : `Tier ${spec.tier} Upgrade`;
}
