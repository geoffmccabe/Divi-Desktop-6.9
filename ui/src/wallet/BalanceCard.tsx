import { useEffect, useState } from "react";
import { walletBalance, type Balance } from "./api";
import { fmtDivi } from "../status";
import { useDiviValue } from "./value";

export function BalanceCard() {
  const [b, setB] = useState<Balance | null>(null);
  const spendableUsd = useDiviValue(b ? b.spendable : null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const v = await walletBalance();
        if (alive) setB(v);
      } catch {
        /* node busy — keep last value */
      }
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="balance-cards">
      <div className="balance-card">
        <span className="bl-label">Spendable</span>
        <span className="bl-amt">
          {b ? fmtDivi(b.spendable) : "—"} <em>DIVI</em>
        </span>
        {spendableUsd.state === "ok" ? (
          <span className="bl-usd">= {spendableUsd.value} {spendableUsd.code}</span>
        ) : (
          <span className="bl-usd" style={{ fontSize: "0.7rem", opacity: 0.7 }}>
            [{spendableUsd.state}
            {spendableUsd.state === "unavailable" ? `: ${spendableUsd.reason}` : ""}]
          </span>
        )}
      </div>
      <div className="balance-card">
        <span className="bl-label">Staking</span>
        <span className="bl-amt">
          {b ? fmtDivi(b.staking) : "—"} <em>DIVI</em>
        </span>
      </div>
      {b && (b.pending > 0 || b.immature > 0) && (
        <div className="bl-sub">
          {b.pending > 0 && <span>{fmtDivi(b.pending)} pending</span>}
          {b.immature > 0 && <span>{fmtDivi(b.immature)} maturing</span>}
        </div>
      )}
    </div>
  );
}
