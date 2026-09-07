// The health bar that flashes up when you are hit.
//
// This is DreadRoot's PlayerDamageHealthBar, deliberately: Geoff asked for the
// same colours and the same style so that taking damage reads the same way in
// both games. Centred, three quarters of the way down, a third of the screen
// wide, a thick black frame, and the fill coloured by how much trouble you are
// in. It holds for a second and fades over half of one, and the rest of the
// time it is not there at all.
//
// The bands and the colours are copied exactly rather than approximated, since
// the whole point is that a player who knows one game already knows this.

import { useEffect, useState, useSyncExternalStore } from "react";
import { getHealthPulse, subscribeHealth } from "./healthPulse";

const HOLD_MS = 1000;
const FADE_MS = 500;
const TOTAL_MS = HOLD_MS + FADE_MS;

/** Full saturation on the left fading to half at the low end, so the bar reads
 *  as draining toward the bad colours rather than being one flat block. */
function fillGradient(pct: number): string {
  const [h, s, l] =
    pct < 10 ? [0, 73, 56] :      /* red */
    pct < 25 ? [34, 100, 56] :    /* orange */
    pct < 50 ? [51, 100, 56] :    /* yellow */
               [133, 61, 51];     /* green */
  return `linear-gradient(to right, hsl(${h} ${s}% ${l}%), hsl(${h} ${Math.round(s * 0.5)}% ${l}%))`;
}

function fmtPct(pct: number): string {
  const s = pct.toFixed(1);
  return (s.endsWith(".0") ? s.slice(0, -2) : s) + "%";
}

export function RebelsHealthBar() {
  const st = useSyncExternalStore(subscribeHealth, getHealthPulse, getHealthPulse);
  const [, setTick] = useState(0);

  /* Re-render each frame while it is alive so the fade is smooth, and stop
     the moment the window passes: nothing runs when the bar is not up. */
  useEffect(() => {
    if (st.at < 0) return;
    let raf = 0;
    const loop = () => {
      setTick((t) => t + 1);
      if (performance.now() - st.at < TOTAL_MS) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [st.at]);

  if (st.at < 0) return null;
  const elapsed = performance.now() - st.at;
  if (elapsed >= TOTAL_MS) return null;

  const opacity = elapsed < HOLD_MS ? 1 : 1 - (elapsed - HOLD_MS) / FADE_MS;
  const pct = Math.max(0, Math.min(100, (st.current / st.max) * 100));

  return (
    <div className="rebels-healthbar" style={{ opacity }}>
      <div className="rebels-healthbar-frame">
        <div style={{ width: `${pct}%`, height: "100%", background: fillGradient(pct) }} />
      </div>
      <div className="rebels-healthbar-pct">{fmtPct(pct)}</div>
    </div>
  );
}
