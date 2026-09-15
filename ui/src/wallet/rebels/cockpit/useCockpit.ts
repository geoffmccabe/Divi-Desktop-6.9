// What the cockpit knows and does, with nothing about where it is drawn.
//
// The HUD state from the controller, which panels are open, the hit flash, the
// wave title's timing, the crosshair following the controller every frame, the
// keyboard shortcuts and the fence that keeps a stray click from leaving the
// game. A layout (RebelsHud for a desktop, a phone layout later) takes this and
// arranges the pieces in ./pieces however suits its screen.

import { useEffect, useRef, useState } from "react";
import type { RebelsController, HudState } from "../rebelsController";

export interface Cockpit {
  hud: HudState;
  /** The layout's outer element: the crosshair is placed within it, and the fence finds the map from it. */
  wrapRef: React.MutableRefObject<HTMLDivElement | null>;
  /** The crosshair element, moved every frame without going through React. */
  crossRef: React.MutableRefObject<HTMLDivElement | null>;
  /** Ten seconds without the globe: say so rather than wait for ever. */
  slow: boolean;
  flashing: boolean;
  waveShown: number;
  waveOpacity: number;
  scores: boolean; setScores: (v: boolean) => void;
  help: boolean; setHelp: (v: boolean) => void;
  market: boolean; setMarket: (v: boolean) => void;
  dflowOpen: boolean; setDflow: (v: boolean) => void;
  inv: boolean; setInv: (v: boolean) => void;
}

export function useCockpit(ctl: RebelsController, onExit: () => void): Cockpit {
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
  /* Both of these are hovered and clicked, so both need the mouse. The help
     card used to open with the pointer still captured by the game, which is
     why hovering its keyboard did nothing: there was no cursor. */
  useEffect(() => { ctl.panel(inv || help); }, [ctl, inv, help]);

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
      if ((e.key === "?" || (e.key === "/" && e.shiftKey)) && !(e.target instanceof HTMLInputElement)) {
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
  /* ---- ON THE ANNOUNCEMENT, AND NOTHING ELSE ----
     This used to watch the wave NUMBER as well. React runs the old effect's
     cleanup before the new one, so the moment the number changed to zero
     (which it does the instant you die, and between waves) the pending
     timers were cancelled and the new run bailed out at the guard above
     without setting any. The title then sat at full opacity for the rest of
     the session. Geoff, 2026-Sep-12: "the WAVE 2 text in the middle of the
     screen stayed there, blocking my view and didn't ever go away." */
  const waveNow = useRef(0);
  waveNow.current = hud.wave;
  useEffect(() => {
    if (!hud.waveAt || !waveNow.current) return;
    setWaveShown(waveNow.current);
    setWaveOpacity(1);
    const hold = setTimeout(() => setWaveOpacity(0), 3000);
    const gone = setTimeout(() => setWaveShown(0), 5000);
    return () => { clearTimeout(hold); clearTimeout(gone); };
  }, [hud.waveAt]);

  return {
    hud, wrapRef, crossRef, slow, flashing, waveShown, waveOpacity,
    scores, setScores, help, setHelp, market, setMarket, dflowOpen, setDflow, inv, setInv,
  };
}
