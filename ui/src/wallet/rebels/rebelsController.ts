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
  shieldMaxFor, isFull, BOOST, SUPER_BOOST_MULT,
  GUARD_ABSORB, GUARD_SECONDS,
  type Flight, type Stick,
} from "./orbitFlight";
import {
  clampReach, REACH_MIN, DRAGON_CLASS, DRAGON_LIFE,
  createCombat, clearEvents, gunMuzzles, TORPEDO_FUSE, CONVERGE, JUNK_LIFE,
  showBullet, dropBullet, stepShownBullets,
  miniMuzzle,
  STAKE_BONUS_MS, TIERS, TRACER_LIFE, STREAK_SECONDS, ENEMY_FIRE_RANGE,
  type CombatState,
  type Enemy, type ShipClass,
} from "./rebelsCombat";
import { platform } from "./platform/current";
import type { Pilot } from "./platform/platform";
import { recordScore, myTotals, addDivi, totalDivi, TIER_COUNT } from "./rebelsScores";
import { R, MAX_ALT, EARTH_D } from "./orbitWorld";
import { makeVoxelPlanet, arrivalOffset, type VoxelPlanet } from "./voxel/voxelPlanet";
import { hitRock, bounceVelocity, bounceDamage } from "./voxel/voxelCollide";
import {
  DISTANCE_IN_EARTHS, WORLD_RADIUS, SKY_EDGE, CUBE, SPIKEWORLD_NEAR, SPIKEWORLD_FAR,
} from "./voxel/voxelWorld";
import { createSpace, type SpaceBody } from "./spaceEnvironment";
import { installSky, skyTexture, type SkyHandle } from "./starfield";
import { loadModel, unitCopy, modelClips } from "./spaceAssets";
import { loadShip, DEFAULT_SHIP } from "./shipChoice";
import { loadPaint, makeRepaintable, type PaintHandle } from "./shipColours";
import {
  fitCollider, fitMounts, halfSpan, type Mounts, placeCollider, noseOf, HULL_FORWARD, HULL_UP, type HitSphere,
} from "./shipCollider";
import {
  loadLoadout, saveLoadout, weaponAt, type Loadout, type SlotKind,
} from "./shipLoadout";
import { pulseHealth } from "./healthPulse";
import { createLean, stepLean, LEAN_SLIDE } from "./shipLean";
import { joinRoom, type Room, type RoomStatus } from "./rebelsRoom";
import { setBankStatus, setBankPurse, setBankActor } from "./rebelsBank";
import { droneClass } from "./rebelsFlock";
import { respawnSeconds, itemByKey } from "./itemCatalog";
import { fetchDropConfig } from "./dropConfigRemote";
import { DEFAULT_DROP_CONFIG, type DropConfig } from "./dropCharts";
import { addSphere, addHeld, heldCount, takeHeld, setItemUser } from "./rebelsInventory";
import { inRearWindow, placeRearCamera, rearAim, tailOf, rearViewport } from "./rearGun";
import { WING_SCALE } from "./rebelsWings";
import { dflow } from "./rebelsDflow";
import { loadLoadoutRemote, watchLoadout } from "./rebelsLoadout";
import { pullFleet } from "./rebelsShips";
import { applyToShip } from "./shipFleet";
import {
  watchAudio, audioHealth, settleAudioFromGesture, watchOutputDevices, requestAudioRebuild, noteLevel,
  resetAudioNow,
} from "../../sound";
import { createPeers, paintFromWire, type Peers } from "./rebelsPeers";
import { PART_ORDER } from "./shipColours";
import { weaponInSlot, BEAM_SECONDS } from "./weaponCatalog";
import {
  hasWeapon, owned, earnPoints, spendable, flightExtras, gearKeys, droneCounts, subscribeArmoury,
  grant,
} from "./rebelsArmoury";
import {
  createFx, makeFighter, makeShieldRig, makeGuardShell,
  type Fx, type ShieldRig,
} from "./rebelsFx";
import { makeMandalaShield, type MandalaShield } from "./rebelsMandala";
import {
  playGunSound, primeGunSound, startRechargeSound, stopRechargeSound,
  playTorpedoSound, playTorpedoBlast, playShipExplosion, resumeAudio,
  playMiniSound, playShotAt, setListener, playIncomingWarning, playBounce, playCoin, audioState,
  startBoostSound, stopBoostSound, setBoostPitch,
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
  /** What full is for this hull: MAX_SHIELD times the Hull Boost. */
  shieldMax: number;
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
  /** The rear-gun window is open (7), and the crosshair is in it. */
  rear: boolean;
  rearAim: boolean;
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
  /** Flock kills this run: over half a fleet's members. */
  flocks: number;
  /** TAB held with fuel: the gauge says so, and by how much. */
  superBoost: boolean;
  superMult: number;
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
  /** An enemy is under the crosshair (aim assist is on). A phone layout colours
   *  the crosshair by it; auto fire shoots while it is true. */
  onTarget: boolean;
}

const BLANK: HudState = {
  ready: false, speed: 0, alt: 0, shields: MAX_SHIELD, shieldMax: MAX_SHIELD, ammo: MAX_AMMO,
  torpedoes: MAX_TORPEDOES, inFlight: 0, hitAt: 0,
  guards: MAX_GUARDS, guarding: false, boost: 1,
  dock: 0, dockName: "", homeName: "", homeDist: 0, towers: 0, view: 0, throttle: 1,
  room: "off", crew: 0, points: 0, fps: 0, simMs: 0, drawCalls: 0, pixelRatio: 0, flocks: 0, superBoost: false, superMult: 2,
  rear: false, rearAim: false,
  primary: 0, secondary: 0, note: "", noteAt: 0, nearby: null, contacts: 0, kills: 0, score: 0, nearTower: Infinity, dockBlock: "",
  wave: 0, waveAt: 0, respawnIn: 0,
  divi: 0, tierKills: new Array(7).fill(0), junk: 0, bonus: false, docked: false, dead: false, launched: false, broken: null,
  onTarget: false,
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
  /** A panel that needs the mouse is open (true) or closed (false): the
   *  pointer is freed without that counting as Escape, and taken back after. */
  panel(open: boolean): void;
  hud(): HudState;
  subscribe(fn: (h: HudState) => void): () => void;
  launch(): void;
  respawn(): void;
  dispose(): void;
}

/** What one step of the flight model reports. */
type FlightStep = ReturnType<typeof stepFlight>;

