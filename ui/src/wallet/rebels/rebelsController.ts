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
import {
  createFlight, stepFlight, MAX_AMMO, MAX_SHIELD, MAX_TORPEDOES, MAX_GUARDS,
  GUARD_ABSORB, GUARD_SECONDS,
  type Flight, type Stick,
} from "./orbitFlight";
import {
  createCombat, stepCombat, clearEvents, fireGuns, fireTorpedo, detonateOldest,
  STAKE_BONUS, STAKE_BONUS_MS,
  type CombatState,
} from "./rebelsCombat";
import { userWonRecently } from "../stakeWin";
import { recordScore } from "./rebelsScores";
import {
  createFx, makeFighter, makeShieldRig, makeGuardShell,
  type Fx, type ShieldRig,
} from "./rebelsFx";
import {
  playGunSound, primeGunSound, startRechargeSound, stopRechargeSound,
  playTorpedoSound, playTorpedoBlast, playShipExplosion, resumeAudio,
} from "./rebelsAudio";

export interface HudState {
  ready: boolean;
  speed: number;
  alt: number;
  shields: number;
  ammo: number;
  /** How many are still in the rack, and how many are out there right now. */
  torpedoes: number;
  inFlight: number;
  /** Guards left, and whether one is up right now. */
  guards: number;
  guarding: boolean;
  boost: number;
  dock: number;
  dockName: string;
  homeName: string;
  homeDist: number;
  towers: number;
  /** Fighters in the air right now, and how many you have taken down. */
  contacts: number;
  kills: number;
  /** Points this run. Only damage landed on fighters scores, and never more
   *  than the damage that actually landed. */
  score: number;
  /** Wreckage in orbit right now. */
  junk: number;
  /** Guns are tripled from a recent stake win. */
  bonus: boolean;
  /** Sitting on a pad with the resupply finished. */
  docked: boolean;
  dead: boolean;
  launched: boolean;
  broken: string | null;
}

const BLANK: HudState = {
  ready: false, speed: 0, alt: 0, shields: MAX_SHIELD, ammo: MAX_AMMO,
  torpedoes: MAX_TORPEDOES, inFlight: 0, guards: MAX_GUARDS, guarding: false, boost: 1,
  dock: 0, dockName: "", homeName: "", homeDist: 0, towers: 0, contacts: 0, kills: 0, score: 0, junk: 0, bonus: false, docked: false, dead: false, launched: false, broken: null,
};

/** Fighters are drawn about a unit across, against three-unit towers. */
const ENEMY_SCALE = 0.85;

export interface RebelsController extends GlobeFlight {
  cursor(): { x: number; y: number };
  /** Called when the player presses Escape, which the browser signals by
   *  releasing the pointer. */
  onEscape(fn: () => void): void;
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
  let fx: Fx | null = null;
  let combat: CombatState = createCombat();
  /* One model per fighter in the air, kept in step with the simulation's list
     by index. Built from a single prototype and cloned, so a spawn costs a
     clone rather than a pile of new geometry. */
  let proto: THREE.Group | null = null;
  const enemyMeshes: THREE.Group[] = [];
  /* One shield rig per fighter model, hanging off it. */
  const enemyShields: ShieldRig[] = [];
  let guardShell: ReturnType<typeof makeGuardShell> | null = null;

  let tipList: THREE.Vector3[] = [];
  let ipList: string[] = [];
  let homeIndex = -1;
  let flight: Flight | null = null;
  /* Three phases, and the whole point is that there is never a cut between
     them. APPROACH eases the map's own view until the globe fills the frame,
     with the launch card over it. DIVE flies from there down to the player's
     own node in one continuous motion. FLY hands over to the cockpit, at
     exactly the pose the dive ended on, so the handover cannot be seen. */
  let phase: "approach" | "dive" | "fly" = "approach";
  let flying = false;
  let approach = 0;
  const approachFrom = new THREE.Vector3();
  let approachTo = 0;
  /** How long the flight down from orbit takes. */
  const DIVE_SECONDS = 4.2;
  let diveT = 0;
  const diveFromPos = new THREE.Vector3();
  const diveFromQuat = new THREE.Quaternion();
  const endQuat = new THREE.Quaternion();
  const dirA = new THREE.Vector3();
  const dirB = new THREE.Vector3();
  const dirMix = new THREE.Vector3();

