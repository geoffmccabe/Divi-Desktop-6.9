// Touch controls: what each thumb asks of the pilot.
//
// Run: sh scripts/run-rebels-touch-tests.sh
//
// A pretend pilot records every request, and pretend fingers land, slide and
// lift on a pretend 800 by 400 phone screen. The real game flown by touch is in
// rebelsController.test.ts (block T).

export {};
import type { Pilot } from "./platform";
import { createTouchInput, shaped, STICK_TRAVEL, TOUCH_ACTIONS } from "./touchInput";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

const handlers: Record<string, ((e: unknown) => void)[]> = {};
(globalThis as Record<string, unknown>).window = {
  addEventListener: (k: string, fn: (e: unknown) => void) => { (handlers[k] ??= []).push(fn); },
  removeEventListener: (k: string, fn: (e: unknown) => void) => { handlers[k] = (handlers[k] ?? []).filter((f) => f !== fn); },
};
const fire = (k: string, e: unknown) => { for (const fn of handlers[k] ?? []) fn(e); };
const count = () => Object.values(handlers).reduce((n, l) => n + l.length, 0);

const W = 800, H = 400, SPAN = Math.min(W, H) * STICK_TRAVEL;
const domHandlers: Record<string, number> = {};
const dom = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
  addEventListener: (k: string) => { domHandlers[k] = (domHandlers[k] ?? 0) + 1; },
  removeEventListener: (k: string) => { domHandlers[k] = (domHandlers[k] ?? 0) - 1; },
} as unknown as HTMLCanvasElement;

/** A page element: a button the layout marked, an ordinary button, or bare canvas. */
function el(kind: "canvas" | "page-button" | string) {
  return {
    closest: (sel: string) => {
      if (sel === "[data-rebels-touch]") return kind !== "canvas" && kind !== "page-button" ? { getAttribute: () => kind } : null;
      return kind === "page-button" ? {} : null;
    },
  };
}
let prevented = 0;
const touch = (id: number, x: number, y: number, target = el("canvas")) => ({
  changedTouches: [{ identifier: id, clientX: x, clientY: y, target }],
  cancelable: true, preventDefault: () => { prevented++; },
});

type Call = [string, ...unknown[]];
const calls: Call[] = [];
const st = { flying: true, hasFlight: true, panelOpen: false, locked: false, rearOn: false, cursor: { x: 0.5, y: 0.5 } };
const controls: Record<string, number | boolean> = {};
const pilot: Pilot = {
  state: () => ({ ...st, cursor: { ...st.cursor } }),
  setControls: (c) => { Object.assign(controls, c); calls.push(["setControls", c]); },
  trigger: (w, d) => calls.push(["trigger", w, d]),
  moveCursor: (x, y) => { st.cursor = { x, y }; calls.push(["moveCursor", x, y]); },
  centreCursor: () => { st.cursor = { x: 0.5, y: 0.5 }; calls.push(["centreCursor"]); },
  releaseAll: () => calls.push(["releaseAll"]),
  selectWeapon: (s) => calls.push(["selectWeapon", s]),
  cycleWeapon: (d) => calls.push(["cycleWeapon", d]),
  useHeld: () => calls.push(["useHeld"]),
  toggleRear: () => calls.push(["toggleRear"]),
  toggleView: () => calls.push(["toggleView"]),
  zoom: (d) => calls.push(["zoom", d]),
  restartSound: () => calls.push(["restartSound"]),
  gesture: () => calls.push(["gesture"]),
  focusReturned: () => calls.push(["focusReturned"]),
  lockChanged: () => calls.push(["lockChanged"]),
  cheatKey: () => false,
};
const saw = (name: string, ...args: unknown[]) => calls.some((c) => c[0] === name && args.every((a, i) => c[i + 1] === a));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

const input = createTouchInput();
const pictures: unknown[] = [];
const unsub = input.subscribe((p) => pictures.push(p));
const detach = input.attach(dom, pilot);
ok("attaching listens for fingers", (handlers.touchstart?.length ?? 0) === 1 && (handlers.touchend?.length ?? 0) === 1 && (handlers.touchcancel?.length ?? 0) === 1);

