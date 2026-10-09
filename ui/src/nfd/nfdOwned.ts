// What one player OWNS, and which of it counts.
//
// GAME AGNOSTIC, like the rest of ui/src/nfd/. Nothing here knows about ships
// or DIVI. A game writes its own benefits file (Divi Rebels: nfdBenefits.ts)
// and reuses this.
//
// ---- WHERE THE TRUTH IS ----
// An NFD's owner lives on the Divi chain, not in our database. The chain's
// own index (contrib/dvxp-scan, vendored into the app's supervisor) answers
// "what does this address hold" and is the ONLY source we trust for it. Our
// database says which collections COUNT; the chain says who holds what. Those
// two answers must never be confused, which is why this file reads one shape
// and nfdRemote.ts reads the other.
//
// ---- THE TIER COMES FROM THE CHAIN, NOT FROM AN EDITION ----
// A Perc collection is not minted edition-by-edition. A pack is minted sealed
// and REVEALED later, and the reveal resolves provably-fairly from a future
// block into a base tier (1..tierCount) plus, when the ultra-rare gate fires,
// an ultra-rare slot. See resolve_reveal in
// /Users/geoffreymccabe/Divi-Blockchain_6.9/contrib/nfd-indexer/src/lib.rs.
// So an owned NFD carries a TIER, and the artwork is whichever catalog item
// sits at that tier. Nothing here looks up an edition.
//
// ⚠ ONE FIELD IS MISSING UPSTREAM AND THIS FILE IS BUILT TO SURVIVE IT.
// The scanner's HTTP shape (nfd_json in contrib/dvxp-scan/src/api.rs) serves
// id, owner, collectionId, mintHeight and the Arweave pointers, but NOT the
// reveal state, although its own NfdView carries it. Until that is served, a
// row arrives with no tier. An NFD with no tier is SHOWN and grants NOTHING,
// which is the only safe way round: inventing a tier would invent a damage
// bonus.

import type { NfdCollection, NfdItem } from "./nfdCatalog";
import { normalsOf, ultraRaresOf } from "./nfdCatalog";

