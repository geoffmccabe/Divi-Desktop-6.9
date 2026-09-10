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
  createCombat, stepCombat, clearEvents, fireGuns, fireTorpedo, detonateOldest, gunMuzzles, fireBeam,
  fireMini, miniMuzzle, spawnFleet,
  STAKE_BONUS, STAKE_BONUS_MS, TIERS, TRACER_LIFE, startWave,
  type CombatState,
  type Enemy, type ShipClass,
} from "./rebelsCombat";
import { userWonRecently } from "../stakeWin";
import { recordScore, myTotals, addDivi, totalDivi, TIER_COUNT, playerName } from "./rebelsScores";
import { R, MAX_ALT } from "./orbitWorld";
import { createSpace, type SpaceBody } from "./spaceEnvironment";
import { installSky, skyTexture, type SkyHandle } from "./starfield";
import { loadModel, unitCopy } from "./spaceAssets";
import { loadShip } from "./shipChoice";
import { loadPaint, makeRepaintable, type PaintHandle } from "./shipColours";
import {
  fitCollider, fitMounts, type Mounts, placeCollider, noseOf, HULL_FORWARD, HULL_UP, type HitSphere,
} from "./shipCollider";
import {
  loadLoadout, saveLoadout, weaponAt, type Loadout, type SlotKind,
} from "./shipLoadout";
import { pulseHealth } from "./healthPulse";
import { createLean, stepLean, LEAN_SLIDE } from "./shipLean";
import { joinRoom, type Room, type RoomStatus } from "./rebelsRoom";
import { setBankStatus, setBankPurse, setBankActor } from "./rebelsBank";
import { droneClass } from "./rebelsFlock";
import { loadLoadoutRemote, watchLoadout } from "./rebelsLoadout";
import {
  watchAudio, audioHealth, settleAudioFromGesture, watchOutputDevices, requestAudioRebuild, noteLevel,
} from "../../sound";
import { createPeers, type Peers } from "./rebelsPeers";
import { PART_ORDER } from "./shipColours";
import { weaponInSlot, BEAM_SECONDS } from "./weaponCatalog";
import {
  hasWeapon, owned, earnPoints, spendable, extraTorpedoes, extraMagazine,
} from "./rebelsArmoury";
import {
  createFx, makeFighter, makeShieldRig, makeGuardShell,
  type Fx, type ShieldRig,
} from "./rebelsFx";
import {
  playGunSound, primeGunSound, startRechargeSound, stopRechargeSound,
  playTorpedoSound, playTorpedoBlast, playShipExplosion, resumeAudio,
  playMiniSound, playShotAt, setListener, playIncomingWarning, playBounce, audioState,
  startBoostSound, stopBoostSound,
} from "./rebelsAudio";
import {
  primeMusic, playOpening, playGameplay, musicOnDeath, stopMusic, tickMusic,
  pumpMusic, musicState,
} from "./rebelsMusic";

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
  /** Whether this ship is in a shared world, and how many others are in it. */
  room: string;
  crew: number;
  /* ---- the frame readout ----
     Frames per second as the screen actually gets them, and how much of each
     frame the game's own work (fly, fight, sound, and the drawing it asks
     for) costs in milliseconds. Both smoothed, so the numbers can be read.
     The gap between the two is the map's rendering, which is the thing the
     FPS plan goes after next. */
  fps: number;
  simMs: number;
  /** Draw calls the renderer made last frame, and its pixel ratio. */
  drawCalls: number;
  pixelRatio: number;
  /** Points left to spend on guns. One is earned for each DIVI brought home. */
  points: number;
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
  room: "off", crew: 0, points: 0, fps: 0, simMs: 0, drawCalls: 0, pixelRatio: 0,
  primary: 0, secondary: 0, note: "", noteAt: 0, nearby: null, contacts: 0, kills: 0, score: 0, nearTower: Infinity, dockBlock: "",
  wave: 0, waveAt: 0, respawnIn: 0,
  divi: 0, tierKills: new Array(7).fill(0), junk: 0, bonus: false, docked: false, dead: false, launched: false, broken: null,
};

/** Fighters are drawn about a unit across, against three-unit towers. */
const ENEMY_SCALE = 0.85;

/** How long a detached game waits for the map to hand it a new scene before
 *  concluding the panel has closed. The rebuild re-attaches in the same tick;
 *  this is only slack for a slow machine. */
