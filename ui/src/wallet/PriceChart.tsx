import { useEffect, useMemo, useRef, useState } from "react";
import { priceHistory } from "./api";

// Divi price chart. Reads the timestamped series (Supabase, sourced from
// CoinMarketCap: daily deep-past + hourly full history + 15-min recent) and
// draws a hand-rolled SVG area chart — no charting library. Price gridlines on
// the left, date/time gridlines on the bottom, a hover crosshair, plus
// scroll-wheel zoom (around the cursor) and drag-to-pan over a free view window.

type Pt = { t: number; c: number };

const RANGES: { key: string; label: string; days: number }[] = [
  { key: "1W", label: "1W", days: 7 },
  { key: "1M", label: "1M", days: 30 },
  { key: "3M", label: "3M", days: 90 },
  { key: "1Y", label: "1Y", days: 365 },
  { key: "ALL", label: "All", days: Infinity },
];

/* WHICH CHARTS EXIST. Only the price chart is built. The rest are listed so
   the menu shows the whole plan and says plainly that they are not ready --
   an empty chart that looks broken is worse than one that admits it is not
   written yet. Each becomes `ready` as its data source lands; see
   docs/CHARTS-PLAN.md for what each one needs. */
const CHARTS: { key: string; label: string; ready: boolean }[] = [
  { key: "price", label: "DIVI Price", ready: true },
  { key: "mcap", label: "Market Cap", ready: false },
  { key: "wallets", label: "Wallets Holding DIVI", ready: false },
  { key: "newwallets", label: "New Wallets per Day", ready: false },
  { key: "nodes", label: "Nodes on the Network", ready: false },
  { key: "txs", label: "Transactions per Day", ready: false },
];

/* MARGINS. MB is the strip below the plot that the date labels sit in; it has
   to be tall enough for an 11px label plus its descenders and a little air,
   and the labels are drawn 8 units up from the bottom edge. Anything less and
   the axis is trimmed even when the chart itself fits. */
const ML = 62, MR = 16, MT = 14, MB = 30;
/* A floor, not a fixed size. The chart's height is measured from the panel it
   sits in (see the ResizeObserver below) so it fills the space available and
   its axis is never outside the box; this is only what to use before the
   first measurement lands, and how small it may ever get. */
const MIN_H = 260;
const DAY = 86400_000;
const MIN_SPAN = 2 * 3600_000; // don't zoom in past ~2 hours
const MAX_RENDER = 1500; // path point cap (downsample beyond this)

const fmtUsd = (v: number) => "$" + v.toFixed(5);
const fmtPrice = (v: number) => "$" + v.toFixed(6);
function fmtTick(t: number, spanDays: number): string {
  const d = new Date(t);
  if (spanDays <= 2) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (spanDays <= 120) return d.toLocaleDateString([], { month: "short", day: "numeric" });
  if (spanDays <= 800) return d.toLocaleDateString([], { month: "short", year: "2-digit" });
  return String(d.getFullYear());
}
const fmtFull = (t: number) =>
  new Date(t).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

function sliceIdx(all: Pt[], s: number, e: number): [number, number] {
  let lo = 0, hi = all.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (all[m].t < s) lo = m + 1; else hi = m; }
  const i0 = lo;
  lo = 0; hi = all.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (all[m].t <= e) lo = m + 1; else hi = m; }
  return [Math.max(0, i0 - 1), Math.min(all.length, lo + 1)];
}
function downsample(pts: Pt[], max: number): Pt[] {
  if (pts.length <= max) return pts;
  const stride = Math.ceil(pts.length / max);
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i += stride) out.push(pts[i]);
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

