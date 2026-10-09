// Whether a kill drops a sealed pack, and which set it came from.
//
// GAME AGNOSTIC, like the rest of ui/src/nfd/. It talks about the TIER OF THE
// THING THAT DIED, not about ships or enemies, so another of Geoff's games
// reuses it by passing whatever its own idea of a tier is.
//
// Geoff, 2026-Oct-08: "There should be a 1% chance per enemy tier to drop an
// NFD on each kill." Asked whether the tier that drops is decided on the spot
// or at the reveal, he chose: "rolled at reveal, blind." So THIS FILE NEVER
// DECIDES A TIER. It decides that a sealed pack dropped and which set it
// belongs to. What is inside is resolved later from a future block, by
// resolve_reveal in
// /Users/geoffreymccabe/Divi-Blockchain_6.9/contrib/nfd-indexer/src/lib.rs.
//
// ---- WHY A SET CAN BE SWITCHED ON AND STILL NOT DROP ----
// Capturing a dropped cube has to MINT, on chain, into a real collection. A
// set that has not been launched has no on-chain id, so a mint has nowhere to
// go and the drop would be a promise the game cannot keep. Such a set is
// excluded here rather than at the moment of capture, because a cube the
// player chases and cannot keep is far worse than a cube that never appeared.
// nfdDropProblems() exists so that exclusion is readable instead of silent.

import type { NfdCollection } from "./nfdCatalog";

/** One percent, per tier of the thing that died. */
export const NFD_DROP_CHANCE_PER_TIER = 0.01;

/** A set a drop may actually come from. */
export interface NfdDropSet {
  /** Our own short key for the set. */
  id: string;
  name: string;
  /** The on-chain collection id, 64 hex. Never null here: that is the point. */
  chainId: string;
  /** The sealed art the dropped cube wears. Never null here. */
  packagedArt: string;
}

/**
 * The sets a drop may come from: switched on, launched on chain, and carrying
 * the sealed artwork a cube needs to be visible.
 *
 * Returned in a stable order (by our own id) so that a given random number
 * picks the same set on every machine in a room. Two players watching the
 * same kill must see the same cube.
 */
export function nfdDropSets(collections: readonly NfdCollection[]): NfdDropSet[] {
  const out: NfdDropSet[] = [];
  for (const c of collections) {
    if (!c.enabled) continue;
    if (!c.chainId) continue;
    if (!c.packagedArt) continue;
    out.push({ id: c.id, name: c.name, chainId: c.chainId, packagedArt: c.packagedArt });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/**
 * Why each switched-on set is not dropping, in words an admin can act on.
 *
 * Only ENABLED sets are reported. A set nobody switched on is not a problem,
 * it is a decision, and listing it would bury the two that are.
 */
export function nfdDropProblems(collections: readonly NfdCollection[]): Array<{ id: string; why: string }> {
  const out: Array<{ id: string; why: string }> = [];
  for (const c of collections) {
    if (!c.enabled) continue;
    if (!c.chainId) {
      out.push({ id: c.id, why: "not launched on chain yet, so a captured pack could not be minted" });
      continue;
    }
    if (!c.packagedArt) {
      out.push({ id: c.id, why: "no packaged artwork, so a dropped pack would be invisible" });
    }
  }
  return out;
}

/**
 * The chance one kill drops a sealed pack.
 *
 * `mult` is the killer's own drop bonus, if the game chooses to apply it.
 *
 * ⚠ CLAMPED TO 1, AND THE CLAMP IS LOAD-BEARING. The rate is uncapped per
 * tier by Geoff's decision, so a hundred-tier enemy would ask for a chance of
 * 1.0 and a two-hundred-tier one for 2.0. A probability above one is not
 * "always": it is a number that quietly breaks every comparison downstream.
 */
export function nfdDropChance(sourceTier: number, mult = 1): number {
  const tier = Math.max(0, Math.floor(sourceTier));
  const m = Number.isFinite(mult) ? Math.max(0, mult) : 0;
  return Math.min(1, tier * NFD_DROP_CHANCE_PER_TIER * m);
}

/**
 * Roll one kill. Two random numbers, both in [0, 1): whether, then which set.
 * Returns the set a sealed pack dropped from, or null for nothing.
 *
 * Deterministic given the numbers, which is what the tests lean on and what
 * lets a room roll once and tell everybody the same answer.
 *
 * ⚠ THE KILLER'S OWN DROP BONUS IS NOT APPLIED UNLESS THE CALLER PASSES IT.
 * Owning a tier 30 NFD gives +30% "chance of a drop" in nfdBenefits.ts. Whether
 * that also multiplies the chance of finding ANOTHER NFD is a game design
 * question and not this file's to answer: it is a loop where owning makes
 * owning more likely. Default is no.
 */
export function rollNfdDrop(
  sets: readonly NfdDropSet[], sourceTier: number, rWhether: number, rWhich: number, mult = 1,
): NfdDropSet | null {
  if (sets.length === 0) return null;
  if (rWhether >= nfdDropChance(sourceTier, mult)) return null;
  const r = Number.isFinite(rWhich) ? Math.min(0.999999, Math.max(0, rWhich)) : 0;
  return sets[Math.floor(r * sets.length)] ?? null;
}

/**
 * How often a tier drops, as something readable. For the admin panel, so the
 * rate can be judged before it is live rather than after.
 */
export function nfdDropOdds(tiers: readonly number[], mult = 1): Array<{ tier: number; chance: number; oneIn: number }> {
  return tiers.map((tier) => {
    const chance = nfdDropChance(tier, mult);
    return { tier, chance, oneIn: chance > 0 ? 1 / chance : Infinity };
  });
}
