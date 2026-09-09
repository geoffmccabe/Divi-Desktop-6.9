// Firing a weapon in the shop, so you can see and hear what you are buying.
//
// Drawn as a flat overlay rather than in the preview's own scene, on purpose.
// The preview renders one ship on a transparent canvas and knows nothing about
// weapons; putting a beam inside it would mean teaching it the catalogue, the
// cone geometry and the tier colours for the sake of a shop. A cone drawn in
// front of the hull reads exactly the same and costs a div.
//
// The five second limit is the weapon's, not the shop's: a beam cannot be held
// longer than that in flight either, so a test that ran for ever would be
// showing something the game will not let you do.

import { useEffect, useRef, useState } from "react";
import { BEAM_MAX_HOLD, type WeaponSpec } from "./weaponCatalog";
import { startBeamSound, stopBeamSound, playGunSound, playMiniSound } from "./rebelsAudio";

export function TestFire({ spec }: { spec: WeaponSpec | null }) {
  const [held, setHeld] = useState(0);
  const started = useRef(0);

  useEffect(() => {
    if (!spec) { stopBeamSound(); setHeld(0); return; }

    /* The one-shot weapons just make their noise. */
    if (spec.kind === "pulse") { playGunSound(); return; }
    if (spec.kind === "mini") {
      const t = setInterval(playMiniSound, 60);
      return () => clearInterval(t);
    }

    /* The beam runs until it is let go or until its five seconds are up. */
    started.current = performance.now();
    startBeamSound();
    let raf = 0;
    const tick = () => {
      const on = (performance.now() - started.current) / 1000;
      if (on >= BEAM_MAX_HOLD) { stopBeamSound(); setHeld(BEAM_MAX_HOLD); return; }
      setHeld(on);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); stopBeamSound(); };
  }, [spec]);

  if (!spec || spec.kind !== "beam" || held >= BEAM_MAX_HOLD) return null;

  const colour = `#${(spec.colour ?? 0xffd83a).toString(16).padStart(6, "0")}`;
  /* The drawn width follows the weapon's own cone so a wider tier looks wider,
     scaled up because two degrees across a 380 pixel panel is a hairline and
     the point of the shop is to show the difference between the tiers. */
  const width = 6 + (spec.cone ?? 2) * 5;

  return (
    <div className="test-fire" aria-hidden>
      <i
        className="test-beam"
        style={{
          width: `${width}%`,
          background: `linear-gradient(to top, ${colour}00 0%, ${colour}cc 35%, ${colour} 100%)`,
        }}
      />
      <span className="test-secs">{held.toFixed(1)}s / {BEAM_MAX_HOLD}s</span>
    </div>
  );
}
