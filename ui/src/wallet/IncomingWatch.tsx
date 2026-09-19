import { useEffect, useReducer, useRef } from "react";
import { mempoolSnapshot } from "./api";
import { playArrival } from "./tone";
import { fmtDivi } from "../status";

// Shown at the top of the Receive view. The moment the user opens Receive it
// scans this node's mempool for anything arriving to their wallet, and keeps
// scanning while open, so a payment in flight is surfaced immediately. Fast
// Sends (DFS1 marker) are called out; ordinary incoming payments are flagged
// too. A Pin Code incoming alert hooks in here once Pin Code Send defines its
// on-chain form (nothing to detect yet — it's still a stub).

interface Incoming {
  txid: string;
  amount: number;
  fast: boolean;
}

export function IncomingWatch() {
  const byId = useRef<Map<string, Incoming>>(new Map());
  const known = useRef<Set<string>>(new Set());
  const first = useRef(true);
  const [, force] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const scan = async () => {
      try {
        const snap = await mempoolSnapshot([...known.current]);
        if (snap && alive) {
          let freshPlain = false;
          for (const e of snap.entries) {
            if (e.decoded && e.mine && e.category === "receive" && !byId.current.has(e.txid)) {
              byId.current.set(e.txid, { txid: e.txid, amount: Math.abs(e.amountMine || 0), fast: e.fast });
              // Fast Sends already chime via the global modal; only ring the
              // bell here for an ordinary incoming payment, and never on the
              // first scan (adopting anything already pending, quietly).
              if (!first.current && !e.fast) freshPlain = true;
            }
          }
          // Drop anything that has left the mempool (confirmed or evicted).
          const live = new Set(snap.entries.map((x) => x.txid));
          for (const id of [...byId.current.keys()]) if (!live.has(id)) byId.current.delete(id);
          known.current = live;
          first.current = false;
          if (freshPlain) playArrival();
          force();
        }
      } catch {
        /* keep last */
      }
      if (alive) timer = setTimeout(scan, 3000);
    };
    scan();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const items = [...byId.current.values()];
  if (items.length === 0) {
    return <div className="rcv-watch idle">Watching the network for incoming payments…</div>;
  }
  return (
    <div className="rcv-watch">
      {items.map((i) => (
        <div key={i.txid} className={"rcv-watch-hit" + (i.fast ? " fast" : "")}>
          <span className="rcv-watch-badge">{i.fast ? "⚡ FAST SEND INCOMING" : "INCOMING PAYMENT"}</span>
          <span className="rcv-watch-amt">+{fmtDivi(i.amount)} DIVI</span>
          <span className="rcv-watch-note">detected in the mempool, not yet confirmed</span>
        </div>
      ))}
    </div>
  );
}
