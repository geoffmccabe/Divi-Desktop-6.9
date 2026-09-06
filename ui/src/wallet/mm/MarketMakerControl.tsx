// Run-the-market-maker control card. Picks a connected exchange, sets a small set
// of conservative params, starts/stops the live engine, and polls its status.
// Reuses the wallet's form + section classes so it matches the app. Live quoting
// currently supports NonKYC (the verified connector); others show as coming.

import { useEffect, useMemo, useState } from "react";
import type { Exchange } from "../exchanges";
import { mmHasCredentials, mmStart, mmStop, mmStatus, mmCancelAll, type MmStatus } from "../api";
import { ExchangeSelect } from "./ExchangeSelect";
import "./mm-control.css";

// Reported up to the panel so the separate funds + depth panels mirror the same
// exchange/pair/strategy the user is configuring here.
export type MmLiveConfig = {
  ex: Exchange; symbol: string; levels: number[]; commit: number; protectPct: number;
} | null;

export function MarketMakerControl({ exchanges, onConfig, hasOrders }: { exchanges: Exchange[]; onConfig?: (c: MmLiveConfig) => void; hasOrders?: boolean }) {
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
              <button type="button" className="wl-btn" disabled={busy || !liveSupported} onClick={start}>
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
