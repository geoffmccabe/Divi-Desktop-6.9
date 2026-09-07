// Trading history / P&L, rebuilt from the exchange's own filled-order record.
// This answers "where did my money go": it totals every buy and sell, shows the
// average prices (buying above your selling average is a losing market), and the
// overall result including whatever inventory you're still holding.

import { useEffect, useState } from "react";
import { mmTradeHistory, type TradePnl } from "../api";
import type { Exchange } from "../exchanges";
import "./trade-pnl.css";

const usd = (n: number) => "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const px = (n: number) => "$" + n.toLocaleString(undefined, { maximumFractionDigits: 7 });
const num = (n: number) => Math.round(n).toLocaleString();
const when = (ms: number) => (ms > 0 ? new Date(ms).toLocaleDateString() : "-");

export function TradePnlPanel({ ex, symbol }: { ex: Exchange; symbol: string }) {
  const [p, setP] = useState<TradePnl | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true); setErr(null);
    mmTradeHistory(ex.slug, ex.connector_type, ex.rest_url ?? "", symbol)
      .then((r) => { setP(r); setErr(null); })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  };
  // Load once when the pair is known; refresh is manual (it's a heavier call).
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ex.slug, symbol]);

  const boughtHighSoldLow = !!p && p.avgBuy > 0 && p.avgSell > 0 && p.avgBuy > p.avgSell;

  return (
    <section className="ts-section tp-panel">
      <div className="tp-head">
        <h3 className="ts-head">Trading history (P&amp;L)</h3>
        <button type="button" className="wl-link" disabled={loading} onClick={load}>{loading ? "…" : "Refresh"}</button>
      </div>

      {err && <p className="wl-note mmc-err">Couldn't read your trade history: {err}</p>}
      {!p && !err && <p className="wl-note">Reading your fills from the exchange…</p>}

      {p && (
        <>
          <p className="wl-note tp-sub">
            {p.fills} filled orders ({p.buys} buys, {p.sells} sells) from {when(p.firstMs)} to {when(p.lastMs)}.
          </p>

          <div className="tp-grid">
            <div className="tp-row"><span>Bought</span><span>{num(p.diviBought)} DIVI for {usd(p.usdtSpent)} <em>avg {px(p.avgBuy)}</em></span></div>
            <div className="tp-row"><span>Sold</span><span>{num(p.diviSold)} DIVI for {usd(p.usdtRecv)} <em>avg {px(p.avgSell)}</em></span></div>
            <div className="tp-row"><span>Net DIVI</span><span>{p.netDivi >= 0 ? "+" : ""}{num(p.netDivi)} DIVI (worth {usd(p.netDivi * p.mid)} now)</span></div>
            <div className="tp-row"><span>Cash from trading</span><span className={p.netUsdt < 0 ? "tp-neg" : "tp-pos"}>{p.netUsdt >= 0 ? "+" : ""}{usd(p.netUsdt)} USDT</span></div>
            <div className="tp-row"><span>Gross volume traded</span><span>{usd(p.grossVolume)}</span></div>
            <div className="tp-row tp-total"><span>Total result (incl. inventory)</span><span className={p.totalPnl < 0 ? "tp-neg" : "tp-pos"}>{p.totalPnl >= 0 ? "+" : ""}{usd(p.totalPnl)}</span></div>
          </div>

          {boughtHighSoldLow && (
            <p className="wl-note tp-warn">
              Your average buy ({px(p.avgBuy)}) is higher than your average sell ({px(p.avgSell)}): the bot bought higher
              than it sold, which is what a falling or choppy market does to a simple maker. That gap, not fees or anything
              leaving your account, is where the money went.
            </p>
          )}
        </>
      )}
    </section>
  );
}
