// Standalone Trading page: the manual trade panel plus its own trading history
// (only the user's own / external trades, never the market maker's), and the same
// collapsible "Connect an exchange" as the Market Maker page. Everything here is
// reused from the mm/ components, so the two pages share one implementation.

import { useEffect, useState } from "react";
import { fetchExchanges, type Exchange } from "./exchanges";
import { mmHasCredentials } from "./api";
import { TradePanel } from "./mm/TradePanel";
import { TradePnlPanel } from "./mm/TradePnlPanel";
import { ExchangeConnect } from "./mm/ExchangeConnect";
import { ExchangeSelect } from "./mm/ExchangeSelect";
import { Collapsible } from "./mm/Collapsible";
import "./governance/governance.css";
import "./multisig/multisig.css";
import "./marketmaker.css";

export function TradingPanel() {
  const [exchanges, setExchanges] = useState<Exchange[] | null>(null);
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [slug, setSlug] = useState("");

  useEffect(() => { fetchExchanges().then(setExchanges).catch(() => setExchanges(null)); }, []);

  useEffect(() => {
    if (!exchanges) return;
    let alive = true;
    Promise.all(
      exchanges.map((x) => mmHasCredentials(x.slug).then((v) => [x.slug, v] as const).catch(() => [x.slug, false] as const)),
    ).then((pairs) => {
      if (!alive) return;
      const m = Object.fromEntries(pairs);
      setConnected(m);
      const firstLive = exchanges.find((x) => m[x.slug] && x.connector_type === "nonkyc");
      setSlug((s) => s || (firstLive ? firstLive.slug : ""));
    });
    return () => { alive = false; };
  }, [exchanges]);

  const ex = exchanges?.find((x) => x.slug === slug);
  const symbol = ex?.pairs[0] ?? "DIVI/USDT";
  const liveSupported = ex?.connector_type === "nonkyc";
  const connectedCount = Object.values(connected).filter(Boolean).length;

  return (
    <div className="gov mm-panel">
      {/* Only show a picker when there's a real choice; otherwise auto-selected. */}
      {connectedCount > 1 && exchanges && (
        <label className="value-field" style={{ maxWidth: 360 }}>
          <span className="send-label">Exchange</span>
          <ExchangeSelect exchanges={exchanges} connected={connected} value={slug} onChange={setSlug} />
        </label>
      )}

      {ex && liveSupported ? (
        <>
          <TradePanel ex={ex} symbol={symbol} />
          <Collapsible title="Trading history (P&L)" defaultOpen>
            <TradePnlPanel ex={ex} symbol={symbol} source="manual" />
          </Collapsible>
        </>
      ) : (
        <section className="ts-section"><p className="wl-note gov-wide">Connect an exchange below to start trading.</p></section>
      )}

      {exchanges && exchanges.length > 0 && <ExchangeConnect exchanges={exchanges} />}
    </div>
  );
}
