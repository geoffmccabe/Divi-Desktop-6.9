import { useState } from "react";
import { openUrl, explorerTxUrl, type Tx } from "./api";
import { useTransactions, type TxStatus } from "./useTransactions";
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
      /* clipboard unavailable */
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
          <button type="button" className="icon-btn" title={copied ? "Copied!" : "Copy transaction ID"} onClick={copy}>
            <Icon name="copy" size={14} />
          </button>
          <button type="button" className="icon-btn" title="View on block explorer" onClick={() => openUrl(explorerTxUrl(t.txid))}>
            <Icon name="external" size={14} />
          </button>
        </span>
      </div>
    </li>
  );
}

function statusText(s: TxStatus, n: number): string {
  switch (s.state) {
    case "loading":
      return "Loading your transactions…";
    case "checking":
      return "Checking for new transactions…";
    case "parsing":
      return `Parsing ${(s.count ?? 0).toLocaleString()} transactions…`;
    case "syncing":
      return "The node is syncing — showing saved transactions…";
    case "unreachable":
      return "Can't reach the blockchain right now — showing saved transactions.";
    case "uptodate":
      return `Up to date · ${n.toLocaleString()} transactions`;
  }
}

export function ActivityList() {
  const { txs, status, refresh } = useTransactions();
  const bad = status.state === "unreachable";
  const ok = status.state === "uptodate";
  const working = status.state === "loading" || status.state === "checking" || status.state === "parsing" || status.state === "syncing";
  const dotClass = "conn-dot" + (bad ? " bad" : ok ? " ok" : "");

  return (
    <div className="activity-wrap">
      <div className="activity-head">
        <span className={"activity-status" + (bad ? " bad" : "")}>
          <span className={dotClass} />
          {statusText(status, txs.length)}
        </span>
        <button
          type="button"
          className={"icon-btn" + (working ? " spinning" : "")}
          title="Refresh transactions"
          onClick={refresh}
        >
          <Icon name="refresh" size={15} />
        </button>
      </div>
      <ul className="activity">
        {txs.map((t, i) => (
          <Row key={t.txid + i} t={t} />
        ))}
        {ok && txs.length === 0 && <li className="wl-empty">No transactions yet.</li>}
      </ul>
    </div>
  );
}