/* ---- THE DEAD ZONE ---- */
ok("a thumb resting near the middle of a stick does nothing", shaped(0.1) === 0 && shaped(-0.15) === 0);
ok("and the rest of the travel still reaches full", shaped(1) === 1 && shaped(-1) === -1 && near(shaped(0.575), 0.5));

/* ---- LEFT THUMB: THROTTLE AND STRAFE ---- */
fire("touchstart", touch(1, 200, 200));
ok("a thumb on the left half is the move stick", !!input.picture().move && !input.picture().aim);
ok("landing does not move the ship", controls.throttle === 0 && controls.strafe === 0);
ok("a finger on the game wakes the sound, as a key does", saw("gesture"));
ok("and is not also a page scroll", prevented > 0);
fire("touchmove", touch(1, 200, 200 - SPAN));
ok("pushing up opens the throttle", controls.throttle === 1, `${controls.throttle}`);
fire("touchmove", touch(1, 200 + SPAN * 2, 200 + SPAN));
ok("past the ring is still full, never more", controls.strafe === 1 && controls.throttle === -1, `${controls.strafe} ${controls.throttle}`);
ok("right is strafe right, down is throttle back", controls.strafe === 1 && controls.throttle === -1);
const pic = input.picture().move!;
ok("the picture says where the thumb landed and where it is", pic.fromX === 200 && pic.x === 200 + SPAN * 2 && pic.dx === 1);
fire("touchend", touch(1, 0, 0));
ok("lifting the thumb lets go of both", controls.throttle === 0 && controls.strafe === 0 && !input.picture().move);

/* ---- RIGHT THUMB: AIM ---- */
calls.length = 0;
fire("touchstart", touch(2, 600, 200));
ok("a thumb on the right half is the aim stick", !!input.picture().aim);
fire("touchmove", touch(2, 600 + SPAN, 200));
ok("sliding right puts the reticle right, as far as the mouse can", near(st.cursor.x, 0.95) && near(st.cursor.y, 0.5), `${st.cursor.x}`);
fire("touchmove", touch(2, 600 + SPAN * 0.575, 200 - SPAN * 0.575));
ok("half way is half way, up is up", near(st.cursor.x, 0.725) && near(st.cursor.y, 0.275), `${st.cursor.x} ${st.cursor.y}`);
st.rearOn = true;
fire("touchmove", touch(2, 600 + SPAN, 200 - SPAN));
ok("with the rear window open the reticle may reach the corner", near(st.cursor.x, 1) && near(st.cursor.y, 0));
st.rearOn = false;
fire("touchmove", touch(2, NaN, 200));
ok("a touch without coordinates is ignored, not turned into NaN", Number.isFinite(st.cursor.x));
fire("touchstart", touch(3, 700, 300));
fire("touchmove", touch(3, 780, 390));
ok("a second finger on the same side does not take the stick", input.picture().aim!.fromX === 600);
fire("touchend", touch(3, 0, 0));
fire("touchend", touch(2, 0, 0));
ok("lifting the aiming thumb stops the turn", saw("centreCursor") && st.cursor.x === 0.5);

/* ---- BOTH THUMBS AT ONCE ---- */
fire("touchstart", touch(4, 100, 200));
fire("touchstart", touch(5, 700, 200));
fire("touchmove", touch(4, 100, 200 - SPAN));
fire("touchmove", touch(5, 700 - SPAN, 200));
ok("flying and aiming together", controls.throttle === 1 && near(st.cursor.x, 0.05));
fire("touchend", touch(4, 0, 0));
ok("lifting one thumb leaves the other", !!input.picture().aim && !input.picture().move && near(st.cursor.x, 0.05));
fire("touchend", touch(5, 0, 0));

/* ---- BUTTONS ---- */
calls.length = 0;
fire("touchstart", touch(6, 750, 350, el("fire")));
ok("FIRE held is the trigger down", saw("trigger", "primary", true) && !saw("trigger", "primary", false));
ok("and a button is not also a stick", !input.picture().aim && input.picture().held.includes("fire"));
fire("touchmove", touch(6, 400, 100));
ok("sliding off FIRE keeps firing", !saw("trigger", "primary", false) && st.cursor.x === 0.5);
fire("touchend", touch(6, 400, 100));
ok("lifting stops", saw("trigger", "primary", false) && input.picture().held.length === 0);

