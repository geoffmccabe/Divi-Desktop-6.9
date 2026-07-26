import { useSyncExternalStore } from "react";
import { mempoolSnapshot, txStatus } from "./api";

// Always-on watcher for incoming Fast Send payments. It polls this node's
// mempool for wallet-bound receives, then follows each one through
// confirmations, computing an HONEST, PRELIMINARY confidence rating from what a
// single node can actually see. The network-wide rating (DiviGossip / HushProof)
// is a later phase; every readout here is labelled as this-node-only.
//
// Detection is gated on the on-chain "DFS1" marker (mempool entry `fast`), so
// only a genuine sender-declared Fast Send lights up the chime/modal/orange
// treatment; an ordinary incoming payment stays a normal receive.

const POLL_MS = 2500;
const FULLY_CONFIRMED = 6; // Divi ~60s blocks → ~6 min to "fully confirmed"
const INSTANT_CAP = 1000; // above this, no high 0-conf confidence; wait a block
const RELAY_SATS_PER_BYTE = 10; // Divi relayfee 0.0001/kB; below this may not relay
const FAST_TXIDS_KEY = "dd69.fastTxids";

export type FastStatus = "incoming" | "confirming" | "confirmed" | "conflicted";

export interface RatingFactor {
  label: string;
  ok: boolean;
  note: string;
}
export interface FastRec {
  txid: string;
  amount: number;
  firstSeen: number; // ms, when THIS client first saw it
  feeSats: number;
  size: number;
  hasData: boolean;
  confirmations: number;
  status: FastStatus;
  score: number; // 0..10, preliminary/single-node
  tier: "checking" | "low" | "medium" | "high" | "confirmed" | "conflicted";
  factors: RatingFactor[];
  warnings: string[];
}

interface State {
  records: FastRec[];
  detectSeq: number; // bumps when a NEW arrival should chime + pop the modal
  latestTxid: string | null;
}
let state: State = { records: [], detectSeq: 0, latestTxid: null };

const byId = new Map<string, FastRec>();
let mempoolKnown = new Set<string>();
const listeners = new Set<() => void>();
let started = false;
let firstPoll = true;
let lastSig = "";

// Only rebuild the snapshot and wake React when something the UI cares about
// actually changed, so an idle wallet doesn't re-render every poll forever.
function emit() {
  const recs = [...byId.values()].sort((a, b) => b.firstSeen - a.firstSeen);
  const sig =
    state.detectSeq + "|" + recs.map((r) => `${r.txid}:${r.confirmations}:${r.score.toFixed(1)}:${r.status}`).join(",");
  if (sig === lastSig) return;
  lastSig = sig;
  state = { records: recs, detectSeq: state.detectSeq, latestTxid: state.latestTxid };
  for (const l of listeners) l();
}

function rememberFastTxid(txid: string) {
  try {
    const arr: string[] = JSON.parse(localStorage.getItem(FAST_TXIDS_KEY) || "[]");
    if (!arr.includes(txid)) {
      arr.push(txid);
      localStorage.setItem(FAST_TXIDS_KEY, JSON.stringify(arr.slice(-500)));
    }
  } catch {
    /* storage unavailable */
  }
}
export function isFastTxid(txid: string): boolean {
  try {
    const arr: string[] = JSON.parse(localStorage.getItem(FAST_TXIDS_KEY) || "[]");
    return arr.includes(txid);
  } catch {
    return false;
  }
}