export const SUSPEND_GRACE_MS = 400;

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
  /* ---- the room ----
     Null when flying alone, which is still a perfectly good way to play. While
     it is live the ROOM owns the fight: the fighters, every round in the air,
     the coins and all the gauges come off the wire and the local simulation is
     not stepped at all. That is what makes two people see the same fight
     rather than two private ones. */
  let room: Room | null = null;
  let peers: Peers | null = null;
  let roomStatus: RoomStatus = "off";

  /* See the black box in frame(). */
  /* Seconds until the beam may fire again, which is also how long it stays
     lit. See weaponCatalog. */
  let beamAt = 0;
  let wasThrusting = false;
  /* Scratch lists for the instanced draws, so a frame allocates none. */
  const droneList: typeof combat.enemies = [];
  const orbList: typeof combat.bullets = [];
  let selfIp = "";
  let frameError = "";
  let frameErrors = 0;
  let diagAt = 0;
  /* Smoothed frame figures, and a clock for pushing them to the HUD: four
     times a second, since a number that changes sixty times a second cannot
     be read and re-rendering the HUD every frame would itself cost frames. */
  let fpsAvg = 0;
  let simAvg = 0;
  let readoutAt = 0;
  let stats: (() => { calls: number; triangles: number; ratio: number }) | null = null;
  let lastWatch: "none" | "kick" | "rebuild" = "none";
  /* ---- THE MAP REBUILDS ITSELF UNDER THE GAME ----
     The globe tears its whole scene down and builds it again whenever its
     node list changes (a node arriving or leaving, which the map polls for
     every ten seconds) or a map setting changes. Each time it does, it hands
     the game back its scene (detach) and then a new one (attach). This used
     to be treated as the game ENDING and STARTING: the run was banked, the
     room left, the fight thrown away, the opening music put back on; and
     from the cockpit it looked like the enemies had simply stopped coming.
     Geoff played a whole session to make a video and met nobody.

     So a detach mid-flight is a suspension, not an end: the fight, the
     flight, the room and the music are kept, only the scene objects are
     released, and the next attach puts them back into the new scene. */
  let suspended = false;
  let attachCount = 0;
  /* The map re-attaches within the same tick when it rebuilds, so a detach
     that is NOT followed by an attach almost at once was the panel closing,
     and then the run is over for real: banked, the room left, the music
     stopped. Nothing else can tell the two apart at detach time. */
  let endAt: ReturnType<typeof setTimeout> | null = null;
  let stopLoadoutWatch: (() => void) | null = null;

  /** The run has ended for real (the panel closed mid-flight). */
  function endSuspended(): void {
    endAt = null;
    if (!suspended) return;
    suspended = false;
    stopMusic();
    leaveRoom();
    if (flying && !hud.dead) bank();
    combat = createCombat();
    flight = null;
  }
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
  /* The lean: how the hull reacts to being flown. See shipLean. */
  const lean = createLean();
  const leanNose = new THREE.Vector3();
  const leanRef = new THREE.Vector3();
  /* The screen's own axes, taken off the camera each time a gun fires. */
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const camFwd = new THREE.Vector3();
  let shipPaint: PaintHandle | null = null;
  let shipHull: HitSphere[] = [];
  /* Where its guns are, read off the model. See fitMounts. */
  let shipMounts: Mounts | null = null;
  let shipLoading = false;
  /** How long the hull is in world units, which sets both how far the camera
   *  pulls back and how big a target the ship is. */
  const SHIP_LENGTH = 2.6;
  /* The smallest and largest notch of the third-person zoom, in units of view.
     See zoomStep. */
  const ZOOM_BASE = 0.04;
  const ZOOM_GROWTH = 0.10;
  /* ---- HOW CLOSE THE CAMERA CAN GET ----
     In ship lengths behind the hull's centre. The hull is one ship length from
     nose to tail, so its tail is at half of one: 0.62 puts the camera a tenth
     of a length behind the tail, which is close enough that the cockpit and one
     wingtip fill the frame. Geoff asked for exactly that and for it not to be
     the only option, so the far end reaches nine and a half lengths, where the
     ship is a shape against the planet. */
  const VIEW_NEAR = 0.62;
  const VIEW_FAR = 1.48;


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
    /* The flying theme goes over five seconds and the menu theme comes back
       after it. See rebelsMusic for why after rather than across. */
    musicOnDeath();
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
    x: 0, y: 0, aimX: 0, aimY: 0, roll: 0, strafe: 0,
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
    /* ---- OWNED, NOT "READY" ----
       Whether a gun can be selected is now a question about this player's
       purchases rather than about whether the game has been written yet. A gun
       nobody has bought says where to get it, because a key that appears to do
       nothing is indistinguishable from a bug. */
    if (kind === "primary") {
      const spec = weaponInSlot(index + 1);
      if (spec && !hasWeapon(loadShip(), spec.key)) {
        setHud({
          note: `${spec.name}: buy it in SPACESHIPS`,
          noteAt: performance.now(),
        });
        return;
      }
    } else if (!w.ready) {
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
   * ONE RETICLE, and the mouse moves it.
   *
   * The ship turns toward it, and the mini gun fires exactly AT it. That is
   * what gives navigation and aiming at the same time rather than one or the
   * other: fly by pushing the reticle where you want to go, and shoot whatever
   * the reticle is on. It is how War Thunder, Rebel Galaxy and Freelancer fly,
   * and it is what Geoff had and liked — "a freely-moving cursor like before to
   * shoot FPS-game style at enemies with the super-fast bullets. That was fun."
   *
   * THIS REPLACES RELATIVE LOOK, which I put in a few versions ago on the
   * research's advice, and the reversal is deliberate rather than a wobble.
   * Relative look turns the ship directly and leaves no reticle to aim with, so
   * it cannot give free aim at all. The reason the research warns against a
   * reticle that does not spring back is that games ship it INVISIBLE, under a
   * pointer lock, where you cannot see it is off centre — and every one of them
   * then needs a "recentre mouse" key. Ours is drawn on screen, clamped inside
   * the frame, and stops turning the moment the pointer leaves. Those three
   * things are the difference between this and the version that was disliked.
   *
   * Locked or not, the reticle works the same way. Under a lock there is no
   * pointer position to read, so movement is accumulated instead; without one
   * the pointer's own position is used. Two paths, one behaviour — which is
   * also what stops the two schemes fighting each other, as they did when one
   * was relative and the other absolute.
   */
  /** Where the reticle stops meaning "straight ahead", and where it reaches
   *  full deflection. Short of the frame edge, so nobody has to put it on the
   *  last pixel to turn hard. */
  const AIM_DEAD = 0.06;
  const AIM_FULL = 0.42;
  /** How far from the middle it may get. */
  const AIM_REACH = 0.45;

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
    const r = dom.getBoundingClientRect();
    if (locked) {
      const lo = 0.5 - AIM_REACH, hi = 0.5 + AIM_REACH;
      cursor.x = Math.max(lo, Math.min(hi, cursor.x + (e.movementX || 0) / r.width));
      cursor.y = Math.max(lo, Math.min(hi, cursor.y + (e.movementY || 0) / r.height));
    } else {
      /* Guarded: an event without coordinates would put NaN in the cursor, the
         stick and then the ship's heading, and nothing recovers from that. */
      if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
      cursor.x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      cursor.y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    }
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
    wakeAudio();
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
  /* ---- HOW FAR ONE NOTCH MOVES ----
     Proportionally, not by a fixed amount.

     It used to be a flat half a unit of view, which at this scale is nearly a
     whole ship length per notch: twelve notches to cross the entire range and
     no way to stop anywhere in particular. Geoff: "the zoom in/out isn't
     granular enough so I can't get the ship the right size."

     A fixed step is the wrong shape for a distance. Half a ship length matters
     enormously when the hull fills the frame and not at all when it is a speck,
     so the step grows with the distance. That puts about ten notches inside the
     first ship length, where the difference between "cockpit and wingtip" and
     "whole ship" is decided, and still crosses the whole range in about twenty:
     fine where it needs to be fine, quick where it does not. */
  function zoomStep(view: number, dir: number): number {
    const step = ZOOM_BASE + view * ZOOM_GROWTH;
    return Math.max(0, Math.min(MAX_VIEW, view + dir * step));
  }

  /* ---- KEEPING THE SOUND ALIVE ----
     A webview suspends its audio context whenever it feels like it: the window
     losing focus, the machine sleeping, the app being switched away from. Once
     suspended it can only be woken from a real user gesture, and resume() from
     anywhere else is quietly ignored.
     
     That used to be done in exactly one place, the click on LAUNCH. So a
     context that suspended at any point AFTER launching stayed suspended for
     the rest of the session: the game carried on flying and shooting and
     exploding in complete silence, with nothing else wrong and nothing to say
     why. Geoff: "the sound is gone in the game."
     
     Every key and every click is a real gesture, so every one of them is now a
     chance to wake it back up. Throttled to once a second because it runs on
     input and there is nothing to gain from asking sixty times. */
  let wokeAt = 0;
  function wakeAudio() {
    /* Whatever the bus watchdog decided while no hand was on the controls
       happens here, inside a real gesture, where WebKit will allow it. */
    settleAudioFromGesture();
    const now = performance.now();
    if (now - wokeAt < 1000) return;
    wokeAt = now;
    resumeAudio();
    /* The same gesture that wakes the sound is the one that lets the music
       start, so it is asked here rather than being left to wonder. */
    pumpMusic();
  }

  function onWheel(e: WheelEvent) {
    if (!flying || !flight) return;
    if (!e.altKey) return;
    e.preventDefault();
    flight.view = zoomStep(flight.view, -Math.sign(e.deltaY));
    if (flight.view > 0) ensureShip();
    setHud({ view: flight.view });
  }

  /** The tip of the hull in the world: where the guns and the tube are. */
  const noseLocal = new THREE.Vector3();
  function shipNose(f: { pos: THREE.Vector3; fwd: THREE.Vector3 }): THREE.Vector3 {
    if (shipMounts) return mountWorld(f, shipMounts.nose);
    if (shipHull.length === 0) return f.pos.clone().addScaledVector(f.fwd, SHIP_LENGTH * 0.5);
    noseLocal.copy(noseOf(shipHull)).multiplyScalar(SHIP_LENGTH).applyQuaternion(shipQuat);
    return f.pos.clone().add(noseLocal);
  }

  /** A mount, in the world: the model's unit-box point scaled to the ship's
   *  length and turned the way the ship is facing. */
  function mountWorld(f: { pos: THREE.Vector3 }, local: THREE.Vector3): THREE.Vector3 {
    return noseLocal.copy(local).multiplyScalar(SHIP_LENGTH).applyQuaternion(shipQuat).add(f.pos).clone();
  }

  /** The two barrels, in the world. Off the wings when the hull has them. */
  function shipBarrels(f: { pos: THREE.Vector3; fwd: THREE.Vector3; up: THREE.Vector3 }): [THREE.Vector3, THREE.Vector3] {
    if (shipMounts) return [mountWorld(f, shipMounts.gunL), mountWorld(f, shipMounts.gunR)];
    const nose = shipNose(f);
    const side = new THREE.Vector3().crossVectors(f.fwd, f.up).normalize().multiplyScalar(SHIP_LENGTH * 0.2);
    return [nose.clone().add(side), nose.clone().sub(side)];
  }

  /** Under the hull, for a torpedo. */
  function shipBelly(f: { pos: THREE.Vector3; fwd: THREE.Vector3 }): THREE.Vector3 {
    return shipMounts ? mountWorld(f, shipMounts.belly) : shipNose(f);
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
        shipPaint = makeRepaintable(model);
        shipPaint.apply(loadPaint());
        /* Fitted BEFORE the model is scaled into the world, so the spheres are
           in the hull's own space and can be turned with it.

           And it really does have to be before. The scaling used to happen on
           the line above this one, which put the whole chain into world-sized
           space; placeCollider then scaled it AGAIN, so every ship was flying
           around inside a hit shape two and a half times too big and taking
           rounds that visibly missed it. */
        shipHull = fitCollider(model);
        shipMounts = fitMounts(model);
        model.scale.setScalar(SHIP_LENGTH);

        /* Which way the hull faces is a property of the PACK, not of the
           model, and is stated once in shipCollider. It used to be worked out
           per hull from the collider and came out ninety degrees wrong on
           twelve of the thirty-two. */
        modelFwd.copy(HULL_FORWARD);
        modelUp.copy(HULL_UP);
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
  /* ---- the cheat key ----
     Geoff's format: "!1#", where ! opens it, 1 says what to send, and # is the
     tier. So "!11" sends a fleet of twenty-four grey spheres and "!15" sends
     purple ones.

     Typed as a SEQUENCE rather than bound to a chord, because the digits are
     already the weapon keys and a chord would have to fight them. While a
     sequence is open the digits are swallowed, so tapping out a cheat never
     also swaps the guns out from under the player. It closes itself after four
     seconds so a stray exclamation mark cannot leave the weapon keys dead.

     Nothing it summons is worth anything: see the anti-cheat guard in
     rebelsCombat, which refuses a conjured drone its kill, its tier count and
     its DIVI. A key that makes enemies out of nothing must not also make
     money out of nothing. */
  let cheat = "";
  let cheatUntil = 0;
  function runCheat(code: string) {
    const kind = code[1];
    const tier = Number(code[2]);
    if (kind !== "1" || !(tier >= 1 && tier <= 6)) return;
    if (!flight) return;
    spawnFleet(combat, tier, flight.pos, flight.fwd, { cheat: true });
  }
  function onKeyDown(e: KeyboardEvent) {
    if (!flying) return;
    wakeAudio();
    const k = e.key.toLowerCase();

    const now = performance.now();
    if (cheat && now > cheatUntil) cheat = "";
    if (k === "!") {
      cheat = "!";
      cheatUntil = now + 4000;
      e.preventDefault();
      return;
    }
    if (cheat) {
      if (k >= "0" && k <= "9") {
        cheat += k;
        e.preventDefault();
        if (cheat.length >= 3) { runCheat(cheat); cheat = ""; }
        return;
      }
      /* Anything else abandons it and is handled normally. */
      cheat = "";
    }

    if (MAPPED.includes(k)) e.preventDefault();
    keys[k] = true;
    if (k === " ") stick.firing = true;
    /* 1-3 choose the primary, 4-6 the secondary. DIRECT, not cycled: Elite's
       fire groups are the most criticised weapon interface in the genre and the
       standard player workaround is pulling things out of the cycle onto their
       own keys. Descent bound 1-5 in 1995 and nobody has complained since. */
    /* ---- ONE LINE OF SIX ----
       The keys used to be 1-3 for the primary and 4-6 for the secondary. The
       six guns are now a single upgrade path, so all six numbers pick along it
       and the secondary stays where the genre puts it: the right button. */
    if (k >= "1" && k <= "6") selectWeapon("primary", Number(k) - 1);
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
    stick.aimX = 0; stick.aimY = 0;
  }

  /**
   * Join the shared world.
   *
   * Everyone lands in the same room, because the ask was for people to be able
   * to play together and not for them to be sorted first. Failing to connect is
   * not an error and does not stop anything: the game carries on exactly as it
   * did, flying its own fight, and the room client keeps trying quietly in the
   * background. A game that refused to start because a server was down would be
   * a worse game than one that was briefly alone.
   */
  function connectRoom(): void {
    if (room) return;
    const home = homeIndex >= 0 && tipList[homeIndex]
      ? tipList[homeIndex].clone()
      : new THREE.Vector3(0, 0, R);
    const paint = loadPaint();
    room = joinRoom({
      node: selfIp || playerName(),
      name: playerName(),
      home,
      ship: loadShip(),
      /* What this ship carries, so the room arms it the same way the solo
         game does: the minigun, the beams, the extra tubes and magazine. */
      gear: owned(loadShip()).filter((k) => k !== "pulse"),
      /* Flattened in the order the shader keeps the parts, which is the order
         the other end puts them back in. */
      paint: PART_ORDER.map((k) => [
        paint[k].hue, paint[k].sat, paint[k].bright,
        ["none", "lines", "hex", "camo"].indexOf(paint[k].overlay ?? "none"),
      ]),
      onStatus: (s) => { roomStatus = s; setHud({ room: s }); setBankStatus(s); },
      onPurse: (p) => setBankPurse(p),
    });
    /* The points panel cashes out through this and through nothing else. */
    const r = room;
    setBankActor({ claim: (to) => r.claim(to), refresh: () => r.askPurse() });
    if (!peers && scene) {
      peers = createPeers();
      scene.add(peers.group);
    }
  }

  function leaveRoom(): void {
    room?.close();
    room = null;
    roomStatus = "off";
    setBankActor(null);
    setBankStatus("off");
    if (peers && scene) scene.remove(peers.group);
    peers?.dispose();
    peers = null;
  }

  function startAt(index: number) {
    const at = index >= 0 && tipList[index]
      ? tipList[index].clone()
      : new THREE.Vector3(0, 0, 106);
    /* What this hull carries beyond the standard, from the store. Read at the
       moment of launch so a purchase made between sorties is felt on the next
       one without the panel having to be reopened. */
    flight = createFlight(at, {
      torpedoes: extraTorpedoes(loadShip()),
      magazine: extraMagazine(loadShip()),
    });
    setHud({ dead: false });
  }

  /* The whole of a frame. A plain function rather than a method so the
     wrapper in frame() can call it inside a try. */
  function runFrame(dt: number) {
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
          x: 0, y: 0, aimX: 0, aimY: 0, roll: 0, strafe: 0,
          throttle: 0, fullStop: false, boosting: false, firing: false,
          secondary: false, guard: false, mini: false,
        };
        const res = stepFlight(flight, dt, live ? stick : blank, tipList, homeIndex);
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

          /* ---- LEANING INTO IT ----
             The hull is drawn where it will be a fifth of a second from now, so
             it visibly banks into a roll instead of sitting dead centre and
             dead straight. The whole idea, and why it is one idea rather than
             three, is in shipLean. The COLLIDER and the guns below keep the
             true orientation. */
          shipModel.quaternion.copy(shipQuat).multiply(stepLean(lean, shipQuat, dt));

          /* And it slides a little in the frame as well as turning, which is
             most of what sells it. Taken from where the leaned nose points
             against where the real one does, so it needs no signs either. */
          leanNose.set(0, 0, 1).applyQuaternion(shipModel.quaternion)
            .sub(leanRef.set(0, 0, 1).applyQuaternion(shipQuat));
          shipModel.position.addScaledVector(leanNose, LEAN_SLIDE * SHIP_LENGTH);

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
          const back = SHIP_LENGTH * (VIEW_NEAR + flight.view * VIEW_FAR);
          camera.position
            .addScaledVector(flight.fwd, -back)
            .addScaledVector(flight.up, back * 0.30);
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

        /* Whether the fight belongs to a room. Worked out before the guns,
           because it decides whether a trigger pull is a shot or a request. */
        const inRoom = !!room && room.status() === "live";

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
          /* The SCREEN's axes, read off the camera itself, so the corner is the
             corner of the picture whatever the bank is doing and wherever the
             camera happens to be sitting. */
          camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
          camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
          camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
          miniMuzzle(
            camera.position, camFwd, camRight, camUp, camera.fov, camera.aspect, muzzle,
            /* In third person it comes out of the nose instead, the same way
               the main guns already do. */
            shipModel && flight.view > 0.01 ? shipNose(flight) : undefined,
          );
          /* ---- WHO PULLS THE TRIGGER ----
             In a room the shot is a REQUEST, not a fact: the room decides
             whether this ship had a round left, whether it may fire yet, and
             what it hits. Firing locally as well would put a round in the air
             that nobody else can see and that scores nothing. */
          if (inRoom && room) room.fire("mini", muzzle, flight.fwd, aimDir);
          else fireMini(combat, muzzle, camera.position, aimDir);
          fx.muzzle(muzzle);
          playMiniSound();
        }

        /* ---- the beam ----
           Not a round: everything in a narrow cone takes the damage at the
           instant it fires, and the cone stays lit for half a second. Held
           down, it simply fires again as soon as it is ready, which is the
           same half second, so a held trigger reads as one continuous beam. */
        const armed = weaponInSlot(weapons.primary + 1);
        if (armed?.kind === "beam") {
          beamAt -= dt;
          if (stick.firing && beamAt <= 0 && flight.ammo >= 1) {
            beamAt = BEAM_SECONDS;
            flight.ammo -= 1;
            const from = shipNose(flight);
            if (inRoom && room) room.fire("beam", from, flight.fwd, undefined, armed.key);
            else fireBeam(combat, armed, from, flight.fwd, "", damageScale());
            fx.muzzle(from);
            playGunSound();
          }
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
          if (shipModel && flight.view > 0.01) at = shipBarrels(flight);
          /* ---- WHO PULLS THE TRIGGER ----
             In a room the shot is a REQUEST, not a fact: the room decides
             whether this ship had rounds left, whether it may fire yet, and
             what it hits. Firing locally as well would put rounds in the air
             that nobody else can see and that score nothing. The muzzles are
             still worked out here, because the flash is a local thing that
             should happen the instant the trigger goes down. */
          let muzzles: [THREE.Vector3, THREE.Vector3];
          if (at) {
            muzzles = at;
          } else {
            muzzles = [new THREE.Vector3(), new THREE.Vector3()];
            gunMuzzles(flight.pos, flight.fwd, s.up, camera.fov, camera.aspect, muzzles);
          }
          if (inRoom && room) room.fire("main", flight.pos, flight.fwd);
          else fireGuns(combat, flight.pos, flight.fwd, s.up, camera.fov, camera.aspect, "", at);
          fx.muzzle(muzzles[0]);
          fx.muzzle(muzzles[1]);
          playGunSound();
        }

        /* ---- WHOSE FIGHT IS IT ----
           In a room, the room's. It simulates the fighters, every round in the
           air and the coins for everybody at once, and the cockpit's job is to
           draw that rather than to run a second private copy of it. Two players
           each stepping their own simulation would be two people in the same
           sky shooting at different enemies, which is not multiplayer, it is
           two games with a chat window.

           Flying stays here either way. A ship that waited for a round trip
           before it turned would feel broken however good the connection was,
           so the stick still moves the ship at once and the position is
           reported afterwards for everyone else to see. */
        if (inRoom && room) {
          room.step(dt);
          room.report(flight.pos, flight.fwd, flight.guardFor > 0);

          /* The room's fight, put where the drawing already looks for it. */
          combat.enemies.length = 0;
          let di = 0;
          for (const e of room.enemies) {
            /* A drone from the wire is drawn as a drone: the sphere pass reads
               the flag, the colour comes from the drone tier, and the pulse
               phase is stable per slot so the swarm does not throb in unison. */
            if (e.drone) {
              const cls = droneClass(e.tier);
              combat.enemies.push({
                pos: e.pos, fwd: e.fwd, roll: 0,
                cls: { ...cls, weight: 0 } as ShipClass,
                shield: e.shield, vel: new THREE.Vector3(), tumble: new THREE.Vector3(),
                spin: new THREE.Vector3(), flash: 0, ammo: 0, reload: 0, fireAt: 0,
                weave: 0, weaveDir: 1, mode: "in", breakAt: 0, rejoinAt: 0,
                escape: new THREE.Vector3(0, 0, 1), passFor: 0, wave: 0,
                drone: true, group: 0, fleet: 0, slot: 0, pulse: (di++ * 0.73) % (Math.PI * 2),
              } as Enemy);
              continue;
            }
            combat.enemies.push({
              pos: e.pos, fwd: e.fwd, roll: 0,
              cls: TIERS[Math.max(0, Math.min(TIERS.length - 1, e.tier - 1))],
              shield: e.shield, vel: new THREE.Vector3(), tumble: new THREE.Vector3(),
              spin: new THREE.Vector3(), flash: 0, ammo: 0, reload: 0, fireAt: 0,
              weave: 0, weaveDir: 1, mode: "in", breakAt: 0, rejoinAt: 0,
              escape: new THREE.Vector3(0, 0, 1), passFor: 0, wave: 0,
            });
          }
          combat.bullets.length = 0;
          for (const b of room.bullets) {
            combat.bullets.push({ pos: b.pos, vel: b.vel, life: 1, hostile: b.hostile, mini: b.mini });
          }
          /* Beams too: yours and everyone else's, drawn from the room's list
             so a beam is seen by the whole room and hits what the room says. */
          combat.beams.length = 0;
          for (const b of room.beams) combat.beams.push(b);
          combat.coins.length = 0;
          for (const k of room.coins) {
            combat.coins.push({ pos: k.pos, vel: new THREE.Vector3(), spin: 0, value: 0 });
          }
          combat.events.push(...room.takeEvents().map((e) => ({
            kind: e.kind as never, at: e.at, power: e.power, who: e.who,
            tier: e.tier, shield: e.shield, damage: e.damage, wave: e.wave,
            guarded: e.guarded,
          })));

          /* ---- ANTI-CHEAT: THE GAUGES ARE THE ROOM'S ----
             Shield, ammo, torpedoes, guards, score and DIVI are all overwritten
             from the wire while connected. A cockpit that decided its own score
             is a cockpit that could be edited into deciding a better one, and
             the whole reason the room exists is that it settles those numbers
             where nobody can reach them. */
          const g = room.gauges;
          if (g) {
            flight.shields = g.shield;
            flight.ammo = g.ammo;
            flight.torpedoes = g.torps;
            flight.guards = g.guards;
            score = g.score;
            divi = g.divi;
          }
          /* Once. others() builds a fresh array each call. */
          const crew = room.others();
          if (peers) peers.draw(crew, camera);
          setHud({ crew: crew.length + 1 });
        } else if (peers) {
          peers.draw([], camera);
        }

        /* ---- fighters and their fire ----
           Only when nobody else is running them. */
        if (!inRoom) stepCombat(combat, dt, {
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
              fireTorpedo(combat, shipModel && flight.view > 0.01 ? shipBelly(flight) : shipNose(flight), flight.fwd);
              playTorpedoSound();
            }
          }
        }

        for (const ev of combat.events) {
          if (ev.kind === "incoming") {
            /* The event carries how near the round is, which is what the alarm
               turns into loudness. */
            playIncomingWarning(ev.power);
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
            /* One point for each DIVI brought home, which is what buys guns. */
            setHud({ divi, points: earnPoints(ev.value ?? 0) });
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
          /* Drones are spheres drawn by the instanced pass, not models. A
             sentinel tier keeps their slot in step with the enemy list without
             building a hull nobody will ever see. */
          const want = combat.enemies[i].drone ? 0 : combat.enemies[i].cls.tier;
          const have = enemyMeshes[i];
          if (have && have.userData.tier === want) continue;
          if (have) scene.remove(have);
          const m = want === 0 ? new THREE.Group() : protos[want - 1].clone(true);
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
          if (!e || e.drone) { m.visible = false; rig.step(nowS, 0); continue; }
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

        /* ---- the thrust ----
           Follows what the ship is DOING rather than what the key is doing.
           Holding shift with an empty boost tank, or while docked, or after
           being shot down, all move the ship not at all, and a roar with no
           acceleration behind it is worse than silence. */
        const thrusting = stick.boosting && flight.boost > 0
          && flight.dock <= 0 && !hud.dead;
        if (thrusting !== wasThrusting) {
          wasThrusting = thrusting;
          if (thrusting) startBoostSound(); else stopBoostSound();
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
        fx.drawBeams(combat.beams, BEAM_SECONDS);
        /* The swarm and its fire. Both are instanced, so the cost of drawing a
           hundred and forty spheres is the cost of drawing one. */
        /* Reused lists rather than two fresh arrays from filter() a frame. */
        droneList.length = 0;
        for (const e of combat.enemies) if (e.drone) droneList.push(e);
        orbList.length = 0;
        for (const b of combat.bullets) if (b.orb) orbList.push(b);
        fx.drawDrones(droneList, nowS);
        fx.drawOrbs(orbList, nowS);
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
            kills: Math.floor(combat.kills),
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
    }

  return {
    attach(api) {
      /* ---- FIRST, AND ON ITS OWN ----
         Before the ship models, before the map tiles, before anything else the
         game will want off the wire. Geoff: "it should be the first thing that
         the player hears because it's lazy-loaded from Cloudflare before
         anything else." Opening the panel is a click, so the audio is allowed
         to start; if the download is still in flight it begins the moment it
         lands. */
      if (endAt) { clearTimeout(endAt); endAt = null; }
      watchOutputDevices();
      /* A reopened panel gets a fresh audio context. The sound has been
         reported dying mid-session with every measurement on this side
         reading healthy; whatever that is, a new context on the current
         output device is the reset a restart of the app would give, without
         the restart. Carried out from the click that opened the panel. */
      if (attachCount++ > 0 && !suspended) { requestAudioRebuild(); settleAudioFromGesture(); }
      primeMusic();
      if (!suspended) playOpening(1.6);
      setHud({ points: spendable() });
      /* What the account has, folded in: a reinstall or a second machine gets
         its guns back. Then every change goes up. */
      if (!stopLoadoutWatch) {
        stopLoadoutWatch = watchLoadout();
        void loadLoadoutRemote().then((moved) => { if (moved) setHud({ points: spendable() }); });
      }
      try {
        scene = api.scene;
        camera = api.camera;
        dom = api.dom;
        stats = api.stats ?? null;

        /* Real tower tips off the real map. Docking lines up with the towers
           you can actually see, because they ARE those towers. */
        scaleTowers = api.scaleTowers;
        ipList = [...api.tips.keys()];
        tipList = ipList.map((ip) => api.tips.get(ip)!.clone());
        selfIp = api.selfIp ?? "";
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
        if (suspended) {
          /* Back into the new scene with the fight and the flight as they
             were. The towers were halved at launch and this is a fresh set at
             full size, so they are halved again and the tips re-read. */
          if (scaleTowers && hud.launched) {
            const tips = scaleTowers(WORLD_SCALE);
            tipList = ipList.map((ip) => tips.get(ip)?.clone() ?? new THREE.Vector3());
          }
          if (peers) scene.add(peers.group);
          suspended = false;
        } else {
          combat = createCombat();
          startAt(homeIndex);
        }

        /* Where the globe exactly fills the height of the frame. Slightly
           inside it, so it fills rather than floats. */
        const half = (camera.fov * Math.PI) / 360;
        globeRadius = api.radius;
        approachTo = (api.radius / Math.sin(half)) * 0.92;
        if (phase === "approach") {
          approachFrom.copy(camera.position);
          if (approachFrom.lengthSq() < 1) approachFrom.set(0, 0, approachTo * 1.6);
          approach = 0;
        }

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

    /* ---- THE BLACK BOX ----
       Two faults have now been reported three times between them, guessed at
       twice from the outside, and both are invisible: a game with no sound and
       a game with no enemies look exactly like a game that is working, from
       here. So it writes down what it is actually doing, once every couple of
       seconds, where it can be read back off disk afterwards.

       localStorage rather than the console, because a webview's console goes
       nowhere anybody can reach, and rather than the HUD, because this is for
       diagnosis and not for the player. It is one small key, overwritten in
       place, so it costs nothing and grows into nothing. */
    frame(dt) {
      const t0 = performance.now();
      try {
        runFrame(dt);
      } catch (err) {
        /* ---- AND IT NO LONGER LOSES THE REST OF THE FRAME IN SILENCE ----
           Everything in a frame runs in one long sequence: fly, shoot, step the
           fight, play what happened, then draw it. An exception anywhere in
           that used to skip every remaining step without a word, and because
           the map owns the render loop the world carried on drawing regardless.
           A throw just before the sounds and the enemy models would look
           EXACTLY like the two things being reported: still flying, still
           rendering, no noise and nothing to fight. */
        frameError = `${(err as Error).message}`;
        frameErrors++;
      }
      tickMusic();
      /* The readout. An exponential average with a short memory: a spike is
         seen, a steady state is steady. */
      if (dt > 0) {
        const k = 0.1;
        fpsAvg += ((1 / dt) - fpsAvg) * k;
        simAvg += ((performance.now() - t0) - simAvg) * k;
      }
      readoutAt -= dt;
      if (readoutAt <= 0) {
        readoutAt = 0.25;
        const st = stats?.();
        setHud({
          fps: Math.round(fpsAvg), simMs: Math.round(simAvg * 10) / 10,
          ...(st ? { drawCalls: st.calls, pixelRatio: st.ratio } : {}),
        });
      }
      diagAt -= dt;
      if (diagAt <= 0) {
        diagAt = 2;
        /* ---- IS ANYTHING ACTUALLY COMING OUT ----
           Music plays whenever the panel is open, so while a track is meant
           to be playing and the player is not mid-death-fade, silence at the
           speakers is a fault, and the bus deals with it. */
        const mus = musicState() as { playing?: string | null };
        noteLevel();
        lastWatch = watchAudio(!!mus.playing && !hud.dead, 2);
        try {
          localStorage.setItem("dd69.rebels.diag", JSON.stringify({
            at: new Date().toISOString(),
            phase,
            /* Whether the ship is currently lost matters as much as the phase:
               a dead player has no wave and no enemies by design, and without
               this a perfectly normal death reads exactly like a game that has
               stopped spawning. */
            dead: hud.dead,
            room: roomStatus,
            crew: room ? room.others().length + 1 : 0,
            respawnIn: respawnAt > performance.now()
              ? Math.round((respawnAt - performance.now()) / 1000) : 0,
            audio: audioState(),
            bus: { ...audioHealth(), lastWatch },
            music: musicState(),
            enemies: combat.enemies.length,
            fighters: combat.enemies.filter((e) => !e.drone).length,
            wave: combat.wave ? { n: combat.wave.n, toSpawn: combat.wave.toSpawn, left: Math.round(combat.wave.timeLeft) } : null,
            meshes: enemyMeshes.length,
            protos: protos.length,
            visible: enemyMeshes.filter((m) => m.visible).length,
            alt: flight ? Math.round(flight.pos.length() - R) : null,
            frameError,
            frameErrors,
            drawCalls: hud.drawCalls,
            pixelRatio: hud.pixelRatio,
          }));
        } catch { /* storage full or blocked; the game does not care */ }
      }
    },
    detach() {
      suspended = flying && !hud.dead && hud.launched;
      if (suspended) {
        if (endAt) clearTimeout(endAt);
        endAt = setTimeout(endSuspended, SUSPEND_GRACE_MS);
      } else {
        stopMusic();
        leaveRoom();
      }
      stopBoostSound();
      /* Backing out mid-flight files what was earned. Losing a good run to a
         stray Escape would be worse than the alternative. */
      if (flying && !hud.dead && !suspended) bank();
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
      if (scene && peers) scene.remove(peers.group);
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
        shipMounts = null;
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
      if (!suspended) {
        combat = createCombat();
        flight = null;
      }
      scene = null; camera = null; dom = null;
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
      playGameplay();
      connectRoom();
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
      /* Launching starts with the reticle centred, wherever the pointer was
         when it hit the LAUNCH button. */
      cursor.x = 0.5; cursor.y = 0.5;
      stick.aimX = 0; stick.aimY = 0;
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
      playGameplay();
      startAt(homeIndex);
      flying = true;
      phase = "fly";
      try { dom?.requestPointerLock?.(); } catch { /* not supported here */ }
      setHud({ launched: true });
    },
    dispose() {
      listeners.clear();
      /* Disposed is final: whatever a detach was waiting to find out, the
         answer is that the game is over. */
      if (endAt) { clearTimeout(endAt); endAt = null; }
      endSuspended();
      stopLoadoutWatch?.();
      stopLoadoutWatch = null;
    },
  };
}
