import { useCallback, useEffect, useState } from "react";
import { hraBuy, hraDelist, hraMarket, type MarketListing } from "./api";

// Names Market: browse, buy, and manage your own listings.
//
// Buying with the native coin is the thing Counterparty and Omni never solved.
// Their dispensers let a seller take the payment and keep the asset, and their
// own lead maintainer called it "trivial for the seller to front-run the buyer
// and get free BTC". The design here closes that:
//
//   * A listing commits to a price AND a no-cancel window. The seller cannot
//     withdraw inside it, so a listing cannot be pulled out from under you.
//   * Buying is ONE transaction that pays and claims. The seller is not a
//     participant, so there is nothing for them to withhold.
//
// One risk remains and is stated on screen rather than buried: if two people
// pay in the same block, only one gets the name and the other has paid for
// nothing. An overlay cannot claw back a native coin payment. The wallet checks
// for a competing purchase immediately before broadcasting, which narrows the
// window to the moment of sending. That is a real reduction, not a fix.

export function NamesMarket({ canTrade, onChanged }: { canTrade: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<MarketListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(() => {
    hraMarket()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setErr("");
    setDone("");
    try {
      await fn();
      setDone("Sent. It takes effect once the transaction is in a block.");
      setConfirming(null);
      load();
      onChanged();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy("");
    }
  };

  if (loading && rows.length === 0) return <p className="wl-note">Looking…</p>;

  return (
    <div className="hra-market">
      <p className="wl-note">
        Names people have put up for sale. Buying is a single payment straight to the seller: there
        is no escrow and nobody holds your money in between.
      </p>

      {rows.length === 0 && (
        <p className="wl-note">
          Nothing is for sale yet. You can offer one of your own from the My Names tab.
        </p>
      )}

      {rows.map((r) => {
        const total = r.priceDivi + r.feeDivi;
        return (
          <article className="hra-mkt-row" key={r.name}>
            <div className="hra-mkt-main">
              <span className="mono hra-name">{r.name.toLowerCase()}</span>
              <span className="hra-mkt-price">{r.priceDivi.toLocaleString()} DIVI</span>
              {r.feeDivi > 0 && (
                <span className="wl-note">plus {r.feeDivi.toLocaleString()} DIVI market fee</span>
              )}
              {r.isMine && <span className="hra-badge">yours</span>}
            </div>

            <div className="hra-mkt-meta">
              <span className="wl-note">
                seller <span className="mono">{r.seller}</span>
              </span>
              {r.lockedForBlocks > 0 ? (
                <span className="hra-free">
                  cannot be withdrawn for {r.lockedForBlocks} more block
                  {r.lockedForBlocks === 1 ? "" : "s"}
                </span>
              ) : (
                <span className="wl-err">
                  the seller is now free to withdraw this at any time
                </span>
              )}
            </div>

            {r.isMine ? (
              <button
                className="wl-btn"
                disabled={busy !== ""}
                onClick={() => run(`delist:${r.name}`, () => hraDelist(r.name))}
              >
                {busy === `delist:${r.name}` ? "Removing…" : "Take off the market"}
              </button>
            ) : confirming === r.name ? (
              <div className="hra-mkt-confirm">
                <p className="send-warn">
                  Paying <strong>{total.toLocaleString()} DIVI</strong> to{" "}
                  <span className="mono">{r.seller}</span>. This cannot be undone.
                </p>
                <p className="wl-err">
                  If somebody else pays for this name in the same block, they get it and your
                  payment is gone. Your wallet checks a moment before sending, which makes that
                  unlikely but not impossible.
                </p>
                <div className="hra-actions">
                  <button className="wl-btn" onClick={() => setConfirming(null)} disabled={busy !== ""}>
                    Cancel
                  </button>
                  <button
                    className="wl-btn wl-btn-primary"
                    disabled={busy !== ""}
                    onClick={() => run(`buy:${r.name}`, () => hraBuy(r.name))}
                  >
                    {busy === `buy:${r.name}` ? "Buying…" : `Pay ${total.toLocaleString()} DIVI`}
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="wl-btn wl-btn-primary"
                disabled={!canTrade || busy !== ""}
                onClick={() => {
                  setErr("");
                  setDone("");
                  setConfirming(r.name);
                }}
              >
                Buy
              </button>
            )}
          </article>
        );
      })}

      {done && <p className="wl-note">{done}</p>}
      {err && <p className="wl-err">{err}</p>}

      <p className="wl-note hra-dim">
        Prices are whatever a seller asked for. Nobody vets them, and a name being expensive says
        nothing about whether it is worth anything.
      </p>
    </div>
  );
}
