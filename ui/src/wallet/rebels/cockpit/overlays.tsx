// What comes and goes over the view: the hit flash, the death and wave
// titles, the aiming marks, a passing note, the connection warning, and the
// way back to the map.

import type { HudState } from "../rebelsController";

/** Everything behind the cockpit inverted, for the tenth of a second after a hit. */
export function HitFlash({ on }: { on: boolean }) {
  return on ? <div className="orbit-invert" /> : null;
}

/** Death, said so it cannot be missed. Geoff, 2026-Sep-13: "when I died
 *  there was no notification of that. It should say YOU HAVE DIED in large
 *  letters." Up for as long as the ship is lost, over the recovery card. */
export function DiedBanner({ hud }: { hud: HudState }) {
  return !hud.broken && hud.dead ? (
    <div className="orbit-died" role="alert">YOU HAVE DIED</div>
  ) : null;
}

/** The wave title: three seconds at full, then two fading out. */
export function WaveBanner({ shown, waveAt, opacity }: { shown: number; waveAt: number; opacity: number }) {
  if (!(shown > 0)) return null;
  return (
    <div className="orbit-wave" key={waveAt} style={{ opacity }}>
      WAVE {shown}
    </div>
  );
}

/** The rear-view label, then the boresight (where the nose points) and the
 *  crosshair over it (where you are aiming), both at once. */
export function AimMarks({ hud, crossRef }: { hud: HudState; crossRef: React.Ref<HTMLDivElement> }) {
  if (!(hud.launched && !hud.dead && !hud.broken)) return null;
  return (
    <>
      {hud.rear && (
        <div className={"orbit-rear" + (hud.rearAim ? " aiming" : "")}>
          <span>REAR{hud.rearAim ? ": FIRING BACKWARDS" : ""}</span>
        </div>
      )}
      <div className={"orbit-bore" + (hud.rearAim ? " rear" : "")} aria-hidden>
        <i /><i /><i /><i /><b />
      </div>
      <div className={"orbit-cross" + (hud.rearAim ? " rear" : "")} ref={crossRef} />
    </>
  );
}

export function ExitButton({ hud, onExit }: { hud: HudState; onExit: () => void }) {
  return (
    <button type="button" className="orbit-exit" onClick={onExit} title="Back to the map">
      {hud.launched ? "ESC  BACK TO MAP" : "BACK TO MAP"}
    </button>
  );
}

/** What was just selected, or why it could not be. Two seconds and gone:
 *  long enough to read, short enough not to become furniture. */
export function NoteLine({ hud }: { hud: HudState }) {
  return hud.note && performance.now() - hud.noteAt < 2000 ? (
    <div className="orbit-note">{hud.note}</div>
  ) : null;
}

/** The connection, when it is not there. The fight is the server's, so
 *  this is the difference between a quiet sky and a lost one. */
export function OfflineBanner({ hud }: { hud: HudState }) {
  if (!(hud.launched && !hud.broken && hud.room !== "live")) return null;
  return (
    <div className="orbit-offline">
      {hud.room === "refused" ? "LOST THE FIGHT: RETRYING" : "RECONNECTING"}
    </div>
  );
}
