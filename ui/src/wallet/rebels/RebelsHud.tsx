// The cockpit. Everything you can see through it is the Node Map's own globe.
//
// Drawn in the DOM rather than in the 3D scene: it is flat, it never moves with
// the world, and this way it uses the same theme tokens as every other surface
// in the wallet, so a skin restyles the cockpit along with everything else.

import { useEffect, useRef, useState } from "react";
import "./orbit.css";
import { MAX_ALT } from "./orbitWorld";
import { MAX_AMMO, MAX_SHIELD } from "./orbitFlight";
import type { RebelsController, HudState } from "./rebelsController";

export function RebelsHud({ ctl, onExit }: { ctl: RebelsController; onExit: () => void }) {
  const [hud, setHud] = useState<HudState>(() => ctl.hud());
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const crossRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => ctl.subscribe(setHud), [ctl]);

  /* If the globe never hands the game its scene, the launch button would sit on
     "finding your node" for ever with nothing explaining why. Say so instead. */
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 10000);
    return () => clearTimeout(t);
  }, []);

  /* The crosshair follows the pointer directly rather than through React. At
     sixty moves a second a setState per move makes the stick feel soggy. */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const wrap = wrapRef.current, cross = crossRef.current;
      if (!wrap || !cross) return;
      const r = wrap.getBoundingClientRect();
      cross.style.left = `${e.clientX - r.left}px`;
      cross.style.top = `${e.clientY - r.top}px`;
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
  /* One globe unit is about 64 km of real Earth, which is what makes this a
     mini-globe rather than a map. */
  const kms = Math.round(hud.speed * 64);

  return (
    <div className="orbit-hud" ref={wrapRef}>
      <div className="orbit-tl">
        <div className="orbit-big">{kms} <span className="orbit-dim">km/s</span></div>
        <div className="orbit-row orbit-dim">ALT {Math.round((hud.alt / MAX_ALT) * 100)}%</div>
      </div>
      <div className="orbit-tr">
        <div className="orbit-row">HOME {hud.homeName}</div>
        <div className="orbit-row orbit-dim">
          {hud.homeDist > 0 ? `${Math.round(hud.homeDist * 64)} km away` : " "}
        </div>
        <div className="orbit-row orbit-dim">{hud.towers} towers</div>
        <div className={"orbit-row" + (hud.contacts > 0 ? " orbit-alert" : " orbit-dim")}>
          {hud.contacts > 0 ? `${hud.contacts} CONTACT${hud.contacts > 1 ? "S" : ""}` : "no contacts"}
        </div>
        <div className="orbit-row orbit-dim">{hud.kills} down</div>
      </div>

      {hud.launched && !hud.dead && !hud.broken && <div className="orbit-cross" ref={crossRef} />}

      {hud.launched && hud.dock > 0 && (
        <div className="orbit-dock">
          <div className="orbit-dock-title">
            {hud.docked ? "RESUPPLIED" : `DOCKED  ${hud.dockName}`}
          </div>
          <div className="orbit-dockbar"><i style={{ width: pct(hud.dock) }} /></div>
          {/* What is actually being restored, filling as it goes. */}
          <div className="orbit-dock-lines">
            <div><span>HULL</span><i><b style={{ width: pct(hud.shields / MAX_SHIELD) }} /></i></div>
            <div><span>AMMO</span><i><b style={{ width: pct(hud.ammo / MAX_AMMO) }} /></i></div>
            <div><span>BOOST</span><i><b style={{ width: pct(hud.boost) }} /></i></div>
          </div>
        </div>
      )}

      <div className="orbit-bars">
        <div className="orbit-gauge">
          <span>SHIELDS</span>
          <div className="orbit-pips">
            {Array.from({ length: MAX_SHIELD }, (_, i) => (
              <div key={i} className={"orbit-pip" + (i < hud.shields ? " on" : "") + (hud.shields <= 2 ? " low" : "")} />
            ))}
          </div>
        </div>
        <div className="orbit-gauge">
          <span>AMMO</span>
          <div className="orbit-meter"><i style={{ width: pct(hud.ammo / MAX_AMMO) }} /></div>
        </div>
        <div className="orbit-gauge">
          <span>BOOST</span>
          <div className="orbit-meter boost"><i style={{ width: pct(hud.boost) }} /></div>
        </div>
      </div>

      <button type="button" className="orbit-exit" onClick={onExit} title="Back to the map">
        BACK TO MAP
      </button>

      {hud.broken && (
        <div className="orbit-card">
          <h2>NO LAUNCH</h2>
          <p>The game could not start on this globe.</p>
          <p className="orbit-keys">{hud.broken}</p>
          <p className="orbit-keys">The map itself is unaffected.</p>
        </div>
      )}

      {!hud.broken && !hud.launched && (
        <div className="orbit-card orbit-card-clear">
          <h2>DIVI REBELS</h2>
          <p>{hud.homeName === "no node located" ? "No node of your own found, launching from the network." : `Launching from ${hud.homeName}.`}</p>
          <p className="orbit-keys">
            POINT TO FLY, OR ARROWS<br />
            CLICK OR SPACE TO FIRE &nbsp;&nbsp; SHIFT BOOST &nbsp;&nbsp; Z BRAKE<br />
            FLY UP TO ANY TOWER TO REPAIR AND REARM. YOUR OWN IS TWICE AS FAST.
          </p>
          <button type="button" onClick={() => ctl.launch()} disabled={!hud.ready}>
            {hud.ready ? "LAUNCH" : slow ? "GLOBE NOT READY" : "FINDING YOUR NODE…"}
          </button>
          {!hud.ready && slow && (
            <p className="orbit-keys">
              The globe has not finished loading. Leave and come back once the
              map is showing its towers.
            </p>
          )}
        </div>
      )}

      {!hud.broken && hud.dead && (
        <div className="orbit-card">
          <h2>SHIP LOST</h2>
          <p>Recovered to {hud.homeName}.</p>
          <button type="button" onClick={() => ctl.respawn()}>LAUNCH AGAIN</button>
        </div>
      )}
    </div>
  );
}
