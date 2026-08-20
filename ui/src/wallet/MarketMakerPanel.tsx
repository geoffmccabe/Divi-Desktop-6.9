// Market Maker preview panel. A non-functional "Coming Soon" walkthrough shown to
// users so they can see the feature coming and go discuss it. No keys, no exchange
// calls, no live data — pure presentation. The real liquidity engine, strategies,
// rewards and community view arrive in later phases. Copy here is user-facing only;
// the internal mechanics (anti-herding, fee handling, etc.) are deliberately not shown.

import "./governance/governance.css";
import "./multisig/multisig.css";
import "./marketmaker.css";
import { Icon } from "../Icon";
import { openUrl } from "./api";

// The existing "Divi Love Project" community group.
const TELEGRAM_URL = "https://t.me/+eivUE-J6EYtjMzIx";

export function MarketMakerPanel() {
  return (
    <div className="gov">
      <section className="ts-section">
        <span className="mm-badge">Coming soon</span>
        <p className="wl-note gov-wide">
          Help build a stronger DIVI market — right from your wallet, using your own funds,
          with your keys and coins staying under your control.
        </p>
      </section>

      <section className="ts-section">
        <h3 className="ts-head">What it is</h3>
        <p className="wl-note gov-wide">
          Market Maker will let you provide liquidity for DIVI trading pairs. That means placing
          gentle buy and sell offers so anyone trading DIVI gets a smoother, fairer price — and the
          market looks alive and healthy. You do it with your own funds, on the exchanges where DIVI
          trades, and you can stop any time.
        </p>
      </section>

      <section className="ts-section">
        <h3 className="ts-head">What you'll be able to do</h3>
        <ul className="mm-list">
          <li className="wl-note gov-wide">Provide liquidity with your own funds, on the exchanges where DIVI trades.</li>
          <li className="wl-note gov-wide">Pick how active you want to be, using simple ready-made strategies.</li>
          <li className="wl-note gov-wide">Keep full control — your keys stay on your device, and you can pause any time.</li>
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
                Add a trading account using trade-only access — it can place orders but can never
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
                everything stops safely — your offers are pulled automatically, so you're never left
                exposed.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="ts-section">
        <h3 className="ts-head">Your funds stay yours</h3>
        <p className="wl-note gov-wide">
          You always keep custody. Your coins sit in your own exchange account, your keys are stored
          only on your device, and the connection is set up so it can trade but never move your money
          out.
        </p>
      </section>

      <section className="ts-section">
        <h3 className="ts-head">A thank-you for helping</h3>
        <p className="wl-note gov-wide">
          Providing liquidity is a real contribution to Divi. To recognize it, the Foundation plans
          NFT and reward programs for people who take part. This is about supporting the community —
          not a promise of profit.
        </p>
      </section>

      <section className="ts-section">
        <h3 className="ts-head">Want in early?</h3>
        <p className="wl-note gov-wide">
          Market Maker is being built now. Come tell us what you'd want from it and help shape it.
        </p>
        <button type="button" className="gov-cta-btn" onClick={() => openUrl(TELEGRAM_URL)}>
          Join the discussion on Telegram
          <Icon name="external" size={16} />
        </button>
      </section>

      <p className="gov-foot">Preview only. Nothing here is live yet, and details may change.</p>
    </div>
  );
}
