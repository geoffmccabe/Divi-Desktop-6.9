// Points and DIVI: where the two meet.
//
// THREE TABS, in the order money tends to flow:
//   BUY POINTS    real DIVI leaves the wallet for the treasury, points arrive.
//   CONVERT DIVI  DIVI won in orbit (held by the ledger, never paid out) is
//                 turned into points. No chain is touched.
//   CASH OUT      DIVI won in orbit goes to a real address. Not connected yet.
//
// WHAT IS REAL AND WHAT IS NOT, stated plainly because a panel about money must
// not imply more than it can do:
//   * Buying is a real transaction. The wallet signs and broadcasts it to the
//     treasury address and the DIVI is gone from the balance, the same as any
//     send. The points that arrive in return are a local balance for now, so
//     this side trusts the broadcast; see creditPurchase for what that means.
//   * Converting only moves numbers the ledger already holds.
//   * Cashing out is NOT connected. The room's ledger tracks what is owed and
//     enforces the hundred DIVI minimum, but the service that actually signs
//     and broadcasts a payout does not exist yet. So the button says so rather
//     than pretending: a disabled control with a reason is honest, and one that
//     silently does nothing is not.

import { useEffect, useState } from "react";
import {
  purse, spendable, convertDiviToPoints, pointsForDivi, creditPurchase,
} from "./rebelsArmoury";
import { totalDivi } from "./rebelsScores";
import { fetchPrices } from "../value";
import {
  BUY_TIERS, bonusFor, pointsForPurchase, TREASURY_ADDRESS,
} from "./weaponCatalog";
import {
  PurchaseWithDivi, type PurchaseOption, type PurchaseProgress,
} from "../../points/PurchaseWithDivi";

/**
 * The least that may be cashed out, in DIVI.
 *
 * The room's ledger holds the same number and refuses anything under it. This
 * copy is for the wording only; the one that decides is the server's, which is
 * the whole point of a ledger nobody's cockpit can reach.
 */
export const MIN_CLAIM = 100;

/** The smallest purchase worth a transaction fee. */
const MIN_BUY = 10;

type Tab = "buy" | "convert" | "cashout";

const TABS: { id: Tab; label: string }[] = [
  { id: "buy", label: "BUY POINTS" },
  { id: "convert", label: "CONVERT DIVI" },
  { id: "cashout", label: "CASH OUT" },
];

