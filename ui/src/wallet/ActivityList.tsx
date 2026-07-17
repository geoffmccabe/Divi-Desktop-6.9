import { useEffect, useRef, useState } from "react";
import { recentActivity, openUrl, explorerTxUrl, type Tx } from "./api";
import { nodeStatus } from "../bridge";
import { fmtDivi, relTime } from "../status";
import { Icon } from "../Icon";

const KIND_LABEL: Record<string, string> = {
  receive: "Received",
  send: "Sent",
  stake: "Stake Winner!",
  other: "Transaction",
};

function Row({ t }: { t: Tx }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(t.txid);
    } catch {
      /* clipboard may be unavailable */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <li className="activity-row">
      <div className="act-top">
        <span className={"act-kind act-" + t.kind}>{KIND_LABEL[t.kind] ?? "Transaction"}</span>
        <span className={"act-amt " + (t.amount < 0 ? "neg" : "pos")}>
          {t.amount > 0 ? "+" : ""}
          {fmtDivi(t.amount)} DIVI
        </span>
      </div>
      {t.address && <div className="act-addr-full">{t.address}</div>}
      <div className="act-bottom">
        <span className="act-time">
          {relTime(t.time)}
          {t.confirmations < 10 ? ` · ${t.confirmations} confirmations` : " · confirmed"}
        </span>
        <span className="act-actions">
          <button
            type="button"
            className="icon-btn"
            title={copied ? "Copied!" : "Copy transaction ID"}
            onClick={copy}
          >
            <Icon name="copy" size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="View on block explorer"
            onClick={() => openUrl(explorerTxUrl(t.txid))}
          >
            <Icon name="external" size={14} />
          </button>
        </span>
      </div>
    </li>
  );
}

export function ActivityList() {
  const [txs, setTxs] = useState<Tx[] | null>(null);
  const [connecting, setConnecting] = useState(true);
  const loadedOnce = useRef(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      // Keep the last-known list if a fetch fails (contended node) — never wipe
      // real transactions to an empty "none" state.
      try {
        const v = await recentActivity();
        if (alive) {
          setTxs(v);
          loadedOnce.current = true;
        }
      } catch {
        /* keep previous txs */
      }
      try {
        const s = await nodeStatus();
        if (alive) setConnecting(!(s.phase === "synced" || s.phase === "staking"));
      } catch {
        if (alive) setConnecting(true);
      }
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const list = txs ?? [];

  return (
    <ul className="activity">
      {connecting && (
        <li className="activity-row activity-connecting">
          <span className="conn-dot" />
          Connecting to the network for new transactions…
        </li>
      )}
      {list.map((t, i) => (
        <Row key={t.txid + i} t={t} />
      ))}
      {loadedOnce.current && list.length === 0 && !connecting && (
        <li className="wl-empty">No transactions yet.</li>
      )}
    </ul>
  );
}