/** One collectible this player holds, as the chain describes it. */
export interface OwnedNfd {
  /** The on-chain id, 64 hex characters. Unique, and the key for everything. */
  id: string;
  /** The on-chain collection it belongs to, or null for a one-off NFD. */
  chainCollection: string | null;
  /** Still a sealed pack: the packaged art, and no tier yet. */
  sealed: boolean;
  /** A reveal is committed and waiting for its block. Implies sealed. */
  revealPending: boolean;
  /**
   * The revealed base tier, or null for "we do not know".
   *
   * Null is NOT a tier of zero. It means sealed, or that the chain did not
   * tell us. Either way it earns nothing.
   */
  tier: number | null;
  /** The ultra-rare slot (1 is the commonest) when the gate fired, else null. */
  ultraRare: number | null;
  /** The block it was minted in. Only used to order equal tiers. */
  mintHeight: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const HEX64 = /^[0-9a-f]{64}$/i;

/** A whole number from 1 up, else null. Rejects 0, negatives and nonsense. */
function tierNum(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return null;
  return v;
}

/**
 * One row of the scanner's `/nfds?owner=` answer.
 *
 * A row we cannot name is dropped rather than guessed at: without an id there
 * is nothing to key, dedupe or act on later. Everything else degrades.
 */
export function readOwnedRow(raw: unknown): OwnedNfd | null {
  if (!isObj(raw)) return null;
  const id = typeof raw.id === "string" && HEX64.test(raw.id) ? raw.id.toLowerCase() : "";
  if (!id) return null;

  /* The reveal, in either of the two shapes it may arrive in: a flat tier, or
     the tuple the Rust side holds it as. Both are read because the HTTP shape
     has not settled and a client that only understood one would break on the
     day it changes. */
  let tier = tierNum(raw.tier);
  let ultraRare = tierNum(raw.ultraRare);
  if (Array.isArray(raw.revealed)) {
    tier = tier ?? tierNum(raw.revealed[0]);
    ultraRare = ultraRare ?? tierNum(raw.revealed[1]);
  }

  const revealPending = raw.revealPending === true;
  /* Sealed means "no tier yet", so a row that CARRIES a tier is not sealed
     whatever the flag says. The tier is the harder fact. */
  const sealed = tier == null && (raw.sealed === true || revealPending || raw.sealed === undefined);

  return {
    id,
    chainCollection:
      typeof raw.collectionId === "string" && HEX64.test(raw.collectionId)
        ? raw.collectionId.toLowerCase()
        : null,
    sealed: tier == null ? sealed : false,
    revealPending: tier == null && revealPending,
    tier,
    ultraRare: tier == null ? null : ultraRare,
    mintHeight: typeof raw.mintHeight === "number" && Number.isFinite(raw.mintHeight) ? raw.mintHeight : 0,
  };
}

/**
 * The whole answer, read softly.
 *
 * Fails to an empty list rather than throwing: an inventory that cannot reach
 * the chain should say "none found", not break the panel it sits in. Duplicate
 * ids are collapsed, because two rows for one collectible would count its tier
 * twice in anything that sums.
 */
export function readOwned(raw: unknown): OwnedNfd[] {
  const list = isObj(raw) && Array.isArray(raw.nfds) ? raw.nfds : Array.isArray(raw) ? raw : [];
  const out = new Map<string, OwnedNfd>();
  for (const r of list) {
    const o = readOwnedRow(r);
    if (o && !out.has(o.id)) out.set(o.id, o);
  }
  return [...out.values()];
}

/**
 * Only what an enabled collection claims.
 *
 * Geoff: "only specific NFD collections would be useful in the game and
 * anything else will not show." So this is an ALLOWLIST, keyed on the chain id
 * an admin has recorded against a collection that is switched on. A holding
 * from any other collection, and any one-off NFD, is not ours to show.
 */
export function ownedByCollection(
  collections: readonly NfdCollection[],
  owned: readonly OwnedNfd[],
): Array<{ collection: NfdCollection; owned: OwnedNfd[] }> {
  const live = collections.filter((c) => c.enabled && c.chainId);
  const byChain = new Map<string, NfdCollection>();
  for (const c of live) byChain.set(c.chainId!.toLowerCase(), c);
  const groups = new Map<string, OwnedNfd[]>();
  for (const o of owned) {
    if (!o.chainCollection) continue;
    const c = byChain.get(o.chainCollection);
    if (!c) continue;
    const list = groups.get(c.id) ?? [];
    list.push(o);
    groups.set(c.id, list);
  }
  return live
    .filter((c) => groups.has(c.id))
    .map((c) => ({ collection: c, owned: sortOwned(groups.get(c.id)!) }));
}

/**
 * Best first: highest tier, ultra-rares ahead of their plain twin, then oldest.
 *
 * The order is the design. The card at the top is the one granting the
 * benefits, so "best" has to mean exactly what the benefits mean, or the panel
 * will highlight one card and buff from another.
 */
export function sortOwned(owned: readonly OwnedNfd[]): OwnedNfd[] {
  return [...owned].sort(
    (a, b) =>
      (b.tier ?? 0) - (a.tier ?? 0) ||
      (b.ultraRare ?? 0) - (a.ultraRare ?? 0) ||
      a.mintHeight - b.mintHeight ||
      a.id.localeCompare(b.id),
  );
}

/**
 * The highest tier held, or 0 for none.
 *
 * ⚠ THE BENEFIT KEYS ON THE BASE TIER, NOT ON THE ULTRA-RARE SLOT. The chain
 * draws a base tier for every pack and then, separately, may draw an
 * ultra-rare slot on its own much steeper ladder; it keeps the base tier
 * either way. Reading an ultra-rare slot as a tier would make slot 3 of ten
 * worth less than a plain tier 20, which is backwards. So ultra-rare is
 * prestige and art here, and the damage bonus comes off the base tier.
 */
export function topTier(owned: readonly OwnedNfd[]): number {
  let top = 0;
  for (const o of owned) if (o.tier != null && o.tier > top) top = o.tier;
  return top;
}

/**
 * The artwork for one owned collectible, or null while it is sealed.
 *
 * An ultra-rare takes its art from the ultra-rare group by slot. Everything
 * else takes the catalog item sitting at its tier.
 *
 * ⚠ A SET MAY HOLD SEVERAL ITEMS AT ONE TIER, and the chain's reveal says a
 * tier, not which of them. One is picked from the collectible's own id, so the
 * same NFD always wears the same face, for everyone, forever. That is a stand
 * in: when the chain serves the chosen item, read it instead and delete this.
 */
export function itemForOwned(c: NfdCollection, o: OwnedNfd): NfdItem | null {
  if (o.tier == null) return null;
  if (o.ultraRare != null) {
    const urs = ultraRaresOf(c);
    return urs[o.ultraRare - 1] ?? null;
  }
  const atTier = normalsOf(c).filter((i) => i.tier === o.tier);
  if (atTier.length === 0) return null;
  if (atTier.length === 1) return atTier[0];
  return atTier[pickFromId(o.id, atTier.length)];
}

/**
 * A stable index from an id. The same id always gives the same index.
 *
 * ⚠ FNV-1a WITH AN AVALANCHE, NOT THE USUAL `h * 31 + c`. The first version
 * here was the usual one, and the test caught it giving every id the same
 * answer: 31 is -1 modulo 4, so against a small count it folds instead of
 * mixing. Real ids are random hashes and would have hidden it; the test used
 * patterned ones and did not.
 */
function pickFromId(id: string, count: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) % count;
}
