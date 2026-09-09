// Points and DIVI: where the two meet.
//
// TWO THINGS HAPPEN HERE and they are opposites, which is why they are one
// panel rather than two. Points come IN, either by flying or by paying for
// them; DIVI goes OUT, to a real wallet. Putting them side by side is the only
// place a player can see what their flying is actually worth.
//
// WHAT IS REAL AND WHAT IS NOT, stated plainly because a panel about money must
// not imply more than it can do:
//   * The balances are real. Points and DIVI are both counted honestly.
//   * Buying points with DIVI hands off to the wallet's own points purchase,
//     which is a built and working flow.
//   * Cashing out is NOT connected. The room's ledger tracks what is owed and
//     enforces the hundred DIVI minimum, but the service that actually signs
//     and broadcasts a payout does not exist yet. So the button says so rather
//     than pretending: a disabled control with a reason is honest, and one that
//     silently does nothing is not.

import { useEffect, useState } from "react";
import { purse, spendable } from "./rebelsArmoury";
import { totalDivi } from "./rebelsScores";
import { USD_PER_POINT } from "./weaponCatalog";
import { fetchPrices } from "../value";

/**
 * The least that may be cashed out, in DIVI.
 *
 * The room's ledger holds the same number and refuses anything under it. This
 * copy is for the wording only; the one that decides is the server's, which is
 * the whole point of a ledger nobody's cockpit can reach.
 */
export const MIN_CLAIM = 100;

export function PointsPanel() {
  const [p, setP] = useState(() => purse());
  const [divi, setDivi] = useState(() => totalDivi());
  const [usd, setUsd] = useState<number | null>(null);
  const [want, setWant] = useState(1000);

  useEffect(() => {
    const t = setInterval(() => { setP(purse()); setDivi(totalDivi()); }, 1500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let alive = true;
    void fetchPrices().then((r) => { if (alive) setUsd(r.prices.usd ?? null); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  /* A point is a tenth of a cent, so what it costs in DIVI is a question about
     what DIVI is worth. No price, no number: see weaponCatalog. */
  const diviFor = usd && usd > 0 ? (want * USD_PER_POINT) / usd : null;
  const canClaim = divi >= MIN_CLAIM;

  return (
    <>
      <div className="wpn-purse">
        <span>POINTS</span><b>{Math.floor(spendable(p)).toLocaleString()}</b>
        <em>{Math.floor(p.earned).toLocaleString()} earned, {Math.floor(p.spent).toLocaleString()} spent</em>
      </div>

      <div className="wpn-list">
        {/* ---- points in ---- */}
        <div className="pts-block">
          <h4>BUY POINTS</h4>
          <p>
            Flying earns a point for every DIVI you bring home. This is the
            short cut.
          </p>
          <div className="pts-row">
            {[1000, 5000, 25000, 100000].map((n) => (
              <button
                type="button"
                key={n}
                className={want === n ? "on" : ""}
                onClick={() => setWant(n)}
              >
                {n.toLocaleString()}
              </button>
            ))}
          </div>
          <div className="pts-quote">
            <b>{want.toLocaleString()} points</b>
            <span>
              {diviFor === null
                ? "DIVI price unavailable"
                : `${Math.round(diviFor).toLocaleString()} DIVI · $${(want * USD_PER_POINT).toFixed(2)}`}
            </span>
          </div>
          {/* The wallet already has a built purchase flow with a confirmation
              step, an address and a transaction to watch. This must go through
              it rather than growing a second one that spends money. */}
          <button type="button" className="pts-go" disabled>
            BUY IN THE WALLET&apos;S POINTS PANEL
          </button>
          <em className="pts-small">
            Not wired to this panel yet. The wallet&apos;s own Points screen does
            this today.
          </em>
        </div>

        {/* ---- DIVI out ---- */}
        <div className="pts-block">
          <h4>CASH OUT DIVI</h4>
          <p>What you have won in orbit, sent to a DIVI address.</p>
          <div className="pts-quote">
            <b>{divi.toFixed(2)} DIVI</b>
            <span>
              {usd && usd > 0 ? `$${(divi * usd).toFixed(2)}` : "DIVI price unavailable"}
            </span>
          </div>
          <button type="button" className="pts-go" disabled={!canClaim}>
            {canClaim ? "CASH OUT" : `${MIN_CLAIM} DIVI MINIMUM`}
          </button>
          <em className="pts-small">
            {canClaim
              ? "The payout service is not connected yet: the ledger is holding this for you."
              : `You have ${divi.toFixed(2)}. Bring home ${(MIN_CLAIM - divi).toFixed(2)} more.`}
          </em>
        </div>
      </div>

      <p className="wpn-note">
        Points buy guns and gear. DIVI is real and can leave the game.
      </p>
    </>
  );
}
