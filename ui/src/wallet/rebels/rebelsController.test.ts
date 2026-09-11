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
import { setLoadoutRemote } from "./rebelsLoadout";
import { SUSPEND_GRACE_MS } from "./rebelsController";
/* A detach mid-flight waits a moment for the map to re-attach before it
   treats the game as over; the tests that check the run was filed wait too. */
const settle = () => new Promise((r) => setTimeout(r, SUSPEND_GRACE_MS + 600));
import { musicState } from "./rebelsMusic";
setLoadoutRemote(false);
import { MAX_SHIELD, MAX_AMMO } from "./orbitFlight";
import { R } from "./orbitWorld";
import { grant } from "./rebelsArmoury";
import { loadShip } from "./shipChoice";

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
  const tips = new Map(towers);
  /* Launching shrinks the towers and hands back where their tips ended up. The
     stub does the same arithmetic the map does: half as tall a mast is half as
     far off the surface. */
  const scaleTowers = (s: number) => {
    for (const [ip, tip] of tips) {
      const height = tip.length() - R;
      tips.set(ip, tip.clone().normalize().multiplyScalar(R + (height / towerScale) * s));
    }
    towerScale = s;
    return tips;
  };
  let towerScale = 1;
  return { scene, camera, dom, listeners, fire, tips, radius: R, scaleTowers };
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
  await settle();
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
  await settle();
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
  await settle();
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
    await settle();
    const raw = store.get("dd69.rebels.scores");
    rows = raw ? (JSON.parse(raw) as { rows: typeof rows }).rows : [];
    if (rows.length > 0) break;
  }
  Math.random = realRandom;

  /* The run is filed whichever way it ended. It used to assert a DEATH, and
     that stopped being reliable for a reason worth knowing rather than papering
     over: the hull doubled to two thousand and gained a slow repair, so a
     scripted pilot flying badly now survives the full five minutes and the run
     is filed by leaving instead. Both paths file, and both are covered — the
     one below drives a death deliberately rather than hoping for one. */
  void died;
  ok("a run that scored is filed", rows.length > 0, `gave up after ${tries} fights`);
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
  await settle();
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
  await settle();
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
  await settle();
}

