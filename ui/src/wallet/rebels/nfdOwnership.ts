// What THIS player's Divi collectibles are worth in Divi Rebels.
//
// The join between three things that each know nothing about the others:
//   - our database says which collections count      (ui/src/nfd/nfdRemote.ts)
//   - the chain says who holds what                  (ui/src/nfd/nfdOwned.ts)
//   - this game says what owning one does            (nfdBenefits.ts)
//
// Game specific, like nfdBenefits.ts, and for the same reason: another of
// Geoff's games writes its own twenty lines here and reuses everything else.

import { fetchEnabledCollections } from "../../nfd/nfdRemote";
import { ownedByCollection, readOwned, topTier, type OwnedNfd } from "../../nfd/nfdOwned";
import type { NfdCollection } from "../../nfd/nfdCatalog";
import { nfdBenefits, NO_NFD, type NfdBenefits } from "./nfdBenefits";
import { nfdStore } from "./nfdStore";
import { platform } from "./platform/current";

/** Why there is nothing to show, when there is nothing to show. */
export type NfdWhy =
  /** Still asking. */
  | "loading"
  /** This door has no wallet to ask: the web. */
  | "no-wallet"
  /** A wallet is here, but this build has no way to ask the chain yet. */
  | "not-wired"
  /** A wallet, but the chain index could not be reached or answered. */
  | "no-chain"
  /** Asked and answered: this wallet holds none of the sets that count. */
  | "none-owned"
  /** No collection is switched on, so nothing could count. */
  | "no-collections"
  /** Holdings found. */
  | "owned";

export interface NfdOwnershipState {
  why: NfdWhy;
  /** The collections that count, whether or not any are owned. Always listed:
   *  a player who owns none still wants to know what to go and get. */
  collections: NfdCollection[];
  /** What is held, grouped by collection, best first inside each group. */
  groups: Array<{ collection: NfdCollection; owned: OwnedNfd[] }>;
  /** The best tier held across every collection that counts. */
  tier: number;
  /** What that tier is worth. NO_NFD when nothing counts. */
  benefits: NfdBenefits;
}

export const NFD_EMPTY: NfdOwnershipState = {
  why: "loading", collections: [], groups: [], tier: 0, benefits: NO_NFD,
};

/**
 * Everything the NFDs tab needs, in one read.
 *
 * ⚠ IT NEVER THROWS AND IT NEVER GUESSES. Each half fails on its own: the
 * collections can arrive without the holdings and the holdings without the
 * collections, and the panel says which happened. The one thing it will not do
 * is report a benefit it cannot account for, because a damage bonus nobody
 * owns is worse than a panel that says it could not look.
 */
export async function readNfdOwnership(): Promise<NfdOwnershipState> {
  const load = await fetchEnabledCollections(nfdStore);
  const collections = load.collections;

  const ask = platform().money.ownedNfds;
  if (!ask) {
    /* Two very different silences, and telling a player the wrong one is
       worse than telling them nothing. In a browser there IS no wallet and
       the answer is "open it in the app". In the app there is a wallet and
       the answer is "this build cannot ask the chain yet", which is OUR
       missing piece and not something the player can do anything about.
       Which one it is, is decided by whether the door has any address. */
    let hasWallet = false;
    try {
      hasWallet = (await platform().money.ownAddresses()).length > 0;
    } catch {
      hasWallet = false;
    }
    return { ...NFD_EMPTY, why: hasWallet ? "not-wired" : "no-wallet", collections };
  }

  let owned: OwnedNfd[] | null = null;
  try {
    owned = readOwned(await ask());
  } catch {
    owned = null;
  }
  if (owned === null) return { ...NFD_EMPTY, why: "no-chain", collections };
  if (collections.length === 0) return { ...NFD_EMPTY, why: "no-collections", collections };

  const groups = ownedByCollection(collections, owned);
  /* The tier is taken across every group, not from the first. A player with a
     tier 3 in one set and a tier 20 in another gets the 20. */
  const tier = topTier(groups.flatMap((g) => g.owned));
  return {
    why: groups.length === 0 ? "none-owned" : "owned",
    collections,
    groups,
    tier,
    benefits: nfdBenefits(tier),
  };
}

/** The line the panel shows when there is nothing to show. */
export function nfdWhyText(why: NfdWhy, sets: number): string {
  switch (why) {
    case "loading":
      return "Reading your collectibles.";
    case "no-wallet":
      return "Collectibles live in your Divi wallet, and this page has no wallet. Open Divi Rebels inside the Divi Desktop app to see them here.";
    case "not-wired":
      return "Your wallet is here, but this build cannot yet ask the chain what it holds. The piece that answers that is still to come; nothing you own is affected.";
    case "no-chain":
      return "Your wallet could not be asked what it holds just now. Nothing is lost; try again in a moment.";
    case "no-collections":
      return "No Divi collectibles count in this game yet.";
    case "none-owned":
      return sets === 1
        ? "You hold none of this set yet. Shoot something big enough and one may fall out."
        : `You hold none of the ${sets} sets that count yet. Shoot something big enough and one may fall out.`;
    default:
      return "";
  }
}
