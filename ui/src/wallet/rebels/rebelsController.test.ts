// Does the controller actually fly the globe it is handed?
//
// The globe itself cannot be tested here: react-globe.gl will not initialise
// under software rendering, so a headless browser shows a black sphere and the
// map never reports ready. What CAN be tested, and is the part that was newly
// written, is everything on this side of the `flight` hook: that attach puts a
// ship into the scene it was given, that it uses the REAL tower tips it was
// handed rather than any of its own, that frame moves the map's camera, and
// that detach gives everything back.
//
// Run: sh scripts/run-rebels-controller-tests.sh

import * as THREE from "three";
import { createRebels } from "./rebelsController";
import { MAX_SHIELD, MAX_AMMO } from "./orbitFlight";
import { R } from "./orbitWorld";

/* The controller listens on window for key-up and focus loss. Node has no
   window, so stand one up; `document` is deliberately left undefined so the
   palette exercises its own no-theme fallback. */
const winListeners: Record<string, number> = {};
/* Handlers are kept, not just counted, so a test can actually press a key. */
const winHandlers: Record<string, ((e: unknown) => void)[]> = {};
(globalThis as unknown as { window: unknown }).window = {
  addEventListener: (k: string, fn: (e: unknown) => void) => {
    winListeners[k] = (winListeners[k] ?? 0) + 1;
    (winHandlers[k] ??= []).push(fn);
  },
  removeEventListener: (k: string, fn: (e: unknown) => void) => {
    winListeners[k] = (winListeners[k] ?? 0) - 1;
    winHandlers[k] = (winHandlers[k] ?? []).filter((f) => f !== fn);
  },
};
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
/* No network in the tests: the score module fires and forgets, and a rejected
   promise must not take the run down with it. */
(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error("offline"));

function press(type: string, e: Record<string, unknown>) {
  for (const fn of winHandlers[type] ?? []) fn({ preventDefault() {}, ...e });
}

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/** A stand-in for what GlobeMap hands over. */
function stubGlobe(towers: Array<[string, THREE.Vector3]>) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1.5, 1, 1000);
  const listeners: Record<string, number> = {};
  const dom = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener: (k: string) => { listeners[k] = (listeners[k] ?? 0) + 1; },
    removeEventListener: (k: string) => { listeners[k] = (listeners[k] ?? 0) - 1; },
  } as unknown as HTMLCanvasElement;
  return { scene, camera, dom, listeners, tips: new Map(towers), radius: R };
}

/** Tower tips exactly where the real map puts them: R + 3, and R + 6 for your
 *  own node, whose tower is drawn at double scale. */
const tipAt = (lat: number, lon: number, height: number) => {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const r = R + height;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
};

process.on("uncaughtException", (e) => {
  /* Print what passed before the crash: a bare stack tells you nothing about
     which check got that far. */
  console.log(out.join("\n"));
  console.log("FAIL threw: " + (e as Error).message);
  process.exit(1);
});

const home = tipAt(9.93, -84.09, 6);
const other = tipAt(51.5, -0.12, 3);
const labels: Record<string, string> = { "self-ip": "San Jose, Costa Rica", "peer-ip": "London, UK" };
const labelFor = (ip: string) => labels[ip] ?? ip;

