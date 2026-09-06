// Divi Rebels, flying the Node Map's own globe.
//
// This owns no scene and no renderer. It is handed the map's live scene through
// GlobeMap's `flight` hook, adds a ship to it, and drives the map's own camera.
// Everything else on screen is the map doing what it always does: the earth, the
// towers, the double-helix links with hex characters running along them, the
// query ripple, the stake-winner coin. All of it keeps animating while you fly
// through it, because none of it has been replaced.

import * as THREE from "three";
import type { GlobeFlight } from "../GlobeMap";
import { buildShip, readPalette, type Palette } from "./orbitWorld";
import {
  createFlight, stepFlight, chaseCamera, MAX_AMMO, MAX_SHIELD,
  type Flight, type Stick,
} from "./orbitFlight";

export interface HudState {
  ready: boolean;
  speed: number;
  alt: number;
  shields: number;
  ammo: number;
  boost: number;
  dock: number;
  dockName: string;
  homeName: string;
  homeDist: number;
  towers: number;
  dead: boolean;
  launched: boolean;
  broken: string | null;
}

const BLANK: HudState = {
  ready: false, speed: 0, alt: 0, shields: MAX_SHIELD, ammo: MAX_AMMO, boost: 1,
  dock: 0, dockName: "", homeName: "", homeDist: 0, towers: 0, dead: false, launched: false, broken: null,
};

const BOLT_CAP = 200;
/** The ship next to a three-unit tower. Small on purpose: the towers are the
 *  landmarks and the planet is the world, the fighter is a speck crossing it. */
const SHIP_SCALE = 0.42;

export interface RebelsController extends GlobeFlight {
  hud(): HudState;
  subscribe(fn: (h: HudState) => void): () => void;
  launch(): void;
  respawn(): void;
  dispose(): void;
}

