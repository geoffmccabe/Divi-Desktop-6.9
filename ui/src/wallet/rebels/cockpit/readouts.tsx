// The cockpit's standing information: what the numbers say while you fly.
//
// Flight readout (speed, height, throttle, nearest tower, frame rate), the
// corner beside it (your ship, what you are near, home, waves, contacts), the
// dock's resupply, the score corner and the gauges along the bottom. Each is
// drawn from the HUD state alone, so any layout can place it anywhere.

import { useEffect, useState } from "react";
import { MAX_AMMO, MAX_SHIELD, MAX_TORPEDOES, MAX_GUARDS } from "../orbitFlight";
import { TIERS } from "../rebelsCombat";
import type { HudState } from "../rebelsController";
import { heldCount } from "../rebelsInventory";
import { subscribeArmoury } from "../rebelsArmoury";
import { ShipBadge } from "../ShipBadge";

export const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;

/** Top left: how fast, how high, the throttle, the nearest tower and the frame rate. */
export function FlightReadout({ hud }: { hud: HudState }) {
  /* One globe unit is about 64 km of real Earth, which is what makes this a
     mini-globe rather than a map. */
  const kms = Math.round(hud.speed * 64);
  return (
    <div className="orbit-tl">
      <div className="orbit-big">{kms} <span className="orbit-dim">km/s</span></div>
      {/* A REAL height, not a percentage of the ceiling. The ceiling used to
          be thirty units, so a percentage of it meant something. It is now
          eight planet radii, and ordinary flying would have read as 1%. The
          same 64km per unit the speed uses. */}
      <div className="orbit-row orbit-dim">ALT {Math.round(hud.alt * 64).toLocaleString()} <span className="orbit-dim">km</span></div>
      {/* The throttle lever. Shown as a number because it is a setting the
          player made and can forget, unlike speed which they can feel. */}
      <div className="orbit-row orbit-dim">
        THR {Math.round(hud.throttle * 100)}%
        {hud.throttle < 0 && <span className="orbit-alert"> REV</span>}
      </div>
      {/* How far the nearest tower is. It used to sit in the middle of the
          screen, under the crosshair, which is the one place a flying game
          cannot afford to put standing information: it is where the player
          is looking at the thing they are trying to hit. */}
      {hud.launched && !hud.dead && Number.isFinite(hud.nearTower) && (
        <div className="orbit-row orbit-dim">TOWER {hud.nearTower.toFixed(1)}u</div>
      )}
      {/* The frame readout. Frames per second as delivered, and the game's
          own share of each frame in milliseconds; what is left of the frame
          is the map drawing itself. Small and dim: it is for tuning, not
          for flying by. */}
      {hud.fps > 0 && (
        <div className="orbit-row orbit-dim orbit-frame">
          {hud.fps} FPS <span className="orbit-dim">{hud.simMs.toFixed(1)}ms game{hud.drawCalls > 0 ? ` · ${hud.drawCalls} draws` : ""}{hud.pixelRatio > 0 ? ` · ${hud.pixelRatio}x` : ""}</span>
        </div>
      )}
    </div>
  );
}

/** Top right: your ship or what you are near, home, the fight around you. */
export function CornerInfo({ hud }: { hud: HudState }) {
  return (
    <div className="orbit-tr">
      {/* Your ship, or, when there is something out there worth naming,
          that instead. The two share this corner and never overlap: one
          fades out as the other fades in. */}
      {hud.launched && <ShipBadge hidden={!!hud.nearby} />}

      {/* What you are near, first, because it is the thing that just changed
          and the rest of this corner is standing information. */}
      {hud.nearby && (
        <div className="orbit-nearby">
          <div className="orbit-row orbit-nearby-name">{hud.nearby.name}</div>
          <div className="orbit-row orbit-dim">{hud.nearby.detail}</div>
        </div>
      )}
      <div className="orbit-row">HOME {hud.homeName}</div>
      <div className="orbit-row orbit-dim">
        {hud.homeDist > 0 ? `${Math.round(hud.homeDist * 64)} km away` : " "}
      </div>
      <div className="orbit-row orbit-dim">{hud.towers} towers</div>
      {hud.wave > 0 && <div className="orbit-row">WAVE {hud.wave}</div>}
      {hud.flocks > 0 && <div className="orbit-row">FLOCKS {hud.flocks}</div>}
      <HeldRow />
      <div className={"orbit-row" + (hud.contacts > 0 ? " orbit-alert" : " orbit-dim")}>
        {hud.contacts > 0 ? `${hud.contacts} CONTACT${hud.contacts > 1 ? "S" : ""}` : "no contacts"}
      </div>
      <div className="orbit-row orbit-dim">{hud.kills} down</div>
      {hud.inFlight > 0 && <div className="orbit-row orbit-torp-live">TORPEDO ARMED</div>}
      {hud.junk > 0 && <div className="orbit-row orbit-dim">{hud.junk} wreckage</div>}
      {hud.bonus && <div className="orbit-row orbit-bonus">STAKE WON &middot; TRIPLE DAMAGE</div>}
    </div>
  );
}