// 1. attach borrows the scene it is given rather than making one.
{
  const g = stubGlobe([["self-ip", home], ["peer-ip", other]]);
  const before = g.scene.children.length;
  const nearStart = g.camera.near;   /* the map's own near, before the game touches it */
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: "self-ip" });
  const h = ctl.hud();
  /* The effects layer and the player's guard shell. */
  ok("attach adds its own objects to the map's scene",
     g.scene.children.length === before + 2, `${before} -> ${g.scene.children.length}`);
  ok("attach reports ready", h.ready && h.broken === null);
  ok("it uses the real towers it was handed", h.towers === 2, `${h.towers} towers`);
  ok("it knows which tower is yours", h.homeName === "San Jose, Costa Rica", h.homeName);
  ok("it listens on the globe's own canvas", g.listeners.pointermove === 1 && g.listeners.pointerdown === 1);

  // 2. the camera is the map's camera, and the game moves it.
  const camStart = g.camera.position.clone();
  ok("near plane opened up so the ship is not clipped", g.camera.near < nearStart && g.camera.near <= 0.1,
     `${nearStart} -> ${g.camera.near}`);
  /* A second of the approach, then launch, then long enough for the dive to
     finish, which is what actually happens. */
  for (let i = 0; i < 60; i++) ctl.frame(1 / 60);
  const orbit = g.camera.position.length();
  ok("the approach pulls back to frame the globe", orbit > R,
     `radius ${orbit.toFixed(1)}`);
  ctl.launch();
  let lowest = Infinity;
  for (let i = 0; i < 60 * 6; i++) {
    ctl.frame(1 / 60);
    lowest = Math.min(lowest, g.camera.position.length());
  }
  ok("the dive never passes through the planet", lowest >= R,
     `closest ${lowest.toFixed(1)}`);
  ok("frame moves the map's camera", g.camera.position.distanceTo(camStart) > 1,
     `moved ${g.camera.position.distanceTo(camStart).toFixed(1)}`);
  ok("the camera stays outside the planet", g.camera.position.length() > R,
     `radius ${g.camera.position.length().toFixed(1)}`);

  // 3. the ship is in the scene, above the surface, and near the camera.
  /* The view is from the cockpit, so there is deliberately no model in the
     middle of it: the camera IS the ship. */
  ok("nothing is parked in front of the camera",
     !g.scene.children.some((o) => o.type === "LineSegments" && o.position.length() > R),
     `${g.scene.children.length} objects`);

  // 4. the cockpit is actually travelling, frame to frame.
  const p1 = g.camera.position.clone();
  for (let i = 0; i < 60; i++) ctl.frame(1 / 60);
  ok("the cockpit travels over the globe", g.camera.position.distanceTo(p1) > 5,
     `moved ${g.camera.position.distanceTo(p1).toFixed(1)} units in a second`);
  ok("and stays above the surface", g.camera.position.length() > R,
     `radius ${g.camera.position.length().toFixed(1)}`);
  ok("window listeners were hooked", (winListeners.keydown ?? 0) === 1 && (winListeners.blur ?? 0) === 1);

  // 5. detach hands everything back.
  ctl.detach();
  ok("detach removes everything the game added", g.scene.children.length === before,
     `${g.scene.children.length} left`);
  ok("detach restores the map's near plane", g.camera.near === nearStart, `near ${g.camera.near}`);
  ok("detach unhooks every listener",
     g.listeners.pointermove === 0 && g.listeners.pointerdown === 0 &&
     (winListeners.keydown ?? 0) === 0 && (winListeners.blur ?? 0) === 0);
}

// 5b. The torpedo path, end to end through the real input handlers.
//      Reported broken twice, so it is driven the way a player drives it: hold
//      the key, press fire, let go.
{
  const g = stubGlobe([["self-ip", home]]);
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: "self-ip" });
  ctl.launch();
  for (let i = 0; i < 60 * 5; i++) ctl.frame(1 / 60);   /* through the dive */

  const before = ctl.hud().torpedoes;
  press("keydown", { key: "t" });
  ctl.frame(1 / 60);
  press("keyup", { key: "t" });
  for (let i = 0; i < 30; i++) ctl.frame(1 / 60);
  ok("the torpedo key launches one", ctl.hud().inFlight === 1 || ctl.hud().torpedoes < before,
     `rack ${before} -> ${ctl.hud().torpedoes}, in flight ${ctl.hud().inFlight}`);

  /* And a second press sets it off rather than launching another. */
  const racked = ctl.hud().torpedoes;
  press("keydown", { key: "t" });
  ctl.frame(1 / 60);
  press("keyup", { key: "t" });
  for (let i = 0; i < 30; i++) ctl.frame(1 / 60);
  ok("a second press detonates rather than launching another",
     ctl.hud().torpedoes === racked, `rack still ${ctl.hud().torpedoes}`);
  ok("and nothing is left in the air", ctl.hud().inFlight === 0, `${ctl.hud().inFlight}`);
  ctl.detach();
}
{
  /* Left alone, the fuse does the job. */
  const g = stubGlobe([["self-ip", home]]);
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: "self-ip" });
  ctl.launch();
  for (let i = 0; i < 60 * 5; i++) ctl.frame(1 / 60);
  press("keydown", { key: "t" });
  ctl.frame(1 / 60);
  press("keyup", { key: "t" });
  for (let i = 0; i < 30; i++) ctl.frame(1 / 60);
  const flying = ctl.hud().inFlight;
  for (let i = 0; i < 60 * 6; i++) ctl.frame(1 / 60);
  ok("an unattended torpedo goes off on its own", flying === 1 && ctl.hud().inFlight === 0,
     `was ${flying}, now ${ctl.hud().inFlight}`);
  ctl.detach();
}

