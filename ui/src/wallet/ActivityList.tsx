import { useEffect, useRef, useState } from "react";
import { openUrl, explorerTxUrl, type Tx } from "./api";
import { useTransactions, type TxStatus } from "./useTransactions";
import { confDisplay } from "./confirmations";
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
  // Flash the confirmation count gold each time a new confirmation lands.
  const prevConf = useRef(t.confirmations);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (t.confirmations > prevConf.current && t.confirmations >= 1 && prevConf.current >= 0) {
      setFlash(true);
      const id = setTimeout(() => setFlash(false), 3000);
      prevConf.current = t.confirmations;
      return () => clearTimeout(id);
    }
    prevConf.current = t.confirmations;
  }, [t.confirmations]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(t.txid);
    } catch {
      /* clipboard unavailable */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  // Receive lifecycle: in the mempool (0 conf) → INCOMING; in a block → RECEIVED.
  const isReceive = t.kind === "receive";
  const conf = confDisplay(t.confirmations, t.kind);
  const inMempool = conf.state === "mempool";
  // Orphaned/conflicted: it never made it into the chain, so it must not be
  // dressed up as money earned. Grey it out and strike the amount through.
  const dead = conf.state === "orphaned" || conf.state === "conflicted";
  const deadStyle = { color: "hsl(var(--muted-foreground))" };

  return (
    <li className="activity-row">
      <div className="act-top">
        {isReceive ? (
          <span
            className={"act-kind act-big " + (dead ? "" : inMempool ? "act-incoming" : "act-received")}
            style={dead ? deadStyle : undefined}
          >
            {dead ? "TRANSACTION CONFLICTED" : inMempool ? "INCOMING TRANSACTION" : "TRANSACTION RECEIVED"}
          </span>
        ) : t.kind === "stake" ? (
          <span className={dead ? "act-kind" : "act-kind act-stake-earned"} style={dead ? deadStyle : undefined}>
            {dead ? "Stake Orphaned" : "Stake Earned!"}
          </span>
        ) : (
          <span className={"act-kind act-" + t.kind} style={dead ? deadStyle : undefined}>
            {KIND_LABEL[t.kind] ?? "Transaction"}
          </span>
        )}
        <span
          className={dead ? "act-amt" : "act-amt " + (t.amount < 0 ? "neg" : "pos")}
          style={dead ? { ...deadStyle, textDecoration: "line-through" } : undefined}
        >
          {t.amount > 0 ? "+" : ""}
          {fmtDivi(t.amount)} DIVI
        </span>
      </div>
      {t.address && <div className="act-addr-full">{t.address}</div>}
      <div className="act-bottom">
        <span className="act-time">
          {relTime(t.time)} ·{" "}
          {/* Every kind of row now reads off the same scale, so a stake and a
              receive at the same depth can't show different numbers. */}
          <span
            className={"act-conf" + (flash && conf.settled ? " act-conf-flash" : "")}
            style={dead ? deadStyle : undefined}
          >
            {conf.text}
          </span>
        </span>
        <span className="act-actions">
          <button type="button" className="icon-btn" title={copied ? "Copied!" : "Copy transaction ID"} onClick={copy}>
            <Icon name="copy" size={14} />
          </button>
          <button type="button" className="icon-btn" title="View in Divi Love Scan" onClick={() => openUrl(explorerTxUrl(t.txid))}>
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