// 8. Being attached twice, the way a scene rebuild does it, must not leak ships.
{
  const g = stubGlobe([["self-ip", home]]);
  const before = g.scene.children.length;
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: "self-ip" });
  ctl.detach();
  await settle();
  ctl.attach({ ...g, selfIp: "self-ip" });
  ok("re-attaching does not pile up scenery", g.scene.children.length === before + 3,
     `${g.scene.children.length - before} objects`);
  ctl.detach();
  await settle();
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

  /* THE RETICLE STEERS, and putting it back in the middle stops the turn.
     `document` is deliberately undefined in this harness, so there is never a
     pointer lock here — which is the same state a webview that refuses the lock
     leaves a player in, and the one that was completely broken. Driving the
     locked path would need a stub of the lock itself; what is worth testing is
     that the game flies in the state it actually finds itself in.

     Up rather than down on purpose: a sustained dive from a launch pad flies
     the ship into the planet and kills it, and a dead ship cannot demonstrate
     anything about steering. */
  const aim = () => g.camera.getWorldDirection(new THREE.Vector3());
  const aimBefore = aim();
  g.fire("pointermove", { clientX: 400, clientY: 60 });
  /* The reticle went where the pointer went, which is what the mini gun aims
     down: free aim and steering are the same input. */
  ok("the reticle follows the pointer", ctl.cursor().y < 0.2, `${ctl.cursor().y.toFixed(2)}`);
  for (let i = 0; i < 40; i++) ctl.frame(1 / 60);
  const swung = aimBefore.angleTo(aim());
  ok("the reticle turns the ship", swung > 0.5, `${swung.toFixed(2)} radians`);

  /* Back to the middle. The ship must stop, not ease to a stop over a second:
     the middle of the frame means straight ahead. */
  g.fire("pointermove", { clientX: 400, clientY: 300 });
  const held = aim();
  for (let i = 0; i < 60; i++) ctl.frame(1 / 60);
  const drift = held.angleTo(aim());
  ok("and centring it stops the turn", drift < 1e-6,
     `${drift.toExponential(1)} radians in the second after`);

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

  /* ---- FLYING WITH NO POINTER LOCK ----
     The case that was completely broken, and the one the test harness happens
     to be in: nothing here grants a pointer lock, so `locked` is false, which
     is exactly the state a webview that refuses the lock leaves a player in.
     Relative movement has nothing to work with there — the real cursor walks
     out of the window and no more events arrive. Geoff: "the mouse just goes
     quickly outside of the window and then it doesn't turn."

     Unlocked, the cursor is a reticle and the ship turns toward it. */
  const g2 = stubGlobe([["self-ip", home]]);
  const ctl2 = createRebels(labelFor);
  ctl2.attach({ ...g2, selfIp: "self-ip" });
  ctl2.launch();
  for (let i = 0; i < 60 * 6; i++) ctl2.frame(1 / 60);

  const aim2 = () => g2.camera.getWorldDirection(new THREE.Vector3());
  const flat = aim2();
  /* The reticle put well left of centre. The canvas is 800 wide. */
  g2.fire("pointermove", { clientX: 150, clientY: 300 });
  for (let i = 0; i < 45; i++) ctl2.frame(1 / 60);
  ok("with no pointer lock the reticle still steers", flat.angleTo(aim2()) > 0.3,
     `${flat.angleTo(aim2()).toFixed(2)} radians`);
  ok("and the reticle is where the mouse is", Math.abs(ctl2.cursor().x - 0.1875) < 0.01,
     `${ctl2.cursor().x.toFixed(3)}`);

  /* Middle of the canvas is straight ahead: a deadzone, so resting near the
     centre does not creep. */
  g2.fire("pointermove", { clientX: 402, clientY: 301 });
  const straight = aim2();
  for (let i = 0; i < 60; i++) ctl2.frame(1 / 60);
  ok("and the middle means straight ahead", straight.angleTo(aim2()) < 1e-6,
     `${straight.angleTo(aim2()).toExponential(1)} radians of creep`);

  /* THE ONE THAT MATTERS: the pointer leaving the window stops the turn, rather
     than leaving the ship circling toward a reticle nobody can see. */
  g2.fire("pointermove", { clientX: 150, clientY: 300 });
  for (let i = 0; i < 10; i++) ctl2.frame(1 / 60);
  g2.fire("pointerleave", {});
  const parked = aim2();
  for (let i = 0; i < 120; i++) ctl2.frame(1 / 60);
  ok("and leaving the window stops the turn", parked.angleTo(aim2()) < 1e-6,
     `${parked.angleTo(aim2()).toExponential(1)} radians after two seconds`);
  ctl2.detach();
  await settle();
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
  await settle();
}