export function PriceChart({ onReturn }: { onReturn: () => void }) {
  const [raw, setRaw] = useState<{ ts: string; close: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [W, setW] = useState(0);
  const [H, setH] = useState(MIN_H);
  const [view, setView] = useState<{ s: number; e: number } | null>(null);
  const [preset, setPreset] = useState<number | null>(7);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  const geomRef = useRef<{ plotW: number }>({ plotW: 0 });
  const boundsRef = useRef<{ s: number; e: number } | null>(null);
  const dragRef = useRef<{ x: number; s: number; e: number } | null>(null);

  useEffect(() => {
    let live = true;
    priceHistory().then((d) => live && (setRaw(d as any), setLoading(false))).catch(() => live && setLoading(false));
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    /* Measure BOTH dimensions. Height used to be a constant, and the panel
       was free to be shorter than that constant, which is exactly how the
       axis ended up outside the visible box. */
    const measure = () => {
      setW(el.clientWidth);
      setH(Math.max(MIN_H, Math.round(el.clientHeight)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el); measure();
    return () => ro.disconnect();
  }, []);

  // Click anywhere else, or press Escape, and the chart menu closes.
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [menuOpen]);

  const all = useMemo<Pt[]>(
    () => raw.map((p) => ({ t: Date.parse(p.ts), c: p.close })).filter((p) => p.c > 0 && !Number.isNaN(p.t)),
    [raw],
  );

  // Initialise the view to the last week once data arrives.
  useEffect(() => {
    if (all.length && !view) {
      const e = all[all.length - 1].t;
      setView({ s: Math.max(all[0].t, e - 7 * DAY), e });
    }
  }, [all, view]);

  const model = useMemo(() => {
    if (W <= ML + MR || H <= MT + MB || !view || all.length < 2) return null;
    const plotW = W - ML - MR, plotH = H - MT - MB;
    const [i0, i1] = sliceIdx(all, view.s, view.e);
    const visible = all.slice(i0, i1);
    if (visible.length < 2) return null;
    let min = Infinity, max = -Infinity;
    for (const p of visible) { if (p.c < min) min = p.c; if (p.c > max) max = p.c; }
    const span = max - min || max || 1;
    const vs = view.s, ve = view.e, tspan = ve - vs || 1;
    const x = (t: number) => ML + ((t - vs) / tspan) * plotW;
    const y = (v: number) => MT + (1 - (v - min) / span) * plotH;
    const draw = downsample(visible, MAX_RENDER);
    const line = draw.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.c).toFixed(1)}`).join(" ");
    const area = `${line} L${(ML + plotW).toFixed(1)},${MT + plotH} L${ML},${MT + plotH} Z`;
    const yTicks = Array.from({ length: 5 }, (_, i) => min + (i / 4) * span);
    const xTicks = Array.from({ length: 6 }, (_, i) => vs + (i / 5) * tspan);
    return {
      plotW, plotH, min, max, vs, ve, tspan, x, y, line, area, yTicks, xTicks,
      spanDays: tspan / DAY, visible,
      change: visible[0].c > 0 ? ((visible[visible.length - 1].c - visible[0].c) / visible[0].c) * 100 : 0,
      last: visible[visible.length - 1].c,
    };
  }, [W, H, view, all]);

  // keep refs fresh for the wheel/drag listeners
  viewRef.current = view;
  boundsRef.current = all.length ? { s: all[0].t, e: all[all.length - 1].t } : null;
  if (model) geomRef.current = { plotW: model.plotW };

  // scroll-wheel zoom around the cursor (non-passive so we can preventDefault)
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const v = viewRef.current, b = boundsRef.current, g = geomRef.current;
      if (!v || !b || !g.plotW) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left - ML) / g.plotW));
      const cursorT = v.s + frac * (v.e - v.s);
      const factor = e.deltaY < 0 ? 0.82 : 1 / 0.82;
      const span = Math.max(MIN_SPAN, Math.min(b.e - b.s, (v.e - v.s) * factor));
      let ns = cursorT - frac * span, ne = cursorT + (1 - frac) * span;
      if (ns < b.s) { ne += b.s - ns; ns = b.s; }
      if (ne > b.e) { ns -= ne - b.e; ne = b.e; }
      setView({ s: Math.max(b.s, ns), e: Math.min(b.e, ne) });
      setPreset(null);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // drag-to-pan (document-level so the drag survives leaving the plot)
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current, b = boundsRef.current, g = geomRef.current;
      if (!d || !b || !g.plotW) return;
      const dt = -((e.clientX - d.x) / g.plotW) * (d.e - d.s);
      let ns = d.s + dt, ne = d.e + dt;
      if (ns < b.s) { ne += b.s - ns; ns = b.s; }
      if (ne > b.e) { ns -= ne - b.e; ne = b.e; }
      setView({ s: Math.max(b.s, ns), e: Math.min(b.e, ne) });
    };
    const up = () => { if (dragRef.current) { dragRef.current = null; setDragging(false); } };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  const setRange = (days: number) => {
    if (!all.length) return;
    const e = all[all.length - 1].t;
    setView(days === Infinity ? { s: all[0].t, e } : { s: Math.max(all[0].t, e - days * DAY), e });
    setPreset(days);
  };

  const hover = useMemo(() => {
    if (!model || hoverX == null || dragging) return null;
    const v = model.visible;
    const frac = Math.min(1, Math.max(0, (hoverX - ML) / model.plotW));
    const targetT = model.vs + frac * model.tspan;
    let lo = 0, hi = v.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (v[m].t < targetT) lo = m + 1; else hi = m; }
    if (lo > 0 && Math.abs(v[lo - 1].t - targetT) < Math.abs(v[lo].t - targetT)) lo--;
    const p = v[lo];
    return { px: model.x(p.t), py: model.y(p.c), t: p.t, c: p.c };
  }, [model, hoverX, dragging]);

  return (
    <div className="pricechart">
      <div className="pc-head">
        <button type="button" className="pc-back" onClick={onReturn}>← Overview</button>
        {/* Which chart to show. Styled from .pc-back so it is the same height
            and weight as the Overview button beside it. The other charts are
            not built yet and say so rather than pretending to be empty. */}
        <div className="pc-menuwrap" ref={menuRef}>
          <button
            type="button"
            className={"pc-back pc-burger" + (menuOpen ? " on" : "")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Choose a chart"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg viewBox="0 0 16 12" width="15" height="11" aria-hidden="true">
              <path d="M1 1.5h14M1 6h14M1 10.5h14" stroke="currentColor"
                strokeWidth="1.7" strokeLinecap="round" fill="none" />
            </svg>
          </button>
          {menuOpen && (
            <div className="pc-menu" role="menu">
              {CHARTS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="menuitem"
                  className={"pc-menu-item" + (c.key === "price" ? " on" : "")}
                  disabled={!c.ready}
                  onClick={() => setMenuOpen(false)}
                >
                  <span>{c.label}</span>
                  {!c.ready && <span className="pc-menu-soon">not built yet</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <h2 className="pc-title">DIVI Price</h2>
        {model && (
          <span className="pc-summary">
            <span className="pc-price">{fmtPrice(model.last)}</span>
            <span className={"pc-change " + (model.change >= 0 ? "up" : "down")}>
              {model.change >= 0 ? "▲" : "▼"} {Math.abs(model.change).toFixed(2)}%
            </span>
          </span>
        )}
      </div>

      <div className="pc-ranges">
        {RANGES.map((r) => (
          <button key={r.key} type="button"
            className={"pc-range" + (preset === r.days ? " on" : "")}
            onClick={() => setRange(r.days)}>
            {r.label}
          </button>
        ))}
        <span className="pc-hint">scroll to zoom · drag to pan</span>
      </div>

      <div
        className={"pc-plot" + (dragging ? " dragging" : "")}
        ref={wrapRef}
        onMouseDown={(e) => { if (view) { dragRef.current = { x: e.clientX, s: view.s, e: view.e }; setDragging(true); setPreset(null); } }}
        onMouseMove={(e) => { const r = wrapRef.current?.getBoundingClientRect(); if (r) setHoverX(e.clientX - r.left); }}
        onMouseLeave={() => setHoverX(null)}
      >
        {loading ? (
          <div className="pc-empty">Loading…</div>
        ) : !model ? (
          <div className="pc-empty">No price data for this range yet.</div>
        ) : (
          <>
            <svg className="pc-svg" width={W} height={H} role="img" aria-label="DIVI price chart">
              <defs>
                <linearGradient id="pcfill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.34" />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                </linearGradient>
              </defs>
              {model.yTicks.map((v, i) => {
                const yy = model.y(v);
                return (
                  <g key={"y" + i}>
                    <line x1={ML} y1={yy} x2={W - MR} y2={yy} className="pc-grid" />
                    <text x={ML - 8} y={yy + 3} className="pc-ylabel">{fmtUsd(v)}</text>
                  </g>
                );
              })}
              {model.xTicks.map((t, i) => {
                const xx = model.x(t);
                return (
                  <g key={"x" + i}>
                    <line x1={xx} y1={MT} x2={xx} y2={MT + model.plotH} className="pc-grid" />
                    <text x={xx} y={H - 8} className="pc-xlabel">{fmtTick(t, model.spanDays)}</text>
                  </g>
                );
              })}
              <path d={model.area} fill="url(#pcfill)" />
              <path d={model.line} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" />
              {hover && (
                <>
                  <line x1={hover.px} y1={MT} x2={hover.px} y2={MT + model.plotH} className="pc-cross" />
                  <circle cx={hover.px} cy={hover.py} r="4" className="pc-dot" />
                </>
              )}
            </svg>
            {hover && (
              <div className="pc-tip" style={{
                left: hover.px > W / 2 ? undefined : hover.px + 12,
                right: hover.px > W / 2 ? W - hover.px + 12 : undefined,
                top: Math.max(MT, hover.py - 34),
              }}>
                <span className="pc-tip-price">{fmtPrice(hover.c)}</span>
                <span className="pc-tip-date">{fmtFull(hover.t)}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
