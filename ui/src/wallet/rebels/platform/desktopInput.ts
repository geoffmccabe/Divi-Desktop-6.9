// Keyboard and mouse: what they mean, for the pilot.
//
// The cockpit used to read the keyboard and the mouse itself, in five hundred
// lines woven through its own state. That is what a phone cannot use: a touch
// screen has no keys to read. So the controller now offers a PILOT (see
// platform.ts), everything a pair of hands can ask of the ship, and this module
// is the keyboard-and-mouse way of asking. A touch module drives the same pilot.
//
// Moved here from rebelsController.ts (2026-Sep-15) with the behaviour unchanged:
// the same events on the same targets, the same key map, the same reticle. The
// cockpit test suite drives the game through exactly these listeners.

import type { Pilot, RebelsInput } from "./platform";
import { GAME_KEYS } from "../RebelsControls";
import { REAR_KEY } from "../rearGun";

/** How far from the middle the reticle may get while the pointer is locked. */
const AIM_REACH = 0.45;

/* ---- THE KEY MAP ----
   Everspace 2's layout, which is where the genre has settled, checked against
   the shipped bindings of Elite, Star Citizen, Squadrons, X4, Freelancer and
   Descent rather than guessed at.

     W / S    throttle up and down, through zero into reverse
     A / D    strafe
     Q / E    roll
     R / C    lift
     SHIFT    boost, TAB super boost
     X        full stop
     F        shield
     1-6      choose a weapon
     V        cockpit or third person

   The keys the game claims are the help card's list, so the two cannot drift:
   a key the card explains is a key the game swallows, and no other. */
const MAPPED = GAME_KEYS;

/** Typing in a box (a ship's name) is typing, not flying. */
function typing(e: KeyboardEvent): boolean {
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || !!t.isContentEditable);
}

export const desktopInput: RebelsInput = {
  attach(dom: HTMLCanvasElement, pilot: Pilot): () => void {
    const keys: Record<string, boolean> = {};

    /* The arrows still fly, for anyone who would rather not use the mouse.
       ADDED to the mouse rather than overriding it, so reaching for one does
       not kill the other. */
    const applyKeys = () => pilot.setControls({
      yaw: (keys.arrowright ? 1 : 0) - (keys.arrowleft ? 1 : 0),
      pitch: (keys.arrowup ? 1 : 0) - (keys.arrowdown ? 1 : 0),
      roll: (keys.e ? 1 : 0) - (keys.q ? 1 : 0),
      strafe: (keys.d ? 1 : 0) - (keys.a ? 1 : 0),
      lift: (keys.r ? 1 : 0) - (keys.c ? 1 : 0),
      throttle: (keys.w ? 1 : 0) - (keys.s ? 1 : 0),
      fullStop: !!keys.x,
      boost: !!keys.shift,
      superBoost: !!keys.tab,
      guard: !!keys.f,
    });

    const wheel = (e: WheelEvent) => {
      const st = pilot.state();
      if (!st.flying || !st.hasFlight) return;
      /* Option and the wheel pulls the camera out of the cockpit. Option on
         purpose: the wheel on its own belongs to whatever the player has open. */
      if (!e.altKey) return;
      e.preventDefault();
      pilot.zoom(-Math.sign(e.deltaY));
    };

    /** Pointer gone from the canvas: stop turning, and put the reticle back in
     *  the middle so it does not reappear mid-turn where it was left. */
    const pointerleave = () => pilot.centreCursor();

    const pointermove = (e: PointerEvent) => {
      const st = pilot.state();
      if (!st.flying) return;
      /* A panel has the mouse: while one is open the pointer is a cursor for
         it, not a stick, and moving it must not fly the ship. */
      if (st.panelOpen) return;
      const r = dom.getBoundingClientRect();
      if (st.locked) {
        /* Under a lock there is no pointer position, so movement accumulates.
           With the rear window open the crosshair may go all the way into the
           corner, or it could never reach the window's edge. */
        const reach = st.rearOn ? 0.5 : AIM_REACH;
        const lo = 0.5 - reach, hi = 0.5 + reach;
        const c = st.cursor;
        pilot.moveCursor(
          Math.max(lo, Math.min(hi, c.x + (e.movementX || 0) / r.width)),
          Math.max(lo, Math.min(hi, c.y + (e.movementY || 0) / r.height)),
        );
      } else {
        /* Guarded: an event without coordinates would put NaN in the cursor, the
           stick and then the ship's heading, and nothing recovers from that. */
        if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
        pilot.moveCursor(
          Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
          Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
        );
      }
    };
    const pointerdown = (e: PointerEvent) => {
      e.preventDefault();
      pilot.gesture();
      /* Right button is the SECONDARY weapon; left is the primary. LEFT ONLY
         fires: a click of the wheel used to empty the guns. */
      if (e.button === 2) { pilot.trigger("secondary", true); return; }
      if (e.button !== 0) return;
      pilot.trigger("primary", true);
    };
    const pointerup = (e: PointerEvent) => {
      if (e.button === 2) { pilot.trigger("secondary", false); return; }
      if (e.button !== 0) return;
      pilot.trigger("primary", false);
    };
    /* And no context menu in the middle of a dogfight. */
    const contextmenu = (e: Event) => { e.preventDefault(); };

    const keydown = (e: KeyboardEvent) => {
      if (!pilot.state().flying || typing(e)) return;
      pilot.gesture();
      const k = e.key.toLowerCase();
      if (pilot.cheatKey(k)) {
        e.preventDefault();
        return;
      }
      if (MAPPED.includes(k)) e.preventDefault();
      keys[k] = true;
      if (k === " ") pilot.trigger("primary", true);
      /* ONE LINE OF SIX: all six numbers pick along the upgrade path; the
         secondary stays on the right button. */
      if (k >= "1" && k <= "6") pilot.selectWeapon(Number(k));
      if (k === "y") pilot.useHeld();
      if (k === "0") pilot.restartSound();
      if (k === REAR_KEY && pilot.state().flying) pilot.toggleRear();
      if (k === "v" && pilot.state().hasFlight) pilot.toggleView();
      applyKeys();
    };
    const keyup = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keys[k] = false;
      if (k === " ") pilot.trigger("primary", false);
      applyKeys();
    };
    /* Losing the window must not leave the throttle open or a key stuck down. */
    const blur = () => {
      for (const k in keys) keys[k] = false;
      pilot.releaseAll();
    };
    const focus = () => pilot.focusReturned();
    const pointerlockchange = () => pilot.lockChanged();

    dom.addEventListener("wheel", wheel, { passive: false });
    dom.addEventListener("pointerleave", pointerleave);
    dom.addEventListener("pointermove", pointermove);
    dom.addEventListener("pointerdown", pointerdown);
    dom.addEventListener("contextmenu", contextmenu);
    window.addEventListener("pointerup", pointerup);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    if (typeof document !== "undefined") {
      document.addEventListener("pointerlockchange", pointerlockchange);
    }
    return () => {
      dom.removeEventListener("wheel", wheel);
      dom.removeEventListener("pointerleave", pointerleave);
      dom.removeEventListener("pointermove", pointermove);
      dom.removeEventListener("pointerdown", pointerdown);
      dom.removeEventListener("contextmenu", contextmenu);
      window.removeEventListener("pointerup", pointerup);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      if (typeof document !== "undefined") {
        document.removeEventListener("pointerlockchange", pointerlockchange);
      }
    };
  },
};
