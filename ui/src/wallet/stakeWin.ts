// A tiny shared signal: the block viz decides whether a block was won by the
// user (its stake winner is one of the node-wallet's addresses); the network map
// reads this to deck out our own node while the win is fresh.

let lastWinAt = 0;

export function markUserWon() {
  lastWinAt = Date.now();
}

/// True if the user won a block within the last `windowMs` (default ~2 blocks).
export function userWonRecently(windowMs = 120000): boolean {
  return lastWinAt > 0 && Date.now() - lastWinAt < windowMs;
}

// Whether the wallet should be staking — remembered so it auto-resumes on open
// (the user shouldn't have to restart staking every time they open the wallet).
const STAKING_KEY = "dd69.stakingDesired";
export function setStakingDesired(v: boolean) {
  try {
    localStorage.setItem(STAKING_KEY, v ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}
export function stakingDesired(): boolean {
  try {
    return localStorage.getItem(STAKING_KEY) === "1";
  } catch {
    return false;
  }
}
