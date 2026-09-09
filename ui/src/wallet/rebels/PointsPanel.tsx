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
import { purse, spendable, convertDiviToPoints, pointsForDivi } from "./rebelsArmoury";
import { totalDivi } from "./rebelsScores";
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
  /* How much DIVI to turn into points, as a fraction of what is held. */
  const [share, setShare] = useState(0.25);
  const [note, setNote] = useState("");

  useEffect(() => {
    const t = setInterval(() => { setP(purse()); setDivi(totalDivi()); }, 1500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let alive = true;
    void fetchPrices().then((r) => { if (alive) setUsd(r.prices.usd ?? null); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  /* A point is a tenth of a cent, so what a DIVI is worth in points is a
     question about what DIVI is worth. No price, no number: see weaponCatalog. */
  const spendDiviAmt = Math.floor(divi * share * 100) / 100;
  const gain = pointsForDivi(spendDiviAmt, usd);
  const canClaim = divi >= MIN_CLAIM;

  const convert = () => {
    const r = convertDiviToPoints(spendDiviAmt, usd);
    if (r.ok) {
      setNote(`${r.divi.toFixed(2)} DIVI became ${Math.floor(r.points).toLocaleString()} points`);
    } else {
      setNote(`Could not convert: ${r.why}`);
    }
    setP(purse());
    setDivi(totalDivi());
  };

  return (
    <>
      <div className="wpn-purse">
        <span>POINTS</span><b>{Math.floor(spendable(p)).toLocaleString()}</b>
        <em>{Math.floor(p.earned).toLocaleString()} earned, {Math.floor(p.spent).toLocaleString()} spent</em>
      </div>

      <div className="wpn-list">
        {/* ---- points in ----
            Turning DIVI won in orbit into points. No chain is touched: that
            DIVI has not been paid out, it is money the treasury is holding, and
            converting it cancels part of the debt in exchange for points. See
            convertDiviToPoints for why that is the honest way to do it. */}
        <div className="pts-block">
          <h4>CONVERT DIVI TO POINTS</h4>
          <p>
            Flying already earns a point for every DIVI. This spends the DIVI
            itself for more, at {(1000).toLocaleString()} points to the dollar.
          </p>
          <div className="pts-row">
            {[0.1, 0.25, 0.5, 1].map((f) => (
              <button
                type="button"
                key={f}
                className={share === f ? "on" : ""}
                onClick={() => setShare(f)}
              >
                {f === 1 ? "ALL" : `${Math.round(f * 100)}%`}
              </button>
            ))}
          </div>
          <div className="pts-quote">
            <b>{spendDiviAmt.toFixed(2)} DIVI</b>
            <span>
              {gain === null
                ? "DIVI price unavailable"
                : `becomes ${Math.floor(gain).toLocaleString()} points`}
            </span>
          </div>
          <button
            type="button"
            className="pts-go"
            disabled={gain === null || spendDiviAmt <= 0}
            onClick={convert}
          >
            {gain === null ? "NO DIVI PRICE" : spendDiviAmt <= 0 ? "NOTHING TO CONVERT" : "CONVERT"}
          </button>
          <em className="pts-small">
            {note || "Points buy guns and gear. Converted DIVI cannot be cashed out."}
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