export function createRebels(labelFor: (ip: string) => string): RebelsController {
  let hud: HudState = { ...BLANK };
  const listeners = new Set<(h: HudState) => void>();
  const push = () => { const t = performance.now(); for (const fn of listeners) fn(hud); dflow.add("hud", performance.now() - t); };

  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let dom: HTMLCanvasElement | null = null;
  let fx: Fx | null = null;
  /* The live drop charts, fetched once per attach; the default until then,
     and every fresh fight is dealt them. */
  let drops: DropConfig = DEFAULT_DROP_CONFIG;
  const freshCombat = (): CombatState => { const c = createCombat(); c.drops = drops; return c; };
  let combat: CombatState = freshCombat();
  /* One model per fighter in the air, kept in step with the simulation's list
     by index. Built from a single prototype and cloned, so a spawn costs a
     clone rather than a pile of new geometry. */
  let protos: THREE.Group[] = [];
  /* ---- the dragon's rig ----
     One, because there is only ever one dragon. The model is fetched once
     (nine megabytes, then cached on this machine) when the game attaches,
     so its first appearance is not a download. Drawn at thirty percent,
     animated with its own clip. Geoff, 2026-Sep-11. */
  const DRAGON_SIZE = 9;
  const DRAGON_OPACITY = 0.3;
  let dragonRig: { group: THREE.Group; mixer: THREE.AnimationMixer } | null = null;
  let dragonProto: THREE.Group | null = null;
  function ensureDragonRig(): void {
    if (dragonRig || !dragonProto || !scene) return;
    const group = unitCopy(dragonProto, { skinned: true });
    group.scale.setScalar(DRAGON_SIZE);
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const ghosts = mats.map((mat) => {
        const c = (mat as THREE.Material).clone() as THREE.MeshStandardMaterial;
        c.transparent = true; c.opacity = DRAGON_OPACITY; c.depthWrite = false;
        return c;
      });
      m.material = Array.isArray(m.material) ? ghosts : ghosts[0];
      m.frustumCulled = false;
    });
    /* The mixer wants the model the clip was made for: the one inside the
       two normalising wrappers unitCopy adds. */
    const inner = group.children[0]?.children[0] ?? group;
    const mixer = new THREE.AnimationMixer(inner);
    const clip = modelClips("rebels_dragon")[0];
    if (clip) mixer.clipAction(clip).play();
    group.visible = false;
    scene.add(group);
    dragonRig = { group, mixer };
  }
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
  /** Pulls out the input the door plugged in at attach. */
  let stopInput: (() => void) | null = null;
  let frameError = "";
  let frameErrors = 0;
  let diagAt = 0;
  /* Smoothed frame figures, and a clock for pushing them to the HUD: four
     times a second, since a number that changes sixty times a second cannot
     be read and re-rendering the HUD every frame would itself cost frames. */
  let fpsAvg = 0;
  let simAvg = 0;
  let readoutAt = 0;
  let stats: (() => { calls: number; triangles: number; ratio: number; programs?: number; geometries?: number; textures?: number }) | null = null;
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
  let flocks = 0;
  /* The map re-attaches within the same tick when it rebuilds, so a detach
     that is NOT followed by an attach almost at once was the panel closing,
     and then the run is over for real: banked, the room left, the music
     stopped. Nothing else can tell the two apart at detach time. */
  let endAt: ReturnType<typeof setTimeout> | null = null;
  let stopLoadoutWatch: (() => void) | null = null;
  let stopArmouryWatch: (() => void) | null = null;

  /** The run has ended for real (the panel closed mid-flight). */
  function endSuspended(): void {
    endAt = null;
    if (!suspended) return;
    suspended = false;
    stopMusic();
    leaveRoom();
    if (flying && !hud.dead) bank();
    combat = freshCombat();
    flight = null;
  }
  const enemyMeshes: THREE.Group[] = [];
  /* One shield rig per fighter model, hanging off it. */
  const enemyShields: ShieldRig[] = [];
  let guardShell: ReturnType<typeof makeGuardShell> | null = null;
  /** The cockpit's own view of the shield. See rebelsMandala.ts. */
  let mandala: MandalaShield | null = null;
  /* ---- SPIKEWORLD, the test trip ----
     Built only when the test key asks for it, so a player who never presses it
     never pays for any of it. See voxel/ and docs/DIVI-REBELS-VOXEL-PLANET-PLAN.md.

     Its centre is a thousand Earth diameters out, which is where Geoff wants
     it; the Threshold Gate will be the way players get there, and until that is
     built this key is the only way anybody sees it. */
  const SPIKEWORLD_AT = new THREE.Vector3(0, 0, DISTANCE_IN_EARTHS * EARTH_D);
  let spikeworld: VoxelPlanet | null = null;
  let voxBuilt = -1;
  let stopItemUser: (() => void) | null = null;
  const _voxLook = new THREE.Vector3();
  let atSpikeworld = false;
  /** The camera's near and far planes before Spikeworld moved them, so they
   *  can be put back. Null when we are not out there. */
  let farAtHome: number | null = null;
  let nearAtHome: number | null = null;
  /** Where the ship was before it went, so it can be put back. */
  const homeAgain = new THREE.Vector3();
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
  /** The capture ball's radius, from the flown hull's wingspan. */
  let shipReach = REACH_MIN;
  /* ---- the rear gun ----
     Open with 7 (when a Rear Gun is held). The scene is drawn a second time
     into the top-right window from a camera behind the ship looking back;
     with the crosshair in the window, the trigger fires the double shot out
     of the tail through the crosshair, and the right button a torpedo. */
  /* Wreckage and wingmen come off the wire ready to draw and are never moved
     here, so one shared zero stands in for the fields the drawing ignores. */
  const _zero = new THREE.Vector3();
  /** The room's last word on the hull, so a drop during a resupply is not
   *  hidden by the animation. */
  let lastRoomShield = -1;
  /** When the last refusal was shown, so a repeated one does not shout. */
  let deniedAt = 0;
  /** The wave the cockpit last announced, so a change is noticed once. */
  let lastWaveSeen = -1;

  /* ---- THE WINGMEN ----
     Half-size copies of the hull they fly with, one model per owner and
     place, kept between frames and hidden when their wingman is gone. The
     server decides where they are and whether they are still there; this
     only puts a model at the position it was given, facing the way its
     owner faces (Geoff: "they always point in the same direction as you
     do"). */
  interface WingRig { group: THREE.Group; forModel: string }
  const wingRigs = new Map<string, WingRig>();
  const wingProtos = new Map<string, THREE.Group | null>();
  function wingProto(model: string): THREE.Group | null {
    const have = wingProtos.get(model);
    if (have !== undefined) return have;
    wingProtos.set(model, null);                  /* asked for; not here yet */
    void loadModel(model)
      .then((p) => { wingProtos.set(model, p); })
      .catch(() => { wingProtos.delete(model); });
    return null;
  }
  function drawWings(): void {
    if (!scene || !room) { return; }
    const seen = new Set<string>();
    for (const wing of room.wings) {
      /* Which hull it is a copy of, and which way that hull is pointing. */
      const mine = wing.owner === room.me();
      const owner = mine ? null : room.others().find((p) => p.id === wing.owner);
      const model = mine ? loadShip() : owner?.ship || DEFAULT_SHIP;
      const facing = mine ? flight?.fwd : owner?.fwd;
      if (!facing) continue;
      const key = `${wing.owner}:${wing.slot}`;
      seen.add(key);
      let rig = wingRigs.get(key);
      if (rig && rig.forModel !== model) {
        scene.remove(rig.group);
        wingRigs.delete(key);
        rig = undefined;
      }
      if (!rig) {
        const proto = wingProto(model);
        if (!proto) continue;                     /* still loading */
        const group = unitCopy(proto);
        /* Painted like the ship it flies with, which is the point of it
           being a copy. */
        try {
          makeRepaintable(group).apply(mine ? loadPaint() : paintFromWire(owner?.paint));
        } catch { /* an unpainted wingman is better than none */ }
        group.scale.setScalar(SHIP_LENGTH * WING_SCALE);
        scene.add(group);
        rig = { group, forModel: model };
        wingRigs.set(key, rig);
      }
      rig.group.visible = true;
      rig.group.position.copy(wing.pos);
      scratch.target.copy(wing.pos).addScaledVector(facing, 10);
      scratch.m4.lookAt(wing.pos, scratch.target, wing.pos.clone().normalize());
      rig.group.quaternion.setFromRotationMatrix(scratch.m4);
    }
    for (const [key, rig] of wingRigs) {
      if (seen.has(key)) continue;
      rig.group.visible = false;
      scene.remove(rig.group);
      wingRigs.delete(key);
    }
  }
  let rearOn = false;
  /** When this cockpit last asked the room for a torpedo, so the next press
   *  is a detonate while it could still be flying. */
  let torpSentAt = 0;
  let afterRender: ((fn: ((r: THREE.WebGLRenderer, draw: (s: THREE.Scene, c: THREE.Camera) => void) => void) | null) => void) | null = null;
  /* The map's compile, handed over so the game can warm its own shaders. */
  let compileScene: (() => void) | null = null;
  /**
   * Compile every shader the game will need, now, while nothing is happening.
   *
   * A compile only reaches what can be SEEN, and almost everything the game
   * draws sits hidden until it is used: the beam, the torpedo, the explosion,
   * the drop, the tracer. So each one cost its own compile the first time it
   * appeared, in the middle of a fight, and DFlow measured those at about a
   * tenth of a second each. Here they are all shown for the length of one
   * call, compiled together, and put back exactly as they were.
   *
   * Cheap to call twice: the second time finds every program already built.
   */
  function warmShaders(): void {
    if (!compileScene || !scene) return;
    const hidden: THREE.Object3D[] = [];
    /* A compile walks the SCENE, so anything held to one side has to be put in
       it for the call and taken out again. The fighter prototypes are exactly
       that: seven models built once and cloned per enemy, never drawn
       themselves. */
    const lent: THREE.Object3D[] = [];
    const show = (root: THREE.Object3D | null | undefined) => {
      if (!root) return;
      if (!root.parent && scene) { scene.add(root); lent.push(root); }
      root.traverse((o) => { if (!o.visible) { o.visible = true; hidden.push(o); } });
    };
    try {
      show(fx?.group);
      show(space?.group);
      show(guardShell?.mesh);
      show(mandala?.group);
      show(peers?.group);
      for (const p of protos) show(p);
      if (dragonProto) show(dragonProto);
      compileScene();
    } catch (e) {
      dflow.note(`warm: ${String(e)}`);
    } finally {
      for (const o of hidden) o.visible = false;
      for (const o of lent) scene?.remove(o);
    }
  }
  const rearCamera = new THREE.PerspectiveCamera(70, 1.6, 0.1, 4000);
  const _rearSize = new THREE.Vector2();
  function drawRearView(renderer: THREE.WebGLRenderer, draw: (s: THREE.Scene, c: THREE.Camera) => void): void {
    if (!scene || !camera || !flight || !rearOn) return;
    renderer.getSize(_rearSize);
    const pr = renderer.getPixelRatio();
    const vp = rearViewport(_rearSize.x * pr, _rearSize.y * pr);
    rearCamera.fov = camera.fov;
    rearCamera.aspect = vp.w / Math.max(1, vp.h);
    rearCamera.near = camera.near; rearCamera.far = camera.far;
    rearCamera.updateProjectionMatrix();
    placeRearCamera(rearCamera, flight);
    const wasAutoClear = renderer.autoClear;
    renderer.setScissorTest(true);
    renderer.setScissor(vp.x, vp.y, vp.w, vp.h);
    renderer.setViewport(vp.x, vp.y, vp.w, vp.h);
    renderer.autoClear = false;
    renderer.clearDepth();
    try { draw(scene, rearCamera); } finally {
      renderer.autoClear = wasAutoClear;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, _rearSize.x * pr, _rearSize.y * pr);
    }
  }
  function setRear(on: boolean): void {
    rearOn = on;
    afterRender?.(on ? drawRearView : null);
    /* Closing the window with the crosshair still in the corner would hand
       the stick a hard turn, so the aim is worked out again either way. */
    aimFromCursor();
    setHud({ rear: on, rearAim: false });
  }
  /* Hull models by enemy id, and pools of hidden ones by tier. */
  type HullSlot = { mesh: THREE.Object3D; rig: ShieldRig; tier: number };
  const enemyRigs = new Map<number, HullSlot>();
  const hullPools = new Map<number, HullSlot[]>();
  const seenEnemies = new Set<number>();
  function releaseHull(slot: HullSlot): void {
    slot.mesh.visible = false;
    slot.rig.group.visible = false;
    slot.rig.step(0, 0);
    let pool = hullPools.get(slot.tier);
    if (!pool) { pool = []; hullPools.set(slot.tier, pool); }
    pool.push(slot);
  }
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
  /* ---- the stake bonus ----
     Only this wallet knows its node won a block, so it tells the server,
     which grants the minute of triple damage and caps how often it will.
     Sent once per win: the flag clears when the window closes. */
  let bonusTold = false;
  function tellBonus(): void {
    const won = platform().wonStakeRecently(STAKE_BONUS_MS);
    if (won && !bonusTold) { room?.bonus(); bonusTold = true; }
    if (!won) bonusTold = false;
  }
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
  /* Thirty seconds, or ten with a VIP Pass. See itemCatalog. */
  /** What the wallet says the player holds, once the door has answered. Nothing
   *  waits on it: it starts at none and the ladder simply improves when it
   *  arrives. */
  let walletDivi = 0;
  const respawnWait = () => respawnSeconds(owned(loadShip()), walletDivi);
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
    /* Whatever the brake was holding belonged to the ship that is now gone. */
    brakeFrom = null;
    bank();
    /* The flying theme goes over five seconds and the menu theme comes back
       after it. See rebelsMusic for why after rather than across. */
    musicOnDeath();
    /* Alone, losing the ship means every player is down, so the sky is cleared
       and the whole thing starts again at wave one with no waiting. With others
       still flying it will instead be a ten second count, which is the room's
       decision to make rather than this one's. */
    /* ---- THE WAIT IS THE ROOM'S TO SET ----
       It clears its own sky when the last player alive goes down, and it
       counts the seconds. The cockpit starts its own clock from the same
       rule so the countdown is there immediately, and takes the room's
       figure the moment it arrives. It used to set no wait at all, which
       offered LAUNCH AGAIN straight away while the room still had the seat
       dead: the ship then flew with a hull the room said was zero. */
    combat.enemies.length = 0;
    combat.bullets.length = 0;
    combat.torpedoes.length = 0;
    combat.wave = null;
    respawnAt = performance.now() + respawnWait() * 1000;
    setHud({ wave: 0, respawnIn: respawnWait() });
    setHud({ dead: true, score: 0 });
    if (rearOn) setRear(false);
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
    x: 0, y: 0, aimX: 0, aimY: 0, roll: 0, strafe: 0, lift: 0, superBoost: false,
    throttle: 0, fullStop: false, boosting: false, firing: false,
    secondary: false, guard: false, mini: false,
  };

  /* ---- AIM ASSIST, AUTO FIRE AND THE BRAKE: FOR THUMBS ----
     Phone space games (Galaxy on Fire 3) and phone shooters (Call of Duty
     Mobile's default mode) both do this, because a thumb on glass cannot aim
     the way a mouse can: the crosshair eases onto an enemy that is close to it,
     and the guns fire on their own while one is under it. Off unless the door's
     input turns it on, so keyboard and mouse play is exactly as it was.
     The brake is those games' other half: held, the ship slows; let go, it goes
     back to the speed the lever was at. */
  const assist = { autoFire: false, magnet: false };
  /** The trigger as the hands hold it, apart from what auto fire adds. */
  let triggerHeld = false;
  let autoFiring = false;
  /** The lever's setting when the brake went on, or null when it is off. */
  let brakeFrom: number | null = null;
  /** When a hand last moved the crosshair itself. Aim assist waits for a still
      thumb, so steering is never fought for the crosshair mid-turn. */
  let movedCursorAt = 0;

  /* What is in the two trigger slots. Saved, so a pilot who prefers the mini
     gun does not have to say so every time they launch. */
  const weapons: Loadout = loadLoadout();
  /* The HUD starts from the saved choice, not from the first gun: nothing drew
     it until touch, where the weapon button is the only way to see it. */
  hud = { ...hud, primary: weapons.primary, secondary: weapons.secondary };

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
    stick.mini = weapons.primary === 1;
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

  function aimFromCursor() {
    const shape = (v: number) => {
      const a = Math.abs(v);
      if (a <= AIM_DEAD) return 0;
      return Math.sign(v) * Math.min(1, (a - AIM_DEAD) / (AIM_FULL - AIM_DEAD));
    };
    /* ---- WHILE YOU ARE LOOKING BEHIND, YOU FLY STRAIGHT ----
       The whole time the rear window is open, not just while the crosshair
       is inside it. Zeroing it only inside the window was not enough and
       Geoff caught it twice: the crosshair has to TRAVEL to the top right
       corner to get there, and every inch of that journey was a hard turn
       up and to the right. "Moving the mouse into the rear-view panel still
       spins the ship around even though I told you to fix that."

       The keyboard still flies the ship: arrows to steer, A and D, R and C,
       Q and E. Pressing 7 again gives the mouse back. */
    stick.aimX = rearOn ? 0 : shape(cursor.x * 2 - 1);
    stick.aimY = rearOn ? 0 : -shape(cursor.y * 2 - 1);
  }

  /* ---- Y: a held Instant Recharge or Supercharge ----
     A recharge when anything is below full; when everything is, a
     supercharge, which stacks a whole refill on top up to double. Taken from
     the inventory here (the account row follows); in a room the room is
     told and applies the same arithmetic to the seat's numbers, which the
     next gauge message carries back. */
  function useHeld(): void {
    if (!flight || !flying || hud.dead) return;
    const haveR = heldCount("recharge"), haveS = heldCount("supercharge");
    const full = isFull(flight, flight.extras);
    const key = haveR > 0 && !full ? "recharge" : haveS > 0 ? "supercharge" : haveR > 0 ? "recharge" : null;
    if (!key) { setHud({ note: "NOTHING TO USE: OPEN A SPHERE IN YOUR INVENTORY (I)", noteAt: performance.now() }); return; }
    const said = useOneHeld(key);
    setHud({ note: said, noteAt: performance.now() });
  }

  /**
   * Use ONE NAMED item, and say what happened.
   *
   * Split out of useHeld so the inventory can use the thing the player is
   * actually looking at, rather than whatever the Y key would have picked.
   * Every answer is a sentence, because a click that does nothing and says
   * nothing is indistinguishable from a broken button.
   */
  function useOneHeld(key: string): string {
    if (!flight || !flying) return "LAUNCH FIRST: ITEMS ARE USED IN FLIGHT";
    if (hud.dead) return "NOT WHILE YOU ARE DOWN";
    if (heldCount(key) <= 0) return "NONE LEFT";
    if (key === "recharge" && isFull(flight, flight.extras)) return "ALREADY FULL";
    if (key !== "recharge" && key !== "supercharge") return "THAT ONE IS NOT USED, IT IS FITTED";
    if (!takeHeld(key, 1)) return "NONE LEFT";
    room?.use(key);
    playBounce();
    return key === "recharge" ? "INSTANT RECHARGE" : "SUPERCHARGE";
  }

  /* Escape releases the lock, which the browser does for us, and that is the
     signal to leave the game. Nothing else can take the pointer away, except
     a panel that needs the mouse (the inventory): while one is open the lock
     is let go on purpose and its loss means nothing. */
  let panelOpen = false;
  function onLockChange() {
    const was = locked;
    locked = typeof document !== "undefined" && document.pointerLockElement === dom;
    if (was && !locked && flying && !panelOpen) onEscape?.();
  }
  function setPanelOpen(on: boolean): void {
    panelOpen = on;
    /* Centred either way: opening freezes the stick where it cannot turn,
       and closing hands back a neutral one rather than whatever corner the
       cursor was left in. */
    cursor.x = 0.5;
    cursor.y = 0.5;
    aimFromCursor();
    if (typeof document === "undefined") return;
    if (on) {
      if (document.pointerLockElement === dom) document.exitPointerLock();
    } else if (flying && !hud.dead) {
      try { dom?.requestPointerLock?.(); } catch { /* not supported here */ }
    }
  }
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
        /* The capture ball: as wide as the wings, in world units. */
        shipReach = clampReach(halfSpan(model) * SHIP_LENGTH);
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
  /* ---- the test cheats ----
     Their own module now (rebelsCheats.ts), plugged in by the door: the app has
     them, the public web does not. The same small host either way. */
  const cheats = platform().cheats?.({
    flying: () => !!flight,
    sendToRoom: (code) => room?.cheat(code),
    addHeld: (key, n) => { addHeld(key, n); },
    applyToShip: (model, key) => applyToShip(model, key),
    grant: (key) => grant(loadShip(), key),
    ship: () => loadShip(),
    note: (text) => setHud({ note: text, noteAt: performance.now() }),
  });
  /* ---- THE PILOT ----
     Everything a pair of hands can ask of the ship (platform.ts). The keyboard
     and mouse drive it from platform/desktopInput.ts; touch will drive the same
     thing on a phone. Each of these is what the old key and mouse handlers did
     here, moved behind a name. */
  let blurredAt = 0;
  const pilot: Pilot = {
    state: () => ({ flying, hasFlight: !!flight, dead: hud.dead, panelOpen, locked, rearOn, cursor: { x: cursor.x, y: cursor.y } }),
    setControls: (c) => {
      if (c.yaw !== undefined) stick.x = c.yaw;
      if (c.pitch !== undefined) stick.y = c.pitch;
      if (c.roll !== undefined) stick.roll = c.roll;
      if (c.strafe !== undefined) stick.strafe = c.strafe;
      if (c.lift !== undefined) stick.lift = c.lift;
      if (c.throttle !== undefined) stick.throttle = c.throttle;
      if (c.fullStop !== undefined) stick.fullStop = c.fullStop;
      if (c.boost !== undefined) stick.boosting = c.boost;
      if (c.superBoost !== undefined) stick.superBoost = c.superBoost;
      if (c.guard !== undefined) stick.guard = c.guard;
      if (c.brake !== undefined && flight) {
        if (c.brake && brakeFrom === null) { brakeFrom = flight.throttle; flight.throttle = 0; }
        else if (!c.brake && brakeFrom !== null) { flight.throttle = brakeFrom; brakeFrom = null; }
      }
      stick.mini = weapons.primary === 1;
    },
    trigger: (which, down) => {
      if (which === "secondary") stick.secondary = down;
      else { triggerHeld = down; stick.firing = down || autoFiring; }
    },
    setAssist: (a) => {
      if (a.autoFire !== undefined) assist.autoFire = a.autoFire;
      if (a.magnet !== undefined) assist.magnet = a.magnet;
    },
    moveCursor: (x, y) => {
      cursor.x = x;
      cursor.y = y;
      movedCursorAt = performance.now();
      aimFromCursor();
    },
    /* Pointer gone: stop turning, reticle back in the middle. */
    centreCursor: () => {
      stick.aimX = 0;
      stick.aimY = 0;
      cursor.x = 0.5;
      cursor.y = 0.5;
    },
    /* Losing the window must not leave the throttle open or a key stuck down. */
    releaseAll: () => {
      triggerHeld = false;
      if (brakeFrom !== null && flight) flight.throttle = brakeFrom;
      brakeFrom = null;
      stick.firing = false; stick.boosting = false; stick.secondary = false;
      stick.guard = false; stick.fullStop = false;
      stick.x = 0; stick.y = 0; stick.roll = 0; stick.strafe = 0; stick.lift = 0; stick.superBoost = false; stick.throttle = 0;
      stick.aimX = 0; stick.aimY = 0;
      blurredAt = performance.now();
    },
    selectWeapon: (slot) => selectWeapon("primary", slot - 1),
    /* Only the guns this ship owns are stepped through, so a touch button never
       lands on a "buy it" note. With one gun owned it stays where it is. */
    cycleWeapon: (dir) => {
      const ship = loadShip();
      for (let step = 1; step <= 6; step++) {
        const index = (((weapons.primary + dir * step) % 6) + 6) % 6;
        const spec = weaponInSlot(index + 1);
        if (spec && hasWeapon(ship, spec.key)) {
          if (index !== weapons.primary) selectWeapon("primary", index);
          return;
        }
      }
    },
    useHeld: () => useHeld(),
    toggleRear: () => {
      if (!flying) return;
      if (!gearKeys(loadShip()).includes("reargun")) {
        setHud({
          note: heldCount("reargun") > 0
            ? "REAR GUN NOT FITTED: RIGHT-CLICK IT IN THE INVENTORY (I)"
            : "NO REAR GUN: FIND ONE, OPEN IT AND FIT IT (I)",
          noteAt: performance.now(),
        });
      } else setRear(!rearOn);
    },
    toggleView: () => {
      if (!flight) return;
      flight.view = flight.view > 0.01 ? 0 : 2;
      if (flight.view > 0) ensureShip();
      setHud({ view: flight.view });
    },
    zoom: (dir) => {
      if (!flying || !flight) return;
      flight.view = zoomStep(flight.view, dir);
      if (flight.view > 0) ensureShip();
      setHud({ view: flight.view });
    },
    /* ---- THE SOUND, FROM SCRATCH ----
       There is one silence the game cannot measure (see resetAudioNow), and this
       is the cure that used to mean quitting the app. A keypress is a gesture,
       which is what a webview wants before it will let a new context make a
       noise. */
    restartSound: () => {
      resetAudioNow();
      primeMusic();
      pumpMusic();
      setHud({ note: "SOUND RESTARTED", noteAt: performance.now() });
    },
    gesture: () => wakeAudio(),
    /* ---- COMING BACK FROM SOMETHING ELSE ----
       A call, a video, another app: that is when a machine moves its audio
       output, and this webview gets no event to say so. Anyone away for more
       than a moment gets a fresh context at their next press, which costs a
       blink and is the difference between sound and none. */
    focusReturned: () => {
      if (blurredAt && performance.now() - blurredAt > 4000) requestAudioRebuild();
      blurredAt = 0;
    },
    lockChanged: () => onLockChange(),
    cheatKey: (k) => !!cheats?.onKey(k, performance.now()),
    teleportTest: () => toggleSpikeworld(),
  };

  /**
   * Go to Spikeworld, or come home.
   *
   * A LOOK-AROUND TRIP, and deliberately not more than that yet: while it is on
   * the ship stops reporting to the room and ignores its corrections, because
   * the room's world is Earth's neighbourhood and a ship two hundred thousand
   * units outside it would be snapped back every tick. Nothing here is
   * multiplayer and nothing here collides; that is Phase 5.
   */
  function toggleSpikeworld(): void {
    if (!flight || !scene || !camera) return;
    atSpikeworld = !atSpikeworld;
    if (atSpikeworld) {
      homeAgain.copy(flight.pos);
      if (!spikeworld) {
        spikeworld = makeVoxelPlanet(SPIKEWORLD_AT);
        scene.add(spikeworld.group);
      }
      /* Out of Earth's neighbourhood, which needs the ceiling lifted: the
         flight model stops a ship at MAX_ALT, about 4,600 units, and this is
         forty times that. */
      /* Out of the fight. Without this the room goes on simulating the ship
         at the last place it was told about and the fighters there go on
         shooting it, which is exactly what happened on the first trip: damage
         from enemies two hundred thousand units away. */
      room?.away();
      flight.ceiling = SPIKEWORLD_AT.length() + WORLD_RADIUS + SKY_EDGE * CUBE + 500;
      flight.pos.copy(SPIKEWORLD_AT).add(arrivalOffset());
      flight.alt = flight.pos.length() - R;
      flight.speed = 0;
      /* Far enough to see the planet, near enough to keep the cockpit sharp.
         The planet is 9,000 units across and the arrival is just outside it. */
      /* ---- THE DEPTH BUFFER, WHICH IS THE WHOLE FLICKER ----
         Geoff, on 69.9.54: "the orange heart is still flickering like crazy"
         and "big chunks of cubes appearing and disappearing". One cause, not
         two, and it is not the geometry: it is how finely the card can tell
         one surface from another at these distances.

         Earth orbit runs a near plane of five centimetres, which is right
         there: the cockpit has things a hand's width from the eye. Depth
         resolution falls off with the SQUARE of the distance and in direct
         proportion to how near the near plane is, and Spikeworld is nothing
         like Earth orbit: the heart is two thousand units away across the
         cavity and the far shell is nine thousand. At near 0.05 and far
         18,000 the card can only tell surfaces SIX UNITS apart at the heart
         and ninety-six at the far shell, against a cube face of nine. So the
         front and back of the same cube land on the same depth and the card
         picks one at random, every frame. That is the flicker, exactly.

         Pushing the near plane out to three units and pulling the far plane
         in to ten thousand (the dust stops at nine anyway) is a hundredfold
         improvement and puts every distance that matters well inside a cube
         face. Three units is safe here because nothing is drawn close: no
         shield, no wingmen, no muzzle flashes, only rock. */
      if (farAtHome === null) { farAtHome = camera.far; nearAtHome = camera.near; }
      camera.near = SPIKEWORLD_NEAR;
      camera.far = SPIKEWORLD_FAR;
      camera.updateProjectionMatrix();
      setHud({ note: "SPIKEWORLD: CMD+SHIFT+\\ TO RETURN", noteAt: performance.now() });
    } else {
      flight.ceiling = undefined;
      if (farAtHome !== null) {
        camera.far = farAtHome;
        camera.near = nearAtHome ?? camera.near;
        camera.updateProjectionMatrix();
        farAtHome = null; nearAtHome = null;
      }
      flight.pos.copy(homeAgain.lengthSq() > 1 ? homeAgain : new THREE.Vector3(0, 0, R + 40));
      /* Back in the fight, which flying alone also starts over. */
      room?.fly();
      flight.alt = flight.pos.length() - R;
      flight.speed = 0;
      if (spikeworld) { spikeworld.dispose(); spikeworld = null; }
      setHud({ note: "BACK IN EARTH ORBIT", noteAt: performance.now() });
    }
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
    /* Who this player is, as the door answers it: the node and its chosen name
       in the app. */
    const who = platform().identity.joinFields(selfIp);
    room = joinRoom({
      node: who.node,
      name: who.name,
      ...(who.door ? { door: who.door } : {}),
      ...(who.guest ? { guest: who.guest } : {}),
      home,
      ship: loadShip(),
      /* What this ship carries, so the room arms it the same way the solo
         game does: the minigun, the beams, the extra tubes and magazine. */
      gear: gearKeys(loadShip()).filter((k) => k !== "pulse"),
      reach: shipReach,
      drones: droneCounts(),
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
    brakeFrom = null;
    flight = createFlight(at, flightExtras(loadShip()));
    setHud({ shieldMax: shieldMaxFor(flight.extras) });
    setHud({ dead: false });
  }

  /* The whole of a frame. A plain function rather than a method so the
     wrapper in frame() can call it inside a try. */
  /* ---- ONE FRAME, IN STEPS ----
     The per-frame work used to be one function of nine hundred and forty lines.
     It is the same code in the same order, split into named steps (2026-Sep-15)
     so each can be read, tested and later moved on its own. */
  /** Before launch: the map's own view eased in or out until the globe fills the frame. */
  function frameApproach(dt: number, camera: THREE.PerspectiveCamera, fx: Fx): boolean {
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
      return true;
    }

    return false;
  }
  /** The launch dive from orbit to the player's own tower, ending exactly on the cockpit pose. */
  function frameDive(dt: number, flight: Flight, camera: THREE.PerspectiveCamera, fx: Fx): boolean {
    const s = scratch;
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
      return true;
    }

    return false;
  }
  /** The flight model's step, flying into things, and docking. Returns what the step reported. */
  function frameFlight(dt: number, flight: Flight, fx: Fx): FlightStep {
    const live = !hud.dead;
    const blank: Stick = {
      x: 0, y: 0, aimX: 0, aimY: 0, roll: 0, strafe: 0, lift: 0, superBoost: false,
      throttle: 0, fullStop: false, boosting: false, firing: false,
      secondary: false, guard: false, mini: false,
    };
    const tFlight = performance.now();
    const shieldsWere = flight.shields;
    const res = stepFlight(flight, dt, live ? stick : blank, tipList, homeIndex);
    dflow.add("flight", performance.now() - tFlight);
    /* ---- flying into things ----
       The ground and the towers are the flight model's rule: it owns the
       bounce, the angle, the speed and the cost of grinding along the
       surface, and there is one copy of that rule and it is here. The
       HULL, though, is the server's number, so whatever the flight model
       just took off is handed over and the local figure put back. Any
       loss, not only the bang: most of what killing yourself on a planet
       costs is the dragging afterwards, which raises no impact. */
    const selfHurt = shieldsWere - flight.shields;
    if (selfHurt > 0) {
      flight.shields = shieldsWere;
      room?.hurt(selfHurt);
    }
    if (res.hit) fx.boom(flight.pos.clone(), 1.2, "cold");
    nearTower = res.nearTower;
    dockBlock = res.dockBlock;
    /* The resupply finished: in company the room holds the gauges, so it
       is told, checks the ship is at a tower, and refills. */
    if (res.docked) room?.dock();

    return res;
  }
  /** The hull where the ship is (leaning into turns), the cockpit camera, the jolt, and the ears. */
  function frameShipAndCamera(dt: number, flight: Flight, camera: THREE.PerspectiveCamera): void {
    const s = scratch;
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
  }
  /** The shield: the mandala from the cockpit, the red sphere from outside. */
  /**
   * Spikeworld, a frame at a time.
   *
   * THIS CALL is what builds the cubes. The rods, the spokes and the heart are
   * built once when the planet is made, which is why the first trip showed
   * those three and nothing else: the step was written into a place in this
   * file that no longer existed after the controller was split, the edit
   * matched nothing, and nothing said so. An edit that silently matches
   * nothing is the one kind this file cannot afford.
   *
   * Timed and counted into DFlow, so next time the answer to "is anything being
   * built" is in the report rather than out of the window.
   */
  /** The last bounce, so the knocks are not counted one a frame while a ship
   *  is scraping along a wall. */
  let bouncedAt = 0;
  const _bv = { x: 0, y: 0, z: 0 };
  const _bn = new THREE.Vector3();
  const _bUpY = new THREE.Vector3(0, 1, 0);
  const _bUpZ = new THREE.Vector3(0, 0, 1);
  /** The ship, as a ball, in world units. A heavy fighter is about three
   *  across, so a cube (nine) comfortably holds one and the ball is its half
   *  span with a little margin for the wings. */
  const SHIP_HALF_SPAN = 1.8;

  /**
   * Flying into the rock.
   *
   * Geoff: "the cubes in the game need colliders and ships should bounce off of
   * them and take a small amount of damage based on velocity ... impart the
   * correct momentum and reduce speed by 30% when colliding and bouncing off at
   * the correct angle (classic physics like billiards)."
   *
   * The flight model steers by a HEADING and a speed rather than by a velocity
   * vector, so the bounce turns the nose: the heading is reflected in the face,
   * which is the same reflection a ball off a cushion makes, and the speed
   * keeps its seventy percent. The ship is also lifted back out of the cube it
   * had got into, or the next frame would find it still inside and bounce it
   * again.
   *
   * The arithmetic is all in voxelCollide, which knows nothing about three.js
   * and can therefore be the room's collision too when the room becomes the
   * authority out here.
   */
  function frameVoxelBounce(flight: Flight): void {
    if (!spikeworld) return;
    const c = spikeworld.centre;
    /* Into the planet's own frame, which is what the collider measures in. */
    const px = flight.pos.x - c.x, py = flight.pos.y - c.y, pz = flight.pos.z - c.z;
    const v = flight.speed;
    const b = hitRock(px, py, pz,
                      flight.fwd.x * v, flight.fwd.y * v, flight.fwd.z * v,
                      SHIP_HALF_SPAN);
    if (!b) return;

    /* Out of the rock first, along the face, with a hair of clearance. */
    _bn.set(b.nx, b.ny, b.nz);
    flight.pos.addScaledVector(_bn, b.depth + 0.05);

    /* The heading, reflected. */
    bounceVelocity(flight.fwd.x * v, flight.fwd.y * v, flight.fwd.z * v, b, _bv);
    const out = Math.hypot(_bv.x, _bv.y, _bv.z);
    if (out > 1e-4) {
      flight.fwd.set(_bv.x / out, _bv.y / out, _bv.z / out);
      flight.speed = out;
      /* The ship's own up has to stay square to its nose or the camera rolls
         into nonsense. Rebuilt from whichever axis is least like the new
         heading, which is the ordinary way round. */
      const side = Math.abs(flight.fwd.y) < 0.9 ? _bUpY : _bUpZ;
      _bn.crossVectors(side, flight.fwd).normalize();
      flight.up.crossVectors(flight.fwd, _bn).normalize();
    } else {
      flight.speed = 0;
    }
    flight.alt = flight.pos.length() - R;

    /* And the knock. Not more than one every third of a second: a ship sliding
       along a wall touches it every frame, and Geoff asked for a few points a
       bump, not a few points sixty times a second. */
    const now = performance.now();
    if (now - bouncedAt < 330) return;
    bouncedAt = now;
    /* Measured against what the ship could possibly be doing, so "forty" means
       flying flat out straight into a wall and nothing less. */
    const hurt = bounceDamage(b.into, BOOST * SUPER_BOOST_MULT);
    if (hurt <= 0) return;
    flight.shields -= hurt;
    setHud({ hitAt: now, note: `HULL ${hurt}`, noteAt: now });
  }

  function frameSpikeworld(camera: THREE.PerspectiveCamera): void {
    if (!spikeworld) return;
    const tVox = performance.now();
    spikeworld.step(camera.position, camera.getWorldDirection(_voxLook));
    dflow.add("vox", performance.now() - tVox);
    const st = spikeworld.stats();
    if (st.built !== voxBuilt) {
      voxBuilt = st.built;
      /* The `gone` tally is the one to read first. Every reason in it except
         "replaced" is rock taken away with nothing covering its ground, which
         is what Geoff kept seeing as "big groups appearing and disappearing".
         It should stay empty of those. */
      const why = Object.entries(st.gone).map(([k, n]) => `${k} ${n}`).join(", ");
      dflow.note(`vox: ${st.chunks} kept, ${st.shown} shown, ${st.triangles} triangles,`
        + ` ${st.dropped} refused by the budget, ${st.built} built, ${st.queued} waiting`
        + (why ? `; stopped drawing: ${why}` : ""));
    }
  }

  function frameShield(flight: Flight, camera: THREE.PerspectiveCamera): void {
    /* ---- the shield ----
       Two pictures of one thing, and only ever one of them at a time.

       From the COCKPIT it is the mandala: pale, half transparent, turning,
       hung on the eye so the pilot looks through it. From the chase camera
       it is the red wire sphere it has always been, because that is the
       shield as seen from OUTSIDE and Geoff asked for that to stay.

       Both are driven by the same strength, so they fade in and out with
       the charge in exactly the same way. */
    {
      const guardStrength = Math.min(1, flight.guardFor / (GUARD_SECONDS * 0.6));
      const inside = flight.view <= 0.01;
      if (guardShell) {
        guardShell.mesh.position.copy(flight.pos);
        guardShell.step(performance.now() / 1000, inside ? 0 : guardStrength);
      }
      if (mandala) {
        mandala.step(
          performance.now() / 1000,
          inside ? guardStrength : 0,
          camera as THREE.PerspectiveCamera,
        );
      }
    }
  }
  /** The planets turning, and naming the one the ship is near. */
  function frameSky(dt: number, flight: Flight): void {
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
  }
  /** The guns, the mini gun and the beam, forwards or through the rear window. Returns the backwards aim, or null. */
  /** How near the crosshair an enemy must be for the crosshair to ease onto
   *  it, as a share of the screen's height. */
  const ASSIST_REACH = 0.12;
  /** Near enough to count as under the crosshair: auto fire shoots. */
  const ASSIST_ON = 0.035;
  /** How quickly the crosshair eases in, per second. Gentle on purpose: the
   *  thumb still aims, and a desktop player in the same fight has no help. */
  const ASSIST_PULL = 2.5;
  /** How long a thumb must be still before the crosshair is eased anywhere. */
  const ASSIST_WAIT = 140;
  const assistPoint = new THREE.Vector3();

  /** Aim assist and auto fire, before the flight step reads the trigger. */
  function frameAssist(dt: number, camera: THREE.PerspectiveCamera): void {
    let best: { x: number; y: number; d: number } | null = null;
    /* Not while a panel has the screen: an open inventory would otherwise keep
       the guns firing at whatever happens to drift under the crosshair. */
    if ((assist.magnet || assist.autoFire) && flying && !hud.dead && !rearOn && !panelOpen) {
      const aspect = camera.aspect || 1;
      for (const e of combat.enemies) {
        if (e.pos.distanceTo(camera.position) > ENEMY_FIRE_RANGE) continue;
        assistPoint.copy(e.pos).project(camera);
        /* Behind the camera, or off the picture. */
        if (assistPoint.z > 1 || Math.abs(assistPoint.x) > 1 || Math.abs(assistPoint.y) > 1) continue;
        const x = (assistPoint.x + 1) / 2, y = (1 - assistPoint.y) / 2;
        const d = Math.hypot((x - cursor.x) * aspect, y - cursor.y);
        if (d < ASSIST_REACH && (!best || d < best.d)) best = { x, y, d };
      }
    }
    /* Only once the thumb has settled: while it is steering, the hand owns the
       crosshair, and a magnet pulling against it reads as a stutter. */
    if (best && assist.magnet && performance.now() - movedCursorAt > ASSIST_WAIT) {
      const k = Math.min(1, dt * ASSIST_PULL);
      cursor.x += (best.x - cursor.x) * k;
      cursor.y += (best.y - cursor.y) * k;
      aimFromCursor();
    }
    const on = !!best && best.d < ASSIST_ON;
    if (on !== hud.onTarget) setHud({ onTarget: on });
    autoFiring = assist.autoFire && on;
    stick.firing = triggerHeld || autoFiring;
  }

  function frameGuns(dt: number, flight: Flight, camera: THREE.PerspectiveCamera, fx: Fx, res: FlightStep): THREE.Vector3 | null {
    const s = scratch;
    /* ---- guns ----
       Fired from the edges of the frame at eye level, converging on the
       crosshair, which is why the muzzles come from the camera's frustum
       rather than from a fixed offset. */
    /* ---- WHICH WAY THE GUNS POINT ----
       Every primary weapon fires through the crosshair, and while the
       crosshair is in the rear window the crosshair is BEHIND you, so
       they all fire backwards: the pulse gun, the mini gun and the
       beams alike. Only the pulse gun used to honour it, so a player
       with the mini gun or a beam armed pressed the trigger in the rear
       window and watched rounds leave the nose. Geoff, 2026-Sep-12:
       "The rear gun doesn't seem to work." */
    const rearAiming = rearOn && inRearWindow(cursor);
    if (rearAiming !== hud.rearAim) setHud({ rearAim: rearAiming });
    if (rearAiming) placeRearCamera(rearCamera, flight);
    const backwards = rearAiming ? rearAim(rearCamera, cursor) : null;

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
      /* ---- WHERE THE MINI GUN IS AIMED ----
         At the point under the crosshair, expressed from the SHIP, since
         that is where the server fires from. It used to send the muzzle
         as the position and the camera's own aim, so the server measured
         the convergence from a point already a couple of units up and
         out at the corner of the frame, and the stream landed up and to
         the right of the crosshair. Geoff, 2026-Sep-12. */
      if (backwards) {
        /* Out of the tail, down the rear window's own line. */
        const tail = tailOf(flight.pos, flight.fwd, SHIP_LENGTH);
        room?.fire("mini", tail, backwards, backwards, undefined, s.up);
        fx.muzzle(tail);
      } else {
        const mark = camera.position.clone().addScaledVector(aimDir, CONVERGE);
        room?.fire("mini", flight.pos, flight.fwd, mark.sub(flight.pos).normalize(), undefined, s.up);
        fx.muzzle(muzzle);
      }
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
        const from = backwards ? tailOf(flight.pos, flight.fwd, SHIP_LENGTH) : shipNose(flight);
        room?.fire("beam", from, backwards ?? flight.fwd, undefined, armed.key);
        fx.muzzle(from);
        playGunSound();
      }
    }

    if (res.fired && backwards) {
      /* ---- the rear gun ----
         Geoff: "fire from the two sides of the mini-screen and go
         towards wherever the mouse pointer is." So the muzzles are the
         edges of the REAR camera's frame, as the main guns are the edges
         of the main one, and the two streams cross on the crosshair's
         spot in the window. The room is given the rear camera's place
         (three units behind the ship, within its tolerance), the aim,
         and the ship's up. */
      const aim = backwards;
      const rearUp = new THREE.Vector3(0, 1, 0).applyQuaternion(rearCamera.quaternion);
      const muzzles: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
      gunMuzzles(rearCamera.position, aim, rearUp, rearCamera.fov, rearCamera.aspect, muzzles);
      room?.fire("main", rearCamera.position, aim, undefined, undefined, rearUp);
      fx.muzzle(muzzles[0]);
      fx.muzzle(muzzles[1]);
      playGunSound();
    } else if (res.fired) {
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
      room?.fire("main", flight.pos, flight.fwd, undefined, undefined, s.up);
      fx.muzzle(muzzles[0]);
      fx.muzzle(muzzles[1]);
      playGunSound();
    }

    return backwards;
  }
  /** The server's fight drawn here: enemies, rounds, streaks, torpedoes, wreckage, beams, loot, gauges, the wave and the crew. */
  function frameRoom(dt: number, flight: Flight, camera: THREE.PerspectiveCamera, inRoom: boolean): void {
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
    const tRoom = performance.now();
    if (inRoom && room) {
      room.step(dt);
      /* ---- NEVER SEND WHAT THE ROOM WILL REFUSE ----
         The room's world is Earth's neighbourhood and it rejects any coordinate
         past a hundred thousand outright, as "bad transform", with a strike
         against the seat; twenty strikes and the socket is closed. Spikeworld
         sits at two hundred thousand, so every report from there was a strike,
         and Geoff was kicked mid-flight: "it crashed at some point and said
         'refused bad transform'".

         Gated on the POSITION rather than on a flag, because a flag can be
         cleared by a path nobody thought of: backing out to the map while away
         cleared it and left the ship still two hundred thousand units out. The
         room's own bound cannot be got wrong. */
      if (flight.pos.length() <= R + MAX_ALT + 2) {
        room.report(flight.pos, flight.fwd, flight.guardFor > 0);
      }

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
            id: e.id, pos: e.pos, fwd: e.fwd, roll: 0,
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
          id: e.id, pos: e.pos, fwd: e.fwd, roll: 0,
          cls: e.dragon ? DRAGON_CLASS : TIERS[Math.max(0, Math.min(TIERS.length - 1, e.tier - 1))],
          ...(e.dragon ? { dragon: true as const, life: DRAGON_LIFE } : {}),
          shield: e.shield, vel: new THREE.Vector3(), tumble: new THREE.Vector3(),
          spin: new THREE.Vector3(), flash: 0, ammo: 0, reload: 0, fireAt: 0,
          weave: 0, weaveDir: 1, mode: "in", breakAt: 0, rejoinAt: 0,
          escape: new THREE.Vector3(0, 0, 1), passFor: 0, wave: 0,
        });
      }
      /* ---- THE ROUNDS ARE FLOWN HERE ----
         The room says what was fired and what stopped early; everything
         in between is this cockpit flying the same rounds with the same
         file the room uses. It used to be handed five hundred positions
         twenty times a second, which was two thirds of the wire. */
      for (const s of room.takeShots()) {
        showBullet(combat, {
          id: s.id, pos: s.pos, vel: s.vel, life: s.life,
          hostile: s.hostile, mini: s.mini,
          ...(s.orb ? { orb: true as const, phase: Math.random() * Math.PI * 2 } : {}),
        });
      }
      for (const id of room.takeSpent()) dropBullet(combat, id);
      stepShownBullets(combat, dt);
      /* Beams too: yours and everyone else's, drawn from the room's list
         so a beam is seen by the whole room and hits what the room says. */
      /* ---- streaks ----
         Every round in the air gets a line from where it was a fortieth
         of a second ago to where it is now. Rebuilt each tick from the
         wire rather than tracked, because the cockpit has no history of
         a round it did not fire and cannot recognise one from one tick
         to the next. */
      combat.tracers.length = 0;
      for (const b of combat.bullets) {
        combat.tracers.push({
          from: b.pos.clone().addScaledVector(b.vel, -STREAK_SECONDS),
          to: b.pos,
          life: TRACER_LIFE, hostile: b.hostile, mini: !!b.mini, live: true,
        });
      }
      combat.torpedoes.length = 0;
      for (const t of room.torpedoes) combat.torpedoes.push({ pos: t.pos, vel: t.vel, life: 1 });
      /* Wreckage is the room's too, and it is SOLID: a round that hits a
         piece is spent, so a cockpit that did not draw it watched shots
         disappear against nothing. */
      combat.junk.length = 0;
      for (const j of room.junk) {
        combat.junk.push({
          pos: j.pos, rot: j.rot, vel: _zero, spin: _zero,
          life: JUNK_LIFE, kind: j.kind as never,
        });
      }
      combat.beams.length = 0;
      for (const b of room.beams) combat.beams.push(b);
      /* Gems are the room's: drawn from its list, never simulated here.
         A private drop only ever arrives at its owner, so nothing here
         has to hide anything. */
      combat.gems.length = 0;
      for (const g of room.gems) {
        combat.gems.push({
          id: g.id, tier: g.tier, pos: g.pos, vel: new THREE.Vector3(), spin: g.spin, body: 0,
          ...(g.item ? { item: g.item, owner: g.owner, hidden: g.hidden } : {}),
        });
      }
      combat.coins.length = 0;
      for (const k of room.coins) {
        combat.coins.push({ pos: k.pos, vel: new THREE.Vector3(), spin: 0, value: 0 });
      }
      combat.events.push(...room.takeEvents().map((e) => ({
        kind: e.kind as never, at: e.at, power: e.power, who: e.who,
        tier: e.tier, shield: e.shield, damage: e.damage, wave: e.wave,
        guarded: e.guarded, item: e.item, id: e.id,
        /* Carried through, or a correction from the room would be
           dropped on the way to the handler that obeys it. */
        snap: (e as { snap?: true }).snap,
      })));

      /* ---- ANTI-CHEAT: THE GAUGES ARE THE ROOM'S ----
         Shield, ammo, torpedoes, guards, score and DIVI are all overwritten
         from the wire while connected. A cockpit that decided its own score
         is a cockpit that could be edited into deciding a better one, and
         the whole reason the room exists is that it settles those numbers
         where nobody can reach them. */
      const g = room.gauges;
      /* Not while a resupply is running: the gauges climb locally over
         the four seconds and the room refills at the end, so taking the
         room's numbers mid-way would pin them at empty until then.
         DAMAGE is the exception. Anything that takes the hull down while
         the animation is playing has to be shown, or a player can be
         shot to pieces behind a bar that reads full and only find out
         when they leave. */
      const docking = flight.dock > 0 && flight.dock < 1;
      const hurtWhileDocking = !!g && lastRoomShield >= 0 && g.shield < lastRoomShield - 0.5;
      if (g) lastRoomShield = g.shield;
      if (g && (!docking || hurtWhileDocking)) {
        flight.shields = g.shield;
        flight.ammo = g.ammo;
        flight.torpedoes = g.torps;
        flight.guards = g.guards;
        score = g.score;
        divi = g.divi;
        /* ---- THE SERVER DECIDES WHEN YOU ARE DEAD ----
           It holds the hull, so it is the only thing that can say. The
           cockpit used to work this out from its own copy inside the
           hit-event handler, which missed every death the handler did
           not see: flying into the planet, for one, whose damage the
           flight model works out and the server applies. */
        if (g.dead && !hud.dead) die();
        /* ---- THE COUNTDOWN RUNS LOCALLY ----
           The room sends whole seconds, so taking each message as the new
           deadline made the clock stutter and jump: at 2.4 seconds left it says
           3 and the clock is pushed back out to three, at 1.9 it says 2 and it
           is pushed back to two. Geoff: "the 30 second countdown froze for a
           while at 2 seconds left, then after 10 seconds or so it changed to 1
           second."

           So the deadline is set ONCE, when the room first says a wait is
           running, and after that the cockpit counts down on its own clock. A
           later message only moves it when the room disagrees by more than a
           second and a half, which is a real correction rather than rounding. */
        if (g.respawn > 0) {
          const asked = performance.now() + g.respawn * 1000;
          if (respawnAt <= performance.now() || Math.abs(asked - respawnAt) > 1500) {
            respawnAt = asked;
          }
        } else if (!g.dead) {
          /* Alive again: the wait is over whatever the clock says. */
          respawnAt = 0;
        }
      }
      /* ---- WHICH WAVE IT IS ----
         Read from the room's own state every tick rather than from the
         announcement, because an announcement can be missed. When the
         last player alive goes down the fight starts over at wave one,
         and that reset happens on a tick with nobody flying, whose
         events are cleared without being sent: the cockpit was never
         told, and went on showing the wave it died in. Geoff,
         2026-Sep-12: "instead of restarting the game like it should
         have, it went directly to Wave 2." */
      if (room.wave !== lastWaveSeen) {
        lastWaveSeen = room.wave;
        setHud(room.wave > 0
          ? { wave: room.wave, waveAt: performance.now() }
          : { wave: 0 });
      }
      /* Once. others() builds a fresh array each call. */
      const crew = room.others();
      if (peers) peers.draw(crew, camera);
      /* How many are in the WORLD, not how many are on screen. */
      setHud({ crew: room.crew() });
    } else if (peers) {
      peers.draw([], camera);
    }

    dflow.add("room", performance.now() - tRoom);
  }
  /** The stake bonus, and the torpedo: launched, detonated, or fired backwards. */
  function frameTorpedo(flight: Flight, res: FlightStep, backwards: THREE.Vector3 | null): void {
    /* ---- THE FIGHT IS THE SERVER'S ----
       Nothing here simulates it. There is one game and it runs in one
       place; the cockpit flies the ship, draws what it is told and asks
       for shots. This used to fall back to running the whole fight
       locally whenever the connection was not up, which meant two copies
       of every feature and, for anything hooked up to only one of them,
       a bug that appeared or vanished depending on the network: the
       tower resupply, torpedoes and the cheat keys all landed that way.
       Geoff, 2026-Sep-12: "there's only ONE game, and it's always
       multiplayer... There shouldn't be two different single or
       multiplayer game modes." */
    const tCombat = performance.now();
    tellBonus();

    /* One button does both jobs. If a torpedo is already in the air the
       press sets it off; otherwise it launches the next one. That is what
       "control-click again to detonate" means with a single control. */
    if (res.heavyPress && backwards) {
      /* A torpedo backwards, out of the tail. */
      if (flight.torpedoes > 0) {
        const aim = backwards;
        const tail = tailOf(flight.pos, flight.fwd, SHIP_LENGTH);
        room?.fire("torp", tail, aim);
        torpSentAt = performance.now();
        playTorpedoSound();
      }
    } else if (res.heavyPress) {
      const slot = weaponAt("secondary", weapons.secondary);
      if (slot && !slot.ready) {
        setHud({ note: `${slot.name}: not yet fitted`, noteAt: performance.now() });
      } else {
        /* ---- the torpedo is the server's ----
           It flies there and comes back on the wire to be drawn. Press
           once to launch, again while one of yours is still in the air to
           set it off. */
        const mineInAir = performance.now() - torpSentAt < TORPEDO_FUSE * 1000 && combat.torpedoes.length > 0;
        if (mineInAir) { room?.detonate(); torpSentAt = 0; }
        else if (flight.torpedoes > 0) {
          room?.fire("torp", shipModel && flight.view > 0.01 ? shipBelly(flight) : shipNose(flight), flight.fwd);
          torpSentAt = performance.now();
          playTorpedoSound();
        }
      }
    }

    dflow.add("combat", performance.now() - tCombat);
  }
  /** Everything that happened this tick: hits, kills, pickups, refusals, and what each looks and sounds like. */
  function frameEvents(flight: Flight, fx: Fx): void {
    const tEvents = performance.now();
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
        /* The flock kill itself is the server's: it is the only thing
           that sees every member and every shooter, and it arrives as its
           own event (flockDown), below. */
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
      } else if (ev.kind === "flockDown") {
        fx.boom(ev.at, 4, "hot");
        playTorpedoBlast();
        if (ev.who && room && ev.who === room.me()) {
          flocks += 1;
          setHud({ flocks, note: "FLOCK DOWN", noteAt: performance.now() });
        }
      } else if (ev.kind === "denied") {
        /* ---- WHERE THE ROOM SAYS YOU ARE ----
           Obeyed, not argued with. Ignoring it left the room's copy of
           the ship behind after any lag spike, and from then on every
           shot was refused for being fired from somewhere else: the guns
           simply stopped working. */
        if ((ev as { snap?: true }).snap && flight && !atSpikeworld) {
          flight.pos.copy(ev.at);
          flight.alt = flight.pos.length() - R;
        }
        /* ---- THE SERVER SAID NO ----
           And the cockpit used to say nothing at all: the refusal was
           turned into an event that nothing handled, so a resupply the
           server threw away still looked and sounded like a resupply.
           Geoff, 2026-Sep-12: "I didn't see any indication that the
           server was refusing the dock. It showed it as docked." Shown
           now, and written down, because this is exactly where a bug
           and a cheat look the same. */
        const why = ev.who ?? "";
        dflow.note(`refused: ${why}`);
        if (performance.now() - deniedAt > 2000) {
          deniedAt = performance.now();
          setHud({ note: `REFUSED: ${why.toUpperCase()}`, noteAt: performance.now() });
        }
      } else if (ev.kind === "wingHit") {
        fx.boom(ev.at, 0.9, "cold");
      } else if (ev.kind === "wingDown") {
        fx.boom(ev.at, 2.2, "hot");
        playShipExplosion(0.8);
        if (room && ev.who === room.me()) {
          setHud({ note: "DRONE DOWN", noteAt: performance.now() });
        }
      } else if (ev.kind === "dragon") {
        playTorpedoBlast();
        setHud({ note: "A DRAGON", noteAt: performance.now() });
      } else if (ev.kind === "dragonGone") {
        fx.boom(ev.at, 1.5, "cold");
      } else if (ev.kind === "drop") {
        /* Something fell out of the wreck. A glint; the thing itself is
           drawn from the gem list, and only its owner sees it. */
        if (!ev.who || (room && ev.who === room.me())) fx.boom(ev.at, 0.9, "cold");
      } else if (ev.kind === "gem") {
        fx.boom(ev.at, 1.2, "cold");
        playBounce();
        if (!ev.who || (room && ev.who === room.me())) {
          if (ev.item) {
            /* Into the inventory, SEALED: the player opens it there (I).
               Solo, this is the client's roll and the client's pickup; in
               a room, the room's, relayed. Either way the account row is
               what keeps it (watchLoadout). */
            addSphere(ev.item, 1);
            const spec = itemByKey(ev.item);
            setHud({ note: `T${spec?.tier ?? 1} SPHERE: OPEN IT IN YOUR INVENTORY (I)`, noteAt: performance.now() });
          } else {
            setHud({ note: `GEM: ${["yellow", "green", "blue", "purple", "red", "white", "fuchsia"][(ev.tier ?? 1) - 1] ?? ""}`, noteAt: performance.now() });
          }
        }
      } else if (ev.kind === "coinHit" || ev.kind === "gemHit") {
        fx.boom(ev.at, 0.5, "cold");
      } else if (ev.kind === "coin") {
        playCoin();
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
    dflow.add("events", performance.now() - tEvents);
  }
  /** Enemy hulls and the dragon, the thrust and dock sounds, every draw call, and the gauges. */
  function frameDrawAndGauges(dt: number, flight: Flight, camera: THREE.PerspectiveCamera, fx: Fx, scene: THREE.Scene): void {
    const s = scratch;
    const tMeshes = performance.now();
    /* ---- HULLS FOLLOW ENEMIES, NOT SLOTS ----
       A hull model used to belong to an INDEX in the enemy list. Every
       time one enemy died the ones after it shifted down a slot, the slot
       saw a different tier, threw its model away and cloned a fresh one
       from the prototype: seven meshes and three line sets per fighter,
       several fighters per death, every death. DFlow showed it: the
       meshes stage spiking to 22ms and a hundred stalls the report could
       only call "outside our code", which is the garbage collector
       sweeping up the clones. Now a model is keyed by the enemy's own id
       and follows it for life; a model whose enemy has gone is hidden
       and kept in a pool for the next of its tier. Nothing is cloned
       after the first wave of each tier. */
    seenEnemies.clear();
    for (const e of combat.enemies) {
      if (e.drone || e.dragon) continue;
      const id = e.id ?? -1;
      const tier = e.cls.tier;
      let slot = enemyRigs.get(id);
      if (slot && slot.tier !== tier) { releaseHull(slot); enemyRigs.delete(id); slot = undefined; }
      if (!slot) {
        const pool = hullPools.get(tier);
        const reused = pool && pool.length ? pool.pop()! : null;
        if (reused) {
          slot = reused;
        } else {
          const m = protos[tier - 1].clone(true);
          m.userData.tier = tier;
          m.scale.setScalar(ENEMY_SCALE);
          scene.add(m);
          enemyMeshes.push(m);
          const rig = makeShieldRig(0x66ccff);
          scene.add(rig.group);
          enemyShields.push(rig);
          slot = { mesh: m, rig, tier };
        }
        slot.mesh.visible = true;
        slot.rig.group.visible = true;
        enemyRigs.set(id, slot);
      }
      seenEnemies.add(id);
    }
    for (const [id, slot] of enemyRigs) {
      if (seenEnemies.has(id)) continue;
      releaseHull(slot);
      enemyRigs.delete(id);
    }
    /* The dragon, if it is here. */
    const dragon = combat.enemies.find((e) => e.dragon) ?? null;
    if (dragon) ensureDragonRig();
    if (dragonRig) {
      dragonRig.group.visible = !!dragon;
      if (dragon) {
        dragonRig.group.position.copy(dragon.pos);
        s.target.copy(dragon.pos).addScaledVector(dragon.fwd, 10);
        s.m4.lookAt(dragon.pos, s.target, dragon.pos.clone().normalize());
        dragonRig.group.quaternion.setFromRotationMatrix(s.m4);
        dragonRig.mixer.update(Math.min(0.1, dt));
      }
    }
    const nowS = performance.now() / 1000;
    for (const e of combat.enemies) {
      if (e.drone || e.dragon) continue;
      const slot = enemyRigs.get(e.id ?? -1);
      if (!slot) continue;
      const m = slot.mesh, rig = slot.rig;
      m.position.copy(e.pos);
      s.target.copy(e.pos).addScaledVector(e.fwd, 10);
      s.m4.lookAt(e.pos, s.target, e.pos.clone().normalize());
      m.quaternion.setFromRotationMatrix(s.m4);
      s.qBank.setFromEuler(new THREE.Euler(e.spin.x, e.spin.y, e.spin.z + e.roll));
      m.quaternion.multiply(s.qBank);
      rig.group.position.copy(e.pos);
      rig.setColour(e.cls.colour);
      rig.setLevel(e.shield, e.cls.shieldMax);
      rig.step(nowS, Math.min(1, e.flash / 0.6));
    }

    /* ---- the thrust ----
       Follows what the ship is DOING rather than what the key is doing.
       Holding shift with an empty boost tank, or while docked, or after
       being shot down, all move the ship not at all, and a roar with no
       acceleration behind it is worse than silence. */
    const thrusting = (stick.boosting || stick.superBoost) && flight.boost > 0
      && flight.dock <= 0 && !hud.dead;
    if (thrusting !== wasThrusting) {
      wasThrusting = thrusting;
      if (thrusting) startBoostSound(); else stopBoostSound();
    }
    /* Super boost: the same roar, faster and higher, for as long as TAB
       is held with fuel to burn. */
    if (thrusting) setBoostPitch(flight.superOn ? 1.35 : 1);
    if (flight.superOn !== hud.superBoost || flight.extras.superMult !== hud.superMult) {
      setHud({ superBoost: flight.superOn, superMult: flight.extras.superMult });
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

    dflow.add("meshes", performance.now() - tMeshes);
    dflow.time("draw.bullets", () => fx!.drawBullets(combat.bullets));
    dflow.time("draw.beams", () => fx!.drawBeams(combat.beams, BEAM_SECONDS));
    /* The swarm and its fire. Both are instanced, so the cost of drawing a
       hundred and forty spheres is the cost of drawing one. */
    /* Reused lists rather than two fresh arrays from filter() a frame. */
    droneList.length = 0;
    for (const e of combat.enemies) if (e.drone) droneList.push(e);
    orbList.length = 0;
    for (const b of combat.bullets) if (b.orb) orbList.push(b);
    dflow.time("draw.drones", () => fx!.drawDrones(droneList, nowS));
    dflow.time("draw.orbs", () => fx!.drawOrbs(orbList, nowS));
    dflow.time("draw.torps", () => fx!.drawTorpedoes(combat.torpedoes));
    dflow.time("draw.junk", () => fx!.drawJunk(combat.junk));
    dflow.time("draw.tracers", () => fx!.drawTracers(combat.tracers, TRACER_LIFE));
    dflow.time("draw.coins", () => fx!.drawCoins(combat.coins));
    dflow.time("draw.gems", () => { fx!.drawGems(combat.gems); fx!.drawDrops(combat.gems); });
    dflow.time("draw.wings", () => drawWings());
    const tDock = performance.now();
    /* The tether, drawn only while a resupply is running. */
    fx.drawDockLink(
      flight.dock > 0 ? flight.pos : null,
      flight.dock > 0 && flight.dockedAt >= 0 ? tipList[flight.dockedAt] ?? null : null,
      performance.now() / 1000,
    );
    dflow.add("draw.dock", performance.now() - tDock);
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
        bonus: (room?.gauges?.bonus ?? 0) > 0,
        docked: flight.dock >= 1,
        nearTower,
        dockBlock,
        respawnIn: Math.max(0, (respawnAt - performance.now()) / 1000),
      });
    }
  }

  function runFrame(dt: number) {
      if (!flight || !camera || !fx || !scene || protos.length === 0) return;
      try {
        if (phase === "approach" && frameApproach(dt, camera, fx)) return;
        if (phase === "dive" && frameDive(dt, flight, camera, fx)) return;
        frameAssist(dt, camera);
        const res = frameFlight(dt, flight, fx);
        /* Before the camera follows the ship, or a bounce would be seen a
           frame late and the view would dip into the rock and out again. */
        if (atSpikeworld) frameVoxelBounce(flight);
        frameShipAndCamera(dt, flight, camera);
        frameSpikeworld(camera);
        frameShield(flight, camera);
        frameSky(dt, flight);
        /* Whether the fight belongs to a room. Worked out before the guns,
           because it decides whether a trigger pull is a shot or a request. */
        const inRoom = !!room && room.status() === "live";
        const backwards = frameGuns(dt, flight, camera, fx, res);
        frameRoom(dt, flight, camera, inRoom);
        frameTorpedo(flight, res, backwards);
        frameEvents(flight, fx);
        frameDrawAndGauges(dt, flight, camera, fx, scene);
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
      if (!stopArmouryWatch) {
        /* A gun bought, a sphere opened or four things forged changes what
           this ship carries, and the server has to be told or it takes
           effect only on the next launch. */
        stopArmouryWatch = subscribeArmoury(() => {
          setHud({ points: spendable() });
          room?.gear(gearKeys(loadShip()).filter((k) => k !== "pulse"), shipReach, droneCounts());
        });
      }
      if (!stopLoadoutWatch) {
        stopLoadoutWatch = watchLoadout();
        void loadLoadoutRemote().then((moved) => { if (moved) setHud({ points: spendable() }); });
        /* The ships' names and fitted upgrades from the account, so a second
           machine or a cleared browser gets them back. */
        void pullFleet();
      }
      /* The dragon arrives long after the rest, so it gets its own warm: its
         skinned shader is a different program again, and the one time anybody
         meets a dragon is the worst moment to compile it. */
      /* How much is in the wallet, which is all the respawn ladder needs. Asked
         once and told to the room, because the room owns the countdown. */
      void (async () => {
        try {
          const held = await platform().money.walletDivi?.();
          if (typeof held === "number" && held > 0) {
            walletDivi = held;
            room?.gear(gearKeys(loadShip()).filter((k) => k !== "pulse"), shipReach, droneCounts(), held);
          }
        } catch { /* no wallet behind this door */ }
      })();
      void loadModel("rebels_dragon")
        .then((p) => { dragonProto = p; warmShaders(); })
        .catch((e) => dflow.note(`dragon model: ${String(e)}`));
      void fetchDropConfig().then((r) => {
        drops = r.config;
        combat.drops = r.config;
        dflow.note(`drops: ${r.live ? "live charts" : `default charts (${r.error ?? ""})`}`);
      });
      try {
        scene = api.scene;
        camera = api.camera;
        dom = api.dom;
        stats = api.stats ?? null;
        afterRender = api.afterRender ?? null;
        afterRender?.(null);
        compileScene = api.compile ?? null;
        rearOn = false;
        setHud({ rear: false, rearAim: false });
        /* The version is a build-time define; tests run without one. */
        const ver = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
        dflow.setLabel(`v${ver} · ${typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 60) : ""}`);

        /* Real tower tips off the real map. Docking lines up with the towers
           you can actually see, because they ARE those towers. */
        scaleTowers = api.scaleTowers;
        ipList = [...api.tips.keys()];
        tipList = ipList.map((ip) => api.tips.get(ip)!.clone());
        selfIp = api.selfIp ?? "";
        homeIndex = api.selfIp ? ipList.indexOf(api.selfIp) : -1;
        /* ---- ONE GAME ----
           The server runs the fight. It is joined the moment the map hands
           over its scene, not when LAUNCH is pressed, so the connection is
           up and settled before anybody flies. See the note on connectRoom.
        */
        connectRoom();

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
        /* The inventory can use an item while a flight is attached. */
        stopItemUser?.();
        stopItemUser = setItemUser((key) => useOneHeld(key));
        mandala = makeMandalaShield();
        scene.add(mandala.group);
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
          combat = freshCombat();
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

        /* The player's hands, plugged in by the door: keyboard and mouse in the
           app and on the web (platform/desktopInput.ts), touch on a phone
           later. The same handlers either way. A previous plug is pulled
           first so a second attach can never leave two sets listening. */
        stopInput?.();
        stopInput = platform().input.attach(dom, pilot);

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
        /* Last, with the whole game in the scene: build every shader while the
           launch card is still up, rather than one stall at a time in a
           fight. */
        warmShaders();
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
      dflow.frameStart(dt);
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
      /* Everything the collector wants to know about this frame. */
      dflow.counts({
        enemies: combat.enemies.length,
        drones: combat.enemies.reduce((n, e) => n + (e.drone ? 1 : 0), 0),
        bullets: combat.bullets.length, coins: combat.coins.length, gems: combat.gems.length,
        tracers: combat.tracers.length, junk: combat.junk.length, beams: combat.beams.length,
        torps: combat.torpedoes.length, peers: room ? room.others().length : 0,
        flocks: combat.flocks.length, meshes: enemyMeshes.length,
      });
      {
        const st = stats?.();
        if (st) dflow.render({ calls: st.calls, triangles: st.triangles, ratio: st.ratio, programs: st.programs ?? 0, geometries: st.geometries ?? 0, textures: st.textures ?? 0 });
      }
      dflow.room(roomStatus);
      dflow.frameEnd();
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
        dflow.audio((audioHealth() as { level: number }).level);
        /* ---- WHAT COUNTS AS "SOMETHING SHOULD BE AUDIBLE" ----
           Flying, and not mid-death-fade. It used to be whether the MUSIC
           reported itself playing, which is the one thing that cannot be
           relied on here: when the whole bus died the music died with it,
           `playing` went quiet, and the watchdog concluded that silence was
           expected and went to sleep for the rest of the session. The
           cockpit is never meant to be silent while a game is on. */
        lastWatch = watchAudio((flying || !!mus.playing) && !hud.dead, 2);
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
            crew: room ? room.crew() : 0,
            /* ---- WHAT THE COCKPIT HAS TO DRAW ----
               Not what the room has: what arrived and is in the lists the
               drawing reads. "I don't see any bullets" is otherwise
               indistinguishable from "nobody fired", and the two have very
               different causes. */
            drawing: {
              bullets: combat.bullets.length,
              beams: combat.beams.length,
              torps: combat.torpedoes.length,
              tracers: combat.tracers.length,
              coins: combat.coins.length,
              gems: combat.gems.length,
              junk: combat.junk.length,
              wings: room ? room.wings.length : 0,
              peers: room ? room.others().length : 0,
            },
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
      /* The map's compile belongs to the map's renderer and the scene it was
         handed; both go away here. */
      compileScene = null;
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
      stopInput?.();
      stopInput = null;
      if (typeof document !== "undefined") {
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
      if (scene && mandala) scene.remove(mandala.group);
      mandala?.dispose();
      mandala = null;
      /* Backing out to the map while away: bring the ship home and put the
         ceiling back, or the next attach reports from two hundred thousand
         units out and is struck for it. */
      if (atSpikeworld && flight) {
        flight.ceiling = undefined;
        if (farAtHome !== null && camera) {
          camera.far = farAtHome;
          camera.near = nearAtHome ?? camera.near;
          camera.updateProjectionMatrix();
        }
        flight.pos.copy(homeAgain.lengthSq() > 1 ? homeAgain : new THREE.Vector3(0, 0, R + 40));
        flight.alt = flight.pos.length() - R;
        flight.speed = 0;
      }
      stopItemUser?.();
      stopItemUser = null;
      farAtHome = null; nearAtHome = null;
      spikeworld?.dispose();
      spikeworld = null;
      atSpikeworld = false;
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
      enemyRigs.clear();
      hullPools.clear();
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
      dragonRig = null;
      wingRigs.clear();
      wingProtos.clear();
      if (!suspended) {
        combat = freshCombat();
        flight = null;
      }
      scene = null; camera = null; dom = null;
      setHud({ ready: false });
    },

    /** The live crosshair, 0..1 across the canvas. Read every frame by the HUD;
     *  putting it through React state would make aiming feel soggy. */
    cursor: () => cursor,
    onEscape(fn) { onEscape = fn; },
    panel: setPanelOpen,
    hud: () => hud,
    subscribe(fn) { listeners.add(fn); fn(hud); return () => { listeners.delete(fn); }; },
    launch() {
      /* No server, no game. There is one fight and it is not here. */
      if (!room || room.status() !== "live") {
        setHud({ note: "CONNECTING TO THE FIGHT", noteAt: performance.now() });
        return;
      }
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
      /* This is a real click, which is the only thing a webview will start
         audio from. Decoding began back at attach; this is what lets it be
         heard. */
      resumeAudio();
      primeGunSound();
      playGameplay();
      connectRoom();
      /* ---- THE FIGHT STARTS HERE, NOT AT ATTACH ----
         The socket has been up since the map handed over its scene, but the
         room only puts this seat in the fight now. Flying alone that also
         wipes the sky and starts at wave one, so pressing LAUNCH really is a
         new game rather than a return to the one that was running while the
         card was being read. */
      room.fly();
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
      if (!room || room.status() !== "live") {
        setHud({ note: "CONNECTING TO THE FIGHT", noteAt: performance.now() });
        return;
      }
      score = 0;
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
      stopArmouryWatch?.();
      stopArmouryWatch = null;
    },
  };
}
