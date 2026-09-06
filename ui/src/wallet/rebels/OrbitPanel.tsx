// Divi Rebels: Orbit mode. Phase 1, single player.
//
// Fly the real Divi node map as a planet, launch from your own node, dock at a
// tower to repair and rearm. No server and no enemies yet: this phase exists to
// answer whether a world four hundred metres around is a joy to fly around, and
// that question needs nobody else online.
//
// The solo vector arcade game is a separate thing and stays where it is, in the
// Community Apps sandbox.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import "./orbit.css";
import { gatherNodes, fallbackHome, type OrbitNode } from "./orbitNodes";
import { buildWorld, buildShip, readPalette, R, MAX_ALT } from "./orbitWorld";
import {
  createFlight, stepFlight, chaseCamera,
  MAX_AMMO, MAX_SHIELD, type Flight, type Stick,
} from "./orbitFlight";
import { useTheme } from "../../theme/ThemeProvider";

/** What the HUD needs. Kept small and refreshed ten times a second, because
 *  putting flight state into React every frame would spend more time in the
 *  reconciler than in the game. */
interface Hud {
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
}

const BOLT_CAP = 200;

function label(n: OrbitNode | null): string {
  if (!n) return "no node located";
  if (n.city && n.country) return `${n.city}, ${n.country}`;
  return n.city || n.country || n.ip;
}

export interface OrbitPanelProps {
  /** Called when the player leaves. The map shows itself again. */
  onExit?: () => void;
}

