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
  fireMini, miniMuzzle,
  STAKE_BONUS, STAKE_BONUS_MS, TIERS, TRACER_LIFE, startWave,
  type CombatState,
} from "./rebelsCombat";
import { userWonRecently } from "../stakeWin";
import { recordScore, myTotals, addDivi, totalDivi, TIER_COUNT } from "./rebelsScores";
import { R, MAX_ALT } from "./orbitWorld";
import { createSpace, type SpaceBody } from "./spaceEnvironment";
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
  dock: 0, dockName: "", homeName: "", homeDist: 0, towers: 0, nearby: null, contacts: 0, kills: 0, score: 0, nearTower: Infinity, dockBlock: "",
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
  let space: ReturnType<typeof createSpace> | null = null;
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

  const stick: Stick = { x: 0, y: 0, boosting: false, braking: false, firing: false, heavy: false, guard: false, mini: false };
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
  /* ---- the crosshair is a SELF-CENTRING STICK ----

     It was not, and that made the game unflyable. The crosshair accumulates
     mouse movement and clamps at the edges of the frame, and its distance from
     the middle is a RATE of turn. Move the mouse down and stop, and the
     crosshair stays below the middle, and the ship keeps pitching down. For
     ever. Push it to the bottom edge and the ship simply loops, over and over,
     which is exactly what Geoff saw: "something is fighting my controls and
     making the screen jerk up and down."

     This was survivable before the flight model was freed, because up and down
     used to be a throttle on an altitude between 0.8 and 30 units: a pinned
     crosshair meant "sit on the floor" and nothing worse. Turning pitch into a
     real direction turned the same input into a permanent command, and there
     was no way to cancel it except to find the exact middle of a frame you
     cannot see.

     Two things fix it, and they are what every mouse-flown game does. A
     DEADZONE, so the middle of the screen means straight ahead rather than
     nearly straight ahead. And a RETURN, so letting go of the mouse returns
     the stick to neutral and the ship stops turning. Moving the mouse outruns
     the return easily, so it costs nothing in responsiveness. */
  const DEADZONE = 0.07;
  /** Seconds for the stick to fall back most of the way to the middle. */
  const STICK_RETURN = 0.45;
  /** How far from the middle the crosshair may get. Short of the frame edge,
   *  so full deflection is reachable without the crosshair sticking to the rim
   *  where nothing the mouse does can move it further. */
  const STICK_REACH = 0.42;

  function shape(v: number): number {
    const a = Math.abs(v);
    if (a <= DEADZONE) return 0;
    return Math.sign(v) * Math.min(1, (a - DEADZONE) / (STICK_REACH - DEADZONE));
  }
  function applyCursor() {
    stick.x = shape(cursor.x * 2 - 1);
    stick.y = -shape(cursor.y * 2 - 1);
  }
  /**
   * Ease the crosshair back to the middle, then settle the stick. Once a frame.
   *
   * The ORDER matters and is the whole reason this is one function. Recentring
   * has to reapply the cursor every frame, and the cursor and the keys write to
   * the same stick, so doing only the cursor would quietly wipe out a held
   * arrow key on the very next frame and leave the keyboard dead. Keys go last
   * and win while they are held, which is what a player expects when they reach
   * for one mid-turn.
   */
  function centreStick(dt: number) {
    const k = Math.min(1, dt / STICK_RETURN);
    cursor.x += (0.5 - cursor.x) * k;
    cursor.y += (0.5 - cursor.y) * k;
    applyCursor();
    applyKeys();
  }
  function onMove(e: PointerEvent) {
    if (!dom) return;
    if (locked) {
      /* Under pointer lock there is no cursor position, only movement, so the
         crosshair is ours to keep and to clamp. That clamping is the whole
         reason for the lock: the pointer can no longer wander out of the game
         and click something that closes it. */
      const r = dom.getBoundingClientRect();
      const lo = 0.5 - STICK_REACH, hi = 0.5 + STICK_REACH;
      cursor.x = Math.max(lo, Math.min(hi, cursor.x + e.movementX / r.width));
      cursor.y = Math.max(lo, Math.min(hi, cursor.y + e.movementY / r.height));
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
    stick.mini = !!keys.e;
  }
  function onKeyDown(e: KeyboardEvent) {
    if (!flying) return;
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "w", "a", "s", "d", "z", "t", "e", "shift", "control"].includes(k)) {
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
    stick.heavy = false; stick.guard = false; stick.mini = false;
    stick.x = 0; stick.y = 0;
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

        /* The stick falls back to neutral whenever the mouse is not pushing it,
           so stopping the mouse stops the turn. */
        if (!hud.dead) centreStick(dt);

        const live = !hud.dead;
        const blank: Stick = { x: 0, y: 0, boosting: false, braking: false, firing: false, heavy: false, guard: false, mini: false };
        const res = stepFlight(flight, dt, live ? stick : blank, tipList, homeIndex);
        if (res.hit) fx.boom(flight.pos.clone(), 1.2, "cold");
        nearTower = res.nearTower;
        dockBlock = res.dockBlock;

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

        camera.position.copy(flight.pos);
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
      cursor.x = 0.5; cursor.y = 0.5;
      applyCursor();
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
