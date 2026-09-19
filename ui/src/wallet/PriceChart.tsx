import { useEffect, useMemo, useState } from "react";
import { priceHistory, type PricePoint } from "./api";

// Divi price chart. Reads the daily series (from Supabase, sourced from
// CoinMarketCap) and draws a hand-rolled SVG area chart — no charting library,
// so it stays in the app's own style and adds no dependency. Defaults to 1 week.

const RANGES: { key: string; label: string; days: number }[] = [
  { key: "1W", label: "1W", days: 7 },
  { key: "1M", label: "1M", days: 30 },
  { key: "3M", label: "3M", days: 90 },
  { key: "1Y", label: "1Y", days: 365 },
  { key: "ALL", label: "All", days: Infinity },
];

const W = 900;
const H = 320;
const PAD = 10;

const fmtUsd = (v: number) => "$" + v.toFixed(6);

export function PriceChart({ onReturn }: { onReturn: () => void }) {
  const [all, setAll] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [rangeKey, setRangeKey] = useState("1W");

  useEffect(() => {
    let live = true;
    priceHistory()
      .then((d) => live && (setAll(d), setLoading(false)))
      .catch(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const range = RANGES.find((r) => r.key === rangeKey)!;
  const pts = useMemo(() => {
    if (range.days === Infinity) return all;
    return all.slice(Math.max(0, all.length - range.days));
  }, [all, range.days]);

  const view = useMemo(() => {
    const vals = pts.map((p) => p.close).filter((v) => v > 0);
    if (vals.length < 2) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || max || 1;
    const n = pts.length;
    const x = (i: number) => PAD + (i / (n - 1)) * (W - 2 * PAD);
    const y = (v: number) => PAD + (1 - (v - min) / span) * (H - 2 * PAD);
    const line = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`)
      .join(" ");
    const area = `${line} L${x(n - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;
    const first = pts[0].close;
    const last = pts[n - 1].close;
    const change = first > 0 ? ((last - first) / first) * 100 : 0;
    return { line, area, min, max, last, change, firstDay: pts[0].day, lastDay: pts[n - 1].day };
  }, [pts]);

  return (
    <div className="pricechart">
      <div className="pc-head">
        <button type="button" className="pc-back" onClick={onReturn}>
          ← Overview
        </button>
        <h2 className="pc-title">DIVI Price</h2>
        {view && (
          <span className="pc-summary">
            <span className="pc-price">{fmtUsd(view.last)}</span>
            <span className={"pc-change " + (view.change >= 0 ? "up" : "down")}>
              {view.change >= 0 ? "▲" : "▼"} {Math.abs(view.change).toFixed(2)}%
            </span>
          </span>
        )}
      </div>

      <div className="pc-ranges">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            className={"pc-range" + (r.key === rangeKey ? " on" : "")}
            onClick={() => setRangeKey(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="pc-chartwrap">
        {loading ? (
          <div className="pc-empty">Loading…</div>
        ) : !view ? (
          <div className="pc-empty">No price data for this range yet.</div>
        ) : (
          <>
            <svg
              className="pc-svg"
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              role="img"
              aria-label="DIVI price chart"
            >
              <defs>
                <linearGradient id="pcfill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={view.area} fill="url(#pcfill)" />
              <path
                d={view.line}
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <span className="pc-hi">{fmtUsd(view.max)}</span>
            <span className="pc-lo">{fmtUsd(view.min)}</span>
            <span className="pc-d0">{view.firstDay}</span>
            <span className="pc-d1">{view.lastDay}</span>
          </>
        )}
      </div>
    </div>
  );
}