export function OrbitPanel({ onExit }: OrbitPanelProps = {}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [flying, setFlying] = useState(false);
  const [dead, setDead] = useState(false);
  /* Set when the 3D scene cannot run at all. This panel must fail by saying so,
     never by throwing: an exception in here unmounts the React tree, which
     empties #root, which trips the wallet's own "failed to start" screen and
     locks the user out of their money over a game. Found exactly that way. */
  const [broken, setBroken] = useState<string | null>(null);
  const [hud, setHud] = useState<Hud>({
    speed: 0, alt: 0, shields: MAX_SHIELD, ammo: MAX_AMMO, boost: 1,
    dock: 0, dockName: "", homeName: "", homeDist: 0, towers: 0,
  });
  /* The crosshair is the stick, so it lives outside React state and is moved by
     writing to the node directly. Routing a pointermove through a setState
     sixty times a second is the classic way to make an input feel soggy. */
  const crossRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef<Stick>({ x: 0, y: 0, boosting: false, braking: false, firing: false });
  const flyingRef = useRef(false);
  const deadRef = useRef(false);
  const respawnRef = useRef<() => void>(() => {});
  const { theme } = useTheme();

  /* The palette is baked into vertex colours when the world is built, so the
     scene has to be rebuilt when any of those tokens change. Watching the whole
     theme object would rebuild on every unrelated slider drag. */
  const paletteKey = [
    theme.primary, theme.accent, theme.rebelsOcean, theme.rebelsLand, theme.rebelsGrid,
    theme.rebelsLink, theme.rebelsHome, theme.rebelsShip, theme.rebelsBolt,
  ].join("|");

  useEffect(() => { flyingRef.current = flying; }, [flying]);
  useEffect(() => { deadRef.current = dead; }, [dead]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    /* Everything from here to the first frame is inside one guard. WebGL can be
       missing (old driver, blacklisted GPU, software rendering off) and that is
       a thing to report, not to crash on. */
    let renderer: THREE.WebGLRenderer;
    let world: ReturnType<typeof buildWorld>;
    try {
      const probe = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
      renderer = probe;
    } catch (err) {
      setBroken(err instanceof Error ? err.message : "this machine could not start 3D graphics");
      return;
    }

    /* ---- the world ---- */
    const data = gatherNodes();
    const home = data.home ?? fallbackHome(data.nodes);
    const pal = readPalette();
    try {
      world = buildWorld(data.nodes, home, pal);
    } catch (err) {
      renderer.dispose();
      setBroken(err instanceof Error ? err.message : "the planet could not be built");
      return;
    }
    const homeIndex = home ? data.nodes.findIndex((n) => n.ip === home.ip) : -1;

    const scene = new THREE.Scene();
    scene.add(world.group);

    const ship = buildShip(pal);
    scene.add(ship);

    /* Bolts are one geometry with a moving draw range rather than an object per
       shot, so firing never allocates. */
    const boltGeo = new THREE.BufferGeometry();
    boltGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BOLT_CAP * 6), 3));
    const boltMat = new THREE.LineBasicMaterial({ color: pal.bolt });
    const boltMesh = new THREE.LineSegments(boltGeo, boltMat);
    boltMesh.frustumCulled = false;
    scene.add(boltMesh);

    const camera = new THREE.PerspectiveCamera(72, 1, 0.4, 3000);
    renderer.setClearColor(pal.ocean, 1);

    /* Launch above the home tower, or over the Atlantic if this wallet has
       never seen a single node. Never refuse to start. */
    const start = homeIndex >= 0
      ? world.towerTips[homeIndex].clone()
      : new THREE.Vector3(0, 0, R + 10);
    let flight: Flight = createFlight(start);

    const camPos = new THREE.Vector3();
    const lookAt = new THREE.Vector3();
    const up = new THREE.Vector3();
    const shipTarget = new THREE.Vector3();
    const m4 = new THREE.Matrix4();
    const qBank = new THREE.Quaternion();
    const zAxis = new THREE.Vector3(0, 0, 1);

    let raf = 0;
    let last = performance.now();
    let hudAt = 0;
    let w = 0, h = 0;

    function resize() {
      const rect = wrap!.getBoundingClientRect();
      const nw = Math.max(320, Math.floor(rect.width));
      const nh = Math.max(240, Math.floor(rect.height));
      if (nw === w && nh === h) return;
      w = nw; h = nh;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function respawn() {
      flight = createFlight(start);
      setDead(false);
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      try {
        tick(now);
      } catch (err) {
        /* One bad frame is a bug; sixty a second is a frozen wallet. Stop the
           loop and say what happened rather than filling the console. */
        cancelAnimationFrame(raf);
        setBroken(err instanceof Error ? err.message : "the render loop stopped");
      }
    }

    function tick(now: number) {
      /* A panel that was hidden comes back with a huge gap; clamping stops the
         ship teleporting through the planet on the frame nobody watched. */
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      resize();

      /* Frozen before launch and after being destroyed: the world still turns
         and renders, the ship simply stops taking orders. */
      const live = flyingRef.current && !deadRef.current;
      const stick = live ? stickRef.current : { x: 0, y: 0, boosting: false, braking: false, firing: false };
      if (live || flight.bolts.length > 0) {
        const res = stepFlight(flight, dt, stick, world.towerTips, homeIndex);
        if (res.hit && flight.shields <= 0) setDead(true);
      }

      /* ---- ship transform ---- */
      up.copy(flight.pos).normalize();
      shipTarget.copy(flight.pos).addScaledVector(flight.fwd, 10);
      m4.lookAt(flight.pos, shipTarget, up);
      ship.quaternion.setFromRotationMatrix(m4);
      qBank.setFromAxisAngle(zAxis, flight.bank);
      ship.quaternion.multiply(qBank);
      ship.position.copy(flight.pos);

      /* ---- camera ---- */
      chaseCamera(flight, camPos, lookAt);
      camera.position.copy(camPos);
      camera.up.copy(up);
      camera.lookAt(lookAt);

      /* ---- bolts ---- */
      const arr = boltGeo.getAttribute("position") as THREE.BufferAttribute;
      const buf = arr.array as Float32Array;
      const n = Math.min(flight.bolts.length, BOLT_CAP);
      for (let i = 0; i < n; i++) {
        const b = flight.bolts[i];
        const o = i * 6;
        buf[o] = b.pos.x; buf[o + 1] = b.pos.y; buf[o + 2] = b.pos.z;
        buf[o + 3] = b.pos.x - b.dir.x * 2.4;
        buf[o + 4] = b.pos.y - b.dir.y * 2.4;
        buf[o + 5] = b.pos.z - b.dir.z * 2.4;
      }
      arr.needsUpdate = true;
      boltGeo.setDrawRange(0, n * 2);

      renderer.render(scene, camera);

      /* ---- hud, ten times a second ---- */
      if (now - hudAt > 100) {
        hudAt = now;
        const dockedName = flight.dockedAt >= 0 ? label(data.nodes[flight.dockedAt] ?? null) : "";
        setHud({
          speed: flight.speed,
          alt: flight.alt,
          shields: Math.max(0, flight.shields),
          ammo: flight.ammo,
          boost: flight.boost,
          dock: flight.dock,
          dockName: dockedName,
          homeName: label(home),
          homeDist: homeIndex >= 0 ? flight.pos.distanceTo(world.towerTips[homeIndex]) : 0,
          towers: data.nodes.length,
        });
      }
    }

    resize();
    raf = requestAnimationFrame(frame);

    /* ---- input ----
       The pointer is a stick, not a cursor: its offset from the centre of the
       view is the deflection. That is the same model the arcade game settled
       on after the first version got it backwards, and it is the reason the
       crosshair is drawn where the hand is. */
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      const s = stickRef.current;
      s.x = Math.max(-1, Math.min(1, nx * 1.25));
      s.y = Math.max(-1, Math.min(1, -ny * 1.25));
      const c = crossRef.current;
      if (c) {
        c.style.left = `${e.clientX - rect.left}px`;
        c.style.top = `${e.clientY - rect.top}px`;
      }
    };
    const onDown = (e: PointerEvent) => { stickRef.current.firing = true; e.preventDefault(); };
    const onUp = () => { stickRef.current.firing = false; };
    const keys: Record<string, boolean> = {};
    const applyKeys = () => {
      const s = stickRef.current;
      /* Keys only take over when they are actually held, so pointer and keys
         can be used in the same session without one fighting the other. */
      let kx = 0, ky = 0;
      if (keys.arrowleft || keys.a) kx -= 1;
      if (keys.arrowright || keys.d) kx += 1;
      if (keys.arrowup || keys.w) ky += 1;
      if (keys.arrowdown || keys.s) ky -= 1;
      if (kx || ky) { s.x = kx; s.y = ky; }
      s.boosting = !!keys.shift;
      s.braking = !!keys.z;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!flyingRef.current) return;
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "w", "a", "s", "d", "z", "shift"].includes(k)) {
        e.preventDefault();
      }
      keys[k] = true;
      if (k === " ") stickRef.current.firing = true;
      applyKeys();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keys[k] = false;
      if (k === " ") stickRef.current.firing = false;
      applyKeys();
    };
    /* Losing the window must not leave the throttle open or a key stuck down. */
    const onBlur = () => {
      for (const k in keys) keys[k] = false;
      const s = stickRef.current;
      s.firing = false; s.boosting = false; s.braking = false; s.x = 0; s.y = 0;
    };

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", resize);

    /* Exposed so the "ship lost" card can put the player back on the pad. */
    respawnRef.current = respawn;

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", resize);
      /* Leaving the panel must give the GPU everything back. Switching between
         panels a dozen times otherwise ends in a lost context. */
      world.dispose();
      boltGeo.dispose();
      boltMat.dispose();
      renderer.dispose();
    };
  }, [paletteKey]);

  const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;

  return (
    <div className="orbit" ref={wrapRef}>
      <canvas className="orbit-canvas" ref={canvasRef} />

      <div className="orbit-hud">
        {onExit && (
          <button type="button" className="orbit-exit" onClick={onExit} title="Back to the map">
            BACK TO MAP
          </button>
        )}
        <div className="orbit-tl">
          <div className="orbit-big">{Math.round(hud.speed * 64)} <span className="orbit-dim">km/s</span></div>
          <div className="orbit-row orbit-dim">ALT {Math.round((hud.alt / MAX_ALT) * 100)}%</div>
        </div>
        <div className="orbit-tr">
          <div className="orbit-row">HOME {hud.homeName}</div>
          <div className="orbit-row orbit-dim">
            {hud.homeDist > 0 ? `${Math.round(hud.homeDist * 64)} km away` : " "}
          </div>
          <div className="orbit-row orbit-dim">{hud.towers} towers</div>
        </div>

        {flying && !broken && <div className="orbit-cross" ref={crossRef} />}

        {flying && hud.dock > 0 && (
          <div className="orbit-dock">
            {hud.dock >= 1 ? "REARMED" : `DOCKING ${hud.dockName}`}
            <div className="orbit-dockbar"><i style={{ width: pct(hud.dock) }} /></div>
          </div>
        )}

        <div className="orbit-bars">
          <div className="orbit-gauge">
            <span>SHIELDS</span>
            <div className="orbit-pips">
              {Array.from({ length: MAX_SHIELD }, (_, i) => (
                <div key={i} className={"orbit-pip" + (i < hud.shields ? " on" : "") + (hud.shields <= 2 ? " low" : "")} />
              ))}
            </div>
          </div>
          <div className="orbit-gauge">
            <span>AMMO</span>
            <div className="orbit-meter"><i style={{ width: pct(hud.ammo / MAX_AMMO) }} /></div>
          </div>
          <div className="orbit-gauge">
            <span>BOOST</span>
            <div className="orbit-meter boost"><i style={{ width: pct(hud.boost) }} /></div>
          </div>
        </div>

        {broken && (
          <div className="orbit-card">
            <h2>NO LAUNCH</h2>
            <p>Orbit mode needs 3D graphics, and this machine could not start them.</p>
            <p className="orbit-keys">{broken}</p>
            <p className="orbit-keys">The rest of the wallet is unaffected.</p>
          </div>
        )}

        {!broken && !flying && !dead && (
          <div className="orbit-card">
            <h2>DIVI REBELS</h2>
            <p>Orbit mode. Launching from {hud.homeName || "your node"}.</p>
            <p className="orbit-keys">
              POINT TO FLY, OR ARROWS<br />
              CLICK OR SPACE TO FIRE &nbsp;&nbsp; SHIFT BOOST &nbsp;&nbsp; Z BRAKE<br />
              FLY UP TO ANY TOWER TO REPAIR AND REARM. YOUR OWN IS TWICE AS FAST.
            </p>
            <button type="button" onClick={() => setFlying(true)}>LAUNCH</button>
          </div>
        )}

        {!broken && dead && (
          <div className="orbit-card">
            <h2>SHIP LOST</h2>
            <p>Recovered to {hud.homeName || "your node"}.</p>
            <button type="button" onClick={() => respawnRef.current()}>LAUNCH AGAIN</button>
          </div>
        )}
      </div>
    </div>
  );
}
