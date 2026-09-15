import { useEffect, useState } from "react";
import { walletBalance, type Balance } from "./api";
import { nodeStatus } from "../bridge";
import { fmtDivi } from "../status";
import { useDiviValue } from "./value";

export function BalanceCard() {
  const [b, setB] = useState<Balance | null>(null);
  // A balance is only the WHOLE truth once the node has read the whole chain.
  // Until then the wallet has not yet seen the blocks that pay it, so a zero is
  // "not counted yet", not "you have nothing". Showing a confident 0.00 during
  // sync told a user his 10,000 DIVI had vanished when it was sitting safely on
  // chain, unspent, three thousand blocks deep.
  const [caughtUp, setCaughtUp] = useState<boolean | null>(null);
  const spendableUsd = useDiviValue(b && caughtUp !== false ? b.spendable : null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const v = await walletBalance();
        if (alive) setB(v);
      } catch {
        /* node busy — keep last value */
      }
      try {
        const s = await nodeStatus();
        if (alive) setCaughtUp(s.phase === "synced" || s.phase === "staking");
      } catch {
        /* leave the last answer rather than flapping the warning on and off */
      }
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Only worth saying while the number could still be wrong AND looks alarming.
  const syncing = caughtUp === false;

  return (
    <div className="balance-cards">
      <div className="balance-card">
        <span className="bl-label">Spendable</span>
        {/* While syncing we show NO figure at all. A number the node cannot yet
            stand behind is worse than no number: a zero reads as "your coins
            are gone" when they are on chain and simply not counted yet. */}
        {syncing ? (
          <span className="bl-amt bl-sync-amt">STILL SYNCING…</span>
        ) : (
          <span className="bl-amt">
            {b ? fmtDivi(b.spendable) : "—"} <em>DIVI</em>
          </span>
        )}
        {syncing ? (
          <span className="bl-syncing">
            Your node is still reading the chain. Coins already sent to you will
            appear here as it catches up.
          </span>
        ) : (
          /* The fiat line appears only when we have a real quote. No price
             means no line, rather than a zero that looks like a valuation. */
          spendableUsd.state === "ok" && (
            <span className="bl-usd">= {spendableUsd.value} {spendableUsd.code}</span>
          )
        )}
      </div>
      <div className="balance-card">
        <span className="bl-label">Staking</span>
        {syncing ? (
          <span className="bl-amt bl-sync-amt">STILL SYNCING…</span>
        ) : (
          <span className="bl-amt">
            {b ? fmtDivi(b.staking) : "—"} <em>DIVI</em>
          </span>
        )}
      </div>
      {/* Equally incomplete mid-sync, so it stays hidden too. */}
      {!syncing && b && (b.pending > 0 || b.immature > 0) && (
        <div className="bl-sub">
          {b.pending > 0 && <span>{fmtDivi(b.pending)} pending</span>}
          {b.immature > 0 && <span>{fmtDivi(b.immature)} maturing</span>}
        </div>
      )}
    </div>
  );
}
