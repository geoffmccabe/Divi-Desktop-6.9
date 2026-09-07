// The cockpit. Everything you can see through it is the Node Map's own globe.
//
// Drawn in the DOM rather than in the 3D scene: it is flat, it never moves with
// the world, and this way it uses the same theme tokens as every other surface
// in the wallet, so a skin restyles the cockpit along with everything else.

import { useEffect, useRef, useState } from "react";
import "./orbit.css";
import { MAX_ALT } from "./orbitWorld";
import { MAX_AMMO, MAX_SHIELD, MAX_TORPEDOES, MAX_GUARDS } from "./orbitFlight";
import { TIERS } from "./rebelsCombat";
import type { RebelsController, HudState } from "./rebelsController";
import { RebelsScoreboard } from "./RebelsScoreboard";

export function RebelsHud({ ctl, onExit }: { ctl: RebelsController; onExit: () => void }) {
  const [hud, setHud] = useState<HudState>(() => ctl.hud());
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const crossRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => ctl.subscribe(setHud), [ctl]);

  /* If the globe never hands the game its scene, the launch button would sit on
     "finding your node" for ever with nothing explaining why. Say so instead. */
  const [slow, setSlow] = useState(false);
  const [scores, setScores] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 10000);
    return () => clearTimeout(t);
  }, []);

  /* The crosshair is read from the controller every frame rather than from
     pointer events. Under pointer lock there is no cursor position to read, only
     movement, so the controller owns where the crosshair is and this just draws
     it. Going through React state instead would make aiming feel soggy. */
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const wrap = wrapRef.current, cross = crossRef.current;
      if (!wrap || !cross) return;
      const c = ctl.cursor();
      const r = wrap.getBoundingClientRect();
      cross.style.left = `${c.x * r.width}px`;
      cross.style.top = `${c.y * r.height}px`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ctl]);

  /* Escape leaves. The browser hands the pointer back when it is pressed, which
     the controller notices; this covers the case where the webview would not
     take the pointer in the first place. */
  useEffect(() => {
    ctl.onEscape(onExit);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onExit(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctl, onExit]);

  /* Fence the game in. With the pointer locked this never fires, because the
     cursor cannot leave the canvas at all. Without a lock it is the fallback:
     a click that lands outside the map is swallowed rather than being allowed
     to navigate away and unmount the game mid-flight. */
  useEffect(() => {
    if (!hud.launched || hud.dead) return;
    const swallow = (e: Event) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const map = wrap.closest(".netmap-canvas-wrap");
      if (map && e.target instanceof Node && !map.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    for (const k of ["pointerdown", "mousedown", "click"]) {
      document.addEventListener(k, swallow, true);
    }
    return () => {
      for (const k of ["pointerdown", "mousedown", "click"]) {
        document.removeEventListener(k, swallow, true);
      }
    };
  }, [hud.launched, hud.dead]);

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
        {hud.inFlight > 0 && <div className="orbit-row orbit-torp-live">TORPEDO ARMED</div>}
        {hud.junk > 0 && <div className="orbit-row orbit-dim">{hud.junk} wreckage</div>}
        {hud.bonus && <div className="orbit-row orbit-bonus">STAKE WON &middot; TRIPLE DAMAGE</div>}
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
            <div><span>TORP</span><i><b style={{ width: pct(hud.torpedoes / MAX_TORPEDOES) }} /></i></div>
            <div><span>GUARD</span><i><b style={{ width: pct(hud.guards / MAX_GUARDS) }} /></i></div>
          </div>
        </div>
      )}

      {hud.launched && (
        <div className="orbit-score">
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
      )}

      <div className="orbit-bars">
        <div className="orbit-gauge">
          <span>SHIELDS {Math.max(0, Math.round((hud.shields / MAX_SHIELD) * 100))}%</span>
          <div className={"orbit-meter" + (hud.shields <= MAX_SHIELD * 0.3 ? " low" : "")}>
            <i style={{ width: pct(hud.shields / MAX_SHIELD) }} />
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
          <span>BOOST</span>
          <div className="orbit-meter boost"><i style={{ width: pct(hud.boost) }} /></div>
        </div>
      </div>

      <button type="button" className="orbit-exit" onClick={onExit} title="Back to the map">
        {hud.launched ? "ESC  BACK TO MAP" : "BACK TO MAP"}
      </button>

      {hud.broken && (
        <div className="orbit-card">
          <h2>NO LAUNCH</h2>
          <p>The game could not start on this globe.</p>
          <p className="orbit-keys">{hud.broken}</p>
          <p className="orbit-keys">The map itself is unaffected.</p>
        </div>
      )}

      {scores && <RebelsScoreboard onClose={() => setScores(false)} />}

      {!hud.broken && !hud.launched && !scores && (
        <div className="orbit-card orbit-card-clear">
          <h2>DIVI REBELS</h2>
          <p>{hud.homeName === "no node located" ? "No node of your own found, launching from the network." : `Launching from ${hud.homeName}.`}</p>
          <p className="orbit-keys">
            POINT TO FLY, OR ARROWS<br />
            CLICK OR SPACE TO FIRE &nbsp;&nbsp; SHIFT BOOST &nbsp;&nbsp; Z BRAKE<br />
            CTRL+CLICK LAUNCHES A TORPEDO, AGAIN TO DETONATE IT<br />
            FLY UP TO ANY TOWER TO REPAIR AND REARM. YOUR OWN IS TWICE AS FAST.
          </p>
          <div className="orbit-buttons">
            <button type="button" onClick={() => ctl.launch()} disabled={!hud.ready}>
              {hud.ready ? "LAUNCH" : slow ? "GLOBE NOT READY" : "FINDING YOUR NODE…"}
            </button>
            <button type="button" className="orbit-secondary" onClick={() => setScores(true)}>
              HIGH SCORES
            </button>
          </div>
          {!hud.ready && slow && (
            <p className="orbit-keys">
              The globe has not finished loading. Leave and come back once the
              map is showing its towers.
            </p>
          )}
        </div>
      )}

      {!hud.broken && hud.dead && !scores && (
        <div className="orbit-card">
          <h2>SHIP LOST</h2>
          <p>Recovered to {hud.homeName}.</p>
          <p className="orbit-keys">Run filed. Score resets from here.</p>
          <div className="orbit-buttons">
            <button type="button" onClick={() => ctl.respawn()}>LAUNCH AGAIN</button>
            <button type="button" className="orbit-secondary" onClick={() => setScores(true)}>
              HIGH SCORES
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
