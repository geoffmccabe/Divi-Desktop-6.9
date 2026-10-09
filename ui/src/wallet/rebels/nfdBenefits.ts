// What owning an NFD does in THIS game.
//
// Deliberately the only Divi Rebels specific file in the NFD feature. The
// catalog, the ingest, the gallery and the ownership shape are in ui/src/nfd/
// and know nothing about ships. Another of Geoff's games writes its own
// version of this file and reuses everything else.
//
// Geoff, 2026-Oct-08: "the top Tier of NFD owned by the user get 1% bonus per
// tier in damage applied, damage resistance (so damage is reduced by 5% for
// owning a T5) and the chance to get a drop is also increased by 1% for every
// tier." Asked whether that should cap, given the set runs to tier 30, he
// chose the full 1% per tier with no cap.

/** What one player's NFDs are worth, as plain multipliers. */
export interface NfdBenefits {
  /** The tier the benefits come from: the highest owned, or 0 for none. */
  tier: number;
  /** Outgoing damage. 1.30 at tier 30. */
  damageMult: number;
  /** Incoming damage REMOVED, as a fraction. 0.30 at tier 30. */
  resistance: number;
  /** The drop roll's chance. 1.30 at tier 30. */
  dropMult: number;
}

/** One percent, per tier, on each of the three. */
export const NFD_PER_TIER = 0.01;

export const NO_NFD: NfdBenefits = { tier: 0, damageMult: 1, resistance: 0, dropMult: 1 };

/**
 * The benefits for a player whose best NFD is this tier.
 *
 * ⚠ RESISTANCE IS CLAMPED BELOW 1 AND THAT IS NOT A STYLE CHOICE. It is
 * subtracted from incoming damage, so at 1.0 a ship is immortal and above it
 * a ship HEALS from being shot. Today the set stops at 30 and 0.30 is
 * nowhere near, but the clamp costs nothing and the day somebody makes a
 * hundred-tier set is not the day to find out. The other two are
 * unbounded on purpose: more damage and more drops are merely strong.
 */
export function nfdBenefits(topTier: number): NfdBenefits {
  const tier = Math.max(0, Math.floor(topTier));
  const bonus = tier * NFD_PER_TIER;
  return {
    tier,
    damageMult: 1 + bonus,
    resistance: Math.min(0.95, bonus),
    dropMult: 1 + bonus,
  };
}

/** The three lines the NFDs panel shows, in plain words. */
export function benefitLines(b: NfdBenefits): Array<{ label: string; value: string }> {
  const pc = (n: number) => `${Math.round(n * 100)}%`;
  return [
    { label: "Damage you deal", value: b.tier ? `+${pc(b.damageMult - 1)}` : "no bonus" },
    { label: "Damage you take", value: b.tier ? `-${pc(b.resistance)}` : "no bonus" },
    { label: "Chance of a drop", value: b.tier ? `+${pc(b.dropMult - 1)}` : "no bonus" },
  ];
}

/**
 * The highest tier among the editions a player owns.
 *
 * Takes the tier per edition rather than the collection, so the caller
 * decides which collections are enabled and this cannot quietly count one
 * that is switched off.
 */
export function topOwnedTier(owned: readonly number[], tierOf: (edition: number) => number | null): number {
  let top = 0;
  for (const e of owned) {
    const t = tierOf(e);
    if (t != null && t > top) top = t;
  }
  return top;
}
