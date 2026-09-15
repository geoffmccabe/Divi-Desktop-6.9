// Touch: what thumbs mean, for the pilot.
//
// The phone's way of asking the same things desktopInput.ts asks with keys and a
// mouse (see the Pilot in platform.ts). The game does not know which is in use.
//
// The draft layout (docs/DIVI-REBELS-WEB-PLAN.md, a starting point for Geoff's
// design):
//   LEFT THUMB   a stick wherever it lands on the left half: up and down is the
//                throttle, left and right is strafe
//   RIGHT THUMB  a stick wherever it lands on the right half: it moves the
//                reticle, and the ship turns toward it, as the mouse does
//   BUTTONS      fire, torpedo, boost and the rest
//
// This module draws nothing. A button is ANY element the phone layout marks with
// data-rebels-touch="<action>" (the actions are TOUCH_ACTIONS below), so the
// layout decides how buttons look and where they sit, and this decides what
// they do. The sticks are reported through subscribe() so the layout can draw
// a ring and a knob under each thumb.

import type { Pilot, RebelsInput } from "./platform";

/** Held for as long as a finger is on them. */
const HOLD_ACTIONS = ["fire", "torpedo", "boost", "super", "guard", "stop", "liftUp", "liftDown", "rollLeft", "rollRight"] as const;
/** Done once, when the finger lands. */
const TAP_ACTIONS = ["weapon", "weaponBack", "rear", "view", "held", "zoomIn", "zoomOut", "sound"] as const;
export const TOUCH_ACTIONS: readonly string[] = [...HOLD_ACTIONS, ...TAP_ACTIONS];
type HoldAction = (typeof HOLD_ACTIONS)[number];

/** A stick's travel, as a share of the screen's shorter side. About a thumb's reach. */
export const STICK_TRAVEL = 0.12;
/** Near the middle of a stick is nothing, so a resting thumb does not drift the ship. */
export const STICK_DEAD = 0.15;
/** How far from the middle the reticle may go: the same as the mouse under a lock. */
const AIM_REACH = 0.45;

export interface TouchStick {
  /** Where the thumb landed and where it is now, in page pixels. */
  fromX: number; fromY: number; x: number; y: number;
  /** The stick's reading, each -1 to 1, before the dead zone. */
  dx: number; dy: number;
}

/** What a phone layout needs to draw the controls under the thumbs. */
export interface TouchPicture {
  move: TouchStick | null;
  aim: TouchStick | null;
  /** The held buttons with a finger on them now. */
  held: string[];
}

export interface TouchInput extends RebelsInput {
  subscribe(fn: (p: TouchPicture) => void): () => void;
  picture(): TouchPicture;
}

interface TouchPoint { identifier: number; clientX: number; clientY: number; target?: unknown }
interface TouchLike { changedTouches: ArrayLike<TouchPoint>; preventDefault?: () => void; cancelable?: boolean }
interface Closest { closest?: (sel: string) => (Closest & { getAttribute?: (k: string) => string | null }) | null }

/** A reading with the dead zone taken out and the rest stretched back to 1. */
export function shaped(v: number): number {
  const a = Math.abs(v);
  if (a <= STICK_DEAD) return 0;
  return Math.sign(v) * Math.min(1, (a - STICK_DEAD) / (1 - STICK_DEAD));
}

