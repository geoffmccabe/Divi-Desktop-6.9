// The vaulting fee "in-between step".
//
// The service is FREE at launch. This module is the seam that lets us switch on
// a monthly fee later without touching the rest of the panel: flip FEE_ENABLED
// to true and give it the real measured reward rate.
//
// How the fee is meant to work (Geoff's spec): estimate the reward a given
// vaulted amount is likely to earn, then bill a share of that (default 10%) as a
// flat monthly fee, quoted up front in DIVI. It is an ESTIMATE billed in
// advance, not a cut of actual rewards, so the number is known before the user
// commits.

// Master on/off switch. While false, every fee is 0 and the panel shows
// "Free during launch".
export const FEE_ENABLED = false;

// The share of expected reward we bill. 0.10 = 10%.
export const FEE_RATE = 0.1;

// Placeholder for the average annual staking reward rate, as a fraction of the
// vaulted amount (0.10 = 10% per year). THIS IS A GUESS and must be replaced
// with the real figure measured from the pool before FEE_ENABLED is turned on.
export const ASSUMED_ANNUAL_REWARD_RATE = 0.1;

// The estimated monthly fee, in DIVI, for a given vaulted amount.
// annualRate lets the caller pass the real measured rate once we have it;
// otherwise it falls back to the placeholder above.
export function estimateMonthlyFee(vaultedDivi: number, annualRate: number = ASSUMED_ANNUAL_REWARD_RATE): number {
  if (!FEE_ENABLED || vaultedDivi <= 0) return 0;
  const expectedMonthlyReward = (vaultedDivi * annualRate) / 12;
  return expectedMonthlyReward * FEE_RATE;
}

// A short label for the panel to show next to the fee.
export function feeLabel(vaultedDivi: number): string {
  if (!FEE_ENABLED) return "Free during launch";
  const fee = estimateMonthlyFee(vaultedDivi);
  return `${fee.toFixed(2)} DIVI / month`;
}
