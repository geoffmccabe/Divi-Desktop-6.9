// The gear page: things a ship carries rather than things it shoots with.
//
// Deliberately the same rows, the same prices in points and DIVI, and the same
// tier rule as the armoury, because from the player's side there is no
// difference between buying a beam and buying a bigger magazine. Both are
// saved for, both stay with the hull, both can only be bought in order.

import { useEffect, useState } from "react";
import { ITEMS, itemUpgradeLabel, type ItemSpec } from "./itemCatalog";
import { priceInDivi } from "./weaponCatalog";
import {
  owned, hasWeapon, spendable, blockedBecause, buyWithPoints, subscribeArmoury,
} from "./rebelsArmoury";
import { fetchPrices } from "../value";

export function ItemStore({ ship }: { ship: string }) {
  const [points, setPoints] = useState(() => spendable());
  const [mine, setMine] = useState<string[]>(() => owned(ship));
  const [diviUsd, setDiviUsd] = useState<number | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => subscribeArmoury(() => {
    setPoints(spendable());
    setMine(owned(ship));
  }), [ship]);
  useEffect(() => { setMine(owned(ship)); }, [ship]);
  useEffect(() => {
    let alive = true;
    void fetchPrices().then((p) => { if (alive) setDiviUsd(p.prices.usd ?? null); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const buy = (spec: ItemSpec) => {
    const r = buyWithPoints(ship, spec.key);
    setNote(r.ok ? `${spec.name} fitted` : `${spec.name}: ${r.why}`);
  };

  return (
    <>
      <div className="wpn-purse">
        <span>POINTS</span><b>{Math.floor(points).toLocaleString()}</b>
        <em>one for each DIVI you bring home</em>
      </div>

      <div className="wpn-list">
        {ITEMS.map((spec) => {
          const have = hasWeapon(ship, spec.key);
          const why = have ? "owned" : blockedBecause(ship, spec, points);
          const locked = !!why && why.startsWith("needs");
          const poor = why === "not enough points";
          const divi = priceInDivi(spec.points, diviUsd);
          return (
            <div
              key={spec.key}
              className={"wpn-row" + (have ? " on" : "") + (locked ? " locked" : "")}
            >
              <span className="wpn-slot">{spec.kind === "torpedo" ? "T" : "M"}</span>
              <span className="wpn-swatch" />
              <div className="wpn-what">
                <b>{spec.name}</b>
                <em>{spec.note}</em>
              </div>
              <div className="wpn-cost">
                {have ? <span className="wpn-have">FITTED</span> : (
                  <>
                    <b>{spec.points.toLocaleString()} pts</b>
                    <em>{divi === null
                      ? "DIVI price unavailable"
                      : `or ${divi < 10 ? divi.toFixed(2) : Math.round(divi).toLocaleString()} DIVI`}</em>
                  </>
                )}
              </div>
              <span />
              <div className="wpn-act">
                {!why && <button type="button" onClick={() => buy(spec)}>BUY</button>}
                {poor && (
                  <span className="wpn-short">
                    {Math.ceil(spec.points - points).toLocaleString()} more
                  </span>
                )}
                {locked && (
                  <span className="wpn-locked">
                    {itemUpgradeLabel(spec)}<em>needs {why.slice(6)}</em>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="wpn-note">
        {note || `${mine.filter((k) => ITEMS.some((i) => i.key === k)).length} of ${ITEMS.length} fitted. Gear stays with this hull.`}
      </p>
    </>
  );
}
