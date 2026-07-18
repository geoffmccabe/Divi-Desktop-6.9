// The single place that turns a raw RPC confirmation count into what the user
// sees, so two rows at the same depth can never disagree with each other.
//
// Divi (like every Bitcoin-derived wallet) uses NEGATIVE confirmations to mean
// "this transaction conflicts with the chain". For a stake that means an
// orphaned block: our node minted it, another block beat it, and the reward was
// never really earned. Printing that number raw is where "-1 confirmations"
// came from.

export type ConfState = "orphaned" | "conflicted" | "mempool" | "counting" | "confirmed";

// Past this depth we stop counting and simply say "confirmed" — for every kind
// of transaction alike. Counting to 500,000 is noise, not information.
export const CONFIRMED_AT = 10;

export interface ConfDisplay {
  state: ConfState;
  text: string;
  /** Is it actually in the chain? False for mempool, orphaned and conflicted. */
  settled: boolean;
}

export function confDisplay(confirmations: number, kind?: string): ConfDisplay {
  if (!Number.isFinite(confirmations)) {
    return { state: "conflicted", text: "status unknown", settled: false };
  }
  if (confirmations < 0) {
    return kind === "stake"
      ? { state: "orphaned", text: "orphaned — this block lost the race", settled: false }
      : { state: "conflicted", text: "conflicted — not in the chain", settled: false };
  }
  if (confirmations === 0) {
    return { state: "mempool", text: "Unconfirmed", settled: false };
  }
  if (confirmations > CONFIRMED_AT) {
    return { state: "confirmed", text: "confirmed", settled: true };
  }
  // A transaction's own block counts as zero, so the number reads as "blocks
  // built on top of it" — 0 the moment it lands, 1 after the next block.
  const n = confirmations - 1;
  return { state: "counting", text: n === 1 ? "1 confirmation" : `${n} confirmations`, settled: true };
}