  /** Where the crosshair is, 0..1 across the canvas. Live, not React state:
   *  the cockpit reads it every frame and so does the HUD. */
  const cursor = { x: 0.5, y: 0.5 };
  let locked = false;
  let globeRadius = 100;
  let onEscape: (() => void) | null = null;

  /** Great-circle blend between two directions, so the dive curves round the
     planet instead of cutting a chord through it. */
  function slerpDir(a: THREE.Vector3, b: THREE.Vector3, k: number, out: THREE.Vector3) {
    const dot = Math.max(-1, Math.min(1, a.dot(b)));
    const omega = Math.acos(dot);
    if (omega < 1e-4) return out.copy(b);
    const sin = Math.sin(omega);
    return out.copy(a).multiplyScalar(Math.sin((1 - k) * omega) / sin)
      .addScaledVector(b, Math.sin(k * omega) / sin).normalize();
  }
  /* Near and far get changed so the ship is not clipped at arm's length; the
     map's own values are put back on the way out. */
  let savedNear = 0, savedFar = 0;
  let hudAt = 0;
  /* Winning a stake on your own node makes your guns hit three times as hard
     for a minute. The map already tracks the win; this just asks it. */
  const damageScale = () => (userWonRecently(STAKE_BONUS_MS) ? STAKE_BONUS : 1);
  /* Last frame's docking progress, so the station sound starts and stops on
     the edges rather than being re-triggered sixty times a second. */
  let wasDocking = false;
  /* Points for this run, zeroed on death. Live rather than React state so the
     frame loop can add to it without a render. */
  let score = 0;
  /* The torpedo readouts are pushed the moment they change rather than on the
     ten-times-a-second HUD tick: a rack that updates a tenth of a second after
     the trigger reads as the trigger not having worked. */
  let lastInFlight = -1;
  let lastRack = -1;

  const stick: Stick = { x: 0, y: 0, boosting: false, braking: false, firing: false, heavy: false, guard: false };
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
  function applyCursor() {
    const nx = cursor.x * 2 - 1;
    const ny = cursor.y * 2 - 1;
    stick.x = Math.max(-1, Math.min(1, nx * 1.25));
    stick.y = Math.max(-1, Math.min(1, -ny * 1.25));
  }
  function onMove(e: PointerEvent) {
    if (!dom) return;
    if (locked) {
      /* Under pointer lock there is no cursor position, only movement, so the
         crosshair is ours to keep and to clamp. That clamping is the whole
         reason for the lock: the pointer can no longer wander out of the game
         and click something that closes it. */
      const r = dom.getBoundingClientRect();
      cursor.x = Math.max(0, Math.min(1, cursor.x + e.movementX / r.width));
      cursor.y = Math.max(0, Math.min(1, cursor.y + e.movementY / r.height));
    } else {
      const r = dom.getBoundingClientRect();
      cursor.x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      cursor.y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    }
    applyCursor();
  }

