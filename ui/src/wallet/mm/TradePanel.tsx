// Manual trade panel: mirrors the exchange for this pair. Shows the live order
// book, lets the user place market or limit buys/sells (run through the API), and
// lists their open orders with a cancel button. Every DIVI amount shows its USD
// value at the current price so the user can't fat-finger a trade. Styled to match
// the Market Maker panels. Running manual orders can compete with the market maker
// for the same balance, which is expected.

import { useEffect, useMemo, useState } from "react";
import { mmBook, mmOpenOrders, mmPlaceOrder, mmCancelOrder, type MmBook, type BookLevel, type ManualOrder, type MmBalance } from "../api";
import type { Exchange } from "../exchanges";
import { FundsPanel } from "./FundsPanel";
import nonkycLogo from "../../assets/nonkyc.webp";
import "./trade-panel.css";

const DP = 7;
const fmtP = (n: number) => n.toFixed(DP);
const fmtQ = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
const usd = (n: number) => "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Price-grouping steps for the book, same idea as the depth planner's Decimals.
const GROUPS = [
  { v: 0.0000001, l: "0.0000001" },
  { v: 0.000001, l: "0.000001" },
  { v: 0.00001, l: "0.00001" },
  { v: 0.0001, l: "0.0001" },
];
// Snap a price to its bucket: sells round up, buys round down.
function groupPrice(price: number, group: number, side: "buy" | "sell"): number {
  if (group <= 0) return price;
  const u = price / group;
  const r = side === "sell" ? Math.ceil(u - 1e-9) : Math.floor(u + 1e-9);
  return Number((r * group).toFixed(DP));
}
// Aggregate raw book levels into grouped buckets, sorted for display.
function groupLevels(levels: BookLevel[], group: number, side: "buy" | "sell"): BookLevel[] {
  const m = new Map<number, number>();
  for (const l of levels) {
    const p = groupPrice(l.price, group, side);
    m.set(p, (m.get(p) ?? 0) + l.size);
  }
  const out = [...m.entries()].map(([price, size]) => ({ price, size }));
  out.sort((a, b) => (side === "sell" ? a.price - b.price : b.price - a.price));
  return out;
}

// The exchange rejects any order worth less than this, so we enforce it up front.
const MIN_ORDER_USDT = 1;

// Attach a running cumulative (DIVI and USD) from the best price outward, so a row
// answers "to fill up to here, this is how much size and how much money".
type CumLevel = BookLevel & { cumQty: number; cumUsd: number };
function withCumulative(levels: BookLevel[]): CumLevel[] {
  let cq = 0, cu = 0;
  return levels.map((l) => { cq += l.size; cu += l.price * l.size; return { ...l, cumQty: cq, cumUsd: cu }; });
}

