// The weapons page of the store.
//
// A list of the six guns down the left, in the order they have to be bought,
// each showing what it costs in points and what that comes to in DIVI at the
// live price. The ship itself stays on the right where it already is.
//
// WHY EVERY GUN IS SHOWN, INCLUDING THE ONES THAT CANNOT BE BOUGHT
// ----------------------------------------------------------------
// Geoff: "the guns are there and greyed out... it should say 'Tier 2 Upgrade'
// so it's clear that they need the lower tier first." A store that hides what
// you cannot afford tells a player nothing about where they are going. Showing
// the whole line, with the reason each one is out of reach, turns the armoury
// into the thing to save for.

import { useEffect, useState } from "react";
import {
  WEAPONS, upgradeLabel, priceInDivi, type WeaponSpec,
} from "./weaponCatalog";
import {
  owned, hasWeapon, spendable, blockedBecause, buyWithPoints, subscribeArmoury,
} from "./rebelsArmoury";
import { fetchPrices } from "../value";

/** What a gun's row is doing right now. */
type Standing =
  | { state: "owned" }
  | { state: "buy" }
  | { state: "poor"; short: number }
  | { state: "locked"; needs: string };

function standingOf(ship: string, spec: WeaponSpec, points: number): Standing {
  if (hasWeapon(ship, spec.key)) return { state: "owned" };
  const why = blockedBecause(ship, spec, points);
  if (!why) return { state: "buy" };
  if (why.startsWith("needs")) return { state: "locked", needs: why.slice(6) };
  return { state: "poor", short: spec.points - points };
}

export function WeaponStore({ ship, onTest }: {
  ship: string;
  /** Fire this weapon on the ship in the preview. */
  onTest?: (spec: WeaponSpec, down: boolean) => void;
}) {
  const [points, setPoints] = useState(() => spendable());
  const [mine, setMine] = useState<string[]>(() => owned(ship));
  const [diviUsd, setDiviUsd] = useState<number | null>(null);
  const [note, setNote] = useState("");

  /* Follow purchases from anywhere rather than polling. */
  useEffect(() => subscribeArmoury(() => {
    setPoints(spendable());
    setMine(owned(ship));
  }), [ship]);
  useEffect(() => { setMine(owned(ship)); }, [ship]);

  /* The DIVI price, from the wallet's own shared feed so the store and the
     header can never disagree. It is CoinMarketCap or it is nothing: see
     wallet/value.ts. A missing price shows no DIVI figure at all rather than
     a made-up one, because this is a button that spends real money. */
  useEffect(() => {
    let alive = true;
    void fetchPrices()
      .then((p) => { if (alive) setDiviUsd(p.prices.usd ?? null); })
      .catch(() => { /* no price; the DIVI column simply says so */ });
    return () => { alive = false; };
  }, []);

  const buy = (spec: WeaponSpec) => {
    const r = buyWithPoints(ship, spec.key);
    setNote(r.ok ? `${spec.name} fitted` : `${spec.name}: ${r.why}`);
  };

  /* ---- A FRAGMENT, NOT A WRAPPER ----
     The specs list on the Ships tab scrolls perfectly and always has. The only
     structural difference here was that the armoury put its scrolling list one
     level DEEPER: side column -> store -> list, where the specs go side column
     -> list. Every level of a flex chain has to be told it may shrink, and one
     link in that chain being wrong is invisible in the CSS and total in effect.
     
     Rather than work out which link, the difference is removed: these are now
     direct children of the side column, exactly as the specs are, and the list
     carries the same rules as the thing that already works. */
  return (
    <>
      <div className="wpn-purse">
        <span>POINTS</span><b>{Math.floor(points).toLocaleString()}</b>
        <em>one for each DIVI you bring home</em>
      </div>

      <div className="wpn-list">
        {WEAPONS.map((spec) => {
          const st = standingOf(ship, spec, points);
          const divi = priceInDivi(spec.points, diviUsd);

          return (
            <div
              key={spec.key}
              className={"wpn-row" + (st.state === "owned" ? " on" : "")
                + (st.state === "locked" ? " locked" : "")}
            >
              <span className="wpn-slot">{spec.slot}</span>
              <span className="wpn-swatch" style={spec.colour
                ? { background: `#${spec.colour.toString(16).padStart(6, "0")}` }
                : undefined} />
              <div className="wpn-what">
                <b>{spec.name}</b>
                <em>{spec.note}</em>
              </div>

              <div className="wpn-cost">
                {st.state === "owned" ? (
                  <span className="wpn-have">FITTED</span>
                ) : (
                  <>
                    <b>{spec.points.toLocaleString()} pts</b>
                    {/* No price, no number. Never a guess. */}
                    <em>{divi === null
                      ? "DIVI price unavailable"
                      : `or ${divi < 10 ? divi.toFixed(2) : Math.round(divi).toLocaleString()} DIVI`}</em>
                  </>
                )}
              </div>

              {/* ---- TEST ----
                  Held rather than clicked, because a beam is a held weapon:
                  tapping it shows half a second and tells you nothing about
                  what five seconds of it looks like. Pointer capture, so
                  letting go anywhere on the screen still stops it rather than
                  leaving it stuck on. */}
              <button
                type="button"
                className="wpn-test"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  onTest?.(spec, true);
                }}
                onPointerUp={() => onTest?.(spec, false)}
                onPointerCancel={() => onTest?.(spec, false)}
              >
                TEST
              </button>

              <div className="wpn-act">
                {st.state === "buy" && (
                  <button type="button" onClick={() => buy(spec)}>BUY</button>
                )}
                {st.state === "poor" && (
                  <span className="wpn-short">
                    {Math.ceil(st.short).toLocaleString()} more
                  </span>
                )}
                {/* The whole point of showing a locked gun: say what is in the
                    way, by name, rather than only that it is out of reach. */}
                {st.state === "locked" && (
                  <span className="wpn-locked">{upgradeLabel(spec)}<em>needs {st.needs}</em></span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="wpn-note">
        {note || `${mine.length} of ${WEAPONS.length} fitted. Weapons stay with this hull.`}
      </p>
    </>
  );
}
