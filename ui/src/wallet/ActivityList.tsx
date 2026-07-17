import { useEffect, useState } from "react";
import { recentActivity, type Tx } from "./api";
import { fmtDivi, relTime, truncMiddle } from "../status";

const KIND_LABEL: Record<string, string> = {
  receive: "Received",
  send: "Sent",
  stake: "Stake reward",
  other: "Transaction",
};

export function ActivityList() {
  const [txs, setTxs] = useState<Tx[] | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const v = await recentActivity();
        if (alive) setTxs(v);
      } catch {
        if (alive && txs === null) setTxs([]);
      }
    };
    poll();
    const id = setInterval(poll, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (txs === null) return <p className="wl-empty">Loading activity…</p>;
  if (txs.length === 0) return <p className="wl-empty">No transactions yet.</p>;

  return (
    <ul className="activity">
      {txs.map((t, i) => (
        <li key={t.txid + i}>
          <span className={"act-kind act-" + t.kind}>{KIND_LABEL[t.kind] ?? "Transaction"}</span>
          <span className="act-addr">{truncMiddle(t.address || t.txid)}</span>
          <span className={"act-amt " + (t.amount < 0 ? "neg" : "pos")}>
            {t.amount > 0 ? "+" : ""}
            {fmtDivi(t.amount)}
          </span>
          <span className="act-time">
            {relTime(t.time)}
            {t.confirmations < 6 ? ` · ${t.confirmations} conf` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