// The honest, single-node rating. Conflict is decisive; otherwise confidence
// climbs with confirmations and is held down at 0-conf, by low fee, or by a
// large amount. Every rating carries the "this node only" caveat.
function rate(rec: FastRec) {
  const feePerByte = rec.size > 0 ? rec.feeSats / rec.size : 0;
  const healthyFee = feePerByte >= RELAY_SATS_PER_BYTE - 1;
  const bigAmount = rec.amount > INSTANT_CAP;
  const factors: RatingFactor[] = [];
  const warnings: string[] = [];

  if (rec.confirmations < 0) {
    rec.status = "conflicted";
    rec.tier = "conflicted";
    rec.score = 0;
    rec.factors = [{ label: "Conflicting spend", ok: false, note: "A double-spend of these coins was seen." }];
    rec.warnings = ["Conflicting transaction detected. Do NOT treat this as received."];
    return;
  }

  factors.push({ label: "No conflict seen (this node)", ok: true, note: "No competing spend of these coins here." });
  factors.push({
    label: "Fee covers relay",
    ok: healthyFee,
    note: `${feePerByte.toFixed(1)} sat/byte${healthyFee ? "" : " — low"}`,
  });
  factors.push({ label: "Amount within instant range", ok: !bigAmount, note: bigAmount ? `over ${INSTANT_CAP} DIVI` : "small payment" });
  factors.push({ label: "Confirmations", ok: rec.confirmations >= 1, note: `${rec.confirmations}` });

  let score: number;
  if (rec.confirmations >= FULLY_CONFIRMED) {
    rec.status = "confirmed";
    score = 10;
  } else if (rec.confirmations >= 2) {
    rec.status = "confirming";
    score = 9;
  } else if (rec.confirmations >= 1) {
    rec.status = "confirming";
    score = 8;
  } else {
    rec.status = "incoming";
    score = 7; // 0-conf ceiling on a single node — never "certain"
    if (!healthyFee) {
      score -= 3;
      warnings.push("Low fee: may confirm slowly or be dropped from mempools.");
    }
    if (bigAmount) {
      score = Math.min(score, 5);
      warnings.push("Large amount: wait for at least one confirmation before releasing goods.");
    }
  }
  rec.score = Math.max(0, Math.min(10, score));
  rec.factors = factors;
  rec.warnings = warnings;
  rec.tier =
    rec.status === "confirmed" ? "confirmed" : rec.score >= 8 ? "high" : rec.score >= 6 ? "medium" : "low";
}

async function poll() {
  try {
    const snap = await mempoolSnapshot([...mempoolKnown]);
    if (snap) {
      for (const e of snap.entries) {
        if (e.decoded && e.mine && e.category === "receive" && e.fast && !byId.has(e.txid)) {
          const rec: FastRec = {
            txid: e.txid,
            amount: Math.abs(e.amountMine || 0),
            firstSeen: Date.now(),
            feeSats: e.feeSats,
            size: e.size,
            hasData: e.hasData,
            confirmations: 0,
            status: "incoming",
            score: 0,
            tier: "checking",
            factors: [],
            warnings: [],
          };
          rate(rec);
          byId.set(e.txid, rec);
          rememberFastTxid(e.txid);
          // First poll after launch: adopt any already-pending payment quietly,
          // no chime/modal. Only genuinely new arrivals alert.
          if (!firstPoll) {
            state.detectSeq++;
            state.latestTxid = e.txid;
          }
        } else if (byId.has(e.txid)) {
          const rec = byId.get(e.txid)!;
          rec.feeSats = e.feeSats;
          rec.size = e.size;
        }
      }
      // Bound the "already classified" set to what's actually in the mempool
      // now, so it can't grow without limit over a long-running session.
      mempoolKnown = new Set(snap.entries.map((e) => e.txid));
    }
    // Follow confirmations for every record that isn't finished.
    for (const rec of byId.values()) {
      if (rec.status === "confirmed" || rec.status === "conflicted") continue;
      const s = await txStatus(rec.txid);
      if (s.found) rec.confirmations = s.confirmations;
      rate(rec);
    }
    // Prune fully-confirmed records older than 10 minutes so the list stays tidy.
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [id, rec] of [...byId.entries()]) {
      if (rec.status === "confirmed" && rec.firstSeen < cutoff) byId.delete(id);
    }
  } catch {
    /* keep last */
  }
  firstPoll = false;
  emit();
}

// Self-scheduling loop: the next poll is only queued AFTER the current one
// finishes, so a slow node can never stack overlapping polls (which would
// hammer it with a growing backlog of RPC calls).
export function startFastReceive() {
  if (started) return;
  started = true;
  const loop = async () => {
    await poll();
    setTimeout(loop, POLL_MS);
  };
  loop();
}

export function useFastReceive(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export function getRecord(txid: string | null): FastRec | undefined {
  return txid ? byId.get(txid) : undefined;
}
