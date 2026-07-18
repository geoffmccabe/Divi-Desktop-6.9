// When the wallet asks for the password. Real security is the node's encryption;
// this governs how often the app makes you re-enter the password to SEND.
//   always → ask on every send, keep only staking-only unlock between sends
//   send   → ask on send (the natural default for a staker)
//   open   → fully unlocked; sends need no password (most convenient, least safe)
export type AskMode = "always" | "send" | "open";

const KEY = "dd69.askMode";

export function getAskMode(): AskMode {
  const v = localStorage.getItem(KEY);
  return v === "always" || v === "open" ? v : "send";
}

export function setAskMode(m: AskMode) {
  localStorage.setItem(KEY, m);
}
