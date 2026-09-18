// Touch: what thumbs mean, for the pilot.
//
// The phone's way of asking the same things desktopInput.ts asks with keys and a
// mouse (see the Pilot in platform.ts). The game does not know which is in use.
//
// ---- THE LAYOUT PHONE PLAYERS ALREADY KNOW ----
// Geoff had not played a shooter on a phone, so this follows the games that
// phone players have: Galaxy on Fire 2 and 3 (the best known space fighters on
// phones) and Call of Duty Mobile (the best known phone shooter). They agree:
//   LEFT THUMB   a floating stick, appearing wherever the thumb lands: it steers
//                (here it moves the crosshair, and the ship turns toward it)
//   RIGHT THUMB  one big FIRE button, with the few other buttons it needs in
//                an arc around it: TORPEDO, BOOST, BRAKE
//   AUTO FIRE    on by default: the guns fire by themselves while an enemy is
//                under the crosshair (Galaxy on Fire 3; Call of Duty Mobile's
//                default mode). FIRE still fires by hand; AUTO turns it off.
//   AIM ASSIST   the crosshair eases onto an enemy close to it
//   ROLL         two fingers on the sky, twisted like a steering wheel, which is
//                what hands reach for; also a sideways drag on the empty right
//                side (Galaxy on Fire 3)
//
// This module draws nothing. A button is ANY element the phone layout marks with
// data-rebels-touch="<action>" (TOUCH_ACTIONS below), so the layout decides how
// buttons look and where they sit, and this decides what they do. The sticks
// and the auto fire setting are reported through subscribe() so the layout can
// draw a ring and knob under each thumb and light the AUTO button.

import type { Pilot, RebelsInput } from "./platform";

/** Held for as long as a finger is on them. */
const HOLD_ACTIONS = ["fire", "torpedo", "boost", "super", "brake", "guard", "stop", "liftUp", "liftDown", "rollLeft", "rollRight"] as const;
/** Done once, when the finger lands. */
const TAP_ACTIONS = ["weapon", "weaponBack", "rear", "view", "held", "zoomIn", "zoomOut", "sound", "auto"] as const;
export const TOUCH_ACTIONS: readonly string[] = [...HOLD_ACTIONS, ...TAP_ACTIONS];
type HoldAction = (typeof HOLD_ACTIONS)[number];

/** A stick's travel, as a share of the screen's shorter side. About a thumb's reach. */
export const STICK_TRAVEL = 0.12;
/** Near the middle of a stick is nothing, so a resting thumb does not drift the ship. */
export const STICK_DEAD = 0.15;
/** How far from the middle the crosshair may go: the same as the mouse under a lock. */
const AIM_REACH = 0.45;
/** How far two fingers must be twisted for a full roll: about thirty degrees. */
export const TWIST_FULL = 0.55;
const AUTO_KEY = "dd69.rebels.touch.autoFire";

export interface TouchStick {
  /** Where the thumb landed and where it is now, in page pixels. */
  fromX: number; fromY: number; x: number; y: number;
  /** The stick's reading, each -1 to 1, before the dead zone. */
  dx: number; dy: number;
  /** How far the thumb may travel for a full reading, in pixels. The layout
   *  draws its ring at this size, so what is drawn is what is read. */
  span: number;
}

/** What a phone layout needs to draw the controls under the thumbs. */
export interface TouchPicture {
  /** The left thumb's steering stick. */
  steer: TouchStick | null;
  /** A thumb rolling the ship on the empty right side. */
  roll: TouchStick | null;
  /** Two fingers twisted on the sky, -1 to 1, or null when there are not two. */
  twist: number | null;
  /** The held buttons with a finger on them now. */
  held: string[];
  autoFire: boolean;
}

export interface TouchInput extends RebelsInput {
  subscribe(fn: (p: TouchPicture) => void): () => void;
  picture(): TouchPicture;
  /** Let go of every finger and button. The layout calls this whenever its
   *  buttons leave the screen (death, a panel opening), since a button taken
   *  away under a thumb never gets its release. */
  release(): void;
}

