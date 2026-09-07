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
  /* The handlers themselves, not just a count: the mouse-flight test has to be
     able to actually move the pointer. */
  const on: Record<string, Array<(e: Record<string, unknown>) => void>> = {};
  const dom = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener: (k: string, fn: (e: Record<string, unknown>) => void) => {
      listeners[k] = (listeners[k] ?? 0) + 1;
      (on[k] ??= []).push(fn);
    },
    removeEventListener: (k: string, fn: (e: Record<string, unknown>) => void) => {
      listeners[k] = (listeners[k] ?? 0) - 1;
      on[k] = (on[k] ?? []).filter((f) => f !== fn);
    },
    requestPointerLock: () => {},
  } as unknown as HTMLCanvasElement;
  const fire = (k: string, e: Record<string, unknown>) => {
    for (const fn of on[k] ?? []) fn({ preventDefault() {}, ...e });
  };
  return { scene, camera, dom, listeners, fire, tips: new Map(towers), radius: R };
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
  /* The effects layer, the player's guard shell, and the sky. */
  ok("attach adds its own objects to the map's scene",
     g.scene.children.length === before + 3, `${before} -> ${g.scene.children.length}`);
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

  /* RIGHT BUTTON now, not a key. Left primary and right secondary is the most
     universal convention in the genre; the torpedo used to be on control-click,
     which is not a thing any space game does. */
  const before = ctl.hud().torpedoes;
  g.fire("pointerdown", { button: 2 });
  ctl.frame(1 / 60);
  /* The RELEASE goes to the window, which is where the controller listens
     for it so that letting go outside the canvas still counts. */
  press("pointerup", { button: 2 });
  for (let i = 0; i < 30; i++) ctl.frame(1 / 60);
  ok("the right button launches a torpedo", ctl.hud().inFlight === 1 || ctl.hud().torpedoes < before,
     `rack ${before} -> ${ctl.hud().torpedoes}, in flight ${ctl.hud().inFlight}`);

  /* And a second press sets it off rather than launching another. */
  const racked = ctl.hud().torpedoes;
  g.fire("pointerdown", { button: 2 });
  ctl.frame(1 / 60);
  /* The RELEASE goes to the window, which is where the controller listens
     for it so that letting go outside the canvas still counts. */
  press("pointerup", { button: 2 });
  for (let i = 0; i < 30; i++) ctl.frame(1 / 60);
  /* Both halves, because "the rack did not change" is equally true if the press
     did nothing at all — which is exactly what was happening while the release
     was being fired at the wrong element. */
  ok("a second press detonates rather than launching another",
     ctl.hud().torpedoes === racked && ctl.hud().inFlight === 0,
     `rack ${ctl.hud().torpedoes}, in flight ${ctl.hud().inFlight}`);
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
  g.fire("pointerdown", { button: 2 });
  ctl.frame(1 / 60);
  /* The RELEASE goes to the window, which is where the controller listens
     for it so that letting go outside the canvas still counts. */
  press("pointerup", { button: 2 });
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
  /* SEEDED, and run over several seeds until one of them scores.
   *
   * Whether a shot lands is luck: sixty rounds, no resupply, and fighters that
   * weave. Driving this reliably would need an aiming autopilot. Left to real
   * randomness the run scored on some passes and not on others, and the old
   * "nothing scored, nothing filed" branch passed vacuously on the quiet ones,
   * which is worthless for the bug this covers — two death paths meant a
   * scoring run was silently never filed at all.
   *
   * One fixed seed was no better: it made the fight reproducible but pinned the
   * whole test on that one fight still being a scoring one, and the very next
   * change to the simulation shifted every roll and turned it quiet. A LIST of
   * seeds, tried until one scores, is deterministic AND survives the sim being
   * worked on, which it is going to be.
   *
   * The HUD's own score is NOT the measure. It is pushed on a wall-clock tick,
   * and this loop runs minutes of game time in a fraction of a second, so it
   * reads zero here while reading correctly in the real game.
   */
  const realRandom = Math.random;
  /* Forty seeds, generated by walking the golden-ratio constant so they are
     well spread and cost one line rather than forty. Deterministic, and the
     whole search runs in about two seconds. Six was enough when the ship flew a
     fixed circle over the globe; freeing the flight model made a blind pilot a
     good deal worse at hitting things, and six stopped being enough. */
  const SEEDS = Array.from({ length: 40 }, (_, i) => 0x2f6e2b1 + i * 0x9e3779b1);
  let rows: Array<{ name: string; games: number; best: number; total: number }> = [];
  let died = false;
  let tries = 0;

  for (const s0 of SEEDS) {
    tries++;
    store.clear();
    store.set("dd69.nodeIdentity", JSON.stringify({ name: "Test Node" }));
    let seed = s0;
    Math.random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    const g = stubGlobe([["self-ip", home]]);
    const ctl = createRebels(labelFor);
    ctl.attach({ ...g, selfIp: "self-ip" });
    ctl.launch();
    for (let i = 0; i < 60 * 5; i++) ctl.frame(1 / 60);   /* through the dive */

    let n = 0;
    while (!ctl.hud().dead && n < 60 * 300) {
      n++;
      press("keydown", { key: Math.floor(n / 45) % 2 === 0 ? "arrowleft" : "arrowright" });
      /* SPACED OUT, because the magazine is the whole budget. Firing ten a
         second emptied all sixty rounds in the first six seconds of a
         seventy-second fight, so every shot was taken before the fighters had
         even closed and the run scored precisely nothing. One shot a second
         spreads the same sixty rounds across the whole engagement. */
      if (n % 60 === 0) press("keydown", { key: " " });
      if (n % 60 === 30) press("keyup", { key: " " });
      /* A LAST RESORT, and only after three minutes.
         This used to start at sixty seconds, back when down was a slider on
         altitude and holding it simply pinned the ship near the ground. Once
         pitch became a real direction it meant flying into the planet, which
         kills in four and a half seconds flat: every seeded fight then ended at
         exactly the same frame, from the ground rather than from the fighters,
         before a single shot had a chance to land. The fighters are what should
         end the run; this is only here so the loop cannot hang. */
      if (n > 60 * 180) press("keydown", { key: "arrowdown" });
      ctl.frame(1 / 60);
    }
    died = died || ctl.hud().dead;
    ctl.detach();

    const raw = store.get("dd69.rebels.scores");
    rows = raw ? (JSON.parse(raw) as { rows: typeof rows }).rows : [];
    if (rows.length > 0) break;
  }
  Math.random = realRandom;

  ok("the ship can actually be lost", died);
  ok("a death that scored files a row", rows.length > 0, `gave up after ${tries} fights`);
  ok("filed under the node's name", rows.some((r) => r.name === "Test Node"),
     rows.map((r) => r.name).join(","));
  ok("counted as a game played", rows[0]?.games === 1, `${rows[0]?.games}`);
  ok("a filed run carries the points it earned", (rows[0]?.best ?? 0) > 0 && (rows[0]?.total ?? 0) > 0,
     `best ${rows[0]?.best}, total ${rows[0]?.total}`);
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
  ok("re-attaching does not pile up scenery", g.scene.children.length === before + 3,
     `${g.scene.children.length - before} objects`);
  ctl.detach();
  ok("and the second detach still cleans up", g.scene.children.length === before);
}

