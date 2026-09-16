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

/**
 * The bottom-left row: back to the map, and full screen beside it.
 *
 * One row rather than two things positioned separately, because the exit
 * button's width changes with its own text and an icon placed at a guessed
 * offset from the corner cannot stay in line with it. Geoff: "That button isn't
 * properly aligned with the EXIT button to its left."
 *
 * Once the game IS full screen the collapse icon leaves the row for the
 * opposite corner, which is what he asked for and where nothing else lives.
 */
export function ExitButton({
  hud, onExit, full, onToggleFull,
}: {
  hud: HudState; onExit: () => void;
  full?: boolean; onToggleFull?: () => void;
}) {
  return (
    <div className="orbit-exit-row">
      <button type="button" className="orbit-exit" onClick={onExit} title="Back to the map">
        {hud.launched ? "ESC  BACK TO MAP" : "BACK TO MAP"}
      </button>
      {onToggleFull && !full && <FullScreenButton full={false} onToggle={onToggleFull} />}
    </div>
  );
}

/**
 * Full screen, and back out of it.
 *
 * Geoff: "I want you to add a small icon for 'full screen' to the right of the
 * ESC BACK TO MAP button. When clicked then the game goes completely full
 * screen. And then there's a button in the bottom right after that on the full
 * screen version, to collapse it back into the app version again."
 *
 * So it is two buttons and only ever one of them showing: the expand icon sits
 * beside the exit button, and once the game is full the collapse icon moves to
 * the opposite corner, out of the way of everything else.
 *
 * Drawn as lines rather than glyphs, because a font's idea of a corner bracket
 * is not something to bet a control on.
 */
export function FullScreenButton({ full, onToggle }: { full: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={"orbit-full" + (full ? " out" : "")}
      onClick={onToggle}
      title={full ? "Back into the app" : "Full screen"}
      aria-label={full ? "Leave full screen" : "Full screen"}
    >
      {/* Four corner brackets, pointing out to expand and in to collapse. */}
      <svg viewBox="0 0 16 16" aria-hidden>
        {full ? (
          <>
            <path d="M6 1v5H1M10 1v5h5M6 15v-5H1M10 15v-5h5" />
          </>
        ) : (
          <>
            <path d="M1 6V1h5M15 6V1h-5M1 10v5h5M15 10v5h-5" />
          </>
        )}
      </svg>
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