interface TouchPoint { identifier: number; clientX: number; clientY: number; target?: unknown }
interface TouchLike { changedTouches: ArrayLike<TouchPoint>; preventDefault?: () => void; cancelable?: boolean }
interface Closest { closest?: (sel: string) => (Closest & { getAttribute?: (k: string) => string | null }) | null }

/** Anything that belongs to the page rather than to flying: a control to press,
 *  or a panel to read and scroll (the inventory, the scoreboard, the market,
 *  the launch and recovery cards). */
const PAGE = "button, input, select, textarea, a, [role='dialog'], [class*='scrim'], [class*='panel'], [class*='orbit-inv'], [class*='orbit-card'], [class*='market'], [class*='board']";

/** A reading with the dead zone taken out and the rest stretched back to 1. */
export function shaped(v: number): number {
  const a = Math.abs(v);
  if (a <= STICK_DEAD) return 0;
  return Math.sign(v) * Math.min(1, (a - STICK_DEAD) / (1 - STICK_DEAD));
}

function readAuto(): boolean {
  try { return localStorage.getItem(AUTO_KEY) !== "off"; } catch { return true; }
}
function saveAuto(on: boolean) {
  try { localStorage.setItem(AUTO_KEY, on ? "on" : "off"); } catch { /* private mode: this session only */ }
}