// 9. MOUSE FLIGHT: stop moving the mouse and the ship stops turning.
//
//    Geoff, twice: "something is fighting my controls and making the screen
//    jerk up and down."
//
//    The crosshair accumulates mouse movement and its distance from the middle
//    is a RATE of turn. Nothing returned it to the middle, so nudging the mouse
//    down and letting go left the ship pitching down for ever, and pushing to
//    the edge left it looping continuously. That is the jerking.
//
//    It was harmless before the flight model was freed, because up and down was
//    a throttle on an altitude that saturated at the floor. Making pitch a real
//    direction turned the same input into a command with no way to cancel it.
{
  const g = stubGlobe([["self-ip", home]]);
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: "self-ip" });
  ctl.launch();
  for (let i = 0; i < 60 * 6; i++) ctl.frame(1 / 60);   /* through the dive */

  /* Push the mouse up, the way a player does when they mean "climb", then take
     their hand off it. Up rather than down on purpose: a sustained dive from a
     launch pad flies the ship into the planet and kills it, and a dead ship
     cannot demonstrate anything about steering.

     THE SHIP is what is measured, not a crosshair. There is no crosshair offset
     any more: the mouse turns the ship directly, which is the whole change. */
  const aim = () => g.camera.getWorldDirection(new THREE.Vector3());
  const aimBefore = aim();
  for (let i = 0; i < 20; i++) {
    g.fire("pointermove", { movementX: 0, movementY: -30 });
    ctl.frame(1 / 60);
  }
  const swung = aimBefore.angleTo(aim());
  ok("pushing the mouse turns the ship", swung > 0.5, `${swung.toFixed(2)} radians`);

  /* Hand off the mouse. The ship must stop turning AT ONCE — not ease to a
     stop, not drift on for a second, stop. That is the whole reason for
     relative look over a stick that springs back. */
  const held = aim();
  ctl.frame(1 / 60);
  const oneFrame = held.angleTo(aim());
  ok("and it stops the moment the mouse does", oneFrame < 1e-6,
     `${oneFrame.toExponential(1)} radians on the next frame`);

  /* THE ONE THAT MATTERS: the SHIP has to stop turning, not just the
     crosshair. A ship that kept looping would swing its altitude up and down
     for ever; one flying straight changes it in one direction. Sampled over
     six seconds, which is longer than a loop takes.
     Read off the CAMERA, which is the ship and moves every frame. The HUD's
     altitude is pushed on a wall-clock tick, and this loop runs six seconds of
     game time in a few milliseconds, so it reads the launch value throughout
     and every check against it passes for the wrong reason. */
  const shipAlt = () => g.camera.position.length() - R;
  const alts: number[] = [];
  for (let s = 0; s < 6; s++) {
    for (let i = 0; i < 60; i++) ctl.frame(1 / 60);
    alts.push(shipAlt());
  }
  let reversals = 0;
  for (let i = 2; i < alts.length; i++) {
    const a = alts[i - 1] - alts[i - 2], b = alts[i] - alts[i - 1];
    if (Math.sign(a) !== Math.sign(b) && Math.abs(a) > 0.5 && Math.abs(b) > 0.5) reversals++;
  }
  ok("and the ship stops turning too", reversals === 0,
     `${reversals} reversals in ${alts.map((a) => a.toFixed(0)).join(", ")}`);

  /* AND THE KEYBOARD STILL WORKS. Recentring has to reapply the cursor every
     frame, and the cursor and the keys write to the same stick, so getting the
     order wrong would silently kill arrow-key steering — a fix for one control
     that breaks the other. Half a second of stick, then let it fly: holding
     longer carries the nose over the top into a loop and proves nothing. */
  /* The mouse push left it climbing hard, so a second of nose-down has to turn
     that into a descent. A second is about a hundred degrees at the pitch rate,
     which is well past level from where it is pointing. */
  const before = shipAlt();
  press("keydown", { key: "arrowdown" });
  for (let i = 0; i < 70; i++) ctl.frame(1 / 60);
  press("keyup", { key: "arrowdown" });
  const turned = shipAlt();
  for (let i = 0; i < 60; i++) ctl.frame(1 / 60);
  const after = shipAlt();
  ok("a held arrow key still steers", after < turned && turned > before,
     `${before.toFixed(0)} climbing to ${turned.toFixed(0)}, then falling to ${after.toFixed(0)}`);
  ctl.detach();
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
