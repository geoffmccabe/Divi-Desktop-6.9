// The cockpit. Everything you can see through it is the Node Map's own globe.
//
// Drawn in the DOM rather than in the 3D scene: it is flat, it never moves with
// the world, and this way it uses the same theme tokens as every other surface
// in the wallet, so a skin restyles the cockpit along with everything else.

import { useEffect, useRef, useState } from "react";
import "./orbit.css";
import { MAX_AMMO, MAX_SHIELD, MAX_TORPEDOES, MAX_GUARDS } from "./orbitFlight";
import { TIERS } from "./rebelsCombat";
import type { RebelsController, HudState } from "./rebelsController";
import { RebelsScoreboard } from "./RebelsScoreboard";
import { RebelsControls, controlLines } from "./RebelsControls";
import { flightExtras } from "./rebelsArmoury";
import { loadShip } from "./shipChoice";
import { ShipMarket } from "./ShipMarket";
import { DflowPanel } from "./DflowPanel";
import { InventoryPanel } from "./InventoryPanel";
import { heldCount } from "./rebelsInventory";
import { subscribeArmoury } from "./rebelsArmoury";
import { RebelsHealthBar } from "./RebelsHealthBar";
import { ShipBadge } from "./ShipBadge";
import pandaUrl from "../../assets/rebels_panda.webp";

