// Manual trade panel: mirrors the exchange for this pair. Shows the live order
// book, lets the user place market or limit buys/sells (run through the API), and
// lists their open orders with a cancel button. Every DIVI amount shows its USD
// value at the current price so the user can't fat-finger a trade. Styled to match
// the Market Maker panels. Running manual orders can compete with the market maker
// for the same balance, which is expected.

import { useEffect, useState } from "react";
import { mmBook, mmOpenOrders, mmPlaceOrder, mmCancelOrder, type MmBook, type ManualOrder } from "../api";
import type { Exchange } from "../exchanges";
import "./trade-panel.css";

const fmtP = (n: number) => n.toFixed(7);
const fmtQ = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
const usd = (n: number) => "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function TradePanel({ ex, symbol }: { ex: Exchange; symbol: string }) {
  const [book, setBook] = useState<MmBook | null>(null);
  const [orders, setOrders] = useState<ManualOrder[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [otype, setOtype] = useState<"limit" | "market">("limit");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");

  const [base, quote] = symbol.replace("-", "/").split("/"); // DIVI, USDT

  const refreshOrders = () =>
    mmOpenOrders(ex.slug, ex.connector_type, ex.rest_url ?? "", symbol).then(setOrders).catch(() => {});

  useEffect(() => {
    let alive = true;
    const tick = () => {
      mmBook(ex.slug, ex.connector_type, ex.rest_url ?? "", symbol).then((b) => { if (alive) setBook(b); }).catch(() => {});
      if (alive) refreshOrders();
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex.slug, symbol]);

  const mid = book?.mid ?? 0;
  const q = parseFloat(qty) || 0;
  const p = parseFloat(price) || 0;
  const effPrice = otype === "limit" ? p : mid; // market uses the mid as an estimate
  const estTotal = q * effPrice; // USDT
  const availQuote = book?.quoteFree ?? 0; // USDT free
  const availBase = book?.baseFree ?? 0;   // DIVI free

  const canPlace = q > 0 && (otype === "market" || p > 0) && !busy && !!book;

  const place = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const id = await mmPlaceOrder(ex.slug, ex.connector_type, ex.rest_url ?? "", symbol, side, otype, q, otype === "limit" ? p : null);
      setMsg(`Order placed${id && id !== "ok" ? ` (${id.slice(0, 8)}…)` : ""}.`);
      setQty("");
      refreshOrders();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  const cancel = async (id: string) => {
    setBusy(true); setErr(null); setMsg(null);
    try { await mmCancelOrder(ex.slug, ex.connector_type, ex.rest_url ?? "", id); setOrders((o) => o.filter((x) => x.id !== id)); refreshOrders(); }
    catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  const asks = (book?.asks ?? []).slice(0, 8).slice().reverse(); // highest at top, best ask just above mid
  const bids = (book?.bids ?? []).slice(0, 8);                     // best bid just below mid

  const fillPrice = (pr: number) => { setOtype("limit"); setPrice(fmtP(pr)); };

  return (
    <section className="ts-section trade-panel">
      <h3 className="ts-head">Trade {base} / {quote}</h3>
      {!book && <p className="wl-note">Reading the live book…</p>}

      {book && (
        <div className="tr-grid">
          {/* Live order book */}
          <div className="tr-book">
            <div className="tr-book-head"><span>Price ({quote})</span><span>Size ({base})</span><span>Value</span></div>
            {asks.map((l, i) => (
              <button key={"a" + i} type="button" className="tr-brow tr-ask" onClick={() => fillPrice(l.price)}>
                <span>{fmtP(l.price)}</span><span>{fmtQ(l.size)}</span><span>{usd(l.price * l.size)}</span>
              </button>
            ))}
            <div className="tr-book-mid">mid {fmtP(mid)} <span>({usd(mid)}/{base})</span></div>
            {bids.map((l, i) => (
              <button key={"b" + i} type="button" className="tr-brow tr-bid" onClick={() => fillPrice(l.price)}>
                <span>{fmtP(l.price)}</span><span>{fmtQ(l.size)}</span><span>{usd(l.price * l.size)}</span>
              </button>
            ))}
          </div>

          {/* Order form */}
          <div className="tr-form">
            <div className="tr-seg">
              <button type="button" className={"tr-seg-btn tr-seg-buy" + (side === "buy" ? " on" : "")} onClick={() => setSide("buy")}>Buy</button>
              <button type="button" className={"tr-seg-btn tr-seg-sell" + (side === "sell" ? " on" : "")} onClick={() => setSide("sell")}>Sell</button>
            </div>
            <div className="tr-seg">
              <button type="button" className={"tr-seg-btn" + (otype === "limit" ? " on" : "")} onClick={() => setOtype("limit")}>Limit</button>
              <button type="button" className={"tr-seg-btn" + (otype === "market" ? " on" : "")} onClick={() => setOtype("market")}>Market</button>
            </div>

            {otype === "limit" && (
              <label className="value-field">
                <span className="send-label">Price ({quote})</span>
                <input className="wl-input" type="number" min={0} step="any" value={price} placeholder={mid ? fmtP(mid) : "0.0"} onChange={(e) => setPrice(e.target.value)} />
              </label>
            )}

            <label className="value-field">
              <span className="send-label">Amount ({base}) <em className="tr-usd">{q > 0 ? `= ${usd(q * (effPrice || mid))}` : `= ${usd(0)}`}</em></span>
              <input className="wl-input" type="number" min={0} step="any" value={qty} placeholder="0" onChange={(e) => setQty(e.target.value)} />
            </label>

            <div className="tr-summary">
              <div><span>Order value</span><span>{usd(estTotal)}{otype === "market" ? " (est.)" : ""}</span></div>
              <div><span>Available</span><span>{side === "buy" ? `${usd(availQuote)} ${quote}` : `${fmtQ(availBase)} ${base} (${usd(availBase * mid)})`}</span></div>
            </div>

            <button type="button" className={"wl-btn tr-place tr-place-" + side} disabled={!canPlace} onClick={place}>
              {busy ? "…" : `${side === "buy" ? "Buy" : "Sell"} ${base}${otype === "market" ? " at market" : ""}`}
            </button>
            {otype === "market" && <p className="wl-note tr-note">Market orders fill immediately at the best available price, which can differ from the estimate.</p>}
            {err && <p className="wl-note mmc-err">{err}</p>}
            {msg && <p className="wl-note tr-ok">{msg}</p>}
          </div>
        </div>
      )}

      {/* Open orders */}
      <div className="tr-open">
        <h4 className="tr-open-head">Your open orders</h4>
        {orders.length === 0 ? (
          <p className="wl-note">No open orders on this pair.</p>
        ) : (
          orders.map((o) => (
            <div key={o.id} className="tr-order">
              <span className={o.side === "buy" ? "tr-buy" : "tr-sell"}>{o.side} {o.orderType}</span>
              <span className="tr-order-detail">{fmtQ(o.qty)} {base} @ {fmtP(o.price)} = {usd(o.qty * o.price)}</span>
              <button type="button" className="wl-link" disabled={busy} onClick={() => cancel(o.id)}>Cancel</button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
