// Live depth ladder for the market maker. One vertical stack centered on the mid:
// sells (red) above, buys (green) below. Each row is a price level; the bar length
// is the liquidity there (in USDT notional), with OUR share drawn bright over the
// rest (dim), so you can see how much of the market is yours. Orders the strategy
// WOULD place show as dashed "ghost" bars, so you see what it's about to do even
// before it runs. Polls a read-only snapshot every few seconds while visible.

import { useEffect, useMemo, useState } from "react";
import { mmBook, type MmBook, type BookLevel, type OpenOrder } from "../api";
import type { Exchange } from "../exchanges";
import "./depth-ladder.css";

const DP = 7; // NonKYC price precision
const PER_SIDE = 10; // buckets shown each side
const RAW_LEVELS = 80; // raw book levels pulled in before grouping
const key = (p: number) => p.toFixed(DP);
const notional = (price: number, size: number) => price * size;

// Price-grouping steps, like an exchange's order book. Default is the raw tick.
const GROUPS = [
  { v: 0.0000001, l: "0.0000001" },
  { v: 0.000001, l: "0.000001" },
  { v: 0.00001, l: "0.00001" },
  { v: 0.0001, l: "0.0001" },
];

// Snap a price to its bucket: sells round up, buys round down, so a bucket means
// "orders at this price or better".
function groupPrice(price: number, group: number, side: "buy" | "sell"): number {
  if (group <= 0) return price;
  const u = price / group;
  const r = side === "sell" ? Math.ceil(u - 1e-9) : Math.floor(u + 1e-9);
  return Number((r * group).toFixed(DP));
}

// Mirror of the engine's run_loop placement, for the "what it would do" preview:
// ~half the commit per side, weighted toward the outer levels.
function computePlanned(
  mid: number, bestBid: number, bestAsk: number, levels: number[], commit: number,
): OpenOrder[] {
  const out: OpenOrder[] = [];
  const perSide = commit / 2;
  const sumW = levels.reduce((a, b) => a + b, 0) || 1;
  let quoteUsed = 0, askUsed = 0;
  for (const sp of levels) {
    const lvl = perSide * (sp / sumW);
    const bidPx = Math.min(mid * (1 - sp / 100), bestAsk * 0.9999);
    const bidQty = Math.floor(lvl / bidPx);
    const cost = bidQty * bidPx;
    if (bidQty > 0 && cost >= 1 && quoteUsed + cost <= perSide) {
      out.push({ side: "buy", price: bidPx, size: bidQty });
      quoteUsed += cost;
    }
    const askPx = Math.max(mid * (1 + sp / 100), bestBid * 1.0001);
    const askQty = Math.floor(lvl / askPx);
    const val = askQty * askPx;
    if (askQty > 0 && val >= 1 && askUsed + val <= perSide) {
      out.push({ side: "sell", price: askPx, size: askQty });
      askUsed += val;
    }
  }
  return out;
}

type Row = { price: number; total: number; ours: number; planned: number };

// Merge one side's book levels with our resting orders and our planned orders
// into per-price rows. Rows are keyed by rounded price so ours/planned line up
// with the book level at the same price.
function buildSide(book: BookLevel[], side: "buy" | "sell", ours: OpenOrder[], planned: OpenOrder[], group: number): Row[] {
  const rows = new Map<string, Row>();
  const get = (rawPrice: number): Row => {
    const price = groupPrice(rawPrice, group, side);
    const k = key(price);
    let r = rows.get(k);
    if (!r) { r = { price, total: 0, ours: 0, planned: 0 }; rows.set(k, r); }
    return r;
  };
  for (const lv of book.slice(0, RAW_LEVELS)) get(lv.price).total += notional(lv.price, lv.size);
  for (const o of ours) if (o.side === side) get(o.price).ours += notional(o.price, o.size);
  for (const o of planned) if (o.side === side) get(o.price).planned += notional(o.price, o.size);
  // Our resting orders should already be inside the book total; make sure a level
  // never shows less total than our own share sitting there.
  for (const r of rows.values()) r.total = Math.max(r.total, r.ours);
  return [...rows.values()];
}