export function createTouchInput(): TouchInput {
  const listeners = new Set<(p: TouchPicture) => void>();
  let current: TouchPicture = { steer: null, roll: null, twist: null, held: [], autoFire: readAuto() };
  const publish = (p: TouchPicture) => {
    current = p;
    for (const fn of listeners) fn(p);
  };

  /** Set while attached, so release() can reach the ship. */
  let letGo: (() => void) | null = null;

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    picture: () => current,
    release: () => letGo?.(),

    attach(dom: HTMLCanvasElement, pilot: Pilot): () => void {
      /* Each finger is one thing until it lifts: a stick or a button. A thumb
         that lands on FIRE and slides off it is still holding fire. */
      type Role = { kind: "steer" | "roll"; stick: TouchStick } | { kind: "hold"; action: HoldAction };
      const fingers = new Map<number, Role>();
      /* ---- TWO FINGERS TWISTED IS A ROLL ----
         Geoff reached for it on his first flight: "I used two fingers to try to
         rotate the view and that didn't work, and I thought it should." While a
         pair is twisting, neither finger steers; letting one go hands the other
         back its own job from wherever it now is, so nothing jumps. */
      let twist: { a: number; b: number; from: number; now: number } | null = null;
      let autoFire = readAuto();
      pilot.setAssist({ autoFire, magnet: true });

      const heldNow = () => [...fingers.values()].flatMap((r) => (r.kind === "hold" ? [r.action] : []));
      const holding = (action: HoldAction) => heldNow().includes(action);
      const stickOf = (kind: "steer" | "roll") => {
        for (const r of fingers.values()) if (r.kind === kind) return r.stick;
        return null;
      };
      const show = () => publish({
        steer: twist ? null : stickOf("steer"), roll: stickOf("roll"),
        twist: twist ? shaped(twist.now) : null, held: heldNow(), autoFire,
      });

      /** The sky fingers, in the order they landed. */
      const skyFingers = () => [...fingers.entries()].filter(([, r]) => r.kind !== "hold") as [number, { kind: "steer" | "roll"; stick: TouchStick }][];
      const angleBetween = (a: TouchStick, b: TouchStick) => Math.atan2(b.y - a.y, b.x - a.x);
      const readTwist = () => {
        if (!twist) return;
        const a = fingers.get(twist.a), b = fingers.get(twist.b);
        if (!a || !b || a.kind === "hold" || b.kind === "hold") return;
        let turned = angleBetween(a.stick, b.stick) - twist.from;
        while (turned > Math.PI) turned -= Math.PI * 2;
        while (turned < -Math.PI) turned += Math.PI * 2;
        twist.now = Math.max(-1, Math.min(1, turned / TWIST_FULL));
      };
      /** A pair broken: the finger left behind starts again where it is. */
      const endTwist = () => {
        if (!twist) return;
        twist = null;
        for (const [, r] of skyFingers()) {
          r.stick.fromX = r.stick.x; r.stick.fromY = r.stick.y;
          r.stick.dx = 0; r.stick.dy = 0;
          if (r.kind === "steer") pilot.centreCursor();
        }
      };

      /** Everything the held buttons and the roll drag say, together. */
      const applyHeld = () => {
        const h = new Set(heldNow());
        const roll = stickOf("roll");
        pilot.setControls({
          lift: (h.has("liftUp") ? 1 : 0) - (h.has("liftDown") ? 1 : 0),
          roll: twist ? shaped(twist.now)
            : roll ? shaped(roll.dx)
            : (h.has("rollRight") ? 1 : 0) - (h.has("rollLeft") ? 1 : 0),
          boost: h.has("boost"),
          superBoost: h.has("super"),
          brake: h.has("brake"),
          guard: h.has("guard"),
          fullStop: h.has("stop"),
        });
      };

      const steerFrom = (s: TouchStick) => {
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
          case "auto":
            autoFire = !autoFire;
            saveAuto(autoFire);
            pilot.setAssist({ autoFire });
            break;
        }
      };
      /* Asked again from whatever is still down, not simply switched off: with
         two thumbs on FIRE, lifting one used to stop the guns. */
      const lift = (action: HoldAction) => {
        if (action === "fire") pilot.trigger("primary", holding("fire"));
        if (action === "torpedo") pilot.trigger("secondary", holding("torpedo"));
      };

      const touchstart = (e: TouchLike) => {
        const st = pilot.state();
        /* The launch card, the death card and every open panel are ordinary
           pages to tap and scroll. Only a ship in the air is flown. */
        if (!st.flying || st.dead || st.panelOpen) return;
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
          if (target?.closest?.(PAGE)) continue;
          const r = dom.getBoundingClientRect();
          if (t.clientX < r.left || t.clientX > r.left + r.width || t.clientY < r.top || t.clientY > r.top + r.height) continue;
          const kind = t.clientX < r.left + r.width / 2 ? "steer" : "roll";
          const sky = skyFingers();
          /* Two fingers on the sky and no more: the pair is a steering wheel. */
          if (sky.length >= 2 || twist) continue;
          used = true;
          fingers.set(t.identifier, { kind, stick: { fromX: t.clientX, fromY: t.clientY, x: t.clientX, y: t.clientY, dx: 0, dy: 0, span: travel() } });
          if (sky.length === 1) {
            const [firstId, first] = sky[0];
            const second = fingers.get(t.identifier);
            if (second && second.kind !== "hold") {
              twist = { a: firstId, b: t.identifier, from: angleBetween(first.stick, second.stick), now: 0 };
              /* Neither finger steers while they are twisting. */
              pilot.centreCursor();
            }
          }
        }
        if (!used) return;
        /* A finger on the game is flying, not scrolling or zooming the page. */
        if (e.cancelable !== false) e.preventDefault?.();
        pilot.gesture();
        applyHeld();
        show();
      };

      const touchmove = (e: TouchLike) => {
        /* A panel opened (or the ship was lost) with thumbs still down: let go
           rather than fly the ship from behind the panel. */
        if (fingers.size > 0 && (pilot.state().panelOpen || pilot.state().dead)) { blur(); return; }
        let used = false;
        for (const t of Array.from(e.changedTouches)) {
          const role = fingers.get(t.identifier);
          if (!role) continue;
          used = true;
          if (role.kind === "hold") continue;
          /* Guarded: a touch without coordinates would put NaN in the crosshair,
             then in the ship's heading, and nothing recovers from that. */
          if (!Number.isFinite(t.clientX) || !Number.isFinite(t.clientY)) continue;
          const s = role.stick, span = s.span;
          s.x = t.clientX; s.y = t.clientY;
          s.dx = clamp((s.x - s.fromX) / span);
          s.dy = clamp((s.y - s.fromY) / span);
          if (twist) continue;
          if (role.kind === "steer") steerFrom(s);
        }
        readTwist();
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
          if (twist && (twist.a === t.identifier || twist.b === t.identifier)) endTwist();
          if (role.kind === "hold") lift(role.action);
          /* The steering thumb lifted: stop turning, as the mouse leaving does. */
          if (role.kind === "steer") pilot.centreCursor();
        }
        if (!used) return;
        applyHeld();
        show();
      };

      /* Losing the page (a call, the home button) must not leave the brake on,
         the guns firing or the ship turning. */
      const blur = () => {
        if (fingers.size === 0) return;
        twist = null;
        fingers.clear();
        pilot.releaseAll();
        /* Said again from the empty hand, so nothing is left held even if a
           door's pilot treats releaseAll differently. */
        applyHeld();
        show();
      };
      letGo = blur;

      /* ---- A MOUSE MAY PRESS THE BUTTONS TOO ----
         An iPad with a trackpad, and anyone opening the phone layout on a
         computer to look at it. Only the marked buttons: flying with a mouse is
         the desktop module's job. */
      const mouseOn = new Map<number, HoldAction>();
      const pointerdown = (e: PointerEvent) => {
        if (e.pointerType === "touch") return;
        const st = pilot.state();
        if (!st.flying || st.dead || st.panelOpen) return;
        const button = (e.target as Closest | null)?.closest?.("[data-rebels-touch]");
        const action = button?.getAttribute?.("data-rebels-touch") ?? "";
        if (!TOUCH_ACTIONS.includes(action)) return;
        e.preventDefault();
        pilot.gesture();
        if ((HOLD_ACTIONS as readonly string[]).includes(action)) {
          mouseOn.set(e.pointerId, action as HoldAction);
          fingers.set(-1000 - e.pointerId, { kind: "hold", action: action as HoldAction });
        }
        press(action);
        applyHeld();
        show();
      };
      const pointerup = (e: PointerEvent) => {
        const action = mouseOn.get(e.pointerId);
        if (action === undefined) return;
        mouseOn.delete(e.pointerId);
        fingers.delete(-1000 - e.pointerId);
        lift(action);
        applyHeld();
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
      window.addEventListener("pointerdown", pointerdown as unknown as EventListener, opts);
      window.addEventListener("pointerup", pointerup as unknown as EventListener);
      window.addEventListener("pointercancel", pointerup as unknown as EventListener);
      /* No long-press menu on the canvas in the middle of a fight. */
      const contextmenu = (e: Event) => { e.preventDefault(); };
      dom.addEventListener("contextmenu", contextmenu);
      show();
      return () => {
        window.removeEventListener("touchstart", touchstart as unknown as EventListener);
        window.removeEventListener("touchmove", touchmove as unknown as EventListener);
        window.removeEventListener("touchend", touchend as unknown as EventListener);
        window.removeEventListener("touchcancel", touchend as unknown as EventListener);
        window.removeEventListener("blur", blur);
        window.removeEventListener("focus", focus);
        window.removeEventListener("pointerdown", pointerdown as unknown as EventListener);
        window.removeEventListener("pointerup", pointerup as unknown as EventListener);
        window.removeEventListener("pointercancel", pointerup as unknown as EventListener);
        dom.removeEventListener("contextmenu", contextmenu);
        letGo = null;
        if (fingers.size > 0) pilot.releaseAll();
        fingers.clear();
        pilot.setAssist({ autoFire: false, magnet: false });
        show();
      };
    },
  };
}
