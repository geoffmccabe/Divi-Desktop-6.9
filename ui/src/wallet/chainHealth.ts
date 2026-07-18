// Chain-health bookkeeping.
//
// The node's own fork list (getchaintips) lives in memory and starts empty at
// every restart, so on its own it can never answer "are forks getting worse?".
// This module keeps our own copy on disk and merges each poll into it, so the
// history outlives node restarts and slowly becomes worth reading.
//
// What the two statuses mean, because the distinction is the useful part:
//   valid-fork    — our node actually followed this branch, then rolled back.
//                   That was a real reorg for us.
//   valid-headers — we saw a competing block's headers but never switched to it.
//                   Someone else's race, witnessed from the outside.

import type { OrphanReport } from "./api";

const KEY = "dd69.chainHealth";

export interface SeenFork {
  height: number;
  status: string;
  branchLen: number;
  /** When THIS APP first saw it — getchaintips carries no timestamps. */
  firstSeen: number;
}

export interface ChainHealthStore {
  forks: SeenFork[];
  minTip: number;
  maxTip: number;
  since: number;
}

const empty = (): ChainHealthStore => ({ forks: [], minTip: 0, maxTip: 0, since: Date.now() });

export function loadHealth(): ChainHealthStore {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && Array.isArray(s.forks)) return s;
  } catch {
    /* fall through */
  }
  return empty();
}

function save(s: ChainHealthStore) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full */
  }
}

/** Fold a fresh poll into the stored history. Returns the updated store. */
export function mergeHealth(report: OrphanReport, prev = loadHealth()): ChainHealthStore {
  const now = Date.now();
  const byHeight = new Map(prev.forks.map((f) => [f.height, f]));
  for (const s of report.stale) {
    const old = byHeight.get(s.height);
    byHeight.set(s.height, {
      height: s.height,
      // A branch can be upgraded from headers-only to fully-validated once our
      // node follows it, so let the status and length move forward.
      status: s.status,
      branchLen: Math.max(s.branchLen, old?.branchLen ?? 0),
      firstSeen: old?.firstSeen ?? now,
    });
  }
  // The window this rate is measured over.
  //
  // Getting this wrong cries wolf. The node hands us every fork it remembers —
  // a whole batch at once on the first read — but those happened over ITS
  // history, not ours. Starting our window at the current tip would divide a
  // pile of inherited forks by a handful of freshly-watched blocks and report
  // something like 6%, tripping the "elevated" warning on a perfectly healthy
  // chain. So seed the window with the node's own span (tip back to its oldest
  // known fork) and never let it move down afterwards — a resyncing node would
  // otherwise drag it toward genesis and bury a real problem in a huge divisor.
  const seed = report.span > 0 ? report.tip - report.span : report.tip;
  const forks = [...byHeight.values()].sort((a, b) => b.height - a.height);
  // The window must at least reach back to the oldest fork we know about, or we
  // divide those forks by a window that never contained them. This also repairs
  // a store written before that was understood, which read 15% on a chain
  // actually running at 0.7%.
  const oldestFork = forks.length ? forks[forks.length - 1].height : 0;
  const base = prev.minTip > 0 ? prev.minTip : Math.max(0, seed);
  const minTip = oldestFork > 0 ? Math.min(base, oldestFork) : base;
  const next: ChainHealthStore = {
    // Cap the history so this can't grow without bound in local storage.
    forks: forks.slice(0, 500),
    minTip,
    maxTip: Math.max(prev.maxTip, report.tip),
    since: prev.since || now,
  };
  save(next);
  return next;
}

export type Verdict = "unknown" | "normal" | "elevated" | "watch" | "serious";

export interface HealthStats {
  observedBlocks: number;
  forkCount: number;
  followed: number; // reorgs that actually moved our node
  witnessed: number; // races we only saw from outside
  deepest: number;
  ratePct: number;
  depths: Array<[number, number]>; // [branchLen, count]
  verdict: Verdict;
  verdictText: string;
}

// Below this we simply don't claim to know anything. A handful of blocks can
// produce a wild-looking percentage that means nothing.
const MIN_BLOCKS = 200;

export function healthStats(s: ChainHealthStore): HealthStats {
  const observedBlocks = Math.max(0, s.maxTip - s.minTip);
  const forkCount = s.forks.length;
  const followed = s.forks.filter((f) => f.status.includes("fork")).length;
  const deepest = s.forks.reduce((m, f) => Math.max(m, f.branchLen), 0);
  const ratePct = observedBlocks > 0 ? (forkCount * 100) / observedBlocks : 0;

  const hist = new Map<number, number>();
  for (const f of s.forks) hist.set(f.branchLen, (hist.get(f.branchLen) ?? 0) + 1);

  let verdict: Verdict = "normal";
  let verdictText = "Normal — short races between stakers, which is how a fast chain behaves.";
  if (observedBlocks < MIN_BLOCKS) {
    verdict = "unknown";
    verdictText = "Not enough observed yet to judge. Leave the wallet running and this fills in.";
  } else if (deepest >= 6) {
    verdict = "serious";
    verdictText = "A fork 6+ blocks deep was seen. That is well beyond normal — worth investigating.";
  } else if (deepest >= 3) {
    verdict = "watch";
    verdictText = "Forks deeper than a single block have appeared. Worth keeping an eye on.";
  } else if (ratePct > 3) {
    verdict = "elevated";
    verdictText = "More forking than usual, which can point to block-propagation trouble.";
  }

  return {
    observedBlocks,
    forkCount,
    followed,
    witnessed: forkCount - followed,
    deepest,
    ratePct,
    depths: [...hist.entries()].sort((a, b) => a[0] - b[0]),
    verdict,
    verdictText,
  };
}
