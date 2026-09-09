// What this player has earned and what they have bought.
//
// POINTS ARE NOT THE WALLET'S POINTS. The wallet sells points for DIVI, for
// its own features. These are earned by playing, one for each DIVI recovered
// out in orbit, and they are spent on guns. Two currencies that happen to share
// a word, kept in two places so neither can ever spend the other.
//
// LIFETIME, NOT A BALANCE... except that it is both, and the difference is
// worth being exact about. `earned` only ever goes up: it is the record of
// everything this player has ever brought home. `spent` is what has gone on
// weapons. What can be spent is the difference. Keeping the two apart rather
// than decrementing one number means a player's total earnings survive a
// purchase, which is what a career is.
//
// OWNERSHIP IS PER SHIP, ALREADY. Nothing today lets a player own two ships,
// but the plan is that they will, and that a ship can be sold with its guns on
// it. So a weapon is owned by a hull rather than by an account from the start:
// retrofitting that later would mean migrating everybody's purchases.

import { STARTING_WEAPONS, weaponByKey, type WeaponSpec } from "./weaponCatalog";
import { itemByKey, torpedoBonus, magBonus, type ItemSpec } from "./itemCatalog";
import { USD_PER_POINT } from "./weaponCatalog";
import { spendDivi } from "./rebelsScores";

/** Anything that can be bought. Guns and gear are the same transaction. */
export type Buyable = WeaponSpec | ItemSpec;

/** Look one up wherever it lives. */
export function specByKey(key: string): Buyable | null {
  return weaponByKey(key) ?? itemByKey(key);
}

const POINTS_KEY = "dd69.rebels.points";
const OWNED_KEY = "dd69.rebels.owned";

export interface Purse {
  /** Everything ever earned. Never goes down. */
  earned: number;
  /** Everything ever spent on weapons. */
  spent: number;
}

export function purse(): Purse {
  try {
    const v = JSON.parse(localStorage.getItem(POINTS_KEY) || "null");
    if (v && typeof v === "object") {
      return {
        earned: num(v.earned),
        spent: num(v.spent),
      };
    }
  } catch {
    /* nothing saved yet */
  }
  return { earned: 0, spent: 0 };
}

const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

/** What is left to spend. */
export function spendable(p = purse()): number {
  return Math.max(0, p.earned - p.spent);
}

function writePurse(p: Purse): void {
  try { localStorage.setItem(POINTS_KEY, JSON.stringify(p)); } catch { /* storage full */ }
  try { window.dispatchEvent(new Event(CHANGED)); } catch { /* not a browser */ }
}

/**
 * One point for each DIVI brought home.
 *
 * Called with the DIVI from a pickup, so a coin worth a fiftieth of a DIVI is
 * a fiftieth of a point. Fractions are kept rather than rounded away: rounding
 * each coin to nothing would mean a player who collected two hundred small
 * coins earned nothing at all.
 */
export function earnPoints(divi: number): number {
  if (!(divi > 0)) return spendable();
  const p = purse();
  p.earned += divi;
  writePurse(p);
  return spendable(p);
}

/* ---- what is owned ---- */

type OwnedMap = Record<string, string[]>;

function readOwned(): OwnedMap {
  try {
    const v = JSON.parse(localStorage.getItem(OWNED_KEY) || "null");
    if (v && typeof v === "object" && !Array.isArray(v)) return v as OwnedMap;
  } catch {
    /* nothing saved yet */
  }
  return {};
}

/** Every weapon this hull carries, including the ones it came with. */
export function owned(ship: string): string[] {
  const mine = readOwned()[ship] ?? [];
  /* The starting weapon is never stored, so it can never be lost and never has
     to be granted: it is simply what a ship is. */
  return [...new Set([...STARTING_WEAPONS, ...mine])];
}

export function hasWeapon(ship: string, key: string): boolean {
  return owned(ship).includes(key);
}

/** Why a weapon cannot be bought right now, or null when it can. */
export function blockedBecause(ship: string, spec: Buyable, points = spendable()): string | null {
  if (hasWeapon(ship, spec.key)) return "owned";
  /* The line has to be walked in order. This is the check the store turns into
     "Tier N Upgrade" rather than a price nobody can pay. */
  if (spec.needs && !hasWeapon(ship, spec.needs)) {
    const before = specByKey(spec.needs);
    return `needs ${before?.name ?? spec.needs}`;
  }
  if (points < spec.points) return "not enough points";
  return null;
}

export type BuyResult =
  | { ok: true; owned: string[]; left: number }
  | { ok: false; why: string };

/**
 * Buy a weapon with points.
 *
 * Every condition is checked here rather than at the button, because a store
 * that only greys out what it will not sell is a store that sells anything to
 * anybody who can reach the function.
 */
export function buyWithPoints(ship: string, key: string): BuyResult {
  const spec = specByKey(key);
  if (!spec) return { ok: false, why: "no such thing" };
  const why = blockedBecause(ship, spec);
  if (why) return { ok: false, why };

  const p = purse();
  p.spent += spec.points;
  writePurse(p);
  grant(ship, key);
  return { ok: true, owned: owned(ship), left: spendable() };
}