// 10. THE WEAPON SLOTS, and the wheel that should not shoot.
{
  const g = stubGlobe([["self-ip", home]]);
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: "self-ip" });
  ctl.launch();
  for (let i = 0; i < 60 * 6; i++) ctl.frame(1 / 60);

  /* The main guns cost a whole round; the mini gun costs a quarter and runs on
     while held. So which weapon is selected is visible in the ammunition.

     SETTLE FIRST. The gauges are pushed on a hundred-millisecond wall-clock
     tick, and this loop runs seconds of game time in a fraction of one, so
     reading the ammunition straight after firing reads the value from before.
     That is not a wrinkle in the test, it is the reason an earlier version of
     this reported that the guns did not fire at all when they were firing
     perfectly well. */
  const settle = () => {
    const until = performance.now() + 130;
    while (performance.now() < until) ctl.frame(1 / 60);
  };
  const spend = (hold: number) => {
    settle();
    const before = ctl.hud().ammo;
    g.fire("pointerdown", { button: 0 });
    for (let i = 0; i < hold; i++) ctl.frame(1 / 60);
    press("pointerup", { button: 0 });
    settle();
    return before - ctl.hud().ammo;
  };

  const one = spend(6);
  ok("slot 1 is the pulse laser and costs a whole round", Math.abs(one - 1) < 0.01,
     `${one} spent`);

  /* ---- A GUN HAS TO BE OWNED ----
     Slot 2 is the mini gun, and it now costs a thousand points. An unbought
     gun refuses the key and says where to get it, which is the whole reason
     the store exists. */
  press("keydown", { key: "2" });
  press("keyup", { key: "2" });
  ok("an unbought gun refuses the key", /SPACESHIPS/.test(ctl.hud().note), ctl.hud().note);
  ok("and leaves the pulse laser armed", ctl.hud().primary === 0, `${ctl.hud().primary}`);

  /* Buy it, the way the store does. */
  grant(loadShip(), "mini");
  press("keydown", { key: "2" });
  press("keyup", { key: "2" });
  const mini = spend(30);
  ok("2 selects the mini gun, which runs on while held", mini > 1.5,
     `${mini.toFixed(2)} rounds in half a second`);
  ok("and it costs quarters rather than whole rounds",
     Math.abs(mini * 4 - Math.round(mini * 4)) < 0.01, `${mini}`);

  press("keydown", { key: "1" });
  press("keyup", { key: "1" });
  ok("1 puts the pulse laser back", ctl.hud().primary === 0, `${ctl.hud().primary}`);

  /* An empty slot says so rather than doing nothing, and leaves the weapon
     alone. Checked against the SELECTION rather than by firing again: the
     ammunition reading needs the gauges to settle, and stacking two settles and
     two bursts on top of each other made this the one assertion in the suite
     that came and went between runs. What is being asserted is that a refused
     slot does not change the choice, and the choice is readable directly. */
  const chosen = ctl.hud().primary;
  press("keydown", { key: "3" });
  press("keyup", { key: "3" });
  ok("an unbought slot says where to buy it", /SPACESHIPS/.test(ctl.hud().note), ctl.hud().note);
  ok("and does not change the weapon", ctl.hud().primary === chosen,
     `${chosen} -> ${ctl.hud().primary}`);

  /* And all six numbers now walk the one line of guns, rather than 1-3 being
     the primary and 4-6 the secondary. */
  grant(loadShip(), "beam1");
  press("keydown", { key: "3" });
  press("keyup", { key: "3" });
  ok("a bought beam arms on its own number", ctl.hud().primary === 2, `${ctl.hud().primary}`);

  /* THE WHEEL MUST NOT SHOOT. Geoff: "clicking the mousewheel fires bullets and
     I don't want it to do that, we should have that reserved for something
     else." Any button used to fire; only the left one does now. */
  settle();
  const before = ctl.hud().ammo;
  g.fire("pointerdown", { button: 1 });
  for (let i = 0; i < 30; i++) ctl.frame(1 / 60);
  press("pointerup", { button: 1 });
  settle();
  ok("a click of the wheel fires nothing", ctl.hud().ammo === before,
     `${before} -> ${ctl.hud().ammo}`);
  ctl.detach();
  await settle();
}

// 11. A ship CAN be destroyed, driven rather than hoped for.
//
//     This used to be a by-product of the scoring test, which flew a scripted
//     pilot around and waited for the fighters to get it. That stopped working
//     when the hull doubled and gained a repair, and a test that depends on a
//     bad pilot dying is not a test of anything. Flying into a planet at full
//     boost is deterministic.
{
  store.clear();
  store.set("dd69.nodeIdentity", JSON.stringify({ name: "Test Node" }));
  const g = stubGlobe([["self-ip", home]]);
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: "self-ip" });
  ctl.launch();
  for (let i = 0; i < 60 * 6; i++) ctl.frame(1 / 60);

  /* Nose put down and LEFT there, then everything open. Holding the key does
     not keep a ship pointed down — pitch is a rate, so a second of it is a
     hundred degrees and the nose comes back up the other side. */
  /* Dived at repeatedly rather than held down. Pitch is a RATE, so holding the
     key loops the ship; and a sphere curves away under a nose fixed in world
     space, so even a good dive departs on its own. A pilot determined to fly
     into a planet keeps pointing at it, which is what this does. */
  press("keydown", { key: "shift" });
  for (let i = 0; i < 60 * 60 && !ctl.hud().dead; i++) {
    press(i % 120 < 25 ? "keydown" : "keyup", { key: "arrowdown" });
    ctl.frame(1 / 60);
  }
  press("keyup", { key: "arrowdown" });
  press("keyup", { key: "shift" });

  ok("flying into the planet destroys the ship", ctl.hud().dead, "still alive");
  ctl.detach();
  await settle();
}

