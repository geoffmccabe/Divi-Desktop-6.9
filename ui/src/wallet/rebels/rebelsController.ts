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
  createFlight, stepFlight, MAX_AMMO, MAX_SHIELD, MAX_TORPEDOES, MAX_GUARDS, MAX_VIEW,
  GUARD_ABSORB, GUARD_SECONDS,
  type Flight, type Stick,
} from "./orbitFlight";
import {
  createCombat, stepCombat, clearEvents, fireGuns, fireTorpedo, detonateOldest,
  fireMini, miniMuzzle,
  STAKE_BONUS, STAKE_BONUS_MS, TIERS, TRACER_LIFE, startWave,
  type CombatState,
} from "./rebelsCombat";
import { userWonRecently } from "../stakeWin";
import { recordScore, myTotals, addDivi, totalDivi, TIER_COUNT } from "./rebelsScores";
import { R, MAX_ALT } from "./orbitWorld";
import { createSpace, type SpaceBody } from "./spaceEnvironment";
import { installSky, skyTexture, type SkyHandle } from "./starfield";
import { loadModel, unitCopy } from "./spaceAssets";
import { loadShip } from "./shipChoice";
import { loadPaint, makeRepaintable, type PaintHandle } from "./shipColours";
import { fitCollider, placeCollider, noseOf, type HitSphere } from "./shipCollider";
import {
  loadLoadout, saveLoadout, weaponAt, type Loadout, type SlotKind,
} from "./shipLoadout";
import { pulseHealth } from "./healthPulse";
import {
  createFx, makeFighter, makeShieldRig, makeGuardShell,
  type Fx, type ShieldRig,
} from "./rebelsFx";
import {
  playGunSound, primeGunSound, startRechargeSound, stopRechargeSound,
  playTorpedoSound, playTorpedoBlast, playShipExplosion, resumeAudio,
  playMiniSound, playShotAt, setListener, playIncomingWarning, playBounce,
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
  /** When the player was last hit, for the cockpit's flash. */
  hitAt: number;
  /** Guards left, and whether one is up right now. */
  guards: number;
  guarding: boolean;
  boost: number;
  dock: number;
  dockName: string;
  homeName: string;
  homeDist: number;
  towers: number;
  /** How far the camera sits behind the ship. Zero is the cockpit. */
  view: number;
  /** Where the throttle lever is, -0.35 to 1. */
  throttle: number;
  /** Which weapon is in each trigger, as an index into PRIMARY / SECONDARY. */
  primary: number;
  secondary: number;
  /** A line that appears for a moment: what was just selected, or why it could
   *  not be. */
  note: string;
  noteAt: number;
  /** Whatever the ship is near enough to name, or null out in open space.
   *  "Near enough" is within three of the thing's own diameters, so a giant
   *  announces itself from further off than a rock does, which is right. */
  nearby: { name: string; detail: string } | null;
  /** Fighters in the air right now, and how many you have taken down. */
  contacts: number;
  kills: number;
  /** Points this run. Only damage landed on fighters scores, and never more
   *  than the damage that actually landed. */
  score: number;
  /** The wave in progress, and when it was announced. */
  wave: number;
  waveAt: number;
  /** Seconds before the player may launch again, if they must wait. */
  respawnIn: number;
  /** DIVI collected, ever. Survives being shot down. */
  divi: number;
  /** Lifetime kills, one count per tier from tier one upward. */
  tierKills: number[];
  /** Wreckage in orbit right now. */
  junk: number;
  /** Guns are tripled from a recent stake win. */
  bonus: boolean;
  /** Sitting on a pad with the resupply finished. */
  docked: boolean;
  /** How far the nearest tower is, and why docking is not happening. */
  nearTower: number;
  dockBlock: string;
  dead: boolean;
  launched: boolean;
  broken: string | null;
}