export function DepthLadder({ ex, symbol, levels, commit }: {
  ex: Exchange; symbol: string; levels: number[]; commit: number; protectPct: number;
}) {
  const [book, setBook] = useState<MmBook | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [group, setGroup] = useState(GROUPS[0].v); // price-grouping step

  useEffect(() => {
    let alive = true;
    const tick = () =>
      mmBook(ex.slug, ex.connector_type, ex.rest_url ?? "", symbol)
        .then((b) => { if (alive) { setBook(b); setErr(null); } })
        .catch((e) => { if (alive) setErr(String(e)); });
    tick();
    const id = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(id); };
  }, [ex, symbol]);

  const view = useMemo(() => {
    if (!book) return null;
    const planned = computePlanned(book.mid, book.bestBid, book.bestAsk, levels, commit);
    // Sells above the mid: build ascending, then show highest at top → lowest just
    // above the mid. Buys below: highest just under the mid → lowest at the bottom.
    const asks = buildSide(book.asks, "sell", book.ourOrders, planned, group).sort((a, b) => a.price - b.price).slice(0, PER_SIDE);
    const bids = buildSide(book.bids, "buy", book.ourOrders, planned, group).sort((a, b) => b.price - a.price).slice(0, PER_SIDE);
    // Normalise EACH SIDE to its own biggest level. A shared scale let one giant
    // level on one side crush the whole other side into a thin band.
    const maxOf = (rows: Row[]) => Math.max(1e-9, ...rows.map((r) => Math.max(r.total, r.planned)));
    return { asks: asks.slice().reverse(), bids, maxAsk: maxOf(asks), maxBid: maxOf(bids) };
  }, [book, levels, commit, group]);

  const Bar = ({ r, side, max }: { r: Row; side: "buy" | "sell"; max: number }) => {
    // The biggest level on this side reaches 70% of the row; everything else is
    // shorter, relative to it. Recomputed live as the book and inputs change.
    const scale = (n: number) => Math.min(70, (n / max) * 70);
    const pct = (n: number) => `${scale(n)}%`;
    const plannedW = r.planned > 0 ? `${Math.max(scale(r.planned), 6)}%` : "0%";
    const oursOfTotal = r.total > 0 ? `${Math.min(100, (r.ours / r.total) * 100)}%` : "0%";
    return (
      <div className={"dl-row dl-" + side}>
        {r.total > 0 && (
          <div className="dl-bar dl-total" style={{ width: pct(r.total) }}>
            {r.ours > 0 && <div className="dl-ours" style={{ width: oursOfTotal }} />}
          </div>
        )}
        {r.planned > 0 && <div className="dl-ghost" style={{ width: plannedW }} />}
        <span className="dl-price">{r.price.toFixed(DP)}</span>
      </div>
    );
  };

  return (
    <section className="ts-section dl-wrap">
      <div className="dl-head">
        <h3 className="ts-head">DEPTH PLANNER: {symbol.replace("/", "-")}</h3>
        <span className="dl-legend"><i className="dl-k-ours-sell" /><i className="dl-k-ours" /> yours <i className="dl-k-others" /> others <i className="dl-k-ghost" /> planned</span>
      </div>
      {err && <p className="wl-note mmc-err">Couldn't read the order book: {err}</p>}
      {!book && !err && <p className="wl-note">Loading the live book…</p>}
      {view && (
        <>
        <div className="dl-group">
          <label className="dl-group-lbl">Decimals
            <select className="dl-group-sel" value={group} onChange={(e) => setGroup(Number(e.target.value))}>
              {GROUPS.map((g) => <option key={g.l} value={g.v}>{g.l}</option>)}
            </select>
          </label>
        </div>
        <div className="dl-ladder">
          <div className="dl-side dl-asks">{view.asks.map((r) => <Bar key={key(r.price)} r={r} side="sell" max={view.maxAsk} />)}</div>
          <div className="dl-mid">
            <span>mid {book!.mid.toFixed(DP)}</span>
            <span className="dl-spread">
              spread {book!.bestBid > 0 ? (((book!.bestAsk - book!.bestBid) / book!.mid) * 100).toFixed(2) : "-"}%
            </span>
          </div>
          <div className="dl-side dl-bids">{view.bids.map((r) => <Bar key={key(r.price)} r={r} side="buy" max={view.maxBid} />)}</div>
        </div>
        </>
      )}
    </section>
  );
}