fire("touchstart", touch(7, 700, 350, el("torpedo")));
fire("touchend", touch(7, 700, 350));
ok("TORPEDO is the secondary trigger, pressed and released", saw("trigger", "secondary", true) && saw("trigger", "secondary", false));

fire("touchstart", touch(8, 100, 350, el("boost")));
fire("touchstart", touch(9, 150, 350, el("guard")));
ok("BOOST and GUARD held together", controls.boost === true && controls.guard === true);
fire("touchend", touch(8, 0, 0));
ok("letting go of one leaves the other", controls.boost === false && controls.guard === true);
fire("touchend", touch(9, 0, 0));

for (const [a, rest] of [["super", "superBoost"], ["stop", "fullStop"]] as const) {
  fire("touchstart", touch(10, 10, 10, el(a)));
  const on = controls[rest] === true;
  fire("touchend", touch(10, 10, 10));
  ok(`${a.toUpperCase()} is held ${rest}`, on && controls[rest] === false);
}
fire("touchstart", touch(11, 10, 10, el("liftUp")));
fire("touchstart", touch(12, 10, 10, el("rollLeft")));
ok("lift and roll buttons", controls.lift === 1 && controls.roll === -1);
fire("touchend", touch(11, 0, 0)); fire("touchend", touch(12, 0, 0));
ok("and they let go", controls.lift === 0 && controls.roll === 0);

calls.length = 0;
const taps: [string, Call][] = [
  ["weapon", ["cycleWeapon", 1]], ["weaponBack", ["cycleWeapon", -1]], ["rear", ["toggleRear"]], ["view", ["toggleView"]],
  ["held", ["useHeld"]], ["zoomIn", ["zoom", 1]], ["zoomOut", ["zoom", -1]], ["sound", ["restartSound"]],
];
for (const [a, want] of taps) {
  fire("touchstart", touch(13, 10, 10, el(a)));
  fire("touchend", touch(13, 10, 10));
  ok(`tapping ${a} asks the pilot once`, calls.filter((c) => JSON.stringify(c) === JSON.stringify(want)).length === 1);
}
ok("every action the layout may use is tested", taps.length + 10 === TOUCH_ACTIONS.length, `${TOUCH_ACTIONS.length}`);

/* ---- LEFT ALONE ---- */
calls.length = 0; prevented = 0;
fire("touchstart", touch(14, 750, 350, el("launch-rocket")));
ok("an unknown action does nothing", calls.length === 0 && prevented === 0);
fire("touchstart", touch(15, 600, 200, el("page-button")));
ok("an ordinary button on the page is left to the page", calls.length === 0 && prevented === 0 && !input.picture().aim);
fire("touchstart", touch(16, 900, 200));
ok("a finger outside the game is left alone", calls.length === 0 && !input.picture().aim);
st.panelOpen = true;
fire("touchstart", touch(17, 200, 200));
ok("with a panel open, fingers are for the panel", calls.length === 0 && !input.picture().move);
st.panelOpen = false; st.flying = false;
fire("touchstart", touch(18, 750, 350, el("fire")));
ok("on the launch card nothing is flown", calls.length === 0 && prevented === 0);
st.flying = true;

/* ---- LOSING THE PAGE ---- */
fire("touchstart", touch(19, 750, 350, el("fire")));
fire("touchstart", touch(20, 100, 200));
fire("blur", {});
ok("losing the page lets go of everything", saw("releaseAll") && input.picture().held.length === 0 && !input.picture().move);
fire("touchend", touch(19, 0, 0));
ok("and the finger lifting afterwards changes nothing", !calls.slice(-3).some((c) => c[0] === "trigger" && c[2] === false));
fire("focus", {});
ok("coming back is reported", saw("focusReturned"));

/* ---- DETACH ---- */
fire("touchstart", touch(21, 750, 350, el("fire")));
calls.length = 0;
const before = count();
detach();
ok("detach removes every listener", count() === 0 && before > 0 && Object.values(domHandlers).every((n) => n === 0), `${before} -> ${count()}`);
ok("and a finger still down is let go", saw("releaseAll"));
const seen = pictures.length;
unsub();
fire("touchstart", touch(22, 200, 200));
ok("nothing is heard after detaching", pictures.length === seen);

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
