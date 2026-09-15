// The cockpit on a phone, held sideways.
//
// The same cockpit state and the same pieces as the desktop layout (RebelsHud),
// arranged for two thumbs the way phone players already know from Galaxy on
// Fire and Call of Duty Mobile (see platform/touchInput.ts for why):
//
//   top left      speed, height, throttle
//   top right     small buttons: the gun (tap to change), REAR, VIEW, ITEMS, EXIT,
//                 and under them DIVI earned, points and score
//   left thumb    the steering stick, drawn where the thumb lands
//   right thumb   FIRE, with TORPEDO, AUTO, BOOST and BRAKE in an arc around it
//   bottom middle shields, ammo, torpedoes, guard, boost
//
// The buttons only carry data-rebels-touch; what they do is the touch module's.

import { useEffect, useState, type CSSProperties } from "react";
import "./phone.css";
import type { RebelsController } from "../rebelsController";
import type { TouchInput, TouchPicture } from "../platform/touchInput";
import { STICK_TRAVEL } from "../platform/touchInput";
import { RebelsHealthBar } from "../RebelsHealthBar";
import { weaponInSlot } from "../weaponCatalog";
import { heldCount } from "../rebelsInventory";
import { subscribeArmoury } from "../rebelsArmoury";
import { useCockpit } from "./useCockpit";
import { FlightReadout, DockPanel, ScoreCorner, GaugeBars } from "./readouts";
import { HitFlash, DiedBanner, WaveBanner, AimMarks, NoteLine, OfflineBanner } from "./overlays";
import { NoLaunchCard, CockpitPanels, LaunchCard, DeathCard } from "./cards";

export function PhoneHud({ ctl, touch, onExit }: { ctl: RebelsController; touch: TouchInput; onExit: () => void }) {
  const c = useCockpit(ctl, onExit);
  const { hud } = c;
  const [pic, setPic] = useState<TouchPicture>(() => touch.picture());
  useEffect(() => touch.subscribe(setPic), [touch]);
  const flying = hud.launched && !hud.dead && !hud.broken;

  return (
    <div className={"orbit-hud rebels-phone" + (hud.onTarget ? " on-target" : "")} ref={c.wrapRef}>
      <FlightReadout hud={hud} />
      <ScoreCorner hud={hud} />
      <HitFlash on={c.flashing} />
      <DiedBanner hud={hud} />
      <WaveBanner shown={c.waveShown} waveAt={hud.waveAt} opacity={c.waveOpacity} />
      <AimMarks hud={hud} crossRef={c.crossRef} />
      <DockPanel hud={hud} />
      <GaugeBars hud={hud} />
      <NoteLine hud={hud} />
      <OfflineBanner hud={hud} />
      <NoLaunchCard hud={hud} />
      <RebelsHealthBar />

      {flying && <ThumbControls pic={pic} primary={hud.primary} onItems={() => c.setInv(true)} onExit={onExit} />}
      {!flying && (
        <button type="button" className="phone-exit phone-exit-idle" onClick={onExit}>EXIT</button>
      )}

      <CockpitPanels c={c} />
      <LaunchCard ctl={ctl} c={c} howTo={<ThumbHowTo />} />
      <DeathCard ctl={ctl} c={c} />
    </div>
  );
}

function ThumbControls({ pic, primary, onItems, onExit }: {
  pic: TouchPicture; primary: number; onItems: () => void; onExit: () => void;
}) {
  const held = new Set(pic.held);
  const btn = (action: string, label: string, extra = "") => (
    <div
      className={`phone-btn phone-${action}${held.has(action) ? " down" : ""}${extra}`}
      data-rebels-touch={action}
      role="button"
      aria-label={label}
    >
      <span>{label}</span>
    </div>
  );
  const gun = weaponInSlot(primary + 1)?.name ?? "GUN";

  return (
    <>
      <div className="phone-top">
        <div className="phone-chip phone-gun" data-rebels-touch="weapon" role="button" aria-label="Change gun">
          <span>{gun}</span>
        </div>
        <UseHeldChip />
        <div className="phone-chip" data-rebels-touch="rear" role="button"><span>REAR</span></div>
        <div className="phone-chip" data-rebels-touch="view" role="button"><span>VIEW</span></div>
        {/* A page button, not a flying one: the inventory is a panel to tap. */}
        <button type="button" className="phone-chip" onClick={onItems}><span>ITEMS</span></button>
        <button type="button" className="phone-chip phone-exit" onClick={onExit}><span>EXIT</span></button>
      </div>

      <SteerStick stick={pic.steer} />

      <div className="phone-cluster">
        {btn("fire", "FIRE")}
        {btn("torpedo", "TORP")}
        {btn("boost", "BOOST")}
        {btn("brake", "BRAKE")}
        {btn("auto", "AUTO", pic.autoFire ? " lit" : "")}
      </div>
    </>
  );
}

/** A ring and a knob under the steering thumb, or a faint one showing where to put it. */
function SteerStick({ stick }: { stick: TouchPicture["steer"] }) {
  if (!stick) {
    return (
      <div className="phone-stick phone-stick-idle" aria-hidden>
        <i />
        <span>STEER</span>
      </div>
    );
  }
  const travel = Math.min(window.innerWidth, window.innerHeight) * STICK_TRAVEL;
  const ring: CSSProperties = { left: stick.fromX, top: stick.fromY, width: travel * 2, height: travel * 2 };
  const knob: CSSProperties = { transform: `translate(${stick.dx * travel}px, ${stick.dy * travel}px)` };
  return (
    <div className="phone-stick" style={ring} aria-hidden>
      <i style={knob} />
    </div>
  );
}

/** The recharge button, only while there is something to use. */
function UseHeldChip() {
  const [, bump] = useState(0);
  useEffect(() => subscribeArmoury(() => bump((n) => n + 1)), []);
  const n = heldCount("recharge") + heldCount("supercharge");
  if (n === 0) return null;
  return (
    <div className="phone-chip phone-held" data-rebels-touch="held" role="button"><span>RECHARGE x{n}</span></div>
  );
}

/** The phone's controls, on the launch card where the desktop shows its keyboard. */
function ThumbHowTo() {
  return (
    <dl className="phone-howto">
      <dt>LEFT THUMB</dt><dd>Steer: put it down anywhere on the left</dd>
      <dt>FIRE</dt><dd>Hold to shoot. AUTO shoots when the crosshair turns red</dd>
      <dt>BOOST / BRAKE</dt><dd>Hold for speed, or to slow into a tight turn</dd>
      <dt>TORP</dt><dd>Tap to launch, tap again to set it off</dd>
      <dt>RIGHT SIDE</dt><dd>Drag sideways to roll</dd>
      <dt>GUN</dt><dd>Tap its name at the top to change</dd>
    </dl>
  );
}
