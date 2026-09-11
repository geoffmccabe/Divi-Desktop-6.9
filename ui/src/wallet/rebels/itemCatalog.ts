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
export type ItemKind = "torpedo" | "mag" | "vip" | "super" | "strafe";

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

export const ITEMS: ItemSpec[] = [
  torpedo(1), torpedo(2), torpedo(3),
  mag(1), mag(2), mag(3),
  VIP_PASS,
];

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
  return ITEMS.find((i) => i.key === key) ?? null;
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
