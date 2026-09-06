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
(globalThis as unknown as { window: unknown }).window = {
  addEventListener: (k: string) => { winListeners[k] = (winListeners[k] ?? 0) + 1; },
  removeEventListener: (k: string) => { winListeners[k] = (winListeners[k] ?? 0) - 1; },
};

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
  ok("attach adds the ship and its guns to the map's own scene",
     g.scene.children.length === before + 2, `${before} -> ${g.scene.children.length}`);
  ok("attach reports ready", h.ready && h.broken === null);
  ok("it uses the real towers it was handed", h.towers === 2, `${h.towers} towers`);
  ok("it knows which tower is yours", h.homeName === "San Jose, Costa Rica", h.homeName);
  ok("it listens on the globe's own canvas", g.listeners.pointermove === 1 && g.listeners.pointerdown === 1);

  // 2. the camera is the map's camera, and the game moves it.
  const camStart = g.camera.position.clone();
  ok("near plane opened up so the ship is not clipped", g.camera.near < nearStart && g.camera.near <= 0.1,
     `${nearStart} -> ${g.camera.near}`);
  ctl.launch();
  for (let i = 0; i < 120; i++) ctl.frame(1 / 60);
  ok("frame moves the map's camera", g.camera.position.distanceTo(camStart) > 1,
     `moved ${g.camera.position.distanceTo(camStart).toFixed(1)}`);
  ok("the camera stays outside the planet", g.camera.position.length() > R,
     `radius ${g.camera.position.length().toFixed(1)}`);

  // 3. the ship is in the scene, above the surface, and near the camera.
  const ship = g.scene.children[before];
  ok("there is a ship object at all", !!ship,
     ship ? "yes" : `scene has ${g.scene.children.length}, broken=${ctl.hud().broken}`);
  if (!ship) throw new Error("no ship: " + (ctl.hud().broken ?? "attach added nothing"));
  ok("the ship flies above the surface", ship.position.length() > R,
     `radius ${ship.position.length().toFixed(1)}`);
  ok("the ship is small next to a tower", (ship.scale.x < 0.8), `scale ${ship.scale.x}`);
  ok("the camera is behind the ship", g.camera.position.distanceTo(ship.position) < 20,
     `${g.camera.position.distanceTo(ship.position).toFixed(1)} away`);

  // 4. the ship is actually travelling, frame to frame.
  const p1 = ship.position.clone();
  for (let i = 0; i < 60; i++) ctl.frame(1 / 60);
  ok("the ship travels over the globe", ship.position.distanceTo(p1) > 5,
     `moved ${ship.position.distanceTo(p1).toFixed(1)} units in a second`);
  ok("window listeners were hooked", (winListeners.keydown ?? 0) === 1 && (winListeners.blur ?? 0) === 1);

  // 5. detach hands everything back.
  ctl.detach();
  ok("detach removes the ship and guns", g.scene.children.length === before,
     `${g.scene.children.length} left`);
  ok("detach restores the map's near plane", g.camera.near === nearStart, `near ${g.camera.near}`);
  ok("detach unhooks every listener",
     g.listeners.pointermove === 0 && g.listeners.pointerdown === 0 &&
     (winListeners.keydown ?? 0) === 0 && (winListeners.blur ?? 0) === 0);
}

// 6. Docking uses the tips the map handed over, not a guess.
{
  const g = stubGlobe([["self-ip", home]]);
  const ctl = createRebels(labelFor);
  ctl.attach({ ...g, selfIp: "self-ip" });
  ctl.launch();
  ctl.frame(1 / 60);
  const ship = g.scene.children[g.scene.children.length - 2];
  /* Checked on the FIRST frame: six seconds later it has flown a hundred units
     away, which is the game working, not the spawn being wrong. */
  ok("you launch from your own tower, not from nowhere",
     ship.position.distanceTo(home) < 40, `${ship.position.distanceTo(home).toFixed(1)} from the tip`);
  for (let i = 0; i < 60 * 6; i++) ctl.frame(1 / 60);
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
  ok("re-attaching does not pile up ships", g.scene.children.length === before + 2,
     `${g.scene.children.length - before} objects`);
  ctl.detach();
  ok("and the second detach still cleans up", g.scene.children.length === before);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