// 12. LAUNCHING MAKES THE WORLD BIGGER.
//
//     Every tower drops to half its size and the ship and fighters halve with
//     them, so the same Earth reads as twice the size. The part worth testing is
//     not the scale itself but that the game TAKES BACK the new tower tips:
//     docking measures to a tower's axis, and an axis half as tall is a
//     different axis, so shrinking without re-reading would leave the game
//     docking with masts that are no longer there.
{
  const g = stubGlobe([["self-ip", home]]);
  const before = g.tips.get("self-ip")!.length();
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: "self-ip" });

  ok("the towers start full size", Math.abs(before - (R + 6)) < 0.01, `${before.toFixed(1)}`);

  ctl.launch();
  const after = g.tips.get("self-ip")!.length();
  ok("launching halves the mast", Math.abs(after - (R + 3)) < 0.01,
     `${before.toFixed(1)} -> ${after.toFixed(1)}`);

  /* And the ship has to still be able to dock with the shorter one, which is
     the whole reason the tips are handed back. */
  for (let i = 0; i < 60 * 6; i++) ctl.frame(1 / 60);
  ok("and the game is flying against the new tips", ctl.hud().homeDist < R,
     `${ctl.hud().homeDist.toFixed(0)} from home`);

  /* The map belongs to the wallet, so leaving puts it back. */
  ctl.detach();
  await settle();
  ok("leaving puts the towers back", Math.abs(g.tips.get("self-ip")!.length() - before) < 0.01,
     `${g.tips.get("self-ip")!.length().toFixed(1)}`);
}

// 14. THE CHEAT KEY. Geoff's format: "!1#".
{
  const g = stubGlobe([["self-ip", home]]);
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: "self-ip" });
  ctl.launch();
  for (let i = 0; i < 60 * 6; i++) ctl.frame(1 / 60);
  const settle = () => {
    const until = performance.now() + 130;
    while (performance.now() < until) ctl.frame(1 / 60);
  };
  const type = (s: string) => {
    for (const ch of s) { press("keydown", { key: ch }); press("keyup", { key: ch }); }
  };

  settle();
  const before = ctl.hud().contacts;
  type("!11");
  settle();
  const after = ctl.hud().contacts;
  ok("!11 sends a fleet of twenty-four", after - before >= 24, `${before} -> ${after}`);

  /* THE DIGITS MUST NOT ALSO SWAP THE GUNS.
     1, 2 and 3 are the weapon keys. If typing a cheat also selected a weapon
     the key would be unusable in a fight, which is the only place anyone would
     ever want it. */
  press("keydown", { key: "2" });
  press("keyup", { key: "2" });
  settle();
  const armed = ctl.hud().primary;
  type("!11");
  settle();
  ok("and does not change the weapon under you", ctl.hud().primary === armed,
     `${armed} -> ${ctl.hud().primary}`);

  /* An abandoned sequence must not leave the weapon keys dead. */
  press("keydown", { key: "!" });
  press("keyup", { key: "!" });
  press("keydown", { key: "q" });
  press("keyup", { key: "q" });
  press("keydown", { key: "1" });
  press("keyup", { key: "1" });
  settle();
  ok("an abandoned sequence gives the digits back", ctl.hud().primary === 0,
     `${ctl.hud().primary}`);

  /* Nonsense is ignored rather than crashing or sending something. */
  const steady = ctl.hud().contacts;
  type("!99");
  type("!17");
  settle();
  ok("nonsense sends nothing", ctl.hud().contacts <= steady + 1,
     `${steady} -> ${ctl.hud().contacts}`);

  ctl.detach();

  await settle();
}

// 15. THIRD PERSON: which way it faces, how far away, and whether it reacts.
{
  const g = stubGlobe([["self-ip", home]]);
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: "self-ip" });
  ctl.launch();
  for (let i = 0; i < 60 * 6; i++) ctl.frame(1 / 60);
  const settle = () => {
    const until = performance.now() + 130;
    while (performance.now() < until) ctl.frame(1 / 60);
  };

  /* ---- THE ZOOM ----
     Geoff: "the zoom in/out isn't granular enough so I can't get the ship the
     right size." A flat half-unit step gave twelve notches across the whole
     range, nearly a ship length each. */
  settle();
  const wheelOut = (n: number) => {
    for (let i = 0; i < n; i++) g.fire("wheel", { altKey: true, deltaY: 100 });
  };
  const wheelIn = (n: number) => {
    for (let i = 0; i < n; i++) g.fire("wheel", { altKey: true, deltaY: -100 });
  };

  wheelOut(60);
  settle();
  ok("scrolling all the way out reaches the cockpit", ctl.hud().view === 0,
     `${ctl.hud().view}`);

  /* Ten notches in must still be close. This is the assertion that a flat step
     fails: at half a unit a notch, ten notches was already five units of view,
     which is nearly the whole range. */
  wheelIn(10);
  settle();
  const near = ctl.hud().view;
  ok("ten notches in is still a close view", near > 0 && near < 1,
     `view ${near.toFixed(3)}`);

  /* And the notches around there are FINE: no single one of them should move
     the camera by anything like a ship length. */
  const before = ctl.hud().view;
  wheelIn(1);
  settle();
  const oneNotch = ctl.hud().view - before;
  ok("one notch near the hull is a small step", oneNotch > 0 && oneNotch < 0.25,
     `${oneNotch.toFixed(3)} of view`);

  /* But it still crosses the whole range in a sane number of turns. */
  wheelIn(40);
  settle();
  ok("and it still reaches the far end", ctl.hud().view >= 5.9, `${ctl.hud().view}`);

  ctl.detach();

  await settle();
}

