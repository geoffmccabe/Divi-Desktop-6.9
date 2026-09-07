// The Ship Market.
//
// A circular panel in the middle of the screen with one hull turning in front
// of it and its numbers beside it, and a way through all thirty-two.
//
// The circle is the whole design. The game's other panels are rectangles down
// an edge, because that is what a cockpit readout is; this one is meant to feel
// like a viewport with something floating in it, so it is round, centred, and
// the ship is allowed to overlap its edge.

import { useMemo, useState } from "react";
import { shipCatalog, STAT_ROWS, SHIP_CLASSES, type Ship } from "./shipCatalog";
import { ShipPreview } from "./ShipPreview";

export function ShipMarket({ onClose }: { onClose: () => void }) {
  const all = useMemo(() => shipCatalog(), []);
  const [pick, setPick] = useState(0);
  const ship: Ship = all[pick] ?? all[0];

  /* The best value in the market for each stat, so a bar means something
     across classes rather than only within one. A station's hull is the top of
     the hull scale, and a fighter's bar is honestly tiny next to it. */
  const peak = useMemo(() => {
    const out: Record<string, number> = {};
    for (const row of STAT_ROWS) {
      out[row.key] = Math.max(...all.map((s) => Number(s.stats[row.key]) || 0));
    }
    return out;
  }, [all]);

  const classOf = (s: Ship) => SHIP_CLASSES.findIndex((c) => c.name === s.className);
  const grouped = useMemo(() => {
    const map = new Map<string, Ship[]>();
    for (const s of all) {
      const list = map.get(s.className) ?? [];
      list.push(s);
      map.set(s.className, list);
    }
    return [...map.entries()];
  }, [all]);

  return (
    <>
      <div className="ship-market-scrim" onClick={onClose} />
      <div className="ship-market">
        <div className="ship-market-ring">
          <ShipPreview id={ship.id} />
        </div>

        <div className="ship-market-head">
          <h2>{ship.name}</h2>
          <div className="ship-market-tier">TIER {ship.tier}</div>
          <p className="ship-market-role">{ship.role}</p>
        </div>

        <div className="ship-market-stats">
          {STAT_ROWS.map((row) => {
            const v = Number(ship.stats[row.key]) || 0;
            const top = peak[row.key] || 1;
            /* A square-root scale. Linear would make every fighter stat a
               sliver next to a station's, and the point of the bar is to
               compare hulls you might actually choose between. */
            const fill = Math.max(0.02, Math.sqrt(v / top));
            return (
              <div className="ship-stat" key={row.key}>
                <span className="ship-stat-label">{row.label}</span>
                <span className="ship-stat-bar">
                  <i style={{ width: `${fill * 100}%` }} />
                </span>
                <span className="ship-stat-value">
                  {v.toLocaleString()}{row.unit && <em> {row.unit}</em>}
                </span>
              </div>
            );
          })}
          <p className="ship-market-note">
            Signature is the one to read backwards: lower is harder to see.
          </p>
        </div>

        <div className="ship-market-list">
          {grouped.map(([className, ships]) => (
            <div className="ship-market-class" key={className}>
              <h3>{className}</h3>
              <div className="ship-market-tiers">
                {ships.map((s) => {
                  const i = all.indexOf(s);
                  return (
                    <button
                      type="button"
                      key={s.id}
                      className={i === pick ? "on" : ""}
                      onClick={() => setPick(i)}
                      title={s.name}
                    >
                      {ships.length > 1 ? s.tier : "•"}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <button type="button" className="ship-market-close" onClick={onClose}>CLOSE</button>
        <div className="ship-market-count">
          {pick + 1} of {all.length} &middot; class {classOf(ship) + 1} of {SHIP_CLASSES.length}
        </div>
      </div>
    </>
  );
}
