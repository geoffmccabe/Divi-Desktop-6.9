// What a ship can be armed with, and what it costs.
//
// DATA, NOT CODE
// --------------
// Every weapon is a row here and nothing about one is written into the game
// anywhere else: the damage, the reach, the colour, the price, what has to be
// owned first. Adding a tier is adding a row. Geoff: "For now it's just
// important to do what I've told you with an eye on the future and don't hard
// code stuff."
//
// That matters more than it usually would, because the plan is ships that can
// be bought, sold and traded with their weapons attached. A weapon that is a
// row can travel with a ship; a weapon that is an `if` in the firing code
// cannot.
//
// THE LINE, AND WHY IT IS A LINE
// ------------------------------
// The six primaries are a single upgrade path, not six alternatives: each one
// needs the one before it. So the store can say "Tier 2 Upgrade" and mean it,
// and a player always knows what the next thing to save for is.

/** How a weapon behaves, which is what the firing code branches on. There are
 *  three kinds and there is no fourth planned; a new TIER is a new row, not a
 *  new kind. */
export type WeaponKind = "pulse" | "mini" | "beam";

export interface WeaponSpec {
  key: string;
  /** 1 to 6. The number key that selects it. */
  slot: number;
  name: string;
  /** One line, for the HUD and the store. */
  note: string;
  kind: WeaponKind;
  /**
   * What it costs in POINTS. Zero means it comes with the ship.
   *
   * The same number is the DIVI price at the rate the wallet already uses:
   * a thousand points to the dollar. See priceInDivi.
   */
  points: number;
  /** What must already be owned. The line is 1 to 6, each needing the last. */
  needs: string | null;
  /**
   * Damage, as a multiple of what the pulse laser does.
   *
   * Geoff's figures: the beam tiers are 130%, 160%, 190% and 220%, which is
   * thirty points more each time rather than thirty percent compounding.
   */
  damage: number;

  /* ---- beams only ---- */
  /** The full angle of the cone, in degrees. Two to five, as asked: a lance
   *  you have to aim rather than a spray. */
  cone?: number;
  /** How far it reaches, in globe units. */
  reach?: number;
  /** The colour of the beam, and of its swatch in the store. */
  colour?: number;
  /**
   * Which tier of its own kind this is, counting from one.
   *
   * NOT its place in the whole line. The first beam is slot three and is
   * Tier 1; the store used to call it Tier 3 because it counted the pulse laser
   * and the mini gun as tiers of the same thing, which they are not. Geoff:
   * "#3 is Tier 1. #4 is Tier 2 Upgrade etc."
   */
  tier?: number;
}

/** How long a beam stays lit, and how often it does its damage while held. One
 *  number, because they are the same thing: the beam is on for exactly as long
 *  as it takes to be ready again. */
export const BEAM_SECONDS = 0.5;
/** What a beam reaches at its first tier, before the per-tier extension. */
export const BEAM_REACH = 90;
/**
 * The longest a beam may be held on, in seconds.
 *
 * Geoff: "the beam cannot be used for more than 5 seconds." Which is also the
 * length of the sample, so the sound and the limit are the same length by
 * design rather than by coincidence: the beam stops when its own noise runs
 * out.
 */
export const BEAM_MAX_HOLD = 5;
/** Each tier above the first reaches twenty percent further than the first. */
export const BEAM_REACH_STEP = 0.2;
/** And costs one round from the magazine per half second, the same as a pulse
 *  shot costs one. A full magazine is a minute of continuous fire. */
export const BEAM_AMMO = 1;

const beamTier = (
  n: number, slot: number, points: number, needs: string, colour: number, name: string,
): WeaponSpec => ({
  key: `beam${n}`,
  slot,
  name,
  note: `Continuous for ${BEAM_SECONDS}s. ${Math.round((1 + n * 0.3) * 100)}% damage.`,
  kind: "beam",
  points,
  needs,
  /* 130, 160, 190, 220 percent: thirty points more each time. */
  damage: 1 + n * 0.3,
  tier: n,
  /* Two, three, four and five degrees. */
  cone: 1 + n,
  reach: BEAM_REACH * (1 + (n - 1) * BEAM_REACH_STEP),
  colour,
});

/**
 * The armoury.
 *
 * Slot one comes with every ship. Everything after it is bought, in order, and
 * each row's `points` is both its price in points and, at the wallet's own
 * rate, its price in DIVI.
 */
export const WEAPONS: WeaponSpec[] = [
  {
    key: "pulse", slot: 1, name: "Pulse Gun",
    note: "Twin barrels, one shot a press.", kind: "pulse",
    points: 0, needs: null, damage: 1,
  },
  {
    key: "mini", slot: 2, name: "Mini Gun",
    note: "Twenty a second while held, quarter damage.", kind: "mini",
    points: 1_000, needs: "pulse", damage: 1,
  },
  beamTier(1, 3, 4_000, "mini", 0xffd83a, "Beam"),
  beamTier(2, 4, 15_000, "beam1", 0x5cf05c, "Beam II"),
  beamTier(3, 5, 50_000, "beam2", 0x54a8ff, "Beam III"),
  beamTier(4, 6, 200_000, "beam3", 0xb46bff, "Beam IV"),
];

export function weaponByKey(key: string): WeaponSpec | null {
  return WEAPONS.find((w) => w.key === key) ?? null;
}

export function weaponInSlot(slot: number): WeaponSpec | null {
  return WEAPONS.find((w) => w.slot === slot) ?? null;
}

/** What comes with a ship, before anything is bought. */
export const STARTING_WEAPONS: string[] = WEAPONS.filter((w) => w.points === 0).map((w) => w.key);

/**
 * What the store calls a weapon that cannot be bought yet.
 *
 * "Tier 2 Upgrade" and so on, counting tiers of the SAME weapon rather than
 * steps along the whole line: the first beam is Tier 1 even though it sits in
 * slot three, because the pulse laser and the mini gun are different guns and
 * not lesser beams. The first of a kind has nothing to upgrade FROM, so it is
 * labelled by its tier alone.
 *
 * The label exists so a player can see that a thing is not merely expensive but
 * is waiting on something else. Geoff: "it should say 'Tier 2 Upgrade' so it's
 * clear that they need the lower tier first."
 */
export function upgradeLabel(spec: WeaponSpec): string {
  if (!spec.tier) return "Locked";
  return spec.tier === 1 ? "Tier 1" : `Tier ${spec.tier} Upgrade`;
}

/**
 * A thousand points to the dollar, which is the rate the wallet already prices
 * points at. So a point is a tenth of a cent, and what that is worth in DIVI
 * depends on what DIVI is worth.
 *
 * Geoff: "1000 points for $1 if Divi price is $0.001 so each point can be worth
 * more if the value of Divi goes up." At a tenth of a cent per DIVI the two
 * numbers are the same; at a cent, a gun costs a tenth of the DIVI it did.
 */
export const USD_PER_POINT = 0.001;

/**
 * What a weapon costs in DIVI, or null when there is no price to work from.
 *
 * NULL RATHER THAN A GUESS. The wallet's standing rule is that DIVI is priced
 * from CoinMarketCap and from nothing else, and that no price means no number
 * shown. A store that invented a DIVI price would be asking somebody to spend
 * real money against a figure this app made up.
 */
export function priceInDivi(points: number, diviUsd: number | null): number | null {
  if (!diviUsd || !Number.isFinite(diviUsd) || diviUsd <= 0) return null;
  return (points * USD_PER_POINT) / diviUsd;
}
