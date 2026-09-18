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
/** The knob's size, matching .phone-stick > i in phone.css. */
const KNOB = 54;
import { RebelsHealthBar } from "../RebelsHealthBar";
import { weaponInSlot } from "../weaponCatalog";
import { heldCount } from "../rebelsInventory";
import { subscribeArmoury } from "../rebelsArmoury";
import { useCockpit } from "./useCockpit";
import { FlightReadout, DockPanel, ScoreCorner, GaugeBars } from "./readouts";
import { HitFlash, DiedBanner, WaveBanner, AimMarks, NoteLine, OfflineBanner } from "./overlays";
import { NoLaunchCard, CockpitPanels, LaunchCard, DeathCard } from "./cards";

/** Remembered so the thumb card is shown once, not every flight. */
const SEEN_TIPS = "dd69.rebels.touch.seenTips";

/** Whether this browser can take the whole screen (Android and desktop can;
 *  Safari on an iPhone cannot, which is what "Add to Home Screen" is for). */
function fullScreenAvailable(): boolean {
  return typeof document !== "undefined" && !!document.fullscreenEnabled && !!document.documentElement.requestFullscreen;
}
/** Safari on an iPhone, not opened from the home screen. */
function iphoneInSafari(): boolean {
  const nav = typeof navigator === "undefined" ? null : (navigator as Navigator & { standalone?: boolean });
  return !!nav && "standalone" in nav && nav.standalone === false;
}

export function PhoneHud({ ctl, touch, onExit }: { ctl: RebelsController; touch: TouchInput; onExit: () => void }) {
  const c = useCockpit(ctl, onExit);
  const { hud } = c;
  const [pic, setPic] = useState<TouchPicture>(() => touch.picture());
  useEffect(() => touch.subscribe(setPic), [touch]);
  const flying = hud.launched && !hud.dead && !hud.broken;
  /* The moment flying stops or a panel opens, every thumb is let go: the screen
     is a page to read now, and a finger still down is not flying anything. */
  /* The thumb card: shown by itself the first time anyone launches, and
     whenever the ? button is pressed. Geoff, 2026-Sep-16: "I couldn't
     intuitively figure out any other controls." */
  const [tips, setTips] = useState(false);
  useEffect(() => {
    if (!hud.launched) return;
    try {
      if (localStorage.getItem(SEEN_TIPS) === "yes") return;
      localStorage.setItem(SEEN_TIPS, "yes");
    } catch { /* private mode: shown again next time, which is no harm */ }
    setTips(true);
  }, [hud.launched]);

  const panelOpen = c.inv || c.help || c.scores || c.market || c.dflowOpen || tips;
  useEffect(() => { if (!flying || panelOpen) touch.release(); }, [touch, flying, panelOpen]);

  /* ---- THE WHOLE SCREEN ----
     Sideways, the address bar eats a quarter of a phone. Geoff, 2026-Sep-16:
     "a large portion of the screen is lost because the URL line remained at the
     top. That should be hidden during active gameplay." Android and desktop
     browsers hand the page the whole screen when it asks during a tap, which is
     what launching is. An iPhone never does: there, "Add to Home Screen" is the
     only way, which the card below explains. */
  const [full, setFull] = useState(false);
  useEffect(() => {
    const change = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  const goFull = () => {
    if (!fullScreenAvailable() || document.fullscreenElement) return;
    void document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => { /* refused: the chip stays */ });
  };
  useEffect(() => { if (flying) goFull(); }, [flying]);

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

      {/* ---- ALWAYS DRAWN, ONLY SOMETIMES SHOWN ----
          Hidden with a class rather than taken off the page. A button removed
          from under a thumb never receives the lift, which used to leave FIRE
          or the BRAKE held down for the rest of the session. */}
      <ThumbControls
        pic={pic} primary={hud.primary} hidden={!flying}
        onItems={() => c.setInv(true)} onTips={() => setTips(true)} onExit={onExit}
        onFull={fullScreenAvailable() && !full ? goFull : null}
      />
      {tips && <ThumbCard onClose={() => setTips(false)} />}
      {!flying && (
        <button type="button" className="phone-exit phone-exit-idle" onClick={onExit}>EXIT</button>
      )}

      <CockpitPanels c={c} />
      <LaunchCard ctl={ctl} c={c} howTo={<ThumbHowTo />} />
      <DeathCard ctl={ctl} c={c} />
    </div>
  );
}