export function createRebels(labelFor: (ip: string) => string): RebelsController {
  let hud: HudState = { ...BLANK };
  const listeners = new Set<(h: HudState) => void>();
  const push = () => { for (const fn of listeners) fn(hud); };

  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let dom: HTMLCanvasElement | null = null;
  let pal: Palette | null = null;
  let ship: THREE.Object3D | null = null;
  let boltMesh: THREE.LineSegments | null = null;
  let boltGeo: THREE.BufferGeometry | null = null;
  let boltMat: THREE.LineBasicMaterial | null = null;

  let tipList: THREE.Vector3[] = [];
  let ipList: string[] = [];
  let homeIndex = -1;
  let flight: Flight | null = null;
  let flying = false;
  /* Near and far get changed so the ship is not clipped at arm's length; the
     map's own values are put back on the way out. */
  let savedNear = 0, savedFar = 0;
  let hudAt = 0;

  const stick: Stick = { x: 0, y: 0, boosting: false, braking: false, firing: false };
  const keys: Record<string, boolean> = {};

  const scratch = {
    up: new THREE.Vector3(),
    camPos: new THREE.Vector3(),
    lookAt: new THREE.Vector3(),
    target: new THREE.Vector3(),
    m4: new THREE.Matrix4(),
    qBank: new THREE.Quaternion(),
    zAxis: new THREE.Vector3(0, 0, 1),
  };

  function setHud(patch: Partial<HudState>) {
    hud = { ...hud, ...patch };
    push();
  }

  /* ---------------- input ----------------
     The pointer is a stick: its offset from the middle of the canvas is the
     deflection, so the crosshair goes where the hand goes. */
  function onMove(e: PointerEvent) {
    if (!dom) return;
    const r = dom.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    stick.x = Math.max(-1, Math.min(1, nx * 1.25));
    stick.y = Math.max(-1, Math.min(1, -ny * 1.25));
  }
  function onDown(e: PointerEvent) { stick.firing = true; e.preventDefault(); }
  function onUp() { stick.firing = false; }
  function applyKeys() {
    let kx = 0, ky = 0;
    if (keys.arrowleft || keys.a) kx -= 1;
    if (keys.arrowright || keys.d) kx += 1;
    if (keys.arrowup || keys.w) ky += 1;
    if (keys.arrowdown || keys.s) ky -= 1;
    if (kx || ky) { stick.x = kx; stick.y = ky; }
    stick.boosting = !!keys.shift;
    stick.braking = !!keys.z;
  }
  function onKeyDown(e: KeyboardEvent) {
    if (!flying) return;
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "w", "a", "s", "d", "z", "shift"].includes(k)) {
      e.preventDefault();
    }
    keys[k] = true;
    if (k === " ") stick.firing = true;
    applyKeys();
  }
  function onKeyUp(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    keys[k] = false;
    if (k === " ") stick.firing = false;
    applyKeys();
  }
  /* Losing the window must not leave the throttle open or a key stuck down. */
  function onBlur() {
    for (const k in keys) keys[k] = false;
    stick.firing = false; stick.boosting = false; stick.braking = false; stick.x = 0; stick.y = 0;
  }

  function startAt(index: number) {
    const at = index >= 0 && tipList[index]
      ? tipList[index].clone()
      : new THREE.Vector3(0, 0, 106);
    flight = createFlight(at);
    setHud({ dead: false });
  }

  return {
    attach(api) {
      try {
        scene = api.scene;
        camera = api.camera;
        dom = api.dom;
        pal = readPalette();

        /* Real tower tips off the real map. Docking lines up with the towers
           you can actually see, because they ARE those towers. */
        ipList = [...api.tips.keys()];
        tipList = ipList.map((ip) => api.tips.get(ip)!.clone());
        homeIndex = api.selfIp ? ipList.indexOf(api.selfIp) : -1;

        savedNear = camera.near;
        savedFar = camera.far;
        camera.near = 0.05;
        camera.far = Math.max(camera.far, 4000);
        camera.updateProjectionMatrix();

        ship = buildShip(pal);
        ship.scale.setScalar(SHIP_SCALE);
        ship.renderOrder = 10;
        scene.add(ship);

        boltGeo = new THREE.BufferGeometry();
        boltGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BOLT_CAP * 6), 3));
        boltMat = new THREE.LineBasicMaterial({ color: pal.bolt });
        boltMesh = new THREE.LineSegments(boltGeo, boltMat);
        boltMesh.frustumCulled = false;
        scene.add(boltMesh);

        startAt(homeIndex);

        dom.addEventListener("pointermove", onMove);
        dom.addEventListener("pointerdown", onDown);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);

        setHud({
          ready: true,
          broken: null,
          towers: tipList.length,
          homeName: homeIndex >= 0 ? labelFor(ipList[homeIndex]) : "no node located",
        });
      } catch (err) {
        /* Never throw out of here. This runs inside the map's own effect, and
           an exception would take the Node Map down with it. */
        setHud({ broken: err instanceof Error ? err.message : "the game could not start", ready: false });
      }
    },

    frame(dt) {
      if (!flight || !camera || !ship || !boltGeo) return;
      try {
        const live = flying && !hud.dead;
        const blank: Stick = { x: 0, y: 0, boosting: false, braking: false, firing: false };
        const res = stepFlight(flight, dt, live ? stick : blank, tipList, homeIndex);
        if (res.hit && flight.shields <= 0) setHud({ dead: true });

        const s = scratch;
        s.up.copy(flight.pos).normalize();
        s.target.copy(flight.pos).addScaledVector(flight.fwd, 10);
        s.m4.lookAt(flight.pos, s.target, s.up);
        ship.quaternion.setFromRotationMatrix(s.m4);
        s.qBank.setFromAxisAngle(s.zAxis, flight.bank);
        ship.quaternion.multiply(s.qBank);
        ship.position.copy(flight.pos);

        chaseCamera(flight, s.camPos, s.lookAt);
        camera.position.copy(s.camPos);
        camera.up.copy(s.up);
        camera.lookAt(s.lookAt);

        const attr = boltGeo.getAttribute("position") as THREE.BufferAttribute;
        const buf = attr.array as Float32Array;
        const n = Math.min(flight.bolts.length, BOLT_CAP);
        for (let i = 0; i < n; i++) {
          const b = flight.bolts[i];
          const o = i * 6;
          buf[o] = b.pos.x; buf[o + 1] = b.pos.y; buf[o + 2] = b.pos.z;
          buf[o + 3] = b.pos.x - b.dir.x * 1.2;
          buf[o + 4] = b.pos.y - b.dir.y * 1.2;
          buf[o + 5] = b.pos.z - b.dir.z * 1.2;
        }
        attr.needsUpdate = true;
        boltGeo.setDrawRange(0, n * 2);

        const now = performance.now();
        if (now - hudAt > 100) {
          hudAt = now;
          setHud({
            speed: flight.speed,
            alt: flight.alt,
            shields: Math.max(0, flight.shields),
            ammo: flight.ammo,
            boost: flight.boost,
            dock: flight.dock,
            dockName: flight.dockedAt >= 0 ? labelFor(ipList[flight.dockedAt] ?? "") : "",
            homeDist: homeIndex >= 0 ? flight.pos.distanceTo(tipList[homeIndex]) : 0,
          });
        }
      } catch (err) {
        setHud({ broken: err instanceof Error ? err.message : "the game stopped", ready: false });
        flight = null;
      }
    },

    detach() {
      if (dom) {
        dom.removeEventListener("pointermove", onMove);
        dom.removeEventListener("pointerdown", onDown);
      }
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      if (camera && savedNear) {
        camera.near = savedNear;
        camera.far = savedFar;
        camera.updateProjectionMatrix();
      }
      if (scene && ship) scene.remove(ship);
      if (scene && boltMesh) scene.remove(boltMesh);
      (ship as THREE.LineSegments | null)?.geometry?.dispose();
      ((ship as THREE.LineSegments | null)?.material as THREE.Material | undefined)?.dispose();
      boltGeo?.dispose();
      boltMat?.dispose();
      ship = null; boltMesh = null; boltGeo = null; boltMat = null;
      scene = null; camera = null; dom = null; flight = null;
      setHud({ ready: false });
    },

    hud: () => hud,
    subscribe(fn) { listeners.add(fn); fn(hud); return () => { listeners.delete(fn); }; },
    launch() { flying = true; setHud({ launched: true, dead: false }); },
    respawn() { startAt(homeIndex); flying = true; setHud({ launched: true }); },
    dispose() { listeners.clear(); },
  };
}
