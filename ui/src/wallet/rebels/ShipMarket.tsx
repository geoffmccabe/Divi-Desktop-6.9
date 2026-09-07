// The Ship Market.
//
// A circular panel in the middle of the screen with one hull turning in front
// of it and its numbers beside it, and a way through all thirty-two.
//
// The circle is the whole design. The game's other panels are rectangles down
// an edge, because that is what a cockpit readout is; this one is meant to feel
// like a viewport with something floating in it, so it is round, centred, and
// the ship is allowed to overlap its edge.

import { useEffect, useMemo, useState } from "react";
import { shipCatalog, STAT_ROWS, SHIP_CLASSES, type Ship } from "./shipCatalog";
import { ShipPreview } from "./ShipPreview";
import {
  PARTS, FACTORY, OVERLAYS, chipColour, loadPaint, savePaint, type PartKey, type ShipPaint,
} from "./shipColours";
import { loadShip, saveShip } from "./shipChoice";
import { saveShip as saveShipRemote } from "./rebelsShips";

export function ShipMarket({ onClose }: { onClose: () => void }) {
  const all = useMemo(() => shipCatalog(), []);
  /* Opens on the ship the player already flies rather than on the first in the
     list, so the Market is where their ship is rather than where the catalogue
     starts. */
  const [pick, setPick] = useState(() => {
    const want = loadShip();
    const i = all.findIndex((s) => s.id === want);
    return i >= 0 ? i : 0;
  });
  const ship: Ship = all[pick] ?? all[0];
  useEffect(() => { saveShip(ship.id); }, [ship.id]);


  /* The paint. One scheme for the whole fleet rather than one per hull: every
     ship in the pack shares the same five swatches, so a per-ship scheme would
     be five times the work for the player and would make the fleet look like a
     jumble sale. Kept between sessions. */
  const [paint, setPaint] = useState<ShipPaint>(() => loadPaint());
  const [tuning, setTuning] = useState<PartKey | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { savePaint(paint); }, [paint]);

  /* And to Supabase, so a reinstall or a second machine does not cost anyone
     their fleet. Debounced, because this fires on every frame of a slider drag
     and the row only has to end up right, not to be right at every instant. */
  useEffect(() => {
    const t = setTimeout(() => { void saveShipRemote(ship.id, ship.tier, paint); }, 900);
    return () => clearTimeout(t);
  }, [ship.id, ship.tier, paint]);

  const setPart = (key: PartKey, field: "hue" | "sat" | "bright", v: number) =>
    setPaint((p) => ({ ...p, [key]: { ...p[key], [field]: v } }));

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
        {/* ---- ONE COLUMN HOLDS THE SHIP ----
            The name, the ring and the paint shop, in that order, in a single
            flex column that owns the left 65%. The specs are its SIBLING and
            own the right 35%.

            Nesting them like this is the point rather than tidiness. Both of
            the last two goes at this layout put things in the same grid cell
            and relied on placement to keep them apart: first the name and the
            paint shop, where the sliders covered the description and the
            buttons under them never saw a click; then the specs themselves,
            whose whole column was accidentally rendered inside this one and
            landed on top of the ship. Geoff, both times, correctly. Elements
            stacked in a flex column cannot overlap each other however small the
            window gets, so the failure is not available any more. */}
        <div className="ship-market-left">
          <div className="ship-market-head">
            <h2>{ship.name}</h2>
            <div className="ship-market-tier">TIER {ship.tier}</div>
            <p className="ship-market-role">{ship.role}</p>
          </div>

          <div className="ship-market-stage">
            <div className="ship-market-ring">
              <ShipPreview id={ship.id} paint={paint} />
            </div>
          </div>

          {/* ---- the paint shop ----
              Five buttons, three sliders each. Five because that is how many
              distinct swatches every ship in the pack actually samples: the blue
              hull, the dark panelling under it, the orange trim, the light edges
              and the engine glow. Not a guess — the atlas was sampled through a
              fighter's, a cruiser's and a station's own UVs to find out. */}
          <div className="ship-paint">
            <div className="ship-paint-parts">
              {PARTS.map((part) => (
                <button
                  type="button"
                  key={part.key}
                  className={tuning === part.key ? "on" : ""}
                  onClick={() => setTuning(tuning === part.key ? null : part.key)}
                  title={part.note}
                >
                  <span className="ship-paint-chip" style={{ background: chipColour(part.key, paint) }} />
                  {part.label}
                </button>
              ))}
              <button
                type="button"
                className="ship-paint-reset"
                onClick={() => setConfirmReset(true)}
              >
                RESET
              </button>
            </div>

            {tuning && (
              <div className="ship-paint-sliders">
                <p>{PARTS.find((p) => p.key === tuning)?.note}</p>
                <label>
                  <span>Hue</span>
                  <input
                    type="range" min={0} max={360} step={1}
                    value={paint[tuning].hue}
                    onChange={(e) => setPart(tuning, "hue", Number(e.target.value))}
                  />
                  <b>{Math.round(paint[tuning].hue)}&deg;</b>
                </label>
                <label>
                  <span>Saturation</span>
                  <input
                    type="range" min={0} max={100} step={1}
                    value={Math.round(paint[tuning].sat * 100)}
                    onChange={(e) => setPart(tuning, "sat", Number(e.target.value) / 100)}
                  />
                  <b>{Math.round(paint[tuning].sat * 100)}%</b>
                </label>
                <label>
                  <span>Brightness</span>
                  <input
                    type="range" min={0} max={600} step={1}
                    value={Math.round(paint[tuning].bright * 100)}
                    onChange={(e) => setPart(tuning, "bright", Number(e.target.value) / 100)}
                  />
                  <b>{Math.round(paint[tuning].bright * 100)}%</b>
                </label>
                <p className="ship-paint-hint">
                  0% is black. For white, take saturation to 0 and brightness up.
                </p>

                <div className="ship-paint-overlays">
                  <span>Overlay</span>
                  <div>
                    {OVERLAYS.map((o) => (
                      <button
                        type="button"
                        key={o}
                        className={paint[tuning].overlay === o ? "on" : ""}
                        onClick={() => setPaint((p) => ({
                          ...p, [tuning]: { ...p[tuning], overlay: o },
                        }))}
                      >
                        {o === "none" ? "PLAIN" : o.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

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

        {confirmReset && (
          <div className="ship-paint-confirm">
            <p>Put every colour back to the factory scheme?</p>
            <div>
              <button
                type="button"
                onClick={() => { setPaint({ ...FACTORY }); setTuning(null); setConfirmReset(false); }}
              >
                YES
              </button>
              <button type="button" className="no" onClick={() => setConfirmReset(false)}>NO</button>
            </div>
          </div>
        )}

        <button type="button" className="ship-market-close" onClick={onClose}>CLOSE</button>
        <div className="ship-market-count">
          {pick + 1} of {all.length} &middot; class {classOf(ship) + 1} of {SHIP_CLASSES.length}
        </div>
      </div>
    </>
  );
}
