// What a point is worth, and what a bundle of them costs.
//
// One idea holds the whole file together: a point is a fixed amount of MONEY WE
// CHARGE, never a fixed amount of model usage. Model prices change; the point
// does not. So a price rise makes a turn cost more points, and never quietly
// makes every balance in the system worth less.
//
//   1000 points = $1.00 charged to the developer
//   we charge twice what the tokens cost us (MARKUP)
//
// So a turn that costs us $0.05 charges $0.10, which is 100 points.
//
// The bundles are DATA, deliberately. Adding a fourth is a line in TIERS, not a
// code change anywhere else: the panel renders whatever is here, and the
// purchase flow prices whatever it is handed.

/** Points per dollar CHARGED. Fixed forever; changing it revalues every balance. */
export const POINTS_PER_USD = 1000;

/** What we charge over what we pay. Geoff's number. */
export const MARKUP = 2;

/**
 * The bundles offered in the buy panel.
 *
 * `discountPercent` compounds per 10x step (0, 20, then 20% off that again =
 * 36%), which keeps the reward for buying bigger consistent rather than picked
 * out of the air. Add tiers freely; nothing below reads the length of this list.
 */
export const TIERS = [
  {
    id: "starter",
    name: "Starter",
    points: 1_000,
    discountPercent: 0,
    blurb: "A few small builds.",
  },
  {
    id: "builder",
    name: "Builder",
    points: 10_000,
    discountPercent: 20,
    blurb: "Ten times the points, twenty percent off.",
  },
  {
    id: "studio",
    name: "Studio",
    points: 100_000,
    discountPercent: 36,
    blurb: "Best value, for building all week.",
  },
];

export class PointsError extends Error {}

/** Points charged for something that costs us `usd`. Always rounded up, never in our favour by accident. */
export function pointsForCostUsd(usd) {
  if (!(Number(usd) >= 0)) throw new PointsError("cost must be a number");
  return Math.ceil(usd * MARKUP * POINTS_PER_USD);
}

/** The dollar value of a points balance, at what we charge. */
export function usdForPoints(points) {
  return (Number(points) || 0) / POINTS_PER_USD;
}

/**
 * Price one tier.
 *
 * `diviPerUsd` is an admin-set number, never a live feed: DIVI price
 * aggregators disagree by roughly 4.5x because they track different illiquid
 * venues, so billing off a feed would be indefensible.
 */
export function priceTier(tier, diviPerUsd) {
  if (!(diviPerUsd > 0)) throw new PointsError("the DIVI rate has not been set");
  const listUsd = tier.points / POINTS_PER_USD;
  const usd = listUsd * (1 - (tier.discountPercent || 0) / 100);
  return {
    id: tier.id,
    name: tier.name,
    blurb: tier.blurb,
    points: tier.points,
    discountPercent: tier.discountPercent || 0,
    listUsd: round8(listUsd),
    usd: round8(usd),
    divi: round8(usd * diviPerUsd),
    // What a point costs in this bundle, so the panel can show honest value.
    diviPerPoint: round8((usd * diviPerUsd) / tier.points),
  };
}

export function priceCatalogue(diviPerUsd, tiers = TIERS) {
  return tiers.map((t) => priceTier(t, diviPerUsd));
}

export function findTier(id, tiers = TIERS) {
  return tiers.find((t) => t.id === id) ?? null;
}

/** DIVI carries 8 decimals; anything finer is not representable on chain. */
export function round8(n) {
  return Math.round((Number(n) || 0) * 1e8) / 1e8;
}
