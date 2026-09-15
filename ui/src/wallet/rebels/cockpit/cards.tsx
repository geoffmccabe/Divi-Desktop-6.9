// The cards and panels that take over the screen: launching, dying, a game
// that could not start, and the panels opened from keys or buttons (help,
// high scores, the ship market, DFlow, the inventory).

import type { ReactNode } from "react";
import type { RebelsController, HudState } from "../rebelsController";
import type { Cockpit } from "./useCockpit";
import { RebelsScoreboard } from "../RebelsScoreboard";
import { RebelsControls, ControlsBoard } from "../RebelsControls";
import { flightExtras } from "../rebelsArmoury";
import { loadShip } from "../shipChoice";
import { ShipMarket } from "../ShipMarket";
import { DflowPanel } from "../DflowPanel";
import { InventoryPanel } from "../InventoryPanel";
import pandaUrl from "../../../assets/rebels_panda.webp";

export function NoLaunchCard({ hud }: { hud: HudState }) {
  if (!hud.broken) return null;
  return (
    <div className="orbit-card">
      <h2>NO LAUNCH</h2>
      <p>The game could not start on this globe.</p>
      <p className="orbit-keys">{hud.broken}</p>
      <p className="orbit-keys">The map itself is unaffected.</p>
    </div>
  );
}

/** Whichever panels are open: help (?), high scores, spaceships, DFlow (#), inventory (I). */
export function CockpitPanels({ c }: { c: Cockpit }) {
  return (
    <>
      {c.help && <RebelsControls onClose={() => c.setHelp(false)} extras={flightExtras(loadShip())} />}

      {c.scores && <RebelsScoreboard onClose={() => c.setScores(false)} />}

      {c.market && <ShipMarket onClose={() => c.setMarket(false)} />}
      {c.dflowOpen && <DflowPanel onClose={() => c.setDflow(false)} />}
      {c.inv && <InventoryPanel onClose={() => c.setInv(false)} />}
    </>
  );
}

/** Before launch: who is launching, how to fly, and the buttons. */
export function LaunchCard({ ctl, c, howTo }: {
  ctl: RebelsController; c: Cockpit;
  /** How to fly, beside the logo. The keyboard by default; a phone shows its thumbs. */
  howTo?: ReactNode;
}) {
  const { hud, slow } = c;
  if (!(!hud.broken && !hud.launched && !c.scores && !c.market)) return null;
  return (
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
        {/* The keyboard, pointed at, rather than two dozen lines of
            text beside the logo. */}
        {howTo ?? <ControlsBoard extras={flightExtras(loadShip())} />}
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
        <button type="button" className="orbit-secondary" onClick={() => c.setScores(true)}>
          HIGH SCORES
        </button>
        <button type="button" className="orbit-secondary" onClick={() => c.setMarket(true)}>
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
  );
}

/** After death: where you were recovered to, and the way back in. */
export function DeathCard({ ctl, c }: { ctl: RebelsController; c: Cockpit }) {
  const { hud } = c;
  if (!(!hud.broken && hud.dead && !c.scores)) return null;
  return (
    <div className="orbit-card orbit-card-died">
      <p>Your ship is lost. Recovered to {hud.homeName}.</p>
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
        <button type="button" className="orbit-secondary" onClick={() => c.setScores(true)}>
          HIGH SCORES
        </button>
      </div>
    </div>
  );
}