  /* Escape releases the lock, which the browser does for us, and that is the
     signal to leave the game. Nothing else can take the pointer away. */
  function onLockChange() {
    const was = locked;
    locked = typeof document !== "undefined" && document.pointerLockElement === dom;
    if (was && !locked && flying) onEscape?.();
  }
  function onDown(e: PointerEvent) {
    e.preventDefault();
    /* Right button is the guard and nothing else. Only the left one shoots. */
    if (e.button === 2) { stick.guard = true; return; }
    /* Control-click is the torpedo. Read off the event rather than trusting the
       keydown listener, which misses the first one after the window regains
       focus. */
    if (e.ctrlKey || e.metaKey) stick.heavy = true;
    stick.firing = true;
  }
  /* And no context menu in the middle of a dogfight. */
  function onContextMenu(e: Event) { e.preventDefault(); }
  function onUp(e: PointerEvent) {
    if (e.button === 2) { stick.guard = false; return; }
    stick.firing = false;
  }
  function applyKeys() {
    let kx = 0, ky = 0;
    if (keys.arrowleft || keys.a) kx -= 1;
    if (keys.arrowright || keys.d) kx += 1;
    if (keys.arrowup || keys.w) ky += 1;
    if (keys.arrowdown || keys.s) ky -= 1;
    if (kx || ky) { stick.x = kx; stick.y = ky; }
    stick.boosting = !!keys.shift;
    stick.braking = !!keys.z;
    stick.heavy = !!keys.control || !!keys.meta || !!keys.t;
  }
  function onKeyDown(e: KeyboardEvent) {
    if (!flying) return;
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "w", "a", "s", "d", "z", "t", "shift", "control"].includes(k)) {
      e.preventDefault();
    }
    keys[k] = true;
    if (k === " ") stick.firing = true;
    if (k === "t") { stick.heavy = true; stick.firing = true; }
    applyKeys();
  }
  function onKeyUp(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    keys[k] = false;
    if (k === " ") stick.firing = false;
    if (k === "t") stick.firing = false;
    applyKeys();
  }
  /* Losing the window must not leave the throttle open or a key stuck down. */
  function onBlur() {
    for (const k in keys) keys[k] = false;
    stick.firing = false; stick.boosting = false; stick.braking = false;
    stick.heavy = false; stick.guard = false; stick.x = 0; stick.y = 0;
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

        /* Start decoding the samples now. Waiting for the first trigger pull
           meant the opening shots of a fight were silent. */
        primeGunSound();

        fx = createFx();
        scene.add(fx.group);
        guardShell = makeGuardShell();
        scene.add(guardShell.mesh);
        proto = makeFighter();
        combat = createCombat();

        startAt(homeIndex);

        /* Where the globe exactly fills the height of the frame. Slightly
           inside it, so it fills rather than floats. */
        const half = (camera.fov * Math.PI) / 360;
        globeRadius = api.radius;
        approachTo = (api.radius / Math.sin(half)) * 0.92;
        approachFrom.copy(camera.position);
        if (approachFrom.lengthSq() < 1) approachFrom.set(0, 0, approachTo * 1.6);
        approach = 0;

        dom.addEventListener("pointermove", onMove);
        dom.addEventListener("pointerdown", onDown);
        dom.addEventListener("contextmenu", onContextMenu);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        if (typeof document !== "undefined") {
          document.addEventListener("pointerlockchange", onLockChange);
        }

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
      if (!flight || !camera || !fx || !scene || !proto) return;
      try {
        const s = scratch;

        /* ---- before launch: ease the map's own view in or out until the
               globe just fills the frame, keeping whatever direction it was
               already looking from ---- */
        if (phase === "approach") {
          approach = Math.min(1, approach + dt / 3.2);
          /* Smoothstep, so it starts and stops gently instead of lurching. */
          const k = approach * approach * (3 - 2 * approach);
          const fromLen = approachFrom.length() || approachTo;
          const len = fromLen + (approachTo - fromLen) * k;
          camera.position.copy(approachFrom).normalize().multiplyScalar(len);
          camera.up.set(0, 1, 0);
          camera.lookAt(0, 0, 0);
          fx.step(dt, camera);
          return;
        }

        /* ---- the dive ----
           One unbroken move from orbit down to the player's own tower. The
           direction travels the great circle so it curves round the planet
           rather than cutting through it, and the altitude falls on a steeper
           curve so it hangs in space for a moment and then drops. It ends on
           EXACTLY the cockpit pose, which is what makes the handover to live
           flight invisible. */
        if (phase === "dive") {
          diveT = Math.min(1, diveT + dt / DIVE_SECONDS);
          const k = diveT * diveT * (3 - 2 * diveT);

          s.up.copy(flight.pos).normalize();
          s.target.copy(flight.pos).addScaledVector(flight.fwd, 10);
          s.m4.lookAt(flight.pos, s.target, s.up);
          endQuat.setFromRotationMatrix(s.m4);

          dirA.copy(diveFromPos).normalize();
          dirB.copy(flight.pos).normalize();
          slerpDir(dirA, dirB, k, dirMix);
          const rA = diveFromPos.length();
          const rB = flight.pos.length();
          /* Altitude on a squarer curve than the ground track: the descent
             starts gently and finishes fast, which is what a dive feels like. */
          const rk = k * k * (3 - 2 * k) * 0.35 + k * k * k * 0.65;
          camera.position.copy(dirMix).multiplyScalar(rA + (rB - rA) * rk);
          camera.quaternion.slerpQuaternions(diveFromQuat, endQuat, k);
          camera.updateMatrixWorld();
          fx.step(dt, camera);
          if (diveT >= 1) phase = "fly";
          return;
        }

        const live = !hud.dead;
        const blank: Stick = { x: 0, y: 0, boosting: false, braking: false, firing: false, heavy: false, guard: false };
        const res = stepFlight(flight, dt, live ? stick : blank, tipList, homeIndex);
        if (res.hit) fx.boom(flight.pos.clone(), 1.2, "cold");

        s.up.copy(flight.pos).normalize();

        /* ---- the cockpit ----
           The camera IS the ship. There is no model in the middle of the view
           because you are sitting in it, and the bank is applied to the camera
           so a turn rolls the horizon rather than rolling a toy in front of
           you. */
        s.target.copy(flight.pos).addScaledVector(flight.fwd, 10);
        s.m4.lookAt(flight.pos, s.target, s.up);
        camera.quaternion.setFromRotationMatrix(s.m4);
        s.qBank.setFromAxisAngle(s.zAxis, flight.bank * 0.55);
        camera.quaternion.multiply(s.qBank);
        camera.position.copy(flight.pos);
        camera.updateMatrixWorld();

        /* The guard rides with the cockpit, since it is around the player. */
        if (guardShell) {
          guardShell.mesh.position.copy(flight.pos);
          guardShell.step(performance.now() / 1000, Math.min(1, flight.guardFor / (GUARD_SECONDS * 0.6)));
        }

        /* ---- guns ----
           Fired from the edges of the frame at eye level, converging on the
           crosshair, which is why the muzzles come from the camera's frustum
           rather than from a fixed offset. */
        if (res.fired) {
          const muzzles = fireGuns(combat, flight.pos, flight.fwd, s.up, camera.fov, camera.aspect);
          fx.muzzle(muzzles[0]);
          fx.muzzle(muzzles[1]);
          playGunSound();
        }

        /* ---- fighters and their fire ---- */
        stepCombat(combat, dt, {
          tips: tipList,
          playerPos: flight.pos,
          playerFwd: flight.fwd,
          wanted: live ? 4 : 0,
          damageScale: damageScale(),
        });

        /* One button does both jobs. If a torpedo is already in the air the
           press sets it off; otherwise it launches the next one. That is what
           "control-click again to detonate" means with a single control. */
        if (res.heavyPress) {
          const w = {
            tips: tipList, playerPos: flight.pos, playerFwd: flight.fwd,
            wanted: 0, damageScale: damageScale(),
          };
          if (!detonateOldest(combat, w) && flight.torpedoes > 0) {
            flight.torpedoes -= 1;
            fireTorpedo(combat, flight.pos, flight.fwd);
            playTorpedoSound();
          }
        }

        for (const ev of combat.events) {
          if (ev.kind === "playerHit") {
            if (flight.grace <= 0) {
              /* The guard soaks four fifths of it, which is what makes ten of
                 them worth spending carefully. */
              const soak = flight.guardFor > 0 ? 1 - GUARD_ABSORB : 1;
              flight.shields -= (ev.damage ?? 25) * soak;
              flight.grace = 0.45;
              if (flight.shields <= 0) setHud({ dead: true });
            }
            fx.boom(ev.at, 1.4, "cold");
          } else if (ev.kind === "enemyDown") {
            fx.boom(ev.at, 3, "hot");
            playShipExplosion();
          } else if (ev.kind === "enemyHit") {
            /* Points are exactly the damage that landed, so a shot into a
               fighter with ten left scores ten and not eighty. */
            score += Math.round(ev.damage ?? 0);
            /* A small spark where the shot landed. The bubble does the rest. */
            fx.boom(ev.at, ev.power, "cold");
          } else if (ev.kind === "junkGone") {
            fx.boom(ev.at, ev.power, "hot");
            playShipExplosion(0.45);
          } else if (ev.kind === "torpedoBlast") {
            fx.boom(ev.at, 6, "torpedo");
            playTorpedoBlast();
          } else if (ev.kind === "towerHit") {
            fx.boom(ev.at, 2, "hot");
            playShipExplosion(0.55);
          } else {
            fx.boom(ev.at, 0.7, "hot");
          }
        }
        if (flight.shields <= 0 && !hud.dead) {
          /* File the run, then wipe it: the score is for one life. */
          if (score > 0) recordScore(score);
          score = 0;
          setHud({ dead: true, score: 0 });
          /* Hand the pointer back, or the "launch again" button cannot be
             clicked. */
          if (typeof document !== "undefined" && document.pointerLockElement === dom) {
            document.exitPointerLock();
          }
        }

        /* Keep one model per live fighter, cloning and hiding rather than
           building and destroying. */
        while (enemyMeshes.length < combat.enemies.length) {
          const m = proto.clone(true);
          m.scale.setScalar(ENEMY_SCALE);
          scene.add(m);
          enemyMeshes.push(m);
          const rig = makeShieldRig(combat.enemies[0]?.cls.colour ?? 0x66ccff);
          /* Added to the scene rather than to the fighter, so a fighter
             tumbling wildly does not take its own shield bubble and its
             readout spinning with it. */
          scene.add(rig.group);
          enemyShields.push(rig);
        }
        const nowS = performance.now() / 1000;
        for (let i = 0; i < enemyMeshes.length; i++) {
          const m = enemyMeshes[i];
          const rig = enemyShields[i];
          const e = combat.enemies[i];
          if (!e) { m.visible = false; rig.step(nowS, 0); continue; }
          m.visible = true;
          m.position.copy(e.pos);
          s.target.copy(e.pos).addScaledVector(e.fwd, 10);
          s.m4.lookAt(e.pos, s.target, e.pos.clone().normalize());
          m.quaternion.setFromRotationMatrix(s.m4);
          /* The tumble from being hit, on top of the bank from manoeuvring. */
          s.qBank.setFromEuler(new THREE.Euler(e.spin.x, e.spin.y, e.spin.z + e.roll));
          m.quaternion.multiply(s.qBank);

          rig.group.position.copy(e.pos);
          rig.setLevel(e.shield / e.cls.shieldMax);
          /* Shown for a couple of seconds after a hit, fading out. */
          rig.step(nowS, Math.min(1, e.flash / 0.6));
        }

        /* The recharging station, on for exactly as long as the resupply. */
        const docking = flight.dock > 0;
        if (docking !== wasDocking) {
          wasDocking = docking;
          if (docking) startRechargeSound(); else stopRechargeSound();
        }

        if (combat.torpedoes.length !== lastInFlight || flight.torpedoes !== lastRack) {
          lastInFlight = combat.torpedoes.length;
          lastRack = flight.torpedoes;
          setHud({ inFlight: lastInFlight, torpedoes: lastRack });
        }

        /* Everything raised this frame has now been drawn and scored. */
        clearEvents(combat);

        fx.drawBullets(combat.bullets);
        fx.drawTorpedoes(combat.torpedoes);
        fx.drawJunk(combat.junk);
        fx.step(dt, camera);

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
            torpedoes: flight.torpedoes,
            inFlight: combat.torpedoes.length,
            guards: flight.guards,
            guarding: flight.guardFor > 0,
            contacts: combat.enemies.length,
            kills: combat.kills,
            score,
            junk: combat.junk.length,
            bonus: damageScale() > 1,
            docked: flight.dock >= 1,
          });
        }
      } catch (err) {
        setHud({ broken: err instanceof Error ? err.message : "the game stopped", ready: false });
        flight = null;
      }
    },

    detach() {
      stopRechargeSound();
      wasDocking = false;
      if (dom) {
        dom.removeEventListener("pointermove", onMove);
        dom.removeEventListener("pointerdown", onDown);
        dom.removeEventListener("contextmenu", onContextMenu);
      }
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      if (typeof document !== "undefined") {
        document.removeEventListener("pointerlockchange", onLockChange);
        if (document.pointerLockElement === dom) document.exitPointerLock();
      }
      locked = false;
      if (camera && savedNear) {
        camera.near = savedNear;
        camera.far = savedFar;
        camera.updateProjectionMatrix();
      }
      if (scene && guardShell) scene.remove(guardShell.mesh);
      guardShell?.dispose();
      guardShell = null;
      if (scene) {
        for (const m of enemyMeshes) scene.remove(m);
        for (const r of enemyShields) scene.remove(r.group);
        if (fx) scene.remove(fx.group);
      }
      for (const r of enemyShields) r.dispose();
      enemyShields.length = 0;
      enemyMeshes.length = 0;
      fx?.dispose();
      /* The prototype's geometry is shared by every clone, so it is disposed
         once, here, and not per fighter. */
      proto?.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
      fx = null; proto = null;
      combat = createCombat();
      scene = null; camera = null; dom = null; flight = null;
      setHud({ ready: false });
    },

    /** The live crosshair, 0..1 across the canvas. Read every frame by the HUD;
     *  putting it through React state would make aiming feel soggy. */
    cursor: () => cursor,
    onEscape(fn) { onEscape = fn; },
    hud: () => hud,
    subscribe(fn) { listeners.add(fn); fn(hud); return () => { listeners.delete(fn); }; },
    launch() {
      flying = true;
      /* This is a real click, which is the only thing a webview will start
         audio from. Decoding began back at attach; this is what lets it be
         heard. */
      resumeAudio();
      primeGunSound();
      startAt(homeIndex);
      if (camera) {
        diveFromPos.copy(camera.position);
        diveFromQuat.copy(camera.quaternion);
      }
      /* If the approach has not moved the camera yet, launching this instant
         would dive from wherever it happened to be, and from inside the planet
         if that was the origin. Start from the approach framing instead. */
      if (diveFromPos.length() < globeRadius * 1.05) {
        diveFromPos.copy(approachFrom.lengthSq() > 1 ? approachFrom : new THREE.Vector3(0, 0, 1))
          .normalize().multiplyScalar(approachTo || globeRadius * 2.4);
      }
      diveT = 0;
      phase = "dive";
      cursor.x = 0.5; cursor.y = 0.5;
      applyCursor();
      /* Confine the pointer to the game. Without this a stray click lands on
         the sidebar and the panel unmounts mid-flight. If the webview refuses,
         the game still plays, it just is not fenced in. */
      try { dom?.requestPointerLock?.(); } catch { /* not supported here */ }
      setHud({ launched: true, dead: false });
    },
    respawn() {
      score = 0;
      startAt(homeIndex);
      flying = true;
      phase = "fly";
      try { dom?.requestPointerLock?.(); } catch { /* not supported here */ }
      setHud({ launched: true });
    },
    dispose() { listeners.clear(); },
  };
}
