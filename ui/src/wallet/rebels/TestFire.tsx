// Firing a weapon in the shop, so you can see and hear what you are buying.
//
// The SOUND and the timing. The picture is drawn inside the ship preview,
// from the model's own gun mounts, as a real cone and real rounds: a flat
// overlay used to be drawn up the panel here, which put the beam on top of
// the hull, forty degrees wide, and had nothing to do with where the guns are.
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

  /* The picture is drawn in the ship preview itself now, from the model's
     own mounts (see ShipPreview). This component keeps the sound and the
     five-second limit and draws nothing. */
  void held;
  void shots;
  return null;
}
