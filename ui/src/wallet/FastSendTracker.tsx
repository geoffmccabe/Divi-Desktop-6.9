import { useEffect, useReducer, useRef, useState } from "react";
import { txStatus, type TxStatus } from "./api";

// Live tracker shown after a Fast Send. It follows the payment on THIS node:
// broadcast, then sitting at 0 confirmations in the mempool, then confirming.
// It also watches for trouble: the daemon reports a conflicting (double-spent)
// wallet transaction with NEGATIVE confirmations, which we surface loudly.
//
// Honest scope for Phase 1: this is the sender's own node view. It proves the
// payment is alive and confirming (or flags a conflict). The network-wide
// confidence score is a later phase; nothing here should be read as one.

const POLL_MS = 2000;
const TARGET_CONF = 6; // stop polling once comfortably confirmed

export function FastSendTracker({ txid, broadcastAt }: { txid: string; broadcastAt: number }) {
  const [st, setSt] = useState<TxStatus | null>(null);
  const [, tick] = useReducer((x) => x + 1, 0);
  const doneRef = useRef(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const s = await txStatus(txid);
        if (!alive) return;
        setSt(s);
        if (s.confirmations >= TARGET_CONF) doneRef.current = true;
      } catch {
        /* keep last */
      }
      if (alive && !doneRef.current) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    // Second-by-second clock so the elapsed time ticks even between polls.
    const clock = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [txid]);

  const elapsed = Math.max(0, (Date.now() - broadcastAt) / 1000);
  const conf = st?.confirmations ?? 0;
  const conflicted = conf < 0;
  const confirmed = conf >= 1;

  const stage = conflicted ? "conflict" : confirmed ? "confirmed" : "mempool";

  return (
    <div className={"fst " + stage}>
      <div className="fst-row">
        <span className="fst-dot ok" />
        <span className="fst-step">Broadcast to the network</span>
        <span className="fst-time">0.0s</span>
      </div>

      <div className="fst-row">
        <span className={"fst-dot " + (conflicted ? "bad" : confirmed ? "ok" : "live")} />
        <span className="fst-step">
          {conflicted
            ? "Waiting to confirm"
            : confirmed
              ? "In the mempool"
              : "In the mempool (0 confirmations)"}
        </span>
        <span className="fst-time">{elapsed.toFixed(1)}s</span>
      </div>

      <div className="fst-row">
        <span className={"fst-dot " + (confirmed ? "ok" : "pending")} />
        <span className="fst-step">
          {confirmed ? `Confirmed · ${conf} confirmation${conf === 1 ? "" : "s"}` : "Waiting for first confirmation…"}
        </span>
      </div>

      {conflicted && (
        <div className="fst-conflict">
          ⚠ A conflicting transaction was detected for these coins. This payment may not confirm. Do not treat it as
          received.
        </div>
      )}

      {!confirmed && !conflicted && (
        <p className="fst-note">
          Blocks are about 60 seconds apart, so the first confirmation usually lands within a minute. This tracker
          shows your own node's view only.
        </p>
      )}
    </div>
  );
}
