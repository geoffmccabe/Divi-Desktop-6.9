// Market Maker preview panel. A non-functional "Coming Soon" walkthrough shown to
// users so they can see the feature coming and go discuss it. No keys, no exchange
// calls, no live data - pure presentation. The real liquidity engine, strategies,
// rewards and community view arrive in later phases. Copy here is user-facing only;
// the internal mechanics (anti-herding, fee handling, etc.) are deliberately not shown.

import "./governance/governance.css";
import "./multisig/multisig.css";
import "./marketmaker.css";
import { useEffect, useState } from "react";
import { mmTestConnection, mmBook, type MmBalance } from "./api";
import { fetchExchanges, type Exchange } from "./exchanges";
import { ExchangeConnect } from "./mm/ExchangeConnect";
import { MarketMakerControl, type MmLiveConfig } from "./mm/MarketMakerControl";
import { DepthLadder } from "./mm/DepthLadder";
import { FundsPanel } from "./mm/FundsPanel";
import { TradePnlPanel } from "./mm/TradePnlPanel";
import { DexPanel } from "./mm/DexPanel";
import { useVenue } from "./mmVenue";

export function MarketMakerPanel() {
  // Live from the shared exchange catalog. Purely informational in this preview;
  // if it can't load we simply don't show the section.
  const [exchanges, setExchanges] = useState<Exchange[] | null>(null);
  const [cfg, setCfg] = useState<MmLiveConfig>(null);
  const [bals, setBals] = useState<MmBalance[] | null>(null);
  const [mode] = useVenue(); // CEX/DEX comes from the toggle in the title row
  useEffect(() => {
    fetchExchanges().then(setExchanges).catch(() => setExchanges(null));
  }, []);

  // Fetch balances once for the selected pair and share them with the funds panel
  // and the control (so it knows whether there are orders to cancel). Keyed on the
  // stable slug/symbol so it doesn't refetch on every keystroke.
  const slug = cfg?.ex.slug, connector = cfg?.ex.connector_type, restUrl = cfg?.ex.rest_url, symbol = cfg?.symbol;
  useEffect(() => {
    if (!slug || !connector) { setBals(null); return; }
    let alive = true;
    const tick = () => mmTestConnection(slug, connector, restUrl ?? "").then((b) => { if (alive) setBals(b); }).catch(() => {});
    tick();
    const id = setInterval(tick, 15000);
    return () => { alive = false; clearInterval(id); };
  }, [slug, connector, restUrl, symbol]);
  const hasOrders = !!bals?.some((b) => (b.locked ?? 0) > 0);

  // The live mid (DIVI priced in USDT) lets the control value the user's DIVI so it
  // can tell them their real max liquidity before they try to commit too much.
  const [mid, setMid] = useState(0);
  useEffect(() => {
    if (!slug || !connector || !symbol) { setMid(0); return; }
    let alive = true;
    const tick = () => mmBook(slug, connector, restUrl ?? "", symbol).then((b) => { if (alive) setMid(b.mid); }).catch(() => {});
    tick();
    const id = setInterval(tick, 12000);
    return () => { alive = false; clearInterval(id); };
  }, [slug, connector, restUrl, symbol]);

  return (
    <div className="gov mm-panel">
      {mode === "dex" ? (
        <DexPanel />
      ) : (
      <>
      {cfg && <FundsPanel symbol={cfg.symbol} bals={bals} />}
      {cfg && cfg.ex.connector_type === "nonkyc" && <TradePnlPanel ex={cfg.ex} symbol={cfg.symbol} />}
      {exchanges && exchanges.length > 0 && (
        <div className="mm-two-col">
          <MarketMakerControl exchanges={exchanges} onConfig={setCfg} hasOrders={hasOrders} bals={bals} mid={mid} />
          {cfg && (
            <DepthLadder ex={cfg.ex} symbol={cfg.symbol} levels={cfg.levels} commit={cfg.commit} protectPct={cfg.protectPct} />
          )}
        </div>
      )}

      <section className="ts-section">
        <h3 className="ts-head">What it is</h3>
        <p className="wl-note gov-wide">
          Market Maker will let you provide liquidity for DIVI trading pairs. That means placing
          gentle buy and sell offers so anyone trading DIVI gets a smoother, fairer price, and the
          market looks alive and healthy. You do it with your own funds, on the exchanges where DIVI
          trades, and you can stop any time.
        </p>
      </section>

      <section className="ts-section">
        <h3 className="ts-head">What you'll be able to do</h3>
        <ul className="mm-list">
          <li className="wl-note gov-wide">Provide liquidity with your own funds, on the exchanges where DIVI trades.</li>
          <li className="wl-note gov-wide">Pick how active you want to be, using simple ready-made strategies.</li>
          <li className="wl-note gov-wide">Keep full control: your keys stay on your device, and you can pause any time.</li>
          <li className="wl-note gov-wide">Earn NFT and Foundation rewards for helping keep the DIVI market healthy.</li>
          <li className="wl-note gov-wide">See the community of liquidity providers in a friendly, private way.</li>
        </ul>
      </section>

      <section className="ts-section">
        <h3 className="ts-head">How it will work</h3>
        <ol className="gov-steps">
          <li className="gov-step">
            <span className="gov-step-num">1</span>
            <div className="gov-step-body">
              <h4>Connect an exchange</h4>
              <p className="wl-note gov-wide">
                Add a trading account using trade-only access: it can place orders but can never
                withdraw your funds.
              </p>
            </div>
          </li>
          <li className="gov-step">
            <span className="gov-step-num">2</span>
            <div className="gov-step-body">
              <h4>Add your liquidity</h4>
              <p className="wl-note gov-wide">
                Set aside a small amount of DIVI and its pair (such as USDT), then choose a strategy
                that suits you.
              </p>
            </div>
          </li>
          <li className="gov-step">
            <span className="gov-step-num">3</span>
            <div className="gov-step-body">
              <h4>Let it run</h4>
              <p className="wl-note gov-wide">
                While your wallet is open it quietly helps make the market. Close the wallet and
                everything stops safely, your offers are pulled automatically, so you're never left
                exposed.
              </p>
            </div>
          </li>
        </ol>
      </section>

      {/* Connect an exchange, then the thank-you / custody notes in one panel. */}
      {exchanges && exchanges.length > 0 && <ExchangeConnect exchanges={exchanges} />}

      <section className="ts-section">
        <h3 className="ts-head">A thank-you for helping</h3>
        <p className="wl-note gov-wide">
          Providing liquidity is a real contribution to Divi. To recognize it, the Foundation plans
          NFT and reward programs for people who take part. This is about supporting the community,
          not a promise of profit.
        </p>
      </section>
      </>
      )}
    </div>
  );
}