export function PointsPanel() {
  const [tab, setTab] = useState<Tab>("buy");
  const [p, setP] = useState(() => purse());
  const [divi, setDivi] = useState(() => totalDivi());
  const [usd, setUsd] = useState<number | null>(null);

  useEffect(() => {
    const t = setInterval(() => { setP(purse()); setDivi(totalDivi()); }, 1500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let alive = true;
    void fetchPrices().then((r) => { if (alive) setUsd(r.prices.usd ?? null); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const refresh = () => { setP(purse()); setDivi(totalDivi()); };

  return (
    <>
      <div className="wpn-purse">
        <span>POINTS</span><b>{Math.floor(spendable(p)).toLocaleString()}</b>
        <em>{Math.floor(p.earned).toLocaleString()} earned, {Math.floor(p.spent).toLocaleString()} spent</em>
      </div>

      <div className="pts-tabs">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            className={tab === t.id ? "on" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="wpn-list">
        {tab === "buy" && <BuyBlock usd={usd} onBought={refresh} />}
        {tab === "convert" && <ConvertBlock usd={usd} divi={divi} onDone={refresh} />}
        {tab === "cashout" && <CashOutBlock usd={usd} divi={divi} />}
      </div>

      <p className="wpn-note">
        Points buy guns and gear. DIVI is real and can leave the game.
      </p>
    </>
  );
}

/* ---- BUY POINTS ----
   A real send from the wallet to the treasury. The four set amounts and a
   typed one; bigger spends carry a bonus in points rather than a discount in
   DIVI (see BUY_TIERS). The wallet's own purchase modal does the signing,
   broadcasting and settling, the same one the builder's credits use. */
function BuyBlock({ usd, onBought }: { usd: number | null; onBought: () => void }) {
  const [pick, setPick] = useState<number | null>(BUY_TIERS[0].divi);
  const [custom, setCustom] = useState("");
  const [buying, setBuying] = useState<PurchaseOption | null>(null);
  const [note, setNote] = useState("");

  /* Whichever is chosen: a tier button, or the typed amount when the box has
     something in it. Typing clears the button so the two never disagree. */
  const typed = Number(custom);
  const amount = pick ?? (Number.isFinite(typed) ? typed : 0);
  const bonus = bonusFor(amount);
  const points = pointsForPurchase(amount, usd);
  const tooSmall = amount < MIN_BUY;

  const option: PurchaseOption | null = points === null || tooSmall ? null : {
    id: `rebels-${amount}`,
    name: `${Math.floor(points).toLocaleString()} points`,
    headline: `${amount.toLocaleString()} DIVI`,
    detail: bonus > 0 ? `includes ${Math.round(bonus * 100)}% bonus points` : undefined,
    amountDivi: amount,
    badge: bonus > 0 ? `+${Math.round(bonus * 100)}%` : undefined,
  };

  return (
    <div className="pts-block">
      <h4>BUY POINTS WITH DIVI</h4>
      <p>
        Paid from this wallet to the Divi Rebels treasury. Spend more at once
        and get more points: {BUY_TIERS.filter((t) => t.bonus > 0)
          .map((t) => `${Math.round(t.bonus * 100)}% at ${t.divi.toLocaleString()}`).join(", ")}.
      </p>
      <div className="pts-row">
        {BUY_TIERS.map((t) => (
          <button
            type="button"
            key={t.divi}
            className={pick === t.divi ? "on" : ""}
            onClick={() => { setPick(t.divi); setCustom(""); }}
          >
            {t.divi.toLocaleString()}
          </button>
        ))}
      </div>
      <div className="pts-custom">
        <input
          type="text"
          inputMode="decimal"
          placeholder="custom DIVI amount"
          value={custom}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9.]/g, "");
            setCustom(v);
            setPick(null);
          }}
        />
      </div>
      <div className="pts-quote">
        <b>{amount > 0 ? `${amount.toLocaleString()} DIVI` : "0 DIVI"}</b>
        <span>
          {usd === null
            ? "DIVI price unavailable"
            : tooSmall
              ? `${MIN_BUY} DIVI minimum`
              : `buys ${Math.floor(points ?? 0).toLocaleString()} points${bonus > 0 ? ` (+${Math.round(bonus * 100)}%)` : ""}`}
        </span>
      </div>
      <button
        type="button"
        className="pts-go"
        disabled={option === null}
        onClick={() => option && setBuying(option)}
      >
        {usd === null ? "NO DIVI PRICE" : tooSmall ? "AMOUNT TOO SMALL" : "BUY POINTS"}
      </button>
      <em className="pts-small">
        {note || `${(1000).toLocaleString()} points to the dollar at the live DIVI price. Bonus points are extra, not a discount.`}
      </em>

      {buying && (
        <PurchaseWithDivi
          options={[buying]}
          onPrepare={async (o) => ({ address: TREASURY_ADDRESS, amountDivi: o.amountDivi })}
          onSent={async (o, txid): Promise<PurchaseProgress> => {
            /* Points at the price quoted when the buyer pressed the button,
               which is the deal they agreed to; the price may have moved by
               the time the wallet reports the send. */
            const pts = pointsForPurchase(o.amountDivi, usd) ?? 0;
            const fresh = creditPurchase(txid, o.amountDivi, pts);
            if (fresh) {
              setNote(`${o.amountDivi.toLocaleString()} DIVI bought ${Math.floor(pts).toLocaleString()} points`);
              onBought();
            }
            return { done: true, note: `${Math.floor(pts).toLocaleString()} points added` };
          }}
          onClose={() => setBuying(null)}
          footnote="Sent to the Divi Rebels treasury. Points land as soon as the wallet reports the send."
        />
      )}
    </div>
  );
}

/* ---- CONVERT DIVI ----
   Turning DIVI won in orbit into points. No chain is touched: that DIVI has
   not been paid out, it is money the treasury is holding, and converting it
   cancels part of the debt in exchange for points. See convertDiviToPoints
   for why that is the honest way to do it. */
function ConvertBlock({ usd, divi, onDone }: { usd: number | null; divi: number; onDone: () => void }) {
  /* How much DIVI to turn into points, as a fraction of what is held. */
  const [share, setShare] = useState(0.25);
  const [note, setNote] = useState("");

  /* A point is a tenth of a cent, so what a DIVI is worth in points is a
     question about what DIVI is worth. No price, no number: see weaponCatalog. */
  const spendDiviAmt = Math.floor(divi * share * 100) / 100;
  const gain = pointsForDivi(spendDiviAmt, usd);

  const convert = () => {
    const r = convertDiviToPoints(spendDiviAmt, usd);
    if (r.ok) {
      setNote(`${r.divi.toFixed(2)} DIVI became ${Math.floor(r.points).toLocaleString()} points`);
    } else {
      setNote(`Could not convert: ${r.why}`);
    }
    onDone();
  };

  return (
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
  );
}

/* ---- CASH OUT ---- */
function CashOutBlock({ usd, divi }: { usd: number | null; divi: number }) {
  const canClaim = divi >= MIN_CLAIM;
  return (
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
  );
}