/** What Y would use: the held recharges and supercharges, when there are any. */
export function HeldRow() {
  const [, bump] = useState(0);
  useEffect(() => subscribeArmoury(() => bump((n) => n + 1)), []);
  const r = heldCount("recharge"), s = heldCount("supercharge");
  if (r + s === 0) return null;
  return (
    <div className="orbit-row">
      Y {r > 0 && <>RECHARGE x{r}</>}{r > 0 && s > 0 && " / "}{s > 0 && <>SUPER x{s}</>}
    </div>
  );
}

/** Docked at a tower: the resupply filling, line by line. */
export function DockPanel({ hud }: { hud: HudState }) {
  if (!(hud.launched && hud.dock > 0)) return null;
  return (
    <div className="orbit-dock">
      <div className="orbit-dock-title">
        {hud.docked ? "RESUPPLIED" : `DOCKED  ${hud.dockName}`}
      </div>
      <div className="orbit-dockbar"><i style={{ width: pct(hud.dock) }} /></div>
      {/* What is actually being restored, filling as it goes. */}
      <div className="orbit-dock-lines">
        <div><span>HULL</span><i><b style={{ width: pct(Math.min(1, hud.shields / (hud.shieldMax || MAX_SHIELD))) }} /></i></div>
        <div><span>AMMO</span><i><b style={{ width: pct(hud.ammo / MAX_AMMO) }} /></i></div>
        <div><span>BOOST</span><i><b style={{ width: pct(hud.boost) }} /></i></div>
        <div><span>TORP</span><i><b style={{ width: pct(hud.torpedoes / MAX_TORPEDOES) }} /></i></div>
        <div><span>GUARD</span><i><b style={{ width: pct(hud.guards / MAX_GUARDS) }} /></i></div>
      </div>
    </div>
  );
}

/** DIVI earned, points, score and lifetime kills by tier. */
export function ScoreCorner({ hud }: { hud: HudState }) {
  if (!hud.launched) return null;
  return (
    <div className="orbit-score">
      <span>DIVI EARNED</span>
      <b className="orbit-divi">{hud.divi.toFixed(2)}</b>
      {/* Points, under the DIVI and in their own colour, because they are a
          different currency that happens to be earned at the same rate: one
          point for each DIVI brought home, and points are what buy guns. */}
      <span>POINTS</span>
      <b className="orbit-points">{Math.floor(hud.points).toLocaleString()}</b>
      <span>SCORE</span>
      <b>{hud.score.toLocaleString()}</b>
      {/* Lifetime kills by ship tier, rarest last, in each tier's colour. */}
      <div className="orbit-tiers">
        {TIERS.map((t, i) => (
          <div key={t.tier} title={`${t.name} (tier ${t.tier})`}>
            <i style={{ background: `#${t.colour.toString(16).padStart(6, "0")}` }} />
            <span>{hud.tierKills[i] ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Shields, ammo, torpedoes, guard and boost. */
export function GaugeBars({ hud }: { hud: HudState }) {
  return (
    <div className="orbit-bars">
      <div className="orbit-gauge">
        <span>SHIELDS {Math.max(0, Math.round((hud.shields / (hud.shieldMax || MAX_SHIELD)) * 100))}%</span>
        <div className={"orbit-meter" + (hud.shields <= (hud.shieldMax || MAX_SHIELD) * 0.3 ? " low" : "") + (hud.shields > (hud.shieldMax || MAX_SHIELD) ? " over" : "")}>
          <i style={{ width: pct(Math.min(1, hud.shields / (hud.shieldMax || MAX_SHIELD))) }} />
        </div>
      </div>
      <div className="orbit-gauge">
        <span>AMMO {hud.ammo.toFixed(2).replace(/\.00$/, "")}</span>
        <div className="orbit-meter"><i style={{ width: pct(hud.ammo / MAX_AMMO) }} /></div>
      </div>
      <div className="orbit-gauge">
        <span>TORPEDO</span>
        <div className="orbit-pips">
          {Array.from({ length: MAX_TORPEDOES }, (_, i) => (
            <div key={i} className={"orbit-pip orbit-torp" + (i < hud.torpedoes ? " on" : "")} />
          ))}
        </div>
      </div>
      <div className="orbit-gauge">
        <span>GUARD</span>
        <div className="orbit-pips">
          {Array.from({ length: MAX_GUARDS }, (_, i) => (
            <div key={i} className={"orbit-pip orbit-guard" + (i < hud.guards ? " on" : "")
              + (hud.guarding ? " up" : "")} />
          ))}
        </div>
      </div>
      <div className="orbit-gauge">
        <span>BOOST{hud.superBoost ? <em className="orbit-super"> {hud.superMult}x</em> : ""}</span>
        <div className={"orbit-meter boost" + (hud.superBoost ? " super" : "")}><i style={{ width: pct(hud.boost) }} /></div>
      </div>
    </div>
  );
}