export function createTouchInput(): TouchInput {
  const listeners = new Set<(p: TouchPicture) => void>();
  let current: TouchPicture = { move: null, aim: null, held: [] };
  const publish = (p: TouchPicture) => {
    current = p;
    for (const fn of listeners) fn(p);
  };

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    picture: () => current,

    attach(dom: HTMLCanvasElement, pilot: Pilot): () => void {
      /* Each finger is one thing until it lifts: a stick or a button. A thumb
         that lands on FIRE and slides off it is still holding fire. */
      type Role = { kind: "move" | "aim"; stick: TouchStick } | { kind: "hold"; action: HoldAction };
      const fingers = new Map<number, Role>();

      const heldNow = () => [...fingers.values()].flatMap((r) => (r.kind === "hold" ? [r.action] : []));
      const stickOf = (kind: "move" | "aim") => {
        for (const r of fingers.values()) if (r.kind === kind) return r.stick;
        return null;
      };
      const show = () => publish({ move: stickOf("move"), aim: stickOf("aim"), held: heldNow() });

      /** Everything the held buttons and the left stick say, together. */
      const applyHeld = () => {
        const h = new Set(heldNow());
        const move = stickOf("move");
        pilot.setControls({
          strafe: move ? shaped(move.dx) : 0,
          /* Up the screen is forward: pushing the thumb up opens the throttle. */
          throttle: move ? -shaped(move.dy) : 0,
          lift: (h.has("liftUp") ? 1 : 0) - (h.has("liftDown") ? 1 : 0),
          roll: (h.has("rollRight") ? 1 : 0) - (h.has("rollLeft") ? 1 : 0),
          boost: h.has("boost"),
          superBoost: h.has("super"),
          guard: h.has("guard"),
          fullStop: h.has("stop"),
        });
      };

      const aimFrom = (s: TouchStick) => {
        const reach = pilot.state().rearOn ? 0.5 : AIM_REACH;
        pilot.moveCursor(0.5 + shaped(s.dx) * reach, 0.5 + shaped(s.dy) * reach);
      };

      const travel = () => {
        const r = dom.getBoundingClientRect();
        return Math.max(1, Math.min(r.width, r.height) * STICK_TRAVEL);
      };
      const clamp = (v: number) => Math.max(-1, Math.min(1, v));

      const press = (action: string) => {
        switch (action) {
          case "fire": pilot.trigger("primary", true); break;
          case "torpedo": pilot.trigger("secondary", true); break;
          case "weapon": pilot.cycleWeapon(1); break;
          case "weaponBack": pilot.cycleWeapon(-1); break;
          case "rear": pilot.toggleRear(); break;
          case "view": if (pilot.state().hasFlight) pilot.toggleView(); break;
          case "held": pilot.useHeld(); break;
          case "zoomIn": pilot.zoom(1); break;
          case "zoomOut": pilot.zoom(-1); break;
          case "sound": pilot.restartSound(); break;
        }
      };
      const lift = (action: HoldAction) => {
        if (action === "fire") pilot.trigger("primary", false);
        if (action === "torpedo") pilot.trigger("secondary", false);
      };

      const touchstart = (e: TouchLike) => {
        const st = pilot.state();
        /* The launch card, the death card and every open panel are ordinary
           pages to tap. Only a ship in the air is flown. */
        if (!st.flying || st.panelOpen) return;
        let used = false;
        for (const t of Array.from(e.changedTouches)) {
          const target = t.target as Closest | undefined;
          const button = target?.closest?.("[data-rebels-touch]");
          if (button) {
            const action = button.getAttribute?.("data-rebels-touch") ?? "";
            if (!TOUCH_ACTIONS.includes(action)) continue;
            used = true;
            if ((HOLD_ACTIONS as readonly string[]).includes(action)) fingers.set(t.identifier, { kind: "hold", action: action as HoldAction });
            press(action);
            continue;
          }
          /* Anything else a page can be tapped on (a panel's button, a box to
             type in) is left to the page. */
          if (target?.closest?.("button, input, select, textarea, a, [role='dialog']")) continue;
          const r = dom.getBoundingClientRect();
          if (t.clientX < r.left || t.clientX > r.left + r.width || t.clientY < r.top || t.clientY > r.top + r.height) continue;
          const kind = t.clientX < r.left + r.width / 2 ? "move" : "aim";
          /* One thumb per stick. A second finger on the same side is ignored
             rather than yanking the stick to where it landed. */
          if (stickOf(kind)) continue;
          used = true;
          fingers.set(t.identifier, { kind, stick: { fromX: t.clientX, fromY: t.clientY, x: t.clientX, y: t.clientY, dx: 0, dy: 0 } });
        }
        if (!used) return;
        /* A finger on the game is flying, not scrolling or zooming the page. */
        if (e.cancelable !== false) e.preventDefault?.();
        pilot.gesture();
        applyHeld();
        show();
      };

      const touchmove = (e: TouchLike) => {
        let used = false;
        for (const t of Array.from(e.changedTouches)) {
          const role = fingers.get(t.identifier);
          if (!role) continue;
          used = true;
          if (role.kind === "hold") continue;
          /* Guarded: a touch without coordinates would put NaN in the reticle,
             then in the ship's heading, and nothing recovers from that. */
          if (!Number.isFinite(t.clientX) || !Number.isFinite(t.clientY)) continue;
          const s = role.stick, span = travel();
          s.x = t.clientX; s.y = t.clientY;
          s.dx = clamp((s.x - s.fromX) / span);
          s.dy = clamp((s.y - s.fromY) / span);
          if (role.kind === "aim") aimFrom(s);
        }
        if (!used) return;
        if (e.cancelable !== false) e.preventDefault?.();
        applyHeld();
        show();
      };

      const touchend = (e: TouchLike) => {
        let used = false;
        for (const t of Array.from(e.changedTouches)) {
          const role = fingers.get(t.identifier);
          if (!role) continue;
          used = true;
          fingers.delete(t.identifier);
          if (role.kind === "hold") lift(role.action);
          /* The aiming thumb lifted: stop turning, as the mouse leaving does. */
          if (role.kind === "aim") pilot.centreCursor();
        }
        if (!used) return;
        applyHeld();
        show();
      };

      /* Losing the page (a call, the home button) must not leave the throttle
         open or the guns firing. */
      const blur = () => {
        fingers.clear();
        pilot.releaseAll();
        show();
      };
      const focus = () => pilot.focusReturned();

      const opts = { passive: false } as AddEventListenerOptions;
      window.addEventListener("touchstart", touchstart as unknown as EventListener, opts);
      window.addEventListener("touchmove", touchmove as unknown as EventListener, opts);
      window.addEventListener("touchend", touchend as unknown as EventListener);
      window.addEventListener("touchcancel", touchend as unknown as EventListener);
      window.addEventListener("blur", blur);
      window.addEventListener("focus", focus);
      /* No long-press menu on the canvas in the middle of a fight. */
      const contextmenu = (e: Event) => { e.preventDefault(); };
      dom.addEventListener("contextmenu", contextmenu);
      return () => {
        window.removeEventListener("touchstart", touchstart as unknown as EventListener);
        window.removeEventListener("touchmove", touchmove as unknown as EventListener);
        window.removeEventListener("touchend", touchend as unknown as EventListener);
        window.removeEventListener("touchcancel", touchend as unknown as EventListener);
        window.removeEventListener("blur", blur);
        window.removeEventListener("focus", focus);
        dom.removeEventListener("contextmenu", contextmenu);
        if (fingers.size > 0) pilot.releaseAll();
        fingers.clear();
        show();
      };
    },
  };
}