export function RebelsHud({ ctl, onExit }: { ctl: RebelsController; onExit: () => void }) {
  const [hud, setHud] = useState<HudState>(() => ctl.hud());
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const crossRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => ctl.subscribe(setHud), [ctl]);

  /* If the globe never hands the game its scene, the launch button would sit on
     "finding your node" for ever with nothing explaining why. Say so instead. */
  const [slow, setSlow] = useState(false);
  const [scores, setScores] = useState(false);
  const [help, setHelp] = useState(false);
  const [market, setMarket] = useState(false);
  const [dflowOpen, setDflow] = useState(false);
  const [inv, setInv] = useState(false);
  /* The inventory needs the mouse: tell the controller so letting go of the
     pointer lock does not read as Escape, and it is taken back on close. */
  useEffect(() => { ctl.panel(inv); }, [ctl, inv]);

  /* The hit flash: everything behind the cockpit inverts for a tenth of a
     second. Driven by a timestamp rather than a boolean so two hits in quick
     succession each get their own flash. */
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (!hud.hitAt) return;
    setFlashing(true);
    const t = setTimeout(() => setFlashing(false), 100);
    return () => clearTimeout(t);
  }, [hud.hitAt]);
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
      /* # opens the DFlow panel. Not while a cheat sequence is being typed:
         the sequence swallows its own keys, so a lone # is always this. */
      if (e.key === "#" && !(e.target instanceof HTMLInputElement)) {
        setDflow((v) => !v);
        return;
      }
      if ((e.key === "i" || e.key === "I") && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        setInv((v) => !v);
        return;
      }
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setHelp((v) => !v);
      }
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

  /* Three seconds held, two fading. Driven off the announcement time so a wave
     arriving while the last title is still up simply replaces it. */
  const [waveShown, setWaveShown] = useState(0);
  const [waveOpacity, setWaveOpacity] = useState(0);
  useEffect(() => {
    if (!hud.waveAt || !hud.wave) return;
    setWaveShown(hud.wave);
    setWaveOpacity(1);
    const hold = setTimeout(() => setWaveOpacity(0), 3000);
    const gone = setTimeout(() => setWaveShown(0), 5000);
    return () => { clearTimeout(hold); clearTimeout(gone); };
  }, [hud.waveAt, hud.wave]);

  const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
  /* One globe unit is about 64 km of real Earth, which is what makes this a
     mini-globe rather than a map. */
  const kms = Math.round(hud.speed * 64);

  return (
    <div className="orbit-hud" ref={wrapRef}>
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
      <div className="orbit-tr">
        {/* Your ship, or — when there is something out there worth naming —
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

      {flashing && <div className="orbit-invert" />}

      {/* The wave title: three seconds at full, then two fading out. */}
      {waveShown > 0 && (
        <div className="orbit-wave" key={hud.waveAt} style={{ opacity: waveOpacity }}>
          WAVE {waveShown}
        </div>
      )}

      {hud.launched && !hud.dead && !hud.broken && hud.rear && (
        <div className={"orbit-rear" + (hud.rearAim ? " aiming" : "")}>
          <span>REAR{hud.rearAim ? ": FIRING BACKWARDS" : ""}</span>
        </div>
      )}
      {hud.launched && !hud.dead && !hud.broken && <div className={"orbit-cross" + (hud.rearAim ? " rear" : "")} ref={crossRef} />}

      {hud.launched && hud.dock > 0 && (
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
      )}

      {hud.launched && (
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
      )}

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

      {/* What was just selected, or why it could not be. Two seconds and gone:
          long enough to read, short enough not to become furniture. */}
      {hud.note && performance.now() - hud.noteAt < 2000 && (
        <div className="orbit-note">{hud.note}</div>
      )}

      {/* The connection, when it is not there. The fight is the server's, so
          this is the difference between a quiet sky and a lost one. */}
      {hud.launched && !hud.broken && hud.room !== "live" && (
        <div className="orbit-offline">
          {hud.room === "refused" ? "LOST THE FIGHT: RETRYING" : "RECONNECTING"}
        </div>
      )}

      <RebelsHealthBar />

      {help && <RebelsControls onClose={() => setHelp(false)} extras={flightExtras(loadShip())} />}

      {scores && <RebelsScoreboard onClose={() => setScores(false)} />}

      {market && <ShipMarket onClose={() => setMarket(false)} />}
      {dflowOpen && <DflowPanel onClose={() => setDflow(false)} />}
      {inv && <InventoryPanel onClose={() => setInv(false)} />}

      {!hud.broken && !hud.launched && !scores && !market && (
        <div className="orbit-card orbit-card-clear">
          {/* Two columns: who this is on the left, how to fly it on the right.
              The controls used to run the full width under the title, which
              made the card a wall of text with a heading on top of it. */}
          <div className="orbit-launch-top">
            <div className="orbit-launch-badge">
              <img src={pandaUrl} alt="" />
              <h2>DIVI REBELS</h2>
              <p>{hud.homeName === "no node located" ? "No node of your own found, launching from the network." : `Launching from ${hud.homeName}.`}</p>
            </div>
            <div className="orbit-launch-keys">
              {controlLines({ extras: flightExtras(loadShip()) }).map((c) => (
                <div key={c.keys}><b>{c.keys}</b><span>{c.what}</span></div>
              ))}
            </div>
          </div>
          <div className="orbit-buttons">
            {/* ---- ONE GAME ----
                The fight runs on the server and nowhere else, so there is
                nothing to launch into until the connection is up. */}
            <button type="button" onClick={() => ctl.launch()} disabled={!hud.ready || hud.room !== "live"}>
              {!hud.ready
                ? (slow ? "GLOBE NOT READY" : "FINDING YOUR NODE…")
                : hud.room === "live"
                  ? "LAUNCH"
                  : hud.room === "refused"
                    ? "CANNOT REACH THE FIGHT"
                    : "CONNECTING TO THE FIGHT…"}
            </button>
            <button type="button" className="orbit-secondary" onClick={() => setScores(true)}>
              HIGH SCORES
            </button>
            <button type="button" className="orbit-secondary" onClick={() => setMarket(true)}>
              SPACESHIPS
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
            <button
              type="button"
              onClick={() => ctl.respawn()}
              disabled={hud.respawnIn > 0 || hud.room !== "live"}
            >
              {hud.respawnIn > 0
                ? `REJOIN IN ${Math.ceil(hud.respawnIn)}`
                : hud.room === "live" ? "LAUNCH AGAIN" : "CONNECTING TO THE FIGHT…"}
            </button>
            <button type="button" className="orbit-secondary" onClick={() => setScores(true)}>
              HIGH SCORES
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** What Y would use: the held recharges and supercharges, when there are any. */
function HeldRow() {
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
