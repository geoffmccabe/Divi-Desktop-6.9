// Run-the-market-maker control card. Picks a connected exchange, sets a small set
// of conservative params, starts/stops the live engine, and polls its status.
// Reuses the wallet's form + section classes so it matches the app. Live quoting
// currently supports NonKYC (the verified connector); others show as coming.

import { useEffect, useMemo, useState } from "react";
import type { Exchange } from "../exchanges";
import { mmHasCredentials, mmStart, mmStop, mmStatus, mmCancelAll, type MmStatus, type MmBalance } from "../api";
import { ExchangeSelect } from "./ExchangeSelect";
import "./mm-control.css";

// Reported up to the panel so the separate funds + depth panels mirror the same
// exchange/pair/strategy the user is configuring here.
export type MmLiveConfig = {
  ex: Exchange; symbol: string; levels: number[]; commit: number; protectPct: number;
} | null;

export function MarketMakerControl({ exchanges, onConfig, hasOrders, bals, mid }: { exchanges: Exchange[]; onConfig?: (c: MmLiveConfig) => void; hasOrders?: boolean; bals?: MmBalance[] | null; mid?: number }) {
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [slug, setSlug] = useState("");
  const [commit, setCommit] = useState(20);   // total USDT of liquidity to commit
  const [refresh, setRefresh] = useState(20);
  const [protect, setProtect] = useState(15); // dump/pump guard, % from session high/low
  const [levelCount, setLevelCount] = useState(3);   // how many orders per side
  const [spreadSpan, setSpreadSpan] = useState(0.6); // how far the OUTERMOST order sits from mid (%)

  // The ladder is GENERATED (never hard-coded) so a future "strategy type" can
  // just supply a different count/span/curve. N levels evenly spaced from the
  // inner step out to the span, e.g. count 3, span 0.6 → 0.2 / 0.4 / 0.6.
  const ladder = useMemo(() => {
    const n = Math.max(1, Math.round(levelCount));
    const span = Math.max(0.01, spreadSpan);
    return Array.from({ length: n }, (_, i) => Number(((span * (i + 1)) / n).toFixed(4)));
  }, [levelCount, spreadSpan]);
  const [status, setStatus] = useState<MmStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all(
      exchanges.map((x) =>
        mmHasCredentials(x.slug).then((v) => [x.slug, v] as const).catch(() => [x.slug, false] as const),
      ),
    ).then((pairs) => {
      if (!alive) return;
      const m = Object.fromEntries(pairs);
      setConnected(m);
      const firstLive = exchanges.find((x) => m[x.slug] && x.connector_type === "nonkyc");
      setSlug((s) => s || (firstLive ? firstLive.slug : ""));
    });
    return () => { alive = false; };
  }, [exchanges]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    const tick = () => mmStatus().then((s) => { if (alive) setStatus(s); }).catch(() => {});
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const ex = exchanges.find((x) => x.slug === slug);
  const liveSupported = ex?.connector_type === "nonkyc";
  const running = status?.running ?? false;
  const connectedExchanges = exchanges.filter((x) => connected[x.slug]);
  const symbol = ex?.pairs[0] ?? "DIVI/USDT";

  // --- Capacity guidance ----------------------------------------------------
  // Tell the user what they can actually deploy BEFORE they start, instead of
  // the engine silently doing less. Two limits: (1) balances, the commit is split
  // ~half USDT / half DIVI, so the smaller side caps the total; (2) the per-order
  // minimum, each order must clear $1, and outer orders are larger, so a small
  // commit can only support so many levels.
  const MIN_ORDER_USD = 1; // NonKYC per-order minimum, mirrors the engine
  const [mmBase, mmQuote] = symbol.replace("/", "-").split("-"); // e.g. DIVI, USDT
  const balOf = (a: string) => bals?.find((b) => b.asset.toUpperCase() === a.toUpperCase());
  const quoteFree = balOf(mmQuote)?.free ?? 0;          // USDT available
  const baseFree = balOf(mmBase)?.free ?? 0;            // DIVI available
  const baseValue = baseFree * (mid ?? 0);              // that DIVI valued in USDT
  const haveCapacity = !!bals && (mid ?? 0) > 0;
  const maxCommit = 2 * Math.min(quoteFree, baseValue); // both sides balanced
  // Per-side budget is half the commit; the engine sizes each order from this
  // regardless of balance (it drops OUTER orders if a side runs short, which the
  // max-commit check above already guards). The INNERMOST order is the smallest,
  // perSide * 2/(n(n+1)); it must clear the minimum, so the most levels that fit
  // is the largest n with n(n+1) <= 2*perSide/min.
  const perSide = commit / 2;
  const maxLevels = Math.floor((Math.sqrt(1 + 8 * (perSide / MIN_ORDER_USD)) - 1) / 2);
  const overCommit = haveCapacity && commit > maxCommit + 0.005;      // needs balances + price
  const tooManyLevels = liveSupported && levelCount > maxLevels;      // depends only on the commit
  const blocked = liveSupported && (overCommit || tooManyLevels);
  const usd0 = (n: number) => "$" + Math.max(0, Math.floor(n)).toLocaleString();

  // Report the live config up so the funds + depth panels mirror it.
  useEffect(() => {
    if (!onConfig) return;
    onConfig(ex && liveSupported
      ? { ex, symbol, levels: ladder, commit: Math.max(1, commit), protectPct: Math.max(1, protect) }
      : null);
  }, [ex, liveSupported, symbol, commit, protect, ladder, onConfig]);

  const start = async () => {
    if (!ex) return;
    setBusy(true); setErr(null);
    try {
      await mmStart(
        ex.slug, ex.connector_type, ex.rest_url ?? "", ex.pairs[0] ?? "DIVI/USDT",
        ladder, Math.max(1, commit), Math.max(5, refresh), Math.max(1, protect),
      );
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  const stop = async () => {
    setBusy(true); setErr(null);
    try { await mmStop(); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  const [cancelMsg, setCancelMsg] = useState<string | null>(null);
  const cancelAll = async () => {
    if (!ex) return;
    setBusy(true); setErr(null); setCancelMsg(null);
    try {
      // The engine re-quotes every cycle, so stop it first or the orders come
      // straight back; then cancel whatever is resting to free the funds.
      if (running) await mmStop();
      const n = await mmCancelAll(ex.slug, ex.connector_type, ex.rest_url ?? "", symbol);
      setCancelMsg(n > 0 ? `Cancelled ${n} resting order${n === 1 ? "" : "s"} and freed your funds.` : "No resting orders found to cancel.");
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  return (
    <section className="ts-section">
      <h3 className="ts-head">Run Market Maker</h3>

      {connectedExchanges.length === 0 ? (
        <p className="wl-note gov-wide">Connect an exchange at the bottom of this page first, then you can run it here.</p>
      ) : (
        <div className="mmc">
          <label className="value-field">
            <span className="send-label">Exchange</span>
            <ExchangeSelect exchanges={exchanges} connected={connected} value={slug} onChange={setSlug} />
          </label>

          <div className="mmc-params">
            <label className="value-field">
              <span className="send-label">Total to commit ($): about half comes from your USDT (buy orders) and half from your DIVI (sell orders), so it won't use all of one coin</span>
              <input className="wl-input" type="number" min={1} value={commit}
                onChange={(e) => setCommit(Number(e.target.value))} />
              {haveCapacity && (
                <span className={"mmc-cap" + (overCommit ? " mmc-err" : "")}>
                  {overCommit
                    ? `You entered ${usd0(commit)}, but your balances only back about ${usd0(maxCommit)}. Lower the amount, or add more ${baseValue < quoteFree ? mmBase : mmQuote}.`
                    : `You can commit up to about ${usd0(maxCommit)} (you have ${usd0(quoteFree)} ${mmQuote} and ${usd0(baseValue)} of ${mmBase}; the smaller side sets the cap).`}
                </span>
              )}
            </label>
            <label className="value-field">
              <span className="send-label">Protect ±% (dump/pump guard)</span>
              <input className="wl-input" type="number" min={1} max={90} value={protect}
                onChange={(e) => setProtect(Number(e.target.value))} />
            </label>
            <label className="value-field">
              <span className="send-label">Levels (orders per side)</span>
              <input className="wl-input" type="number" min={1} max={12} value={levelCount}
                onChange={(e) => setLevelCount(Number(e.target.value))} />
              {tooManyLevels && (
                <span className="mmc-cap mmc-err">
                  {maxLevels < 1
                    ? `That amount is too small to place any orders (each needs at least ${usd0(MIN_ORDER_USD)}).`
                    : `At ${usd0(commit)}, only ${maxLevels} level${maxLevels === 1 ? "" : "s"} per side fit: each order needs at least ${usd0(MIN_ORDER_USD)}, and outer orders are larger. Lower the levels or raise the amount.`}
                </span>
              )}
            </label>
            <label className="value-field">
              <span className="send-label">Spread span % (outermost order)</span>
              <input className="wl-input" type="number" min={0.05} step={0.05} value={spreadSpan}
                onChange={(e) => setSpreadSpan(Number(e.target.value))} />
            </label>
            <label className="value-field">
              <span className="send-label">Refresh (seconds)</span>
              <input className="wl-input" type="number" min={5} value={refresh}
                onChange={(e) => setRefresh(Number(e.target.value))} />
            </label>
          </div>

          <p className="wl-note">
            About half your commit goes to each side (capped by your balances), laddered at{" "}
            {ladder.map((l) => `${l}%`).join(" / ")} from mid and weighted toward the outer levels.
            It won't buy below / sell above {protect}% from the session high/low, and cancels everything
            automatically when you stop or close the wallet.
          </p>

          {!liveSupported && (
            <p className="wl-note">Live quoting for {ex?.name} is coming. NonKYC is supported today.</p>
          )}

          <div className="mmc-actions">
            {!running ? (
              <button type="button" className="wl-btn mmc-start" disabled={busy || !liveSupported || blocked} onClick={start}>
                {busy ? "…" : "Start"}
              </button>
            ) : (
              <button type="button" className="wl-btn mmc-stop" disabled={busy} onClick={stop}>
                {busy ? "…" : "Stop"}
              </button>
            )}
            <span className={running ? "mmc-on" : "mmc-off"}>{running ? "running" : "stopped"}</span>
            {liveSupported && hasOrders && (
              <button type="button" className="wl-link" disabled={busy} onClick={cancelAll}>
                {running ? "Stop and cancel my orders (free my funds)" : "Cancel my resting orders (free my funds)"}
              </button>
            )}
          </div>

          {err && <p className="wl-note mmc-err">{err}</p>}
          {cancelMsg && <p className="wl-note">{cancelMsg}</p>}

          {status && running && (
            <div className="mmc-status">
              <div><span className="mmc-k">Status</span><span className="mmc-v">{status.message || "-"}</span></div>
              <div><span className="mmc-k">Mid price</span><span className="mmc-v">{status.mid ? status.mid.toFixed(7) : "-"}</span></div>
              <div><span className="mmc-k">Live orders</span><span className="mmc-v">{status.openOrders}</span></div>
              <div><span className="mmc-k">Cycles</span><span className="mmc-v">{status.cycles}</span></div>
              <div><span className="mmc-k">USDT</span><span className="mmc-v">{status.quoteFree.toFixed(2)} free / {status.quoteHeld.toFixed(2)} in orders</span></div>
              <div><span className="mmc-k">DIVI</span><span className="mmc-v">{Math.round(status.baseFree)} free / {Math.round(status.baseHeld)} in orders</span></div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
