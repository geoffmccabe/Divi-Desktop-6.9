// What a Proof-of-Existence anchor costs, and how that cost is divided.
//
// The price is quoted in USD and converted to DIVI at the current rate, so the
// cost stays stable in real terms as the DIVI price moves. It is then split:
// a share goes to the configured address, and the remainder is left unspent so
// the staker who mines the block collects it as the transaction fee — giving
// stakers a second revenue stream beyond block rewards.
//
// IMPORTANT: this split is a convention of this app, not a consensus rule. The
// chain neither knows nor enforces it, and anyone running modified software
// could anchor without paying it. It is a product decision, not a protocol one.

export interface PoePayoutSettings {
  /** Divi address receiving the configured share. Empty = no payout output. */
  address: string;
  /** What one anchor should cost, in USD. */
  targetUsd: number;
  /** Percentage of the cost sent to `address`; the rest becomes the staker fee. */
  payoutPercent: number;
}

const KEY = "dd69.poe.payout";

export const POE_PAYOUT_DEFAULTS: PoePayoutSettings = {
  address: "",
  targetUsd: 1,
  payoutPercent: 80,
};

export function getPoePayout(): PoePayoutSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && typeof v === "object") {
      const merged = { ...POE_PAYOUT_DEFAULTS, ...v };
      // Guard against hand-edited or corrupted values producing a nonsense split.
      if (!Number.isFinite(merged.targetUsd) || merged.targetUsd <= 0) {
        merged.targetUsd = POE_PAYOUT_DEFAULTS.targetUsd;
      }
      if (!Number.isFinite(merged.payoutPercent)) merged.payoutPercent = POE_PAYOUT_DEFAULTS.payoutPercent;
      merged.payoutPercent = Math.min(100, Math.max(0, merged.payoutPercent));
      return merged;
    }
  } catch {
    /* fall through to defaults */
  }
  return POE_PAYOUT_DEFAULTS;
}

export function setPoePayout(s: PoePayoutSettings) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export interface AnchorSplit {
  /** Total cost of the anchor in DIVI. */
  totalDivi: number;
  /** Portion sent to the configured address. */
  payoutDivi: number;
  /** Portion left as the transaction fee for the staker. */
  feeDivi: number;
}

/**
 * Works out the split for one anchor. Returns null when there's no usable price,
 * so callers show "cost unavailable" rather than inventing a figure.
 */
export function splitForAnchor(
  s: PoePayoutSettings,
  usdPerDivi: number | null,
  minFeeDivi = 0.0001,
): AnchorSplit | null {
  if (!usdPerDivi || !Number.isFinite(usdPerDivi) || usdPerDivi <= 0) return null;
  const totalDivi = s.targetUsd / usdPerDivi;
  // With no address configured the whole cost would otherwise vanish into the
  // fee; charge only the minimum instead, so an unconfigured wallet doesn't
  // quietly overpay stakers.
  if (!s.address.trim()) return { totalDivi: minFeeDivi, payoutDivi: 0, feeDivi: minFeeDivi };

  const payoutDivi = (totalDivi * s.payoutPercent) / 100;
  const feeDivi = Math.max(minFeeDivi, totalDivi - payoutDivi);
  return { totalDivi: payoutDivi + feeDivi, payoutDivi, feeDivi };
}