/**
 * Record a weapon as owned without charging points for it.
 *
 * For the DIVI path, where the money has already changed hands somewhere this
 * file knows nothing about. Deliberately separate from buyWithPoints so that
 * the two ways of paying cannot be confused for one another, and so the one
 * that moves real value has to be called on purpose.
 */
export function grant(ship: string, key: string): void {
  const all = readOwned();
  const mine = new Set(all[ship] ?? []);
  mine.add(key);
  all[ship] = [...mine];
  try { localStorage.setItem(OWNED_KEY, JSON.stringify(all)); } catch { /* full */ }
  try { window.dispatchEvent(new Event(CHANGED)); } catch { /* not a browser */ }
}

/** Fired whenever points or ownership move, so the store and the HUD can
 *  follow without polling. */
export const CHANGED = "dd69-rebels-armoury";

export function subscribeArmoury(fn: () => void): () => void {
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
}

/**
 * Turn DIVI won in the game into points.
 *
 * The rate is the wallet's own: a thousand points to the dollar, so what a
 * DIVI is worth in points depends on what DIVI is worth. Geoff: "1000 points
 * for $1 if Divi price is $0.001 so each point can be worth more if the value
 * of Divi goes up."
 *
 * NO BLOCKCHAIN IS INVOLVED, and it is worth being exact about why. The DIVI
 * won in orbit has not been paid out: it is money the treasury owes and is
 * holding. Converting it cancels part of that debt in exchange for points, so
 * nothing has to move on a chain and nothing can fail halfway. Cashing OUT is
 * the transaction, and it is a different button.
 *
 * Refuses rather than guesses when there is no price, because a rate this app
 * made up would be someone's winnings valued at a number nobody agreed to.
 */
export function convertDiviToPoints(divi: number, diviUsd: number | null): {
  ok: boolean; why?: string; divi: number; points: number;
} {
  if (!diviUsd || !Number.isFinite(diviUsd) || diviUsd <= 0) {
    return { ok: false, why: "no DIVI price", divi: 0, points: 0 };
  }
  if (!(divi > 0)) return { ok: false, why: "nothing to convert", divi: 0, points: 0 };
  const took = spendDivi(divi);
  if (took <= 0) return { ok: false, why: "not enough DIVI", divi: 0, points: 0 };
  const points = (took * diviUsd) / USD_PER_POINT;
  const p = purse();
  p.earned += points;
  writePurse(p);
  return { ok: true, divi: took, points };
}

/** What a given amount of DIVI is worth in points right now, or null with no
 *  price to work from. */
export function pointsForDivi(divi: number, diviUsd: number | null): number | null {
  if (!diviUsd || !Number.isFinite(diviUsd) || diviUsd <= 0) return null;
  return (Math.max(0, divi) * diviUsd) / USD_PER_POINT;
}

/* ---- buying points with real DIVI ----
   The transaction itself is the wallet's: PurchaseWithDivi signs and
   broadcasts it to the treasury and hands back a transaction id. This is only
   the bookkeeping on this side. */

const PURCHASES_KEY = "dd69.rebels.purchases";

export interface Purchase {
  txid: string;
  divi: number;
  points: number;
  at: string;
}

export function purchases(): Purchase[] {
  try {
    const v = JSON.parse(localStorage.getItem(PURCHASES_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Record a paid-for purchase and add its points. ONCE per transaction.
 *
 * The purchase modal asks "has it settled?" every couple of seconds until told
 * yes, and each ask arrives here. Crediting on every ask would pay the points
 * out again and again for as long as the window stayed open, so the
 * transaction id is the key: seen it before, nothing more happens.
 *
 * WHAT THIS DOES NOT DO, stated because it is a rule of this project: it does
 * not verify the transaction against the chain. Points here are a local
 * balance and a local balance can be edited, so a verification step would
 * guard a door in a wall that is not there yet. The DIVI genuinely moves to
 * the treasury regardless. When points move server-side, the ledger should
 * confirm the payment the way the builder's points already are: by asking the
 * chain what reached the address, never by trusting a txid from the buyer.
 */
export function creditPurchase(txid: string, divi: number, points: number): boolean {
  if (!txid || !(points > 0)) return false;
  const all = purchases();
  if (all.some((x) => x.txid === txid)) return false;
  all.push({ txid, divi, points, at: new Date().toISOString() });
  try { localStorage.setItem(PURCHASES_KEY, JSON.stringify(all)); } catch { /* full */ }
  const p = purse();
  p.earned += points;
  writePurse(p);
  return true;
}

/* ---- what the gear actually does ----
   Read through here rather than by any code that knows a particular key, so a
   fourth tier of anything stays a row in a catalogue. */

/** Extra torpedo tubes this hull has bought. */
export function extraTorpedoes(ship: string): number {
  return torpedoBonus(owned(ship));
}

/** How much bigger this hull's magazine is, as a fraction of the standard. */
export function extraMagazine(ship: string): number {
  return magBonus(owned(ship));
}

/** Test hook. */
export function resetArmouryForTests(): void {
  try {
    localStorage.removeItem(POINTS_KEY);
    localStorage.removeItem(OWNED_KEY);
    localStorage.removeItem(PURCHASES_KEY);
  } catch { /* nothing to clear */ }
}
