// The gear page: things a ship carries rather than things it shoots with.
//
// Deliberately the same rows, the same prices in points and DIVI, and the same
// tier rule as the armoury, because from the player's side there is no
// difference between buying a beam and buying a bigger magazine. Both are
// saved for, both are the player's on every hull, both can only be bought in order.

import { useEffect, useState } from "react";
import { bankView, subscribeBank, type BankView } from "./rebelsBank";
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
              <span className="wpn-slot">{spec.kind === "torpedo" ? "T" : spec.kind === "mag" ? "M" : "V"}</span>
              <span className="wpn-swatch" />
              <div className="wpn-what">
                <b>{spec.name}</b>
                <em>{spec.note}</em>
              </div>
              <div className={"wpn-cost" + (poor ? " short" : "")}>
                {have ? <span className="wpn-have">OWNED</span> : (
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

      {/* ---- gems ----
          Property, not gear: what the account holds, as the room's ledger
          has it. Nothing to buy here; a market for them comes later. */}
      <GemsHeld />
      <p className="wpn-note">
        {note || `${mine.filter((k) => ITEMS.some((i) => i.key === k)).length} of ${ITEMS.length} fitted. Yours on every hull.`}
      </p>
    </>
  );
}

const GEM_NAMES = ["Yellow", "Green", "Blue", "Purple", "Red", "White", "Fuchsia"];
const GEM_COLOURS = [0xf5d90a, 0x57e06a, 0x4fa8ff, 0xa96bff, 0xff4d4d, 0xf2f6ff, 0xff45d0];

function GemsHeld() {
  const [bank, setBank] = useState<BankView>(() => bankView());
  useEffect(() => subscribeBank(setBank), []);
  const gems = bank.purse?.gems ?? [];
  const total = gems.reduce((a, b) => a + b, 0);
  return (
    <div className="pts-block gems-held">
      <h4>GEMS</h4>
      {bank.status !== "live" ? (
        <p>Join the room to see the gems you hold.</p>
      ) : total === 0 ? (
        <p>None yet. A flock's last member leaves one; fly through it.</p>
      ) : (
        <div className="gem-row">
          {gems.map((n, i) => n > 0 && (
            <span key={i} className="gem-chip" style={{ borderColor: `#${GEM_COLOURS[i].toString(16).padStart(6, "0")}` }}>
              <i style={{ background: `#${GEM_COLOURS[i].toString(16).padStart(6, "0")}` }} />
              {GEM_NAMES[i]} <b>{n}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
