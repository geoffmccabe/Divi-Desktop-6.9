// Run-the-market-maker control card. Picks a connected exchange, sets a small set
// of conservative params, starts/stops the live engine, and polls its status.
// Reuses the wallet's form + section classes so it matches the app. Live quoting
// currently supports NonKYC (the verified connector); others show as coming.

import { useEffect, useState } from "react";
import type { Exchange } from "../exchanges";
import { mmHasCredentials, mmStart, mmStop, mmStatus, type MmStatus } from "../api";
import "./mm-control.css";

const LADDER = [0.1, 0.3, 0.6]; // % from mid, each side, per level

export function MarketMakerControl({ exchanges }: { exchanges: Exchange[] }) {
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [slug, setSlug] = useState("");
  const [orderUsdt, setOrderUsdt] = useState(2);
  const [refresh, setRefresh] = useState(20);
  const [maxSide, setMaxSide] = useState(8);
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

  const start = async () => {
    if (!ex) return;
    setBusy(true); setErr(null);
    try {
      await mmStart(
        ex.slug, ex.connector_type, ex.rest_url ?? "", ex.pairs[0] ?? "DIVI/USDT",
        LADDER, Math.max(1, orderUsdt), Math.max(5, refresh), Math.max(1, maxSide),
      );
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  const stop = async () => {
    setBusy(true); setErr(null);
    try { await mmStop(); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  return (
    <section className="ts-section">
      <h3 className="ts-head">Run the market maker</h3>

      {connectedExchanges.length === 0 ? (
        <p className="wl-note gov-wide">Connect an exchange above first, then you can run it here.</p>
      ) : (
        <div className="mmc">
          <label className="value-field">
            <span className="send-label">Exchange</span>
            <select className="wl-input" value={slug} onChange={(e) => setSlug(e.target.value)}>
              {connectedExchanges.map((x) => (
                <option key={x.slug} value={x.slug}>{x.name} — {x.pairs[0] ?? ""}</option>
              ))}
            </select>
          </label>

          <div className="mmc-params">
            <label className="value-field">
              <span className="send-label">Order size (USDT)</span>
              <input className="wl-input" type="number" min={1} value={orderUsdt}
                onChange={(e) => setOrderUsdt(Number(e.target.value))} />
            </label>
            <label className="value-field">
              <span className="send-label">Refresh (seconds)</span>
              <input className="wl-input" type="number" min={5} value={refresh}
                onChange={(e) => setRefresh(Number(e.target.value))} />
            </label>
            <label className="value-field">
              <span className="send-label">Max per side (USDT)</span>
              <input className="wl-input" type="number" min={1} value={maxSide}
                onChange={(e) => setMaxSide(Number(e.target.value))} />
            </label>
          </div>

          <p className="wl-note">
            Conservative ladder: {LADDER.map((l) => `${l}%`).join(" / ")} each side of mid, non-crossing.
            Everything cancels automatically when you stop or close the wallet.
          </p>

          {!liveSupported && (
            <p className="wl-note">Live quoting for {ex?.name} is coming — NonKYC is supported today.</p>
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
          </div>

          {err && <p className="wl-note mmc-err">{err}</p>}

          {status && (
            <div className="mmc-status">
              <div><span className="mmc-k">Status</span><span className="mmc-v">{status.message || "—"}</span></div>
              <div><span className="mmc-k">Mid price</span><span className="mmc-v">{status.mid ? status.mid.toFixed(7) : "—"}</span></div>
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