const BLANK: HudState = {
  ready: false, speed: 0, alt: 0, shields: MAX_SHIELD, ammo: MAX_AMMO,
  torpedoes: MAX_TORPEDOES, inFlight: 0, hitAt: 0,
  guards: MAX_GUARDS, guarding: false, boost: 1,
  dock: 0, dockName: "", homeName: "", homeDist: 0, towers: 0, view: 0, throttle: 1,
  primary: 0, secondary: 0, note: "", noteAt: 0, nearby: null, contacts: 0, kills: 0, score: 0, nearTower: Infinity, dockBlock: "",
  wave: 0, waveAt: 0, respawnIn: 0,
  divi: 0, tierKills: new Array(7).fill(0), junk: 0, bonus: false, docked: false, dead: false, launched: false, broken: null,
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
  let protos: THREE.Group[] = [];
  const enemyMeshes: THREE.Group[] = [];
  /* One shield rig per fighter model, hanging off it. */
  const enemyShields: ShieldRig[] = [];
  let guardShell: ReturnType<typeof makeGuardShell> | null = null;
  /** How much of its size a tower keeps once a game is running. */
  const WORLD_SCALE = 0.5;
  let space: ReturnType<typeof createSpace> | null = null;
  let sky: SkyHandle | null = null;
  /** The map's own hook for shrinking its towers, held from attach. */
  let scaleTowers: ((s: number) => Map<string, THREE.Vector3>) | null = null;

  /* ---- the ship you can see ----
     Only built once somebody pulls the camera back, because in the cockpit
     there is nothing to draw and a fighter's worth of geometry for a model
     nobody looks at is a fighter's worth of geometry wasted. */
  let shipModel: THREE.Object3D | null = null;
  let shipPaint: PaintHandle | null = null;
  let shipHull: HitSphere[] = [];
  let shipLoading = false;
  /** How long the hull is in world units, which sets both how far the camera
   *  pulls back and how big a target the ship is. */
  const SHIP_LENGTH = 2.6;
  /** The hull's spheres, placed in the world, reused every frame. */
  const hullWorld: Array<{ at: THREE.Vector3; r: number }> = [];
  const shipQuat = new THREE.Quaternion();
  const shipM4 = new THREE.Matrix4();
  const worldM4 = new THREE.Matrix4();
  const worldRight = new THREE.Vector3();
  /** The hull's own frame, worked out from its geometry when it loads. */
  const modelFwd = new THREE.Vector3(0, 0, -1);
  const modelUp = new THREE.Vector3(0, 1, 0);
  const modelRight = new THREE.Vector3(1, 0, 0);
  /** What the ship is currently close enough to, so the readout only changes
   *  when it actually changes. */
  let nearBody: string = "";

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
  /** The pose at the moment the tower is reached: looking down at it. The
   *  landing turn starts here. */
  const arriveQuat = new THREE.Quaternion();
  /** How much of the dive is the run in. The rest is the turn onto the pad. */
  const ARRIVE_AT = 0.74;
  const dirA = new THREE.Vector3();
  const dirB = new THREE.Vector3();
  const dirMix = new THREE.Vector3();

  /** Where the crosshair is, 0..1 across the canvas. Live, not React state:
   *  the cockpit reads it every frame and so does the HUD. */
  const cursor = { x: 0.5, y: 0.5 };
  let locked = false;
  let globeRadius = 100;
  let onEscape: (() => void) | null = null;

  /* The great-circle blend that used to curve the dive round the planet has
     gone with the dive that needed it. The run in is a straight line at the
     tower now, because curving round meant the tower was never ahead. */
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
  /* DIVI collected, ever. Loaded from what this wallet has already banked and
     added to as coins are flown into. */
  let divi = 0;
  /* The torpedo readouts are pushed the moment they change rather than on the
     ten-times-a-second HUD tick: a rack that updates a tenth of a second after
     the trigger reads as the trigger not having worked. */
  /** How long a player waits before rejoining while others are still flying. */
  const RESPAWN_WAIT = 10;
  let respawnAt = 0;
  let nearTower = Infinity;
  let dockBlock: string = "";
  let lastInFlight = -1;
  let lastRack = -1;
  /* Being hit: the view inverts for a tenth of a second and the camera is
     knocked off centre for a fifth, then settles. Both are driven from here so
     they cannot disagree about when a hit happened. */
  const SHAKE_SECONDS = 0.2;
  /** How far off centre the jolt throws the view, as a fraction of it. */
  const SHAKE_FRACTION = 0.15;
  let shakeFor = 0;
  const shakeAxis = new THREE.Vector3();
  /* Lifetime tier kills, seeded from the player's own row so the counters start
     where they left off rather than at zero every session. */
  let lifetimeTiers: number[] = new Array(TIER_COUNT).fill(0);

  /**
   * Losing the ship. THE ONLY PLACE that happens.
   *
   * There used to be two: one marked the player dead the moment their shield
   * ran out, and the other filed the score but only if they were not already
   * marked dead. The first always won, so no run was ever recorded from any
   * death. Filing and dying are one event and belong in one function.
   */
  function die(): void {
    if (hud.dead) return;
    bank();
    /* Alone, losing the ship means every player is down, so the sky is cleared
       and the whole thing starts again at wave one with no waiting. With others
       still flying it will instead be a ten second count, which is the room's
       decision to make rather than this one's. */
    const everyoneDown = true;
    if (everyoneDown) {
      combat.enemies.length = 0;
      combat.bullets.length = 0;
      combat.torpedoes.length = 0;
      combat.wave = null;
      respawnAt = 0;
      setHud({ wave: 0, respawnIn: 0 });
    } else {
      respawnAt = performance.now() + RESPAWN_WAIT * 1000;
    }
    setHud({ dead: true, score: 0 });
    if (typeof document !== "undefined" && document.pointerLockElement === dom) {
      /* Give the pointer back, or the "launch again" button cannot be clicked. */
      document.exitPointerLock();
    }
  }

  /** File whatever has been earned so far and start the count again. */
  function bank(): void {
    if (score > 0 || combat.tierKills.some((n) => n > 0)) {
      recordScore(score, combat.tierKills.slice());
      combat.tierKills.fill(0);
    }
    score = 0;
  }

  const stick: Stick = {
    x: 0, y: 0, lookX: 0, lookY: 0, aimX: 0, aimY: 0, roll: 0, strafe: 0,
    throttle: 0, fullStop: false, boosting: false, firing: false,
    secondary: false, guard: false, mini: false,
  };
  const keys: Record<string, boolean> = {};

  /* What is in the two trigger slots. Saved, so a pilot who prefers the mini
     gun does not have to say so every time they launch. */
  const weapons: Loadout = loadLoadout();

  /**
   * Choose a weapon.
   *
   * A slot that is not fitted yet SAYS SO rather than quietly doing nothing: a
   * key that appears dead is indistinguishable from a bug, and there are three
   * empty slots in this loadout by design.
   */
  function selectWeapon(kind: SlotKind, index: number) {
    const w = weaponAt(kind, index);
    if (!w) return;
    if (!w.ready) {
      setHud({ note: `${w.name}: not yet fitted`, noteAt: performance.now() });
      return;
    }
    weapons[kind] = index;
    saveLoadout(weapons);
    applyKeys();
    setHud({
      primary: weapons.primary,
      secondary: weapons.secondary,
      note: w.name,
      noteAt: performance.now(),
    });
  }

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

     THE MOUSE TURNS THE SHIP. It does not hold a crosshair somewhere.

     There used to be a virtual stick here: the crosshair accumulated mouse
     movement, its distance from the middle of the frame was read as a turn
     RATE, and a spring pulled it back to centre. That is the scheme Squadrons,
     Everspace 2 and Elite ship by default, and it is also the one every single
     game that ships it also ships a "recentre mouse" key for. The key is the
     tell. A stick that can be left deflected with no way to feel it is a stick
     that turns your ship while nobody is touching it, and it is what Geoff hit
     three separate times: shaky controls, a ship that looped upward on its own,
     and a nose that would not stay put.

     What replaces it is what Descent 3, FreeSpace 2 and Elite's optional
     Relative Mouse do — and Frontier's own forums call that option "a secret
     easy mode" and "the biggest skill booster in the game". The mouse turns the
     ship by exactly how far it moved. Stop moving it and the ship stops. There
     is no offset to get stuck in, so the whole family of bugs is gone rather
     than damped.

     The crosshair is therefore always the middle of the screen, which is also
     where the guns already converge. `cursor` stays, fixed at the centre: the
     HUD draws it and the mini gun aims through it, and both want a point rather
     than a special case. */

  /**
   * TWO WAYS TO FLY WITH A MOUSE, because the game has to work in both cases.
   *
   * With the pointer LOCKED the mouse cannot leave the window, so its movement
   * is the turn directly and the reticle stays in the middle where the guns
   * converge. That is the better feel and what the genre has settled on.
   *
   * Without the lock — and a webview may simply refuse it — a relative scheme
   * has nothing to work with: the real cursor walks out of the window and no
   * more movement arrives. Geoff: "the mouse just goes quickly outside of the
   * window and then it doesn't turn." So in that case the cursor becomes a
   * VISIBLE reticle and the ship turns toward it, which is how Freelancer flew
   * and needs no lock at all. Leaving the canvas stops the turn rather than
   * leaving the ship chasing a reticle nobody can see.
   *
   * The two write to different channels — `look` and `aim` — so they sum in the
   * flight model instead of overwriting each other, which is the mistake the
   * last two versions of this made.
   */
  const LOOK_PER_PIXEL = 0.0028;
  /** Where the reticle stops meaning "straight ahead", and where it reaches
   *  full deflection. Short of the frame edge on purpose: nobody should have to
   *  put the cursor on the last pixel to turn hard. */
  const AIM_DEAD = 0.06;
  const AIM_FULL = 0.42;

  function aimFromCursor() {
    const shape = (v: number) => {
      const a = Math.abs(v);
      if (a <= AIM_DEAD) return 0;
      return Math.sign(v) * Math.min(1, (a - AIM_DEAD) / (AIM_FULL - AIM_DEAD));
    };
    stick.aimX = shape(cursor.x * 2 - 1);
    stick.aimY = -shape(cursor.y * 2 - 1);
  }

  function onMove(e: PointerEvent) {
    if (!dom || !flying) return;
    if (locked) {
      stick.lookX += (e.movementX || 0) * LOOK_PER_PIXEL;
      stick.lookY += (e.movementY || 0) * LOOK_PER_PIXEL;
      cursor.x = 0.5;
      cursor.y = 0.5;
      stick.aimX = 0;
      stick.aimY = 0;
      return;
    }
    const r = dom.getBoundingClientRect();
    /* GUARDED, because an event without coordinates would otherwise put NaN in
       the cursor, NaN in the stick, NaN in the ship's heading, and the whole
       flight would quietly stop being a number. Nothing recovers from that: it
       propagates into the position and the ship is gone for the rest of the
       run. A missing coordinate is a bad event, so it is ignored. */
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    cursor.x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    cursor.y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    aimFromCursor();
  }

  /** Pointer gone from the canvas: stop turning, and put the reticle back in
   *  the middle so it does not reappear mid-turn where it was left. */
  function onLeave() {
    stick.aimX = 0;
    stick.aimY = 0;
    cursor.x = 0.5;
    cursor.y = 0.5;
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
    /* Right button is the SECONDARY weapon. It was the shield, which is the one
       place in this scheme that was actively at odds with the genre: left
       primary and right secondary is the most universal convention there is.
       The shield is on F. */
    if (e.button === 2) { stick.secondary = true; return; }
    /* Control-click is the torpedo. Read off the event rather than trusting the
       keydown listener, which misses the first one after the window regains
       focus. Control-click no longer means anything: the secondary weapon is on
       the right button, where the genre puts it. */
    /* LEFT ONLY. Any button used to fire, so a click of the wheel emptied the
       guns — and the middle button is wanted for something of its own. */
    if (e.button !== 0) return;
    stick.firing = true;
  }
  /* And no context menu in the middle of a dogfight. */
  function onContextMenu(e: Event) { e.preventDefault(); }

  /**
   * Option and the wheel pulls the camera out of the cockpit.
   *
   * Option-qualified on purpose: the wheel on its own belongs to whatever the
   * player has open, and a game that swallows every scroll is a game that fights
   * the app it lives in. DreadRoot does the same thing for the same reason.
   */
  function onWheel(e: WheelEvent) {
    if (!flying || !flight) return;
    if (!e.altKey) return;
    e.preventDefault();
    flight.view = Math.max(0, Math.min(MAX_VIEW, flight.view - Math.sign(e.deltaY) * 0.5));
    if (flight.view > 0) ensureShip();
    setHud({ view: flight.view });
  }

  /** The tip of the hull in the world: where the guns and the tube are. */
  const noseLocal = new THREE.Vector3();
  function shipNose(f: { pos: THREE.Vector3; fwd: THREE.Vector3 }): THREE.Vector3 {
    if (shipHull.length === 0) return f.pos.clone().addScaledVector(f.fwd, SHIP_LENGTH * 0.5);
    noseLocal.copy(noseOf(shipHull)).multiplyScalar(SHIP_LENGTH).applyQuaternion(shipQuat);
    return f.pos.clone().add(noseLocal);
  }

  /** Fetch the hull the first time the camera leaves the cockpit. */
  function ensureShip() {
    if (shipModel || shipLoading || !scene) return;
    shipLoading = true;
    const id = loadShip();
    void loadModel(id)
      .then((proto) => {
        if (!scene) return;
        const model = unitCopy(proto);
        model.scale.setScalar(SHIP_LENGTH);
        shipPaint = makeRepaintable(model);
        shipPaint.apply(loadPaint());
        /* Fitted BEFORE the model is scaled into the world, so the spheres are
           in the hull's own space and can be turned with it. */
        shipHull = fitCollider(model);

        /* Forward is the direction of the narrow end of the hull, and up is
           whatever is left of the model's own +Y once that is taken out. */
        modelFwd.copy(noseOf(shipHull));
        if (modelFwd.lengthSq() < 1e-9) modelFwd.set(0, 0, -1);
        modelFwd.normalize();
        modelUp.set(0, 1, 0).addScaledVector(modelFwd, -modelFwd.y);
        if (modelUp.lengthSq() < 1e-9) modelUp.set(1, 0, 0).addScaledVector(modelFwd, -modelFwd.x);
        modelUp.normalize();
        modelRight.crossVectors(modelUp, modelFwd).normalize();

        /* ---- LIGHT ----
           The map's scene has one enormous ambient light and nothing else, so a
           lit hull in it is a flat grey shape with no sense of being anywhere.
           Geoff: "it doesn't capture any of the light or glow from planets or
           anything happening in the scene."

           The sky is already an equirectangular texture, so it can be the hull's
           environment map: the ship then genuinely reflects the starfield and
           the Milky Way, and picks up their colour along its edges. Given to
           THIS model's materials rather than to scene.environment, which would
           relight every tower on the map as well. */
        const env = skyTexture();
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          for (const mat of (Array.isArray(m.material) ? m.material : [m.material])) {
            const std = mat as THREE.MeshStandardMaterial;
            if (!std.isMeshStandardMaterial) continue;
            if (env) { std.envMap = env; std.envMapIntensity = 1.15; }
            /* Enough metal to catch a reflection, enough roughness that it is a
               sheen rather than a mirror. Flat paint reflects nothing and was
               most of why it looked pasted on. */
            std.metalness = 0.35;
            std.roughness = 0.55;
            std.needsUpdate = true;
          }
        });

        shipModel = model;
        scene.add(model);
      })
      .catch(() => { /* no model, no third person: the cockpit still flies */ })
      .finally(() => { shipLoading = false; });
  }
  function onUp(e: PointerEvent) {
    if (e.button === 2) { stick.secondary = false; return; }
    if (e.button !== 0) return;
    stick.firing = false;
  }

  /* ---- THE KEY MAP ----
     Everspace 2's layout, which is where the genre has settled, checked against
     the shipped bindings of Elite, Star Citizen, Squadrons, X4, Freelancer and
     Descent rather than guessed at.

       W / S    throttle up and down, through zero into reverse
       A / D    strafe
       Q / E    roll
       SHIFT    boost
       X        full stop
       F        shield
       1-6      choose a weapon
       V        cockpit or third person

     Three of these were somewhere else and every one of the three was somewhere
     no other space game puts it: the brake was on Z (Elite uses Z for flight
     assist off), the torpedo was on control-click, and the mini gun was on a
     held E, which is roll everywhere else. The arrow keys still pitch and yaw
     for anyone who wants them. */
  const MAPPED = [
    "w", "a", "s", "d", "q", "e", "x", "f", "v", " ",
    "1", "2", "3", "4", "5", "6", "shift",
    "arrowup", "arrowdown", "arrowleft", "arrowright",
  ];

  function applyKeys() {
    /* The arrows still fly, for anyone who would rather not use the mouse.
       ADDED to the mouse rather than overriding it, so reaching for one does
       not kill the other. */
    stick.x = (keys.arrowright ? 1 : 0) - (keys.arrowleft ? 1 : 0);
    stick.y = (keys.arrowup ? 1 : 0) - (keys.arrowdown ? 1 : 0);
    stick.roll = (keys.e ? 1 : 0) - (keys.q ? 1 : 0);
    stick.strafe = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
    stick.throttle = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
    stick.fullStop = !!keys.x;
    stick.boosting = !!keys.shift;
    stick.guard = !!keys.f;
    stick.mini = weapons.primary === 1;
  }
  function onKeyDown(e: KeyboardEvent) {
    if (!flying) return;
    const k = e.key.toLowerCase();
    if (MAPPED.includes(k)) e.preventDefault();
    keys[k] = true;
    if (k === " ") stick.firing = true;
    /* 1-3 choose the primary, 4-6 the secondary. DIRECT, not cycled: Elite's
       fire groups are the most criticised weapon interface in the genre and the
       standard player workaround is pulling things out of the cycle onto their
       own keys. Descent bound 1-5 in 1995 and nobody has complained since. */
    if (k >= "1" && k <= "3") selectWeapon("primary", Number(k) - 1);
    if (k >= "4" && k <= "6") selectWeapon("secondary", Number(k) - 4);
    if (k === "v" && flight) {
      flight.view = flight.view > 0.01 ? 0 : 2;
      if (flight.view > 0) ensureShip();
      setHud({ view: flight.view });
    }
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
    stick.firing = false; stick.boosting = false; stick.secondary = false;
    stick.guard = false; stick.fullStop = false;
    stick.x = 0; stick.y = 0; stick.roll = 0; stick.strafe = 0; stick.throttle = 0;
    stick.lookX = 0; stick.lookY = 0;
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
        scaleTowers = api.scaleTowers;
        ipList = [...api.tips.keys()];
        tipList = ipList.map((ip) => api.tips.get(ip)!.clone());
        homeIndex = api.selfIp ? ipList.indexOf(api.selfIp) : -1;

        savedNear = camera.near;
        savedFar = camera.far;
        camera.near = 0.05;
        /* Far enough to SEE the outer planets, which is a good deal further
           than the old four thousand: the fourteenth sits 3,600 units out and
           is 300 across, so anything short of this simply does not draw it. */
        camera.far = Math.max(camera.far, (R + MAX_ALT) * 2.6);
        camera.updateProjectionMatrix();

        /* Start decoding the samples now. Waiting for the first trigger pull
           meant the opening shots of a fight were silent. */
        primeGunSound();

        fx = createFx();
        scene.add(fx.group);

        /* The sky. Built here rather than on launch because the planets are
           always there, and because the first run has to fetch them: starting
           at attach means they are usually in place by the time anyone has
           finished reading the launch card. */
        space = createSpace();
        scene.add(space.group);

        /* And the stars behind all of it. The scene belongs to the Node Map,
           which is used outside the game, so whatever background it had is
           handed back on the way out — the same courtesy the camera's near and
           far planes get. */
        sky = installSky(scene);
        guardShell = makeGuardShell();
        scene.add(guardShell.mesh);
        /* One prototype per tier, cloned per fighter. Seven models built once
           costs nothing and means a rare ship is the right colour from the
           frame it appears. */
        protos = TIERS.map((t) => makeFighter(t.colour));
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

        dom.addEventListener("wheel", onWheel, { passive: false });
        dom.addEventListener("pointerleave", onLeave);
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

        /* What this player has already killed, so the tallies are lifetime and
           not per session. Offline it falls back to the local copy. */
        divi = totalDivi();
        setHud({ divi });

        void myTotals().then((row) => {
          lifetimeTiers = row.tierKills.slice(0, TIER_COUNT);
          setHud({ tierKills: lifetimeTiers.slice() });
        });

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
      if (!flight || !camera || !fx || !scene || protos.length === 0) return;
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
          /* The worlds turn while the launch card is up, so the sky is alive
             before anyone has pressed anything. */
          space?.step(dt);
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

          /* Where the cockpit ends up: level, looking along the heading. */
          s.up.copy(flight.up);
          s.target.copy(flight.pos).addScaledVector(flight.fwd, 10);
          s.m4.lookAt(flight.pos, s.target, s.up);
          endQuat.setFromRotationMatrix(s.m4);

          /* The tower being flown at. Its tip, not the pad above it, so the
             view is pinned to the thing the player is arriving at. */
          const tip = homeIndex >= 0 && homeIndex < tipList.length
            ? tipList[homeIndex]
            : dirB.copy(flight.pos).normalize().multiplyScalar(globeRadius);

          if (diveT < ARRIVE_AT) {
            /* ---- the run in ----
               STRAIGHT AT THE TOWER, and looking at it the whole way.

               It used to travel the great circle from wherever the map was
               looking round to the tower's own direction, slerping the camera
               toward the final level cockpit pose as it went. Both halves of
               that were wrong from the pilot's seat: curving round the planet
               meant the tower was never actually ahead, and blending toward a
               pose that is TANGENT to the surface meant the view swung away
               from the planet early in the run and arrived sideways. Geoff:
               "it turns away from the planet, ruining the approach view".

               A straight line and a fixed gaze fix both. */
            const u = diveT / ARRIVE_AT;
            /* Decelerating: quick out of orbit, slowing as the tower fills the
               frame, so the arrival is a settle rather than a stop. */
            const k = 1 - (1 - u) * (1 - u) * (1 - u);
            camera.position.lerpVectors(diveFromPos, flight.pos, k);

            /* Up is the planet's here, not the ship's: the horizon should sit
               level on the way down. Where the ship is nearly overhead the two
               are almost parallel, so the heading stands in as the hint. */
            dirA.copy(camera.position).normalize();
            s.m4.lookAt(camera.position, tip,
              Math.abs(dirA.dot(dirMix.copy(tip).sub(camera.position).normalize())) > 0.985
                ? flight.fwd : dirA);
            arriveQuat.setFromRotationMatrix(s.m4);
            /* Eased off the map's own framing over the first moment, so the
               cut from "looking at the globe" to "looking at the tower" is a
               turn rather than a jump. */
            camera.quaternion.slerpQuaternions(diveFromQuat, arriveQuat, Math.min(1, u * 3));
          } else {
            /* ---- the landing ----
               Arrived, and now the ninety degrees from looking down at the
               tower to looking along the surface. Nothing else moves, so it
               reads as the ship settling onto the pad and levelling off. */
            const u = (diveT - ARRIVE_AT) / (1 - ARRIVE_AT);
            const k = u * u * (3 - 2 * u);
            camera.position.copy(flight.pos);
            camera.quaternion.slerpQuaternions(arriveQuat, endQuat, k);
          }

          camera.updateMatrixWorld();
          fx.step(dt, camera);
          space?.step(dt);
          if (diveT >= 1) phase = "fly";
          return;
        }

        const live = !hud.dead;
        const blank: Stick = {
          x: 0, y: 0, lookX: 0, lookY: 0, aimX: 0, aimY: 0, roll: 0, strafe: 0,
          throttle: 0, fullStop: false, boosting: false, firing: false,
          secondary: false, guard: false, mini: false,
        };
        const res = stepFlight(flight, dt, live ? stick : blank, tipList, homeIndex);
        /* CONSUMED. The mouse delta is an angle that has already happened, so
           it must be spent exactly once: leaving it set would turn the ship
           again on every later frame, which is the spinning-forever bug in a
           new costume. */
        stick.lookX = 0;
        stick.lookY = 0;
        if (res.hit) fx.boom(flight.pos.clone(), 1.2, "cold");
        nearTower = res.nearTower;
        dockBlock = res.dockBlock;

        /* ---- the ship you can see, and the camera behind it ----
           The hull sits at the flight position and the CAMERA pulls back from
           it, rather than the ship being pushed away from a fixed camera: a
           ship that slid backwards out of its own cockpit would leave its guns
           and its collider behind it.

           Pulled back along the nose and lifted a little, so the hull sits low
           in the frame and the crosshair is not behind it. */
        if (shipModel && flight.view > 0.01) {
          shipModel.visible = true;
          shipModel.position.copy(flight.pos);
          /* ---- WHICH WAY IS FORWARD ----
             Not assumed. The first version took Synty hulls to face -Z, which is
             what three's lookAt points down, and the ship flew backwards:
             "it's pointing right at me instead of in the direction we're going."
             Worse, the guns went with it — the muzzles are placed at the nose,
             so a nose at the back put the fire behind the camera, which is the
             fire appearing at the bottom of the screen.

             The model's own geometry knows the answer. The collider was fitted
             along the hull and its narrow end is the nose, so the direction from
             the centre to that end IS forward, whichever axis the exporter
             happened to use. Two bases are built from it and one is rotated onto
             the other. */
          shipM4.makeBasis(modelRight, modelUp, modelFwd);
          worldRight.crossVectors(flight.up, flight.fwd).normalize();
          worldM4.makeBasis(worldRight, flight.up, flight.fwd);
          shipM4.transpose();
          shipQuat.setFromRotationMatrix(worldM4.multiply(shipM4));
          shipModel.quaternion.copy(shipQuat);

          /* And the hull becomes what bullets hit, instead of the ball around
             the camera. */
          placeCollider(shipHull, flight.pos, shipQuat, SHIP_LENGTH, hullWorld);
        } else if (shipModel) {
          shipModel.visible = false;
          hullWorld.length = 0;
        }

        /* THE SHIP'S OWN UP, not the planet's.
           Deriving it from the position was what pinned the horizon level: the
           camera stayed upright through a climb no matter where the nose was
           pointing, which is exactly the sensation of not being allowed to
           look up. Now a loop rolls the world over the top, because the ship
           really is upside down at that moment. */
        s.up.copy(flight.up);

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
        /* The jolt. Applied after the cockpit's own orientation, so it throws
           the whole view rather than steering the ship, and eased back to
           nothing over its fifth of a second. */
        if (shakeFor > 0) {
          shakeFor = Math.max(0, shakeFor - dt);
          const k = shakeFor / SHAKE_SECONDS;
          const halfFov = (camera.fov * Math.PI) / 360;
          const angle = Math.atan(Math.tan(halfFov) * SHAKE_FRACTION * 2) * k;
          s.qBank.setFromAxisAngle(shakeAxis, angle);
          camera.quaternion.multiply(s.qBank);
        }

        /* Behind and slightly above, or exactly at the ship in the cockpit. */
        camera.position.copy(flight.pos);
        if (flight.view > 0.01) {
          const back = flight.view * SHIP_LENGTH * 1.6 + SHIP_LENGTH * 0.9;
          camera.position
            .addScaledVector(flight.fwd, -back)
            .addScaledVector(flight.up, back * 0.28);
        }
        camera.updateMatrixWorld();

        /* The ears go where the cockpit is, facing the way it faces, so a shot
           behind you sounds behind you. */
        setListener(
          flight.pos.x, flight.pos.y, flight.pos.z,
          flight.fwd.x, flight.fwd.y, flight.fwd.z,
          s.up.x, s.up.y, s.up.z,
        );

        /* The guard rides with the cockpit, since it is around the player. */
        if (guardShell) {
          guardShell.mesh.position.copy(flight.pos);
          guardShell.step(performance.now() / 1000, Math.min(1, flight.guardFor / (GUARD_SECONDS * 0.6)));
        }

        /* ---- the sky, and what you are near ----
           The worlds turn on their own axes whether anyone is watching or not.
           Coming within three of a body's own diameters names it in the corner;
           leaving clears it. Compared by name so the HUD is only pushed when the
           answer actually changes, rather than on every frame you spend near
           the same planet. */
        if (space) {
          space.step(dt);
          const found: SpaceBody | null = space.near(flight.pos, 3);
          const name = found?.name ?? "";
          if (name !== nearBody) {
            nearBody = name;
            setHud({ nearby: found ? { name: found.name, detail: found.detail } : null });
          }
        }

        /* ---- guns ----
           Fired from the edges of the frame at eye level, converging on the
           crosshair, which is why the muzzles come from the camera's frustum
           rather than from a fixed offset. */
        /* The mini gun: one round from the top right, along the line the
           POINTER is on rather than the ship's own axis. The ray is taken
           straight from the camera through the crosshair, so what is under the
           crosshair is what it hits. */
        if (res.miniFired) {
          const ndc = new THREE.Vector3(cursor.x * 2 - 1, -(cursor.y * 2 - 1), 0.5);
          ndc.unproject(camera);
          const aimDir = ndc.sub(camera.position).normalize();
          const muzzle = new THREE.Vector3();
          miniMuzzle(flight.pos, flight.fwd, s.up, camera.fov, camera.aspect, muzzle);
          fireMini(combat, muzzle, camera.position, aimDir);
          fx.muzzle(muzzle);
          playMiniSound();
        }

        if (res.fired) {
          /* ---- where the guns are ----
             In the cockpit they come from the EDGES of the frame at eye level,
             which is the arcade convention and the only sensible answer when
             there is no ship on screen to hang them off.

             In third person there IS one, and fire that appears beside the
             camera rather than at the hull reads as broken. So the muzzles move
             to the ship's nose: the two barrels straddle it by a fifth of the
             hull's length, still converging on the crosshair, so the rounds
             leave the ship and meet where you are aiming. */
          let at: [THREE.Vector3, THREE.Vector3] | undefined;
          if (shipModel && flight.view > 0.01) {
            const nose = shipNose(flight);
            const side = new THREE.Vector3().crossVectors(flight.fwd, flight.up)
              .normalize().multiplyScalar(SHIP_LENGTH * 0.2);
            at = [nose.clone().add(side), nose.clone().sub(side)];
          }
          const muzzles = fireGuns(
            combat, flight.pos, flight.fwd, s.up, camera.fov, camera.aspect, "", at);
          fx.muzzle(muzzles[0]);
          fx.muzzle(muzzles[1]);
          playGunSound();
        }

        /* ---- fighters and their fire ---- */
        stepCombat(combat, dt, {
          tips: tipList,
          playerPos: flight.pos,
          playerFwd: flight.fwd,
          /* In third person the HULL is the target, fitted from the model's own
             geometry. In the cockpit there is nothing on screen to judge a near
             miss against, so the single radius round the camera is both fairer
             and cheaper. */
          players: hullWorld.length > 0
            ? [{ id: "", pos: flight.pos, fwd: flight.fwd, hull: hullWorld }]
            : undefined,
          damageScale: damageScale(),
        });

        /* One button does both jobs. If a torpedo is already in the air the
           press sets it off; otherwise it launches the next one. That is what
           "control-click again to detonate" means with a single control. */
        if (res.heavyPress) {
          const slot = weaponAt("secondary", weapons.secondary);
          if (slot && !slot.ready) {
            setHud({ note: `${slot.name}: not yet fitted`, noteAt: performance.now() });
          } else {
            const w = {
              tips: tipList, playerPos: flight.pos, playerFwd: flight.fwd,
              wanted: 0, damageScale: damageScale(),
            };
            if (!detonateOldest(combat, w) && flight.torpedoes > 0) {
              flight.torpedoes -= 1;
              /* Out of the tube at the nose, not out of the camera. */
              fireTorpedo(combat, shipNose(flight), flight.fwd);
              playTorpedoSound();
            }
          }
        }

        for (const ev of combat.events) {
          if (ev.kind === "incoming") {
            playIncomingWarning();
          } else if (ev.kind === "playerHit") {
            if (flight.grace <= 0) {
              /* Tell the cockpit to flash, and knock the view off centre in
                 some direction that is not the same one every time. */
              setHud({ hitAt: performance.now() });
              shakeFor = SHAKE_SECONDS;
              shakeAxis.set(Math.random() * 2 - 1, Math.random() * 2 - 1, 0).normalize();
              /* The guard soaks four fifths of it, which is what makes ten of
                 them worth spending carefully. */
              const guarded = flight.guardFor > 0;
              const soak = guarded ? 1 - GUARD_ABSORB : 1;
              /* And it is worth HEARING that the button worked. */
              if (guarded) playBounce();
              flight.shields -= (ev.damage ?? 25) * soak;
              flight.grace = 0.45;
              /* Being shot at postpones the slow repair, same as flying into
                 something does. */
              flight.sinceHit = 0;
              /* The big centred bar, for a second, coloured by how bad it is.
                 Raised HERE rather than from the HUD's own polling, because a
                 hit is an event and the bar is the game telling you about it. */
              pulseHealth(flight.shields, MAX_SHIELD);
              if (flight.shields <= 0) die();
            }
            fx.boom(ev.at, 1.4, "cold");
          } else if (ev.kind === "enemyDown") {
            fx.boom(ev.at, 3, "hot");
            playShipExplosion();
            if (ev.tier) {
              lifetimeTiers[ev.tier - 1] = (lifetimeTiers[ev.tier - 1] ?? 0) + 1;
              setHud({ tierKills: lifetimeTiers.slice() });
            }
          } else if (ev.kind === "enemyHit") {
            /* Points are exactly the damage that landed, so a shot into a
               fighter with ten left scores ten and not eighty. */
            score += Math.round(ev.damage ?? 0);
            /* A small spark where the shot landed. The bubble does the rest. */
            fx.boom(ev.at, ev.power, "cold");
          } else if (ev.kind === "waveStart") {
            /* Shown big for three seconds, then two seconds of fading. */
            setHud({ wave: ev.wave ?? 0, waveAt: performance.now() });
          } else if (ev.kind === "coin") {
            /* Picked up. Kept for ever, not for this life: earnings survive
               being shot down. */
            divi += ev.value ?? 0;
            addDivi(ev.value ?? 0);
            setHud({ divi });
          } else if (ev.kind === "enemyShot") {
            playShotAt(ev.at.x, ev.at.y, ev.at.z, 0.7);
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
        if (flight.shields <= 0) die();

        /* Keep one model per live fighter, cloning and hiding rather than
           building and destroying. */
        /* A model per fighter, and it has to match that fighter's tier, so a
           slot whose occupant changed tier is rebuilt rather than recoloured. */
        for (let i = 0; i < combat.enemies.length; i++) {
          const want = combat.enemies[i].cls.tier;
          const have = enemyMeshes[i];
          if (have && have.userData.tier === want) continue;
          if (have) scene.remove(have);
          const m = protos[want - 1].clone(true);
          m.userData.tier = want;
          m.scale.setScalar(ENEMY_SCALE);
          scene.add(m);
          enemyMeshes[i] = m;
        }
        while (enemyShields.length < enemyMeshes.length) {
          const rig = makeShieldRig(0x66ccff);
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
          rig.setColour(e.cls.colour);
          rig.setLevel(e.shield, e.cls.shieldMax);
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
        fx.drawTracers(combat.tracers, TRACER_LIFE);
        fx.drawCoins(combat.coins);
        /* The tether, drawn only while a resupply is running. */
        fx.drawDockLink(
          flight.dock > 0 ? flight.pos : null,
          flight.dock > 0 && flight.dockedAt >= 0 ? tipList[flight.dockedAt] ?? null : null,
          performance.now() / 1000,
        );
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
            throttle: flight.throttle,
            guards: flight.guards,
            guarding: flight.guardFor > 0,
            contacts: combat.enemies.length,
            kills: combat.kills,
            score,
            junk: combat.junk.length,
            bonus: damageScale() > 1,
            docked: flight.dock >= 1,
            nearTower,
            dockBlock,
            respawnIn: Math.max(0, (respawnAt - performance.now()) / 1000),
          });
        }
      } catch (err) {
        setHud({ broken: err instanceof Error ? err.message : "the game stopped", ready: false });
        flight = null;
      }
    },

    detach() {
      /* Backing out mid-flight files what was earned. Losing a good run to a
         stray Escape would be worse than the alternative. */
      if (flying && !hud.dead) bank();
      stopRechargeSound();
      wasDocking = false;
      if (dom) {
        dom.removeEventListener("wheel", onWheel);
        dom.removeEventListener("pointerleave", onLeave);
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
        /* The map is not ours: its towers go back to full size on the way out. */
        if (scaleTowers) { scaleTowers(1); scaleTowers = null; }
        if (shipModel && scene) scene.remove(shipModel);
        shipModel = null;
        shipPaint = null;
        shipHull = [];
        sky?.restore();
        sky = null;
        if (space) { scene.remove(space.group); space.dispose(); space = null; }
        if (fx) scene.remove(fx.group);
      }
      for (const r of enemyShields) r.dispose();
      enemyShields.length = 0;
      enemyMeshes.length = 0;
      fx?.dispose();
      /* The prototype's geometry is shared by every clone, so it is disposed
         once, here, and not per fighter. */
      for (const proto of protos) proto.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
      fx = null; protos = [];
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
      /* ---- THE WORLD GETS BIGGER ----
         Every tower drops to half its size the moment a game starts, and the
         ship and the fighters are half as quick to match. The globe does not
         change at all: the same Earth simply reads as twice the size, which is
         far cheaper and far more stable than scaling the world, since every
         distance in the flight model and the map's own camera stay exactly
         where they were.

         The tips come BACK from the map rather than being guessed at. Docking
         measures to the tower's axis, and an axis half as tall is a different
         axis: shrinking the towers without taking the new tips would leave the
         game docking with masts that are no longer there. */
      if (scaleTowers) {
        const tips = scaleTowers(WORLD_SCALE);
        tipList = ipList.map((ip) => tips.get(ip)?.clone() ?? new THREE.Vector3());
      }
      if (!combat.wave) startWave(combat, 1);
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
      /* Launching starts with nothing on the stick: no leftover mouse delta
         from lining up the LAUNCH button. */
      stick.lookX = 0; stick.lookY = 0;
      /* Confine the pointer to the game. Without this a stray click lands on
         the sidebar and the panel unmounts mid-flight. If the webview refuses,
         the game still plays, it just is not fenced in. */
      try { dom?.requestPointerLock?.(); } catch { /* not supported here */ }
      setHud({ launched: true, dead: false });
    },
    respawn() {
      if (respawnAt > performance.now()) return;
      score = 0;
      if (!combat.wave) startWave(combat, 1);
      startAt(homeIndex);
      flying = true;
      phase = "fly";
      try { dom?.requestPointerLock?.(); } catch { /* not supported here */ }
      setHud({ launched: true });
    },
    dispose() { listeners.clear(); },
  };
}