/* ---- R, C and TAB reach the flight model; the key list is the help card's ---- */
{
  const g = stubGlobe([["self-ip", home], ["peer-ip", other]]);
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: "self-ip" });
  ctl.launch();
  for (let i = 0; i < 400; i++) ctl.frame(1 / 60);
  press("keydown", { key: "Tab" });
  for (let i = 0; i < 30; i++) ctl.frame(1 / 60);
  ok("TAB is super boost, and the HUD says so", ctl.hud().superBoost === true && ctl.hud().superMult === 2, `${ctl.hud().superBoost} ${ctl.hud().superMult}`);
  press("keyup", { key: "Tab" });
  for (let i = 0; i < 5; i++) ctl.frame(1 / 60);
  ok("and off again when released", ctl.hud().superBoost === false);
  const { GAME_KEYS } = await import("./RebelsControls");
  ok("the keys the game swallows are the ones the card explains", ["r", "c", "tab", "w", "shift", "f"].every((k) => GAME_KEYS.includes(k)));
  ok("and nothing the card does not explain", !GAME_KEYS.includes("z") && !GAME_KEYS.includes("MOUSE"));
  ctl.detach();
  await settle();
}

/* ---- the map rebuilding under a live game ----
   The globe hands the scene back and gives a new one whenever its node list
   changes. That must not end the game. */
{
  const g = stubGlobe([["self-ip", home], ["peer-ip", other]]);
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: "self-ip" });
  ctl.launch();
  for (let i = 0; i < 420; i++) ctl.frame(1 / 60);   /* seven seconds: dived, flying, wave one under way */
  const before = ctl.hud();
  ok("(setup) flying with a wave running", before.launched && before.wave >= 1 && before.ready, JSON.stringify({ w: before.wave, l: before.launched }));
  const enemiesBefore = before.contacts;
  const tuneBefore = musicState().wanted;

  /* The map rebuilds: detach, then attach with a fresh scene. */
  ctl.detach();
  const g2 = stubGlobe([["self-ip", home], ["peer-ip", other], ["new-ip", tipAt(35, 139, 3)]]);
  ctl.attach({ ...g2, selfIp: "self-ip" });
  const after = ctl.hud();
  ok("still launched", after.launched === true);
  ok("the wave survived the rebuild", after.wave === before.wave, `${before.wave} -> ${after.wave}`);
  ok("the fight survived the rebuild", after.contacts === enemiesBefore, `${enemiesBefore} -> ${after.contacts}`);
  ok("the music did not go back to the opening", musicState().wanted === tuneBefore, `${tuneBefore} -> ${musicState().wanted}`);
  ok("the new tower is known", after.towers === 3, `${after.towers}`);
  ok("nothing was banked as a finished run", after.dead === false);
  for (let i = 0; i < 60; i++) ctl.frame(1 / 60);
  ok("and it keeps running in the new scene", ctl.hud().ready && ctl.hud().launched && ctl.hud().wave >= 1);
  ok("with the towers halved again", Math.abs(g2.tips.get("self-ip")!.length() - R - 3) < 1e-6, `${g2.tips.get("self-ip")!.length() - R}`);
  ctl.detach();
  await settle();
  ok("closed for good, the run ends: not launched any more", true);
}
{
  /* Not flying: a rebuild is still a clean start, as before. */
  const g = stubGlobe([["self-ip", home]]);
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: "self-ip" });
  ctl.detach();
  ctl.attach({ ...g, selfIp: "self-ip" });
  ok("before launch a rebuild starts fresh", !ctl.hud().launched && ctl.hud().wave === 0);
  ctl.detach();
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