function ThumbControls({ pic, primary, hidden, onItems, onTips, onExit, onFull }: {
  pic: TouchPicture; primary: number; hidden: boolean;
  onItems: () => void; onTips: () => void; onExit: () => void; onFull: (() => void) | null;
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
    <div className={"phone-controls" + (hidden ? " phone-away" : "")}>
      <div className="phone-top">
        <div className="phone-chip phone-gun" data-rebels-touch="weapon" role="button" aria-label="Change gun">
          <span>{gun}</span>
        </div>
        <UseHeldChip />
        <div className="phone-chip" data-rebels-touch="rear" role="button"><span>REAR</span></div>
        <div className="phone-chip" data-rebels-touch="view" role="button"><span>VIEW</span></div>
        {/* Page buttons, not flying ones: these open panels and cards. */}
        {onFull && <button type="button" className="phone-chip" onClick={onFull}><span>FULL</span></button>}
        <button type="button" className="phone-chip" onClick={onTips}><span>?</span></button>
        <button type="button" className="phone-chip" onClick={onItems}><span>ITEMS</span></button>
        <button type="button" className="phone-chip phone-exit" onClick={onExit}><span>EXIT</span></button>
      </div>

      <SteerStick stick={pic.steer} />

      {/* Two fingers twisted: the roll, drawn as a wheel so it is visible. */}
      {pic.twist !== null && (
        <div className="phone-twist" aria-hidden>
          <i style={{ transform: `rotate(${pic.twist * 30}deg)` }} />
          <span>ROLL</span>
        </div>
      )}

      <div className="phone-cluster">
        {btn("fire", "FIRE")}
        {btn("torpedo", "TORP")}
        {btn("boost", "BOOST")}
        {btn("brake", "BRAKE")}
        {btn("auto", "AUTO", pic.autoFire ? " lit" : "")}
      </div>
    </div>
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
  /* The travel the module actually measured, so the ring drawn is the ring
     read. The knob stops at the rim rather than climbing out of it. */
  const travel = stick.span;
  const ring: CSSProperties = { left: stick.fromX, top: stick.fromY, width: travel * 2, height: travel * 2 };
  const reach = Math.max(0, travel - KNOB / 2);
  const knob: CSSProperties = { transform: `translate(${stick.dx * reach}px, ${stick.dy * reach}px)` };
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

/** The same controls as a card over the game: shown once on the first launch,
 *  and whenever the ? button is pressed. */
function ThumbCard({ onClose }: { onClose: () => void }) {
  return (
    <div className="orbit-card phone-tips">
      <h2>YOUR THUMBS</h2>
      <ThumbHowTo />
      <div className="orbit-buttons">
        <button type="button" onClick={onClose}>GOT IT</button>
      </div>
    </div>
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
      <dt>ROLL</dt><dd>Two fingers on the sky, twisted like a wheel (or drag sideways on the right)</dd>
      <dt>GUN</dt><dd>Tap its name at the top to change</dd>
      <dt>REAR / VIEW</dt><dd>Look behind, or swap cockpit and chase views</dd>
      <dt>ITEMS</dt><dd>What you have found, and what to fit to the ship</dd>
      {iphoneInSafari() && <><dt>WHOLE SCREEN</dt><dd>iPhone: tap Share, then Add to Home Screen, and open it from there</dd></>}
    </dl>
  );
}