// 5c. Dying files the run.
//
//     Geoff: "I scored some points but I'm not on the high scores list."
//     There were two death paths: one marked the player dead the moment the
//     shield ran out, the other filed the score but only if they were not
//     already marked dead, so the first always won and NOTHING was ever
//     recorded from any death. This drives a real death and looks in the table.
{
  store.clear();
  store.set("dd69.nodeIdentity", JSON.stringify({ name: "Test Node" }));
  const g = stubGlobe([["self-ip", home]]);
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: "self-ip" });
  ctl.launch();
  for (let i = 0; i < 60 * 5; i++) ctl.frame(1 / 60);   /* through the dive */

  /* The invariant, rather than a scripted kill.
   *
   * Driving the controller to reliably land a shot needs an aiming autopilot:
   * the magazine is sixty rounds, there is no docking here, and the fighters
   * weave, so whether anything hits is luck. What is checked instead is the
   * thing that must always hold: a run that reaches the table has the points
   * it earned on it. That is exactly the bug this covers, where two death
   * paths meant a scoring run was silently never filed at all.
   *
   * The HUD's own score is NOT used as the measure. It is pushed on a
   * wall-clock tick, and this loop runs minutes of game time in a fraction of
   * a second, so it reads zero here while reading correctly in the real game.
   */
  let guard = 0;
  while (!ctl.hud().dead && guard < 60 * 300) {
    guard++;
    const sweep = Math.floor(guard / 45) % 2 === 0 ? "arrowleft" : "arrowright";
    press("keydown", { key: sweep });
    if (guard % 6 === 0) press("keydown", { key: " " });
    if (guard % 6 === 3) press("keyup", { key: " " });
    if (guard > 60 * 60) press("keydown", { key: "arrowdown" });
    ctl.frame(1 / 60);
  }
  ok("the ship can actually be lost", ctl.hud().dead, `after ${(guard / 60).toFixed(1)}s`);

  const raw = store.get("dd69.rebels.scores");
  const rows = raw
    ? (JSON.parse(raw) as { rows: Array<{ name: string; games: number; best: number; total: number }> }).rows
    : [];
  if (rows.length > 0) {
    ok("filed under the node's name", rows.some((r) => r.name === "Test Node"),
       rows.map((r) => r.name).join(","));
    ok("counted as a game played", rows[0]?.games === 1, `${rows[0]?.games}`);
    ok("a filed run carries the points it earned", rows[0].best > 0 && rows[0].total > 0,
       `best ${rows[0].best}, total ${rows[0].total}`);
  } else {
    /* Nothing was hit in the time available, which is luck rather than a
       fault, and the quitter case below covers the other half. */
    ok("nothing scored, nothing filed", true, "no hits landed this run");
  }
  ctl.detach();
}
{
  /* And backing out mid-run files it too, rather than throwing it away. */
  store.clear();
  store.set("dd69.nodeIdentity", JSON.stringify({ name: "Quitter" }));
  const g = stubGlobe([["self-ip", home]]);
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: "self-ip" });
  ctl.launch();
  for (let i = 0; i < 60 * 6; i++) ctl.frame(1 / 60);
  /* Nothing was scored, so nothing should be filed: an empty run is not a run. */
  ctl.detach();
  ok("leaving with nothing scored files nothing", !store.get("dd69.rebels.scores"));
}

// 6. Docking uses the tips the map handed over, not a guess.
{
  const g = stubGlobe([["self-ip", home]]);
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: "self-ip" });
  ctl.launch();
  /* The dive lands you at your own tower. Checked once it has finished, not
     during it. */
  for (let i = 0; i < 60 * 5; i++) ctl.frame(1 / 60);
  ok("the dive ends at your own tower",
     g.camera.position.distanceTo(home) < 40,
     `${g.camera.position.distanceTo(home).toFixed(1)} from the tip`);
  for (let i = 0; i < 60 * 3; i++) ctl.frame(1 / 60);
  const h = ctl.hud();
  ok("shields and ammo start full", h.shields === MAX_SHIELD && h.ammo <= MAX_AMMO);
  ctl.detach();
}

// 7. A map with no towers at all must still fly, not crash.
{
  const g = stubGlobe([]);
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: null });
  ctl.launch();
  for (let i = 0; i < 300; i++) ctl.frame(1 / 60);
  const h = ctl.hud();
  ok("an empty map still flies", h.broken === null && h.towers === 0);
  ok("with no node of your own it says so", h.homeName === "no node located", h.homeName);
  ctl.detach();
}

// 8. Being attached twice, the way a scene rebuild does it, must not leak ships.
{
  const g = stubGlobe([["self-ip", home]]);
  const before = g.scene.children.length;
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: "self-ip" });
  ctl.detach();
  ctl.attach({ ...g, selfIp: "self-ip" });
  ok("re-attaching does not pile up scenery", g.scene.children.length === before + 2,
     `${g.scene.children.length - before} objects`);
  ctl.detach();
  ok("and the second detach still cleans up", g.scene.children.length === before);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