// Filter icons: two bars, coloured for which side(s) show.
const BarsIcon = ({ top, bottom }: { top: string; bottom: string }) => (
  <svg width="15" height="15" viewBox="0 0 14 14" aria-hidden="true">
    <rect x="1" y="2" width="12" height="4" rx="1" fill={top} />
    <rect x="1" y="8" width="12" height="4" rx="1" fill={bottom} />
  </svg>
);
const RED = "#e05555";
const GREEN = "#26a17b"; // the USDT/Tether green, used for every green in this panel

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
  const [group, setGroup] = useState(GROUPS[0].v);            // book price grouping (Decimals)
  const [bookFilter, setBookFilter] = useState<"both" | "sells" | "buys">("both");
  // Balances are held as last-known-good: a balance read that momentarily fails
  // comes back all-zero, and we must NOT flash $0.00 - keep the previous figures
  // until a real new reading arrives.
  const [bals, setBals] = useState<{ bf: number; bh: number; qf: number; qh: number } | null>(null);

  const [base, quote] = symbol.replace("-", "/").split("/"); // DIVI, USDT

  const refreshOrders = () =>
    mmOpenOrders(ex.slug, ex.connector_type, ex.rest_url ?? "", symbol).then(setOrders).catch(() => {});

  useEffect(() => {
    let alive = true;
    const tick = () => {
      mmBook(ex.slug, ex.connector_type, ex.rest_url ?? "", symbol).then((b) => {
        if (!alive) return;
        if (b.asks.length || b.bids.length) setBook(b); // keep the last book if a read came back empty
        const total = b.baseFree + b.baseHeld + b.quoteFree + b.quoteHeld;
        if (total > 0) setBals({ bf: b.baseFree, bh: b.baseHeld, qf: b.quoteFree, qh: b.quoteHeld }); // ignore a transient 0 read
      }).catch(() => {});
      if (alive) refreshOrders();
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex.slug, symbol]);

  const mid = book?.mid ?? 0;
  const bestBid = book?.bestBid ?? mid;
  const bestAsk = book?.bestAsk ?? mid;
  const q = parseFloat(qty) || 0;
  const p = parseFloat(price) || 0;
  // For a market order the fill is at the far side of the spread (buy hits the
  // best ask, sell hits the best bid), so estimate against that, not the mid.
  const effPrice = otype === "limit" ? p : (side === "buy" ? bestAsk : bestBid);
  const estTotal = q * effPrice; // USDT
  const qf = bals?.qf ?? 0, qh = bals?.qh ?? 0, bf = bals?.bf ?? 0, bh = bals?.bh ?? 0;
  const availQuote = qf; // USDT free
  const availBase = bf;  // DIVI free
  // Reuse the existing Funds summary component rather than reinventing it. Held is
  // last-known-good, so it never flashes zero.
  const mmBals: MmBalance[] | null = bals
    ? [{ asset: quote, free: qf, locked: qh }, { asset: base, free: bf, locked: bh }]
    : null;

  // The exchange rejects orders worth under 1 USDT, so block it here with a clear
  // reason instead of letting the order fail at the exchange.
  const belowMin = q > 0 && effPrice > 0 && estTotal < MIN_ORDER_USDT;
  const canPlace = q > 0 && (otype === "market" || p > 0) && effPrice > 0 && !belowMin && !busy && !!book;

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

  // Group, attach the running cumulative from the best price, then choose what to
  // show. "both" is a compact 8 each side; a single-side filter shows ALL levels in
  // a scroll box so you can reach the far end of the book.
  const { asksToShow, bidsToShow } = useMemo(() => {
    const ga = withCumulative(groupLevels(book?.asks ?? [], group, "sell")); // best ask outward
    const gb = withCumulative(groupLevels(book?.bids ?? [], group, "buy"));  // best bid outward
    return {
      asksToShow: (bookFilter === "both" ? ga.slice(0, 8) : ga).slice().reverse(), // highest at top
      bidsToShow: bookFilter === "both" ? gb.slice(0, 8) : gb,
    };
  }, [book, group, bookFilter]);

  const fillPrice = (pr: number) => { setOtype("limit"); setPrice(fmtP(pr)); };

  return (
    <section className="ts-section trade-panel">
      {/* Exchange logo on the left, the standard Funds summary on the right. */}
      <div className="tr-topbar">
        {ex.connector_type === "nonkyc"
          ? <img className="tr-ex-logo-img" src={nonkycLogo} alt={ex.name} />
          : <div className="tr-ex-logo" aria-hidden="true">{(ex.name || "?").charAt(0).toUpperCase()}</div>}
        {mmBals && <FundsPanel symbol={symbol} bals={mmBals} />}
        <div className="tr-price">
          <span className="tr-price-label">{base} price</span>
          <span className="tr-price-main">{fmtP(mid)} {quote}</span>
          <span className="tr-price-usd">{usd(mid)}</span>
        </div>
      </div>

      {!book && <p className="wl-note">Reading the live book…</p>}

      {book && (
        <div className="tr-grid">
          {/* Live order book: side filter + decimals grouping, then the book. */}
          <div className="tr-book-wrap">
            <div className="tr-book-ctrls">
              <div className="tr-filter">
                <button type="button" title="Buys and sells" className={"tr-filter-btn" + (bookFilter === "both" ? " on" : "")} onClick={() => setBookFilter("both")}><BarsIcon top={RED} bottom={GREEN} /></button>
                <button type="button" title="Sells only" className={"tr-filter-btn" + (bookFilter === "sells" ? " on" : "")} onClick={() => setBookFilter("sells")}><BarsIcon top={RED} bottom={RED} /></button>
                <button type="button" title="Buys only" className={"tr-filter-btn" + (bookFilter === "buys" ? " on" : "")} onClick={() => setBookFilter("buys")}><BarsIcon top={GREEN} bottom={GREEN} /></button>
              </div>
              <label className="tr-decimals">Decimals
                <select className="tr-decimals-sel" value={group} onChange={(e) => setGroup(Number(e.target.value))}>
                  {GROUPS.map((g) => <option key={g.l} value={g.v}>{g.l}</option>)}
                </select>
              </label>
            </div>
            <div className={"tr-book" + (bookFilter !== "both" ? " tr-book-scroll" : "")}>
              <div className="tr-book-head"><span>Price</span><span>Size ({base})</span><span>Value</span><span>Total {base}</span><span>Total $</span></div>
              {bookFilter !== "buys" && asksToShow.map((l, i) => (
                <button key={"a" + i} type="button" className="tr-brow tr-ask" onClick={() => fillPrice(l.price)}>
                  <span>{fmtP(l.price)}</span><span>{fmtQ(l.size)}</span><span>{usd(l.price * l.size)}</span><span>{fmtQ(l.cumQty)}</span><span>{usd(l.cumUsd)}</span>
                </button>
              ))}
              <div className="tr-book-mid">mid {fmtP(mid)} <span>({usd(mid)}/{base})</span></div>
              {bookFilter !== "sells" && bidsToShow.map((l, i) => (
                <button key={"b" + i} type="button" className="tr-brow tr-bid" onClick={() => fillPrice(l.price)}>
                  <span>{fmtP(l.price)}</span><span>{fmtQ(l.size)}</span><span>{usd(l.price * l.size)}</span><span>{fmtQ(l.cumQty)}</span><span>{usd(l.cumUsd)}</span>
                </button>
              ))}
            </div>
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
              <div><span>Order value</span><span>
                {belowMin && <span className="tr-min">(Minimum {usd(MIN_ORDER_USDT)}) </span>}
                <span className={belowMin ? "tr-min" : ""}>{usd(estTotal)}{otype === "market" ? " (est.)" : ""}</span>
              </span></div>
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
            <div key={o.id} className={"tr-order" + (o.fromMm ? " tr-order-mm" : "")}>
              <span className={o.side === "buy" ? "tr-buy" : "tr-sell"}>{o.side} {o.orderType}</span>
              <span className="tr-order-detail">{fmtQ(o.qty)} {base} @ {fmtP(o.price)} = {usd(o.qty * o.price)}</span>
              <button type="button" className="wl-link" disabled={busy} onClick={() => cancel(o.id)}>Cancel</button>
              {o.fromMm && <span className="tr-mm-tag">Market Maker</span>}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
