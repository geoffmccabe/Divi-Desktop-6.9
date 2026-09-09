// Firing a weapon in the shop, so you can see and hear what you are buying.
//
// Drawn as a flat overlay rather than in the preview's own scene. The preview
// renders one ship on a transparent canvas and knows nothing about weapons;
// putting fire inside it would mean teaching it the catalogue, the cone
// geometry and the tier colours for the sake of a shop.
//
// The ship points AWAY from the camera in this view, so everything here is
// drawn going up the panel from the nose: that is the direction its guns are
// pointing, seen from behind and slightly above.
//
// The five second limit is the weapon's, not the shop's. A beam cannot be held
// longer than that in flight either, so a test that ran for ever would be
// showing something the game will not let you do.

import { useEffect, useRef, useState } from "react";
import { BEAM_MAX_HOLD, type WeaponSpec } from "./weaponCatalog";
import { startBeamSound, stopBeamSound, playGunSound, playMiniSound } from "./rebelsAudio";

/** One round in flight, as a fraction of the way up the panel. */
interface Shot { id: number; x: number; born: number }

/** How long a drawn round takes to cross the panel, in seconds. */
const SHOT_FLIGHT = 0.45;
/** Rounds a second from the mini gun, and from the pulse gun's twin barrels. */
const MINI_RATE = 14;
const PULSE_RATE = 2.2;

export function TestFire({ spec }: { spec: WeaponSpec | null }) {
  const [held, setHeld] = useState(0);
  const [shots, setShots] = useState<Shot[]>([]);
  const started = useRef(0);

  useEffect(() => {
    if (!spec) { stopBeamSound(); setHeld(0); setShots([]); return; }
    started.current = performance.now();
    let raf = 0;
    let nextShot = 0;
    let n = 0;

    if (spec.kind === "beam") startBeamSound();

    const tick = () => {
      const on = (performance.now() - started.current) / 1000;

      if (spec.kind === "beam") {
        if (on >= BEAM_MAX_HOLD) { stopBeamSound(); setHeld(BEAM_MAX_HOLD); return; }
        setHeld(on);
      } else {
        /* ---- ROUNDS YOU CAN SEE ----
           The guns made their noise and nothing came out, which makes a TEST
           button look broken. Two barrels for the pulse gun and a single fast
           stream for the mini, which is the difference between them. */
        const rate = spec.kind === "mini" ? MINI_RATE : PULSE_RATE;
        if (on >= nextShot) {
          nextShot = on + 1 / rate;
          if (spec.kind === "mini") {
            playMiniSound();
            /* From one corner, the way it fires from the corner of the frame
               in the cockpit. */
            setShots((was) => [...was, { id: n++, x: 0.62, born: on }]);
          } else {
            playGunSound();
            setShots((was) => [
              ...was,
              { id: n++, x: 0.38, born: on },
              { id: n++, x: 0.62, born: on },
            ]);
          }
        }
        setShots((was) => was.filter((sh) => on - sh.born < SHOT_FLIGHT));
        setHeld(on);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); stopBeamSound(); };
  }, [spec]);

  if (!spec) return null;

  const colour = `#${(spec.colour ?? 0xffe08a).toString(16).padStart(6, "0")}`;

  if (spec.kind === "beam") {
    if (held >= BEAM_MAX_HOLD) return null;
    /* ---- A CONE, NOT A CYLINDER ----
       It was a rounded rectangle, which is a cylinder however it is coloured.
       The clip path makes it what the weapon actually is: a point at the ship's
       nose widening away from it. The width follows the weapon's own cone, so a
       higher tier is visibly wider, scaled up because two degrees across a
       380 pixel panel is a hairline and the whole point of the shop is to show
       the difference between the tiers. */
    const width = 8 + (spec.cone ?? 2) * 6;
    return (
      <div className="test-fire" aria-hidden>
        <i
          className="test-beam"
          style={{
            width: `${width}%`,
            background: `linear-gradient(to top, ${colour} 0%, ${colour}dd 55%, ${colour}22 100%)`,
            clipPath: "polygon(50% 100%, 100% 0%, 0% 0%)",
          }}
        />
        <span className="test-secs">{held.toFixed(1)}s / {BEAM_MAX_HOLD}s</span>
      </div>
    );
  }

  const now = held;
  return (
    <div className="test-fire" aria-hidden>
      {shots.map((sh) => {
        const k = Math.min(1, (now - sh.born) / SHOT_FLIGHT);
        return (
          <i
            key={sh.id}
            className={spec.kind === "mini" ? "test-shot test-shot-mini" : "test-shot"}
            style={{
              left: `${sh.x * 100}%`,
              /* Up the panel and shrinking, which is what a round going away
                 from you does. */
              bottom: `${18 + k * 74}%`,
              opacity: 1 - k * 0.75,
              transform: `translateX(-50%) scale(${1 - k * 0.55})`,
            }}
          />
        );
      })}
    </div>
  );
}
