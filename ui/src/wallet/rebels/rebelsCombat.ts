// Bullets and enemy fighters: the simulation half, with no THREE objects in it
// beyond vectors. Kept apart from the drawing so it can be tested in node, the
// same way the flight model is.

import * as THREE from "three";
import { R, cruiseScale } from "./orbitWorld";
import {
  droneClass, newGroup, newFleetId, stepFlock, reslot, slotOffsets,
  FLEET_SIZE, DRONE_CAP, DRONE_R, DRONE_RELOAD, DRONE_BULLET_SPEED, DRONE_FIRE_RANGE,
  type FlockGroup,
} from "./rebelsFlock";

export const BULLET_SPEED = 120;      /* globe units per second */
export const BULLET_LIFE = 2.2;
export const BULLET_R = 0.16;         /* what it hits with */
export const CONVERGE = 55;           /* where the two guns cross, in units ahead */

/* ---- the mini gun ----
   A single fast round from the top right of the frame, aimed wherever the
   pointer is rather than down the ship's own axis. A quarter of the damage and
   a quarter of a round, so four of them cost what one shot from the main guns
   costs. */
export const MINI_DAMAGE = 0.25;
export const MINI_SPEED_MULT = 1.5;
export const MINI_AMMO = 0.25;
/** It keeps firing while the trigger is held, twenty times a second. */
export const MINI_INTERVAL = 0.05;
export const ENEMY_R = 1.05;          /* hit radius of a fighter */

/* ---- damage ----
   A hit is worth somewhere between ten and a hundred, so no two exchanges feel
   the same and a lucky burst can strip a fighter. Shields soak it first;
   whatever is left over goes into the hull, so the shot that finally breaks a
   shield still hurts rather than being wasted. */
export const LASER_MIN = 10;
export const LASER_MAX = 100;
/** Winning a stake on your node makes you hit three times as hard for a minute. */
export const STAKE_BONUS = 3;
export const STAKE_BONUS_MS = 60_000;

/** A ship class: everything that differs between the seven tiers. */
export interface ShipClass {
  /** 1..7. Also the index into the per-tier kill counts. */
  tier: number;
  name: string;
  /** The shield IS the ship's health. There is deliberately no second layer
   *  under it: a hull meant a fighter sat at nought percent still flying while
   *  another hundred damage went into something the player could not see, which
   *  read as shots not counting. Shield gone, ship gone. */
  shieldMax: number;
  /** Hull and panel colour, and the colour of its shield bubble. */
  colour: number;
  /** Multiplier on flying speed. */
  speed: number;
  /** Relative chance of a spawn being this one, before normalising. */
  weight: number;
}

/* ---- the seven ----
   Each tier is a fifth as likely as the one before it and thirty points of
   speed and shield stronger, so the rare ones are rare AND worth being
   frightened of. Geoff's figures: 80%, 16%, 2% and so on, which is a ratio of
   a fifth; and 100%, 130%, 160%, 190%, 220%, carried on to seven.

   Worth knowing before this gets tuned: a fifth each time makes tier seven
   about one spawn in twenty thousand. That is genuinely almost never. The
   weights are data, so softening it is one edit here. */
const TIER_COLOURS = [0x9aa3ad, 0x57e06a, 0x4fa8ff, 0xa96bff, 0xff4d4d, 0xf2f6ff, 0xff45d0];
const TIER_NAMES = ["Grey", "Green", "Blue", "Purple", "Red", "White", "Fuchsia"];

export const TIERS: ShipClass[] = TIER_COLOURS.map((colour, i) => ({
  tier: i + 1,
  name: TIER_NAMES[i],
  shieldMax: 100 + i * 30,
  colour,
  speed: 1 + i * 0.3,
  weight: 0.8 * Math.pow(0.2, i),
}));

/** The commonest one, and what anything unspecified means. */
export const FIGHTER: ShipClass = TIERS[0];

/**
 * Roll a tier. Weighted, so the rare ones stay rare.
 *
 * `bias` above one lifts every tier above the first, which is how one wave
 * comes out harder than another without sending more ships.
 */
export function rollTier(bias = 1): ShipClass {
  const weights = TIERS.map((t, i) => (i === 0 ? t.weight : t.weight * bias));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < TIERS.length; i++) {
    r -= weights[i];
    if (r <= 0) return TIERS[i];
  }
  return TIERS[0];
}

/** Knockback, as an impulse in units per second per point of damage. Taken
 *  literally, "knockback equal to the damage" would fling a fighter a sixth of
 *  the way round the planet; as an impulse it reads as a real thump. */
export const KNOCK_PER_DAMAGE = 0.26;
/** Radians per second of tumble per point of damage. Hit one harder, it spins
 *  faster. */
export const SPIN_PER_DAMAGE = 0.055;
/** How long a shield bubble stays visible after a hit. */
export const SHIELD_SHOW = 2.4;

/* ---- wreckage ----
   A dead fighter comes apart into its body and its two panels. Each piece is
   a real object under gravity: given enough sideways speed it orbits, and the
   drag term makes every orbit decay so the sky cannot silently fill with junk. */
export const JUNK_MAX = 60;
export const JUNK_LIFE = 120;
/** Chosen so a circular orbit just above the towers runs at about twenty units
 *  a second, which is roughly a fighter's cruising speed. */
export const GRAVITY_MU = 44_800;
/* Very low, and it has to be. The planet is a hundred units across and the
   wreckage orbits about fourteen above it, so losing even three percent of its
   speed drops the low point of the orbit onto the ground: at the first drag
   figure a piece was down in twelve seconds, which reads as falling, not
   orbiting. At this figure it goes round for the best part of a minute and then
   comes down, which is the thing that was asked for. */
export const JUNK_DRAG = 0.0008;
export const JUNK_R = 0.7;

/* ---- DIVI in orbit ----
   A destroyed fighter scatters coins. They are thrown out on the ship's own
   momentum and then fly under gravity, and they stay up there until somebody
   flies into them: anybody's kill can be anybody's pickup.

   The numbers here were worked out rather than picked, because the whole thing
   turns on being catchable. The player cruises at 16 units a second and boosts
   to 38. A coin in a circular orbit runs at sqrt(mu/r), so:

     mu = 44,800 (the wreckage's)  ->  20 u/s, once round in 36s
     mu = 60,000                  ->  23 u/s, once round in 29s   <- this
     mu = 403,200                 ->  60 u/s, once round in 11s, uncatchable

   Sixty thousand goes round quicker than the wreckage does while staying well
   under a boosting player, so a coin can be run down rather than merely watched.
   They also pull toward a player who gets close, because the spheres themselves
   are a tenth of a hull across and threading a needle that small at those speeds
   would not be a game. */
export const COIN_VALUE = 0.02;
/** Five a kill, which is a tenth of a DIVI: exactly the rate the payout uses. */
export const COIN_PER_KILL = 5;
export const COIN_MU = 60_000;
/** Radius of the sphere itself: a tenth of the fighter's hull ball. */
export const COIN_R = 0.031;
/** How close counts as collected, and how close before it starts coming to you. */
export const COIN_PICKUP = 2.2;
export const COIN_MAGNET = 11;
export const COIN_MAX = 400;

export interface Coin {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: number;
  value: number;
}
/* Halved along with the player's, so a dogfight plays exactly as it did while
   the world around it feels twice the size. */
export const ENEMY_SPEED = 9.5;
/* Radians a second of turn. THIS is the number that decides whether a fighter
   reads as a spaceship or as an insect: turn radius is speed divided by turn
   rate, so at 1.1 a fighter came round in eight units and could hold station on
   a player who was trying to shake it. At 0.6 it needs sixteen, which is wider
   than the range it shoots from — so it has to commit to an approach, take its
   shot, and go past. */
export const ENEMY_TURN = 0.6;
/** Below this height a fighter starts pulling up, hard. */
export const ENEMY_FLOOR = 25;
export const ENEMY_FIRE_RANGE = 70;
/** They carry the same magazine a player does, then have to break off and
 *  recharge, which is what gives you a breather rather than an endless stream. */
export const ENEMY_AMMO = 60;
export const ENEMY_RELOAD = 10;
/* The player's own shield lives in orbitFlight as MAX_SHIELD. It was declared
   here too and the two had already drifted apart, which is how a test came to
   measure a hundred-point shield against a game that gives a thousand. One
   number, one home. */
export const TOWER_HIT_R = 2.2;

/* ---- torpedoes ----
   Two per sortie, replenished only at your own tower. Slow enough to watch, and
   detonated either by a second control-click or by their own four-second fuse.
   Five times the damage of a bullet, over an area, which is what makes carrying
   only two a real decision. */
export const TORPEDO_MAX = 2;
export const TORPEDO_SPEED = 38;
export const TORPEDO_FUSE = 4;
export const TORPEDO_DAMAGE = 5;
/** Everything inside this radius takes the hit, not just what it touched. */
export const TORPEDO_BLAST = 11;

/* ---- tracers ----
   A round leaves a line behind it that stays for three seconds after the round
   itself is gone, then fades. This is not decoration: it is how a player works
   out that they are being shot at from behind or from the side, and where the
   shooter must be, in a game where the view only faces one way. */
/** How long before impact the cockpit calls out an incoming round. Half a
 *  second is enough to reach for the right button and not enough to ignore. */
export const WARN_LEAD = 0.5;
/** What a round has to come within to count as on course. */
export const PLAYER_HIT_R = 1.4;

export const TRACER_LIFE = 3;
export const TRACER_MAX = 220;

export interface Tracer {
  from: THREE.Vector3;
  to: THREE.Vector3;
  life: number;
  hostile: boolean;
  mini: boolean;
  /** The round still drawing it, if it is still flying. */
  live: boolean;
}

export interface Bullet {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  /** Whose it is. Enemy fire is drawn differently and hurts you, not them. */
  hostile: boolean;
  /**
   * Which player fired it. Empty in the solo game, where there is only one
   * possible answer.
   *
   * This is what makes scoring in a room safe. Points follow the round back to
   * the gun that fired it, so nobody can be credited for a kill they were not
   * near — and, just as importantly, nobody LOSES a kill to whoever happens to
   * be closest when the fighter comes apart.
   */
  owner?: string;
  /** From the mini gun: quarter damage, drawn smaller. */
  mini?: boolean;
  /** From a swarm drone: drawn as a pulsing red energy sphere rather than as a
   *  stretched bolt, and slower than an ordinary round. */
  orb?: boolean;
  /** Where in its pulse this one is, so a volley does not throb in unison. */
  phase?: number;
  /** The line this round is drawing behind it. */
  tracer?: Tracer;
  /** The cockpit has already called this one out. Once each, or a stream of
   *  fire would be one long tone. */
  warned?: boolean;
}

export interface Enemy {
  pos: THREE.Vector3;
  fwd: THREE.Vector3;
  roll: number;
  cls: ShipClass;
  shield: number;
  /** Knockback, decaying. Sits on top of ordinary flight. */
  vel: THREE.Vector3;
  /** Tumble from being hit: axis times radians per second, decaying. */
  tumble: THREE.Vector3;
  /** Accumulated rotation from that tumble, so it keeps spinning visually. */
  spin: THREE.Vector3;
  /** Seconds left showing the shield bubble. */
  flash: number;
  /** Rounds left, and seconds until the magazine is back. */
  ammo: number;
  reload: number;
  fireAt: number;
  /** Seconds left of the little sidestep that stops them flying in a line. */
  weave: number;
  weaveDir: number;
  /**
   * What this fighter is doing: closing for a pass, or breaking off after one.
   *
   * Without this they simply turned toward the player every frame for ever and
   * flew faster the closer they got, which is not a fighter, it is a wasp.
   * Geoff: "they are swarming around me like bugs and not moving like a
   * spaceship with a limited ability to turn... they need to make strafing runs
   * like a reasonable spaceship."
   */
  mode: "in" | "out";
  /** How close this one comes before it breaks off, and how far it goes before
   *  it turns back. Per fighter, so a flight of them does not move as one. */
  breakAt: number;
  rejoinAt: number;
  /** The heading it committed to when it broke off. Held, rather than
   *  recomputed, or "away" would curve back into the player. */
  escape: THREE.Vector3;
  /** Seconds left on this pass before it breaks off regardless. Stops a fighter
   *  that cannot get a firing solution from following you around all day. */
  passFor: number;
  /** Which wave sent it, so a wave can tell when it is finished. */
  wave: number;

  /* ---- swarm drones ----
     A drone is an Enemy with these filled in. It is deliberately the SAME
     record rather than a second kind of thing in a second list: every bullet
     test, every shield hit, every explosion and every piece of wreckage in
     this file then works on it without being told about it. Only the flying is
     different, and only the flying is branched on. */
  drone?: true;
  /** Which formation it flies in, and which fleet that came from. */
  group?: number;
  fleet?: number;
  /** Its place in the formation lattice. */
  slot?: number;
  /** Phase offset so a swarm does not pulse in unison. */
  pulse?: number;
  /** Conjured by the cheat key. Worth no DIVI and no score. */
  cheat?: boolean;
}

export type JunkKind = "body" | "wingL" | "wingR";

export interface Junk {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rot: THREE.Vector3;
  life: number;
  kind: JunkKind;
}

export interface Torpedo {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** Seconds left on the fuse. */
  life: number;
  /** Who launched it, so the blast scores to them. */
  owner?: string;
}

export interface CombatEvent {
  kind: "enemyDown" | "towerHit" | "playerHit" | "bulletSpent" | "torpedoBlast"
      | "enemyHit" | "junkGone" | "enemyShot" | "coin" | "coinLost" | "waveStart"
      | "incoming" | "blocked";
  at: THREE.Vector3;
  /** How big a bang. 1 is a bullet strike, 3 is a fighter coming apart. */
  power: number;
  /** enemyHit only: what the shield is down to, 0..1 of its class maximum. */
  shield?: number;
  /** enemyHit only: damage actually landed, which is what scores. */
  damage?: number;
  /** enemyDown only: which of the seven it was. */
  tier?: number;
  /** coin only: what it was worth. */
  value?: number;
  /** waveStart only: which wave. */
  wave?: number;
  /** Which ship this happened TO, or was done BY. Empty in the solo game,
   *  where there is only ever one answer. */
  who?: string;
  /** playerHit only: true when the guard was up and took the brunt. Decided
   *  here so that in a room it is decided by the server. */
  guarded?: boolean;
}

/* ---- waves ----
   Ten fighters in the first wave, spread over two minutes, then twelve, then
   fourteen. A wave ends when everything it sent is dead, OR when its two
   minutes are up and the next one comes in anyway. That second exit is what
   builds the sky up: fall behind and the leftovers of one wave are still
   hunting you when the next arrives.

   Waves are not all the same weight. Each one draws a bias that makes the rare
   tiers more or less likely, so some are visibly nastier than others without
   the count changing. */
export const WAVE_SECONDS = 120;
export const WAVE_FIRST = 10;
export const WAVE_STEP = 2;

export interface Wave {
  n: number;
  /** Still to send. */
  toSpawn: number;
  /** Seconds until the next one arrives. */
  nextAt: number;
  /** Seconds left in this wave's window. */
  timeLeft: number;
  /** Alive right now out of everything this wave sent. */
  alive: number;
  /** How much likelier the rare tiers are in this wave. 1 is ordinary. */
  bias: number;
}

export function waveSize(n: number): number {
  return WAVE_FIRST + (n - 1) * WAVE_STEP;
}

/** Begin a wave. Bias is rolled here, which is what makes some harder. */
export function startWave(c: CombatState, n: number): void {
  const count = waveSize(n);
  c.wave = {
    n,
    toSpawn: count,
    /* The first arrives almost at once, so a wave starting is something you
       see rather than something you wait for. */
    nextAt: 1.5,
    timeLeft: WAVE_SECONDS,
    alive: 0,
    bias: 0.5 + Math.random() * 2.5,
  };
  c.events.push({ kind: "waveStart", at: new THREE.Vector3(), power: 1, wave: n });
}

export interface CombatState {
  bullets: Bullet[];
  torpedoes: Torpedo[];
  enemies: Enemy[];
  junk: Junk[];
  coins: Coin[];
  tracers: Tracer[];
  events: CombatEvent[];
  /** The wave in progress, or null when nothing is being sent. */
  wave: Wave | null;
  /** Live swarm formations. Empty until a fleet is sent. */
  flocks: FlockGroup[];
  kills: number;
  /** Kills this run, one count per tier, indexed from zero. */
  tierKills: number[];
  spawnAt: number;
}

export function createCombat(): CombatState {
  return {
    bullets: [], torpedoes: [], enemies: [], junk: [], coins: [], tracers: [], events: [],
    wave: null, flocks: [],
    kills: 0, tierKills: TIERS.map(() => 0), spawnAt: 2,
  };
}

/** What one laser hit is worth. */
export function rollLaserDamage(): number {
  return LASER_MIN + Math.random() * (LASER_MAX - LASER_MIN);
}

/**
 * Put damage into a fighter: shields first, the remainder into the hull.
 *
 * Also does the knockback and the tumble, because they are the same event and
 * splitting them apart is how one of them ends up forgotten at a call site.
 */
export function hurtEnemy(
  c: CombatState,
  e: Enemy,
  amount: number,
  from: THREE.Vector3,
  by = "",
): number {
  const push = e.pos.clone().sub(from);
  if (push.lengthSq() < 1e-9) push.copy(e.fwd);
  push.normalize();
  e.vel.addScaledVector(push, amount * KNOCK_PER_DAMAGE);
  /* A random axis, so a fighter tumbles rather than pivoting neatly. */
  e.tumble.addScaledVector(new THREE.Vector3().randomDirection(), amount * SPIN_PER_DAMAGE);
  e.flash = SHIELD_SHOW;

  /* What is actually there to take. A shot for eighty into a fighter with ten
     left lands ten, not eighty, which is what stops points running ahead of the
     damage actually done. */
  const applied = Math.min(amount, Math.max(0, e.shield));
  e.shield -= amount;

  c.events.push({
    kind: "enemyHit", at: e.pos.clone(), power: Math.min(2, 0.4 + amount / 90),
    shield: Math.max(0, e.shield) / e.cls.shieldMax,
    damage: applied,
    who: by,
  });

  /* Shield through nought is the end of it. */
  if (e.shield <= 0) {
    breakUp(c, e);
    const i = c.enemies.indexOf(e);
    if (i >= 0) c.enemies.splice(i, 1);
    /* ---- ANTI-CHEAT ----
       A drone conjured out of nothing by the cheat key is worth nothing: no
       kill, no tier count, no DIVI. The key exists so a swarm can be LOOKED
       at, and a key that also minted currency would be the most obvious
       exploit in the game. The guard is here, at the one place a kill is
       recorded, rather than at the call sites, so a new way to kill something
       cannot quietly reopen it. */
    if (!e.cheat) {
      c.kills++;
      /* Drone tiers are their own scale and would otherwise land in the
         fighter tier buckets and inflate them. */
      if (!e.drone) c.tierKills[e.cls.tier - 1] += 1;
    }
    c.events.push({
      kind: "enemyDown", at: e.pos.clone(), power: e.drone ? 2 : 3,
      tier: e.cls.tier, who: by,
    });
  }
  return applied;
}

/** A dead fighter comes apart into its body and its two panels. */
function breakUp(c: CombatState, e: Enemy): void {
  const up = e.pos.clone().normalize();
  const right = new THREE.Vector3().crossVectors(e.fwd, up).normalize();
  /* A drone is a ball, so it comes apart into three lumps rather than into a
     fuselage and two wings. Wings shed by something with no wings on it was
     the sort of detail that gets noticed immediately. */
  const kinds: JunkKind[] = e.drone
    ? ["body", "body", "body"]
    : ["body", "wingL", "wingR"];
  const offs = [0, -1, 1];
  for (let i = 0; i < 3; i++) {
    /* Each piece leaves with the fighter's own motion plus a shove outward, so
       the three of them separate instead of travelling as a clump. */
    const vel = e.fwd.clone().multiplyScalar(ENEMY_SPEED * 0.7)
      .add(e.vel)
      .addScaledVector(right, offs[i] * (6 + Math.random() * 8))
      .addScaledVector(up, (Math.random() - 0.3) * 7);
    /* A piece can come out almost stationary: the knockback from the killing
       shot points back down the fighter's own line of flight and the two
       cancel. It then drops straight down instead of orbiting, which is not
       wreckage, it is a stone. Give every piece a floor. */
    if (vel.lengthSq() < 1) vel.copy(up).addScaledVector(right, offs[i] || 1);
    if (vel.length() < 11) vel.setLength(11);
    c.junk.push({
      pos: e.pos.clone().addScaledVector(right, offs[i] * 0.9),
      vel,
      spin: new THREE.Vector3().randomDirection().multiplyScalar(1.5 + Math.random() * 5),
      rot: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      life: JUNK_LIFE,
      kind: kinds[i],
    });
  }
  /* Oldest out first, so a long fight cannot fill the sky. */
  while (c.junk.length > JUNK_MAX) c.junk.shift();

  if (!e.cheat) scatterCoins(c, e);
}

/**
 * The DIVI a fighter was carrying, thrown clear.
 *
 * Each coin leaves on the ship's own momentum, in its own direction, and is
 * then put into an orbit rather than left to whatever that momentum happened to
 * be. That is a deliberate compromise: keeping the raw speed would send most of
 * them straight into the planet within seconds, and the point of these is that
 * they stay up until somebody comes for them. The DIRECTION is the ship's, the
 * speed is what will hold an orbit at that height.
 */
function scatterCoins(c: CombatState, e: Enemy): void {
  const up = e.pos.clone().normalize();
  for (let i = 0; i < COIN_PER_KILL; i++) {
    /* Thrown outward in a spread around the fighter's own heading. */
    const dir = e.fwd.clone()
      .addScaledVector(e.vel.clone().normalize(), 0.4)
      .add(new THREE.Vector3().randomDirection().multiplyScalar(0.7))
      .normalize();
    /* Flatten it against local up, then set it to orbital speed for this
       altitude, with a little variation so they spread out over time instead of
       travelling as a clump for ever. */
    const tangent = dir.addScaledVector(up, -dir.dot(up));
    if (tangent.lengthSq() < 1e-6) tangent.copy(e.fwd);
    tangent.normalize();
    /* Speed is worked out from where the coin actually STARTS, and never below
       circular. Below it the orbit becomes an ellipse whose low point is under
       the ground, and the coin is in the planet within a minute: three in five
       were being lost that way. At or a little above circular, the starting
       height is the LOWEST the orbit ever gets. */
    const at = e.pos.clone().addScaledVector(up, (Math.random() - 0.5) * 1.5);
    const r = at.length();
    const speed = Math.sqrt(COIN_MU / r) * (1 + Math.random() * 0.06);
    c.coins.push({
      pos: at,
      vel: tangent.multiplyScalar(speed),
      spin: Math.random() * Math.PI * 2,
      value: COIN_VALUE,
    });
  }
  /* They stay up until collected, so the only limit is a ceiling on how many
     the sky may hold. Oldest go first. */
  while (c.coins.length > COIN_MAX) c.coins.shift();
}

/** Launched straight down the middle, from between the guns. */
export function fireTorpedo(c: CombatState, pos: THREE.Vector3, fwd: THREE.Vector3, owner = ""): void {
  c.torpedoes.push({
    pos: pos.clone().addScaledVector(fwd, 1.5),
    vel: fwd.clone().multiplyScalar(TORPEDO_SPEED),
    life: TORPEDO_FUSE,
    owner,
  });
}

/**
 * Blow one up where it is, damaging everything inside the blast.
 *
 * Area damage rather than a direct hit is the whole point of carrying one: a
 * bullet has to touch a fighter, a torpedo only has to be near a few.
 */
export function detonate(c: CombatState, t: Torpedo, w: CombatWorld): void {
  c.events.push({ kind: "torpedoBlast", at: t.pos.clone(), power: 6, who: t.owner ?? "" });
  for (let i = c.enemies.length - 1; i >= 0; i--) {
    const e = c.enemies[i];
    if (e.pos.distanceTo(t.pos) > TORPEDO_BLAST) continue;
    /* Five lasers' worth, so a torpedo strips a full shield and the hull under
       it in one go. */
    hurtEnemy(c, e, LASER_MAX * TORPEDO_DAMAGE, t.pos, t.owner ?? "");
  }
  for (const tip of w.tips) {
    if (tip.distanceTo(t.pos) <= TORPEDO_BLAST) {
      c.events.push({ kind: "towerHit", at: tip.clone(), power: 2 });
    }
  }
  const i = c.torpedoes.indexOf(t);
  if (i >= 0) c.torpedoes.splice(i, 1);
}

/** Set off the one that has been in the air longest. Returns whether there was
 *  one to set off, which is what tells the caller to launch instead. */
export function detonateOldest(c: CombatState, w: CombatWorld, owner = ""): boolean {
  /* In a room you may only set off your OWN. Otherwise the first player to
     press the key would detonate somebody else's run of torpedoes. */
  const i = owner ? c.torpedoes.findIndex((t) => t.owner === owner) : 0;
  if (i < 0 || c.torpedoes.length === 0) return false;
  detonate(c, c.torpedoes[i], w);
  return true;
}

/**
 * Where the two guns sit, and which way they point.
 *
 * They are placed on the edges of the view rather than at some arbitrary offset
 * from the ship, because in a cockpit there is no ship to hang them off: what
 * the player sees is fire arriving from the left and right of the screen at eye
 * level and meeting where they are aiming. So the muzzles are computed from the
 * camera's own frustum, which is what makes them land exactly on the edges at
 * any window size.
 */
export function gunMuzzles(
  pos: THREE.Vector3,
  fwd: THREE.Vector3,
  up: THREE.Vector3,
  fovDeg: number,
  aspect: number,
  out: [THREE.Vector3, THREE.Vector3],
): void {
  const d = 2.2;
  const halfH = Math.tan((fovDeg * Math.PI) / 360) * d;
  const halfW = halfH * aspect;
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  const centre = new THREE.Vector3().copy(pos).addScaledVector(fwd, d);
  out[0].copy(centre).addScaledVector(right, -halfW * 0.96);
  out[1].copy(centre).addScaledVector(right, halfW * 0.96);
}

export function fireGuns(
  c: CombatState,
  pos: THREE.Vector3,
  fwd: THREE.Vector3,
  up: THREE.Vector3,
  fovDeg: number,
  aspect: number,
  owner = "",
  /**
   * Where the barrels are, when the caller knows better.
   *
   * From the cockpit they are worked out from the camera's frustum, because
   * there is no ship on screen and fire arriving from the edges of the frame IS
   * the ship. In third person there is a hull, and fire that appears beside the
   * camera rather than at its nose reads as broken, so the caller passes the
   * nose instead. Either way the bullets are made HERE, so tracers, ownership
   * and lifetimes cannot drift apart between the two.
   */
  at?: [THREE.Vector3, THREE.Vector3],
): [THREE.Vector3, THREE.Vector3] {
  const m: [THREE.Vector3, THREE.Vector3] = at ?? [new THREE.Vector3(), new THREE.Vector3()];
  if (!at) gunMuzzles(pos, fwd, up, fovDeg, aspect, m);
  /* Both barrels are aimed at the same point down the middle, so the two
     streams cross where the crosshair is and anything under it is on the line. */
  const target = new THREE.Vector3().copy(pos).addScaledVector(fwd, CONVERGE);
  for (const muzzle of m) {
    const vel = target.clone().sub(muzzle).normalize().multiplyScalar(BULLET_SPEED);
    const b: Bullet = { pos: muzzle.clone(), vel, life: BULLET_LIFE, hostile: false, owner };
    c.bullets.push(b);
    addTracer(c, b);
  }
  return m;
}

/**
 * The mini gun's muzzle: the top right of the frame.
 *
 * Same idea as the main guns, from the camera's own frustum, so it sits on the
 * corner whatever the window size.
 */
export function miniMuzzle(
  camPos: THREE.Vector3,
  camFwd: THREE.Vector3,
  camRight: THREE.Vector3,
  camUp: THREE.Vector3,
  fovDeg: number,
  aspect: number,
  out: THREE.Vector3,
  at?: THREE.Vector3,
): void {
  /* Third person: out of the ship's nose, because there is a ship on screen
     and fire that starts anywhere else reads as broken. */
  if (at) { out.copy(at); return; }

  /* ---- THE CORNER OF THE SCREEN ----
     Measured in the CAMERA's own frame, not the ship's.

     These used to be the ship's own forward and up, which is the same thing
     only in the cockpit and only while flying level. In third person the
     camera sits metres behind the ship, so a corner offset sized for a viewer
     at the ship subtends a far smaller angle from where the camera actually
     is, and the muzzle landed near the middle of the frame instead: Geoff,
     "the minigun shots are going from the cursor". And even in the cockpit the
     camera is rolled by the bank and thrown by a hit, so "up" for the ship and
     "up" for the screen are not the same vector during exactly the manoeuvres
     anyone would be shooting through. */
  const d = 2.2;
  const halfH = Math.tan((fovDeg * Math.PI) / 360) * d;
  const halfW = halfH * aspect;
  out.copy(camPos)
    .addScaledVector(camFwd, d)
    .addScaledVector(camRight, halfW * 0.94)
    .addScaledVector(camUp, halfH * 0.86);
}

/**
 * Fire the mini gun along a given aim ray.
 *
 * `aimFrom` and `aimDir` are the line the POINTER is on, which is not the
 * ship's axis: that is the whole difference between this and the main guns.
 * The round leaves the corner and crosses that line, so what is under the
 * crosshair is what gets hit.
 */
export function fireMini(
  c: CombatState,
  muzzle: THREE.Vector3,
  aimFrom: THREE.Vector3,
  aimDir: THREE.Vector3,
  owner = "",
): void {
  const target = aimFrom.clone().addScaledVector(aimDir, CONVERGE);
  const vel = target.sub(muzzle).normalize().multiplyScalar(BULLET_SPEED * MINI_SPEED_MULT);
  const b: Bullet = { pos: muzzle.clone(), vel, life: BULLET_LIFE, hostile: false, mini: true, owner };
  c.bullets.push(b);
  addTracer(c, b);
}

export function enemyFire(c: CombatState, e: Enemy, at: THREE.Vector3): void {
  const vel = at.clone().sub(e.pos).normalize().multiplyScalar(BULLET_SPEED * 0.6);
  const b: Bullet = {
    pos: e.pos.clone().addScaledVector(vel, 0.02), vel, life: BULLET_LIFE * 1.4, hostile: true,
  };
  c.bullets.push(b);
  addTracer(c, b);
  /* Reported so it can be HEARD where it happened. A shot from behind is the
     only warning a player gets that something is on their tail. */
  c.events.push({ kind: "enemyShot", at: e.pos.clone(), power: 1 });
}

/* ---- the swarm ----
   A drone fires one round every thirty seconds and no more. That is the whole
   balance of the thing: twenty-four of them still put up a round every second
   and a bit between them, so a fleet overhead is a steady patter of fire from
   all directions, but no single sphere can ever pin you. */
export function droneFire(c: CombatState, e: Enemy, at: THREE.Vector3): void {
  const vel = at.clone().sub(e.pos).normalize()
    .multiplyScalar(BULLET_SPEED * DRONE_BULLET_SPEED);
  const b: Bullet = {
    pos: e.pos.clone().addScaledVector(vel, 0.02), vel,
    /* Slower rounds need longer to cover the same ground, or they would wink
       out short of a player they were aimed squarely at. */
    life: BULLET_LIFE * 1.9, hostile: true, orb: true,
    phase: Math.random() * Math.PI * 2,
  };
  c.bullets.push(b);
  addTracer(c, b);
  c.events.push({ kind: "enemyShot", at: e.pos.clone(), power: 1 });
}

/**
 * Send a fleet in.
 *
 * They arrive as ONE body, well out, and travel in together. The split
 * happens later and on its own, when the formation gets close enough that a
 * player can see it happen.
 */
export function spawnFleet(
  c: CombatState,
  tier: number,
  playerPos: THREE.Vector3,
  playerFwd: THREE.Vector3,
  opts: { count?: number; cheat?: boolean } = {},
): Enemy[] {
  const cls = droneClass(tier);
  const room = Math.max(0, DRONE_CAP - c.enemies.filter((e) => e.drone).length);
  const count = Math.min(opts.count ?? FLEET_SIZE, room);
  if (count <= 0) return [];

  /* Out in front and off to one side, far enough away to be a shape on the
     sky rather than something that appeared in your lap. Ahead of the player
     on purpose: a fleet that spawns behind you is a fleet you never see
     arrive, and arriving is most of what this is for. */
  const up = playerPos.clone().normalize();
  const side = new THREE.Vector3().crossVectors(playerFwd, up).normalize();
  const at = playerPos.clone()
    .addScaledVector(playerFwd, 300)
    .addScaledVector(side, (Math.random() - 0.5) * 160)
    .addScaledVector(up, 40 + Math.random() * 90);
  /* Never inside the planet, and never below the height they would instantly
     have to climb out of. */
  if (at.length() < R + 60) at.normalize().multiplyScalar(R + 60);

  const heading = playerPos.clone().sub(at).normalize();
  const fleet = newFleetId();
  const g = newGroup(fleet, cls.tier, at, heading);
  c.flocks.push(g);

  const slots = slotOffsets(count);
  const right = new THREE.Vector3().crossVectors(heading, at.clone().normalize()).normalize();
  const realUp = new THREE.Vector3().crossVectors(right, heading).normalize();

  const made: Enemy[] = [];
  for (let i = 0; i < count; i++) {
    const off = slots[i];
    const pos = at.clone()
      .addScaledVector(right, off.x)
      .addScaledVector(realUp, off.y)
      .addScaledVector(heading, off.z);
    const e: Enemy = {
      pos,
      fwd: heading.clone(),
      roll: 0,
      cls: { ...cls, weight: 0 } as ShipClass,
      shield: cls.shieldMax,
      vel: new THREE.Vector3(),
      tumble: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      flash: 0,
      ammo: 1,
      reload: 0,
      /* Staggered, so the first shots do not all arrive together. */
      fireAt: Math.random() * DRONE_RELOAD,
      weave: 0,
      weaveDir: 1,
      mode: "in",
      breakAt: 0,
      rejoinAt: 0,
      escape: heading.clone(),
      passFor: 0,
      wave: 0,
      drone: true,
      group: g.id,
      fleet,
      slot: i,
      pulse: Math.random() * Math.PI * 2,
      cheat: opts.cheat,
    };
    c.enemies.push(e);
    made.push(e);
  }
  g.alive = made.length;
  return made;
}

/** Start a round's trail. Called wherever a bullet is created. */
function addTracer(c: CombatState, b: Bullet): void {
  const t: Tracer = {
    from: b.pos.clone(), to: b.pos.clone(),
    life: TRACER_LIFE, hostile: b.hostile, mini: !!b.mini, live: true,
  };
  b.tracer = t;
  c.tracers.push(t);
  /* Oldest out first. A long fight would otherwise draw every shot ever
     fired. */
  while (c.tracers.length > TRACER_MAX) c.tracers.shift();
}

/** Closest approach of a moving point to a target over one step. Bullets travel
 *  two units a frame and fighters are one across, so testing only the endpoints
 *  would let shots pass straight through. */
function segmentHit(from: THREE.Vector3, to: THREE.Vector3, target: THREE.Vector3, radius: number): boolean {
  const ab = to.clone().sub(from);
  const len2 = ab.lengthSq();
  if (len2 < 1e-12) return from.distanceTo(target) < radius;
  let t = target.clone().sub(from).dot(ab) / len2;
  t = Math.max(0, Math.min(1, t));
  return from.clone().addScaledVector(ab, t).distanceTo(target) < radius;
}

/** One flyable ship in the fight, as far as the simulation cares. */
export interface PlayerBody {
  /** Empty in the solo game. In a room it is the seat this ship belongs to,
   *  and it rides on every event the ship causes or suffers. */
  id: string;
  pos: THREE.Vector3;
  fwd: THREE.Vector3;
  /** Guard up right now. Checked HERE rather than by whoever reads the events,
   *  so a client cannot decide for itself that it blocked something. */
  guard?: boolean;
  /**
   * The hull's own shape, as a chain of spheres already placed in the world.
   *
   * Absent in the cockpit, where there is no visible ship and a single radius
   * around the camera is both fair and all anyone can judge. Present in third
   * person, where the player can SEE the hull and expects a round that passes a
   * wingtip to miss it. Fitted from the model's real geometry — see
   * shipCollider.ts for why a chain of spheres rather than the triangles.
   */
  hull?: Array<{ at: THREE.Vector3; r: number }>;
}

export interface CombatWorld {
  /** Tower tips, straight off the map. */
  tips: THREE.Vector3[];
  playerPos: THREE.Vector3;
  playerFwd: THREE.Vector3;
  /**
   * Everyone in the fight, when a room is running it.
   *
   * The solo game leaves this out and the pair of fields above are the whole
   * roster. That is deliberate: ONE simulation serves both, so the server and
   * the client cannot drift apart in the way that quietly ruins these games —
   * two implementations of the same fight always end up disagreeing about who
   * shot whom, and the disagreement always favours whoever is lying.
   */
  players?: PlayerBody[];
  /** Multiplies everything the player's guns do. Three for a minute after
   *  winning a stake on your node. */
  damageScale: number;
}

/* The roster, with the solo case folded in. Reused rather than rebuilt, since
   this is called several times per frame. */
const _solo: PlayerBody[] = [{ id: "", pos: new THREE.Vector3(), fwd: new THREE.Vector3() }];
function roster(w: CombatWorld): PlayerBody[] {
  if (w.players && w.players.length > 0) return w.players;
  _solo[0].pos = w.playerPos;
  _solo[0].fwd = w.playerFwd;
  return _solo;
}

/**
 * Did this round hit that ship?
 *
 * One sphere at the camera when there is no visible hull, and the fitted chain
 * when there is. Both are a segment test rather than a point test, because a
 * bullet moves two units in a frame and a ship is one across: checking only
 * where it ENDED UP would let it pass clean through.
 */
function hitsPlayer(from: THREE.Vector3, to: THREE.Vector3, pl: PlayerBody): boolean {
  const hull = pl.hull;
  if (!hull || hull.length === 0) return segmentHit(from, to, pl.pos, PLAYER_HIT_R);
  for (const s of hull) if (segmentHit(from, to, s.at, s.r)) return true;
  return false;
}

/** Whoever is closest to a point. Fighters chase them and coins drift to them. */
function nearestPlayer(w: CombatWorld, to: THREE.Vector3): PlayerBody {
  const all = roster(w);
  let best = all[0];
  let bestD = Infinity;
  for (const p of all) {
    const d = p.pos.distanceToSquared(to);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/**
 * Throw away events that have been dealt with.
 *
 * The caller clears, NOT stepCombat. It used to clear its own list on entry,
 * which quietly ate anything raised between two steps: setting off a torpedo
 * pushed its explosion and the next step wiped it before the renderer looked,
 * so torpedoes vanished without a bang. Ownership sits with the reader now, so
 * the order of calls cannot break it again.
 */
/** Scratch for the per-group head count. Module level so a frame allocates no
 *  map of its own. */
const headCount = new Map<number, number>();

export function clearEvents(c: CombatState): void {
  c.events.length = 0;
}

export function stepCombat(c: CombatState, dt: number, w: CombatWorld): void {

  /* ---- bullets ---- */
  for (let i = c.bullets.length - 1; i >= 0; i--) {
    const b = c.bullets[i];
    const from = b.pos.clone();
    b.pos.addScaledVector(b.vel, dt);
    b.life -= dt;
    /* The trail grows with the round and stops where it stopped. */
    if (b.tracer) b.tracer.to.copy(b.pos);
    let spent = false;

    if (!b.hostile) {
      for (let j = c.enemies.length - 1; j >= 0 && !spent; j--) {
        const e = c.enemies[j];
        if (!segmentHit(from, b.pos, e.pos, e.drone ? DRONE_R : ENEMY_R)) continue;
        spent = true;
        const scale = (b.mini ? MINI_DAMAGE : 1) * w.damageScale;
        hurtEnemy(c, e, rollLaserDamage() * scale, from, b.owner ?? "");
      }
      /* Wreckage is solid: shoot a piece and it goes. */
      for (let j = c.junk.length - 1; j >= 0 && !spent; j--) {
        if (!segmentHit(from, b.pos, c.junk[j].pos, JUNK_R)) continue;
        spent = true;
        c.events.push({ kind: "junkGone", at: c.junk[j].pos.clone(), power: 1.4 });
        c.junk.splice(j, 1);
      }
      for (let j = 0; j < w.tips.length && !spent; j++) {
        if (!segmentHit(from, b.pos, w.tips[j], TOWER_HIT_R)) continue;
        spent = true;
        /* The tower is a real node on a real map, so it is not destroyed. It
           takes the hit and throws a bang, which is what the player wanted to
           see and costs the map nothing. */
        c.events.push({ kind: "towerHit", at: b.pos.clone(), power: 2 });
      }
    } else {
      /* Against EVERY ship in the fight, not just the one holding the camera.
         In a room this is the only place a player takes damage, and it is the
         server's copy of this loop that decides it. */
      for (const pl of roster(w)) {
        if (!hitsPlayer(from, b.pos, pl)) continue;
        spent = true;
        c.events.push({
          kind: "playerHit", at: b.pos.clone(), power: 1.4, damage: rollLaserDamage(),
          who: pl.id, guarded: !!pl.guard,
        });
        break;
      }
    }

    /* Is this one going to hit? A straight ray against the player: where in
       the round's next half second does it come closest, and is that close
       enough to matter. The player's own motion is left out because a round
       travels four times faster than the ship, so it barely changes the answer
       and including it would mean calling out shots a turn has already dealt
       with. Once per round, or a stream of fire becomes one long tone. */
    if (!spent && b.hostile && !b.warned) {
      const speed2 = b.vel.lengthSq();
      if (speed2 > 1e-9) {
        for (const pl of roster(w)) {
          const rel = pl.pos.clone().sub(b.pos);
          const t = Math.max(0, Math.min(WARN_LEAD, rel.dot(b.vel) / speed2));
          const miss = rel.addScaledVector(b.vel, -t).length();
          if (miss < PLAYER_HIT_R && t > 0 && t <= WARN_LEAD) {
            b.warned = true;
            /* Only the ship it is aimed at hears it. Everybody's warnings going
               off in everybody's cockpit would be one long tone. */
            c.events.push({ kind: "incoming", at: b.pos.clone(), power: 1, who: pl.id });
            break;
          }
        }
      }
    }

    /* Into the planet. */
    if (!spent && b.pos.length() < R) {
      spent = true;
      c.events.push({ kind: "bulletSpent", at: b.pos.clone(), power: 1 });
    }
    if (spent || b.life <= 0) {
      if (b.tracer) b.tracer.live = false;
      c.bullets.splice(i, 1);
    }
  }

  /* ---- torpedoes ----
     They fly on until the fuse runs out or the player sets them off, and they
     go off against the planet rather than sinking into it. */
  for (let i = c.torpedoes.length - 1; i >= 0; i--) {
    const t = c.torpedoes[i];
    t.pos.addScaledVector(t.vel, dt);
    t.life -= dt;
    if (t.life <= 0 || t.pos.length() < R) {
      detonate(c, t, w);
    }
  }

  /* ---- trails ----
     They only start counting down once their round has finished flying, so a
     long shot leaves its line for three seconds after it lands rather than
     three seconds after it was fired. */
  for (let i = c.tracers.length - 1; i >= 0; i--) {
    const t = c.tracers[i];
    if (t.live) continue;
    t.life -= dt;
    if (t.life <= 0) c.tracers.splice(i, 1);
  }

  /* ---- DIVI ----
     Gravity, no drag: these are meant to stay up. A coin near the player is
     drawn toward them, which is what makes something a tenth of a hull across
     collectable at orbital speed. */
  for (let i = c.coins.length - 1; i >= 0; i--) {
    const k = c.coins[i];
    const r2 = k.pos.lengthSq();
    const r = Math.sqrt(r2);
    k.vel.addScaledVector(k.pos, -(COIN_MU / (r2 * r)) * dt);

    /* Coins go to whoever is nearest, so in a room they are worth racing for. */
    const claimant = nearestPlayer(w, k.pos);
    const toPlayer = claimant.pos.clone().sub(k.pos);
    const range = toPlayer.length();
    if (range < COIN_MAGNET) {
      /* Stronger the closer it gets, so the last stretch is certain. */
      const pull = (1 - range / COIN_MAGNET) ** 2 * 140;
      k.vel.addScaledVector(toPlayer.normalize(), pull * dt);
    }

    k.pos.addScaledVector(k.vel, dt);
    k.spin += dt * 2.2;

    if (range < COIN_PICKUP) {
      c.events.push({ kind: "coin", at: k.pos.clone(), power: 0.4, value: k.value, who: claimant.id });
      c.coins.splice(i, 1);
      continue;
    }
    /* Into the planet: gone, like anything else that falls. */
    if (r < R) {
      c.events.push({ kind: "coinLost", at: k.pos.clone(), power: 0.3 });
      c.coins.splice(i, 1);
    }
  }

  /* ---- wreckage ----
     Real orbits: gravity pulls each piece toward the centre, so one thrown
     sideways fast enough keeps going round, and a slow one falls. The drag term
     is what guarantees every orbit eventually decays, which is the difference
     between space junk and a permanent leak. */
  for (let i = c.junk.length - 1; i >= 0; i--) {
    const j = c.junk[i];
    const r2 = j.pos.lengthSq();
    const r = Math.sqrt(r2);
    const g = GRAVITY_MU / (r2 * r);
    j.vel.addScaledVector(j.pos, -g * dt);
    j.vel.multiplyScalar(1 - Math.min(0.5, JUNK_DRAG * dt));
    j.pos.addScaledVector(j.vel, dt);
    j.rot.addScaledVector(j.spin, dt);
    j.life -= dt;

    /* Down, burned up, or simply old. */
    if (j.life <= 0 || r < R) {
      c.events.push({ kind: "junkGone", at: j.pos.clone(), power: r < R ? 1.6 : 0.6 });
      c.junk.splice(i, 1);
      continue;
    }

    /* It is as dangerous as a laser to anything it meets. */
    let struck = false;
    for (let k = c.enemies.length - 1; k >= 0 && !struck; k--) {
      const e = c.enemies[k];
      if (e.pos.distanceTo(j.pos) > (e.drone ? DRONE_R : ENEMY_R) + JUNK_R) continue;
      struck = true;
      hurtEnemy(c, e, rollLaserDamage(), j.pos);
    }
    for (const pl of roster(w)) {
      if (struck) break;
      if (!hitsPlayer(j.pos, j.pos, pl) && j.pos.distanceTo(pl.pos) > 1.4 + JUNK_R) continue;
      struck = true;
      c.events.push({
        kind: "playerHit", at: j.pos.clone(), power: 1.6, damage: rollLaserDamage(),
        who: pl.id, guarded: !!pl.guard,
      });
    }
    if (struck) {
      c.events.push({ kind: "junkGone", at: j.pos.clone(), power: 1.4 });
      c.junk.splice(i, 1);
    }
  }

  /* ---- waves ----
     Spawns are spread across the wave's window rather than arriving together,
     so a wave is a rising tide rather than a wall. */
  const wave = c.wave;
  if (wave) {
    wave.timeLeft -= dt;
    if (wave.toSpawn > 0) {
      wave.nextAt -= dt;
      if (wave.nextAt <= 0) {
        /* In front of SOMEBODY, picked at random, so a room's fighters do
           not all pile onto whoever happens to be first in the list. With one
           player there is nothing to pick, and drawing anyway would consume a
           random number and shift every later roll — which is enough to turn a
           seeded test into a different fight. */
        const all = roster(w);
        const mark = all.length > 1 ? all[Math.floor(Math.random() * all.length)] : all[0];
        const e = spawnNear(mark.pos, mark.fwd, wave.bias);
        e.wave = wave.n;
        c.enemies.push(e);
        wave.toSpawn -= 1;
        wave.alive += 1;
        /* Evenly across whatever is left of the window, with a little jitter so
           they do not arrive on a metronome. */
        const spread = Math.max(2, wave.timeLeft) / Math.max(1, wave.toSpawn);
        wave.nextAt = spread * (0.6 + Math.random() * 0.8);
      }
    }
    wave.alive = c.enemies.filter((e) => e.wave === wave.n).length;
    /* Over when everything it sent is dead, or when its time is simply up and
       the next one starts on top of the leftovers. */
    const cleared = wave.toSpawn === 0 && wave.alive === 0;
    if (cleared || wave.timeLeft <= 0) startWave(c, wave.n + 1);
  }

  const toPlayer = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const _want = new THREE.Vector3();
  for (let i = c.enemies.length - 1; i >= 0; i--) {
    const e = c.enemies[i];
    /* Drones are flown by the flock, below. They share this list so that every
       bullet, shield and explosion in this file works on them unchanged, but
       nothing about how a fighter flies applies to a sphere in formation. */
    if (e.drone) continue;
    /* Each fighter hunts whoever is closest to it, re-checked every frame, so
       flying past a dogfight pulls some of it onto you. */
    const prey = nearestPlayer(w, e.pos);
    toPlayer.copy(prey.pos).sub(e.pos);
    const range = toPlayer.length();
    toPlayer.normalize();

    /* ---- STRAFING RUNS ----
       A fighter makes a pass and leaves. It does not hover.

       Closing: turn toward the player at a limited rate and fly. Once it is
       close, or once the pass has gone on long enough, it commits to a heading
       AWAY and holds it — held rather than recomputed each frame, or "away"
       curves gently back into the player and the whole thing becomes an orbit
       again. When it is far enough out it turns and comes back.

       The turn rate is the number that decides whether this reads as a
       spaceship. At this speed a fighter needs about sixteen units to come
       round, so it cannot pivot on the spot to stay on your tail: it has to
       commit to an approach, take its shot, and go past. */
    const dot = Math.max(-1, Math.min(1, e.fwd.dot(toPlayer)));

    e.passFor -= dt;
    if (e.mode === "in" && (range < e.breakAt || e.passFor <= 0)) {
      e.mode = "out";
      /* STRAIGHT ON, and off to one side.
         The fighter is a few units short of the player and pointed at them, so
         simply holding its heading carries it through the merge and out the far
         side, which is what a pass IS. The first version subtracted a bit of
         "toward the player" from the heading to make it fly away — but at the
         merge the heading already IS toward the player, so taking a third of it
         off left the fighter still pointed at them. It flew past, curved back,
         and never got far enough away to come round again: one pass in three
         minutes, and the rest of it loitering. */
      e.escape.copy(e.fwd).addScaledVector(
        axis.copy(e.fwd).cross(e.pos).normalize(), (Math.random() - 0.5) * 0.8);
      e.escape.normalize();
    } else if (e.mode === "out" && range > e.rejoinAt) {
      e.mode = "in";
      e.passFor = 7 + Math.random() * 5;
      e.breakAt = 9 + Math.random() * 9;
      e.rejoinAt = 55 + Math.random() * 45;
    }

    const want = _want.copy(e.mode === "in" ? toPlayer : e.escape);

    /* ---- PULL UP ----
       Fighters had no idea the planet was there. One that broke off downward
       flew into the surface, was clamped to it by the floor below, and then slid
       around underneath the player at a fixed distance for ever — which in a
       test read as a fighter that made one pass and then loitered at 39 units
       and never came back, and in the game would read as an enemy stuck in the
       ground. Below about twenty-five units the wanted heading is bent outward,
       hard enough at the bottom to overcome anything else it wants to do. */
    const altE = e.pos.length() - R;
    if (altE < ENEMY_FLOOR) {
      want.addScaledVector(e.pos.clone().normalize(), (1 - altE / ENEMY_FLOOR) * 2.2);
      want.normalize();
    }

    const off = Math.acos(Math.max(-1, Math.min(1, e.fwd.dot(want))));
    if (off > 1e-3) {
      axis.crossVectors(e.fwd, want);
      /* THE HALF-TURN TRAP.
         A fighter pointed exactly opposite to where it wants to go has no
         defined axis to turn about: the cross product of two antiparallel
         vectors is zero, so the turn was skipped and it flew on for ever. That
         is not a corner case here, it is where a fighter ENDS UP — one that
         broke off downward reached the floor pointing straight down, wanted to
         go straight up, and was pinned there sliding around under the player at
         a fixed range for the rest of the run. Any perpendicular will do to
         start it turning; a moment later the two are no longer opposed and the
         real axis takes over. */
      if (axis.lengthSq() < 1e-9) {
        axis.set(1, 0, 0).cross(e.fwd);
        if (axis.lengthSq() < 1e-9) axis.set(0, 1, 0).cross(e.fwd);
      }
      axis.normalize();
      e.fwd.applyAxisAngle(axis, Math.min(off, ENEMY_TURN * e.cls.speed * dt)).normalize();
    }

    /* A slow sidestep on the way in, so an approach is not a straight line to
       shoot down. Nothing on the way out: a fighter running for distance flies
       straight, which is also what makes it a target worth chasing. */
    if (e.mode === "in") {
      e.weave -= dt;
      if (e.weave <= 0) { e.weave = 0.8 + Math.random(); e.weaveDir = Math.random() < 0.5 ? -1 : 1; }
      const up = e.pos.clone().normalize();
      e.fwd.applyAxisAngle(up, e.weaveDir * 0.35 * dt).normalize();
    }
    e.roll += ((e.mode === "in" ? e.weaveDir * 0.8 : 0) - e.roll) * Math.min(1, dt * 3);

    /* Break off rather than ram, then come round again. Rarer tiers fly
       faster, which is most of what makes them dangerous.

       AND THEY GET OPEN SPACE TOO. The player's cruise is multiplied out among
       the planets so the sky is crossable; leaving the fighters on their old
       nineteen units a second meant that above about two hundred units the
       player simply outran every one of them, and ten seconds later they were
       culled for being too far away. With free flight the ship climbs past that
       height on its own within seconds, so the sky quietly emptied itself.
       Geoff: "there also seem to be no enemies... they aren't chasing me."
       Symmetry fixes it: whatever the player gets out there, so do they. */
    const open = cruiseScale(e.pos.length() - R);
    /* One speed. It used to fly HALF AGAIN AS FAST inside eight units, which is
       precisely how a fighter turns into a gnat: the closer it got the harder
       it was to shake. A fighter that is quicker in close is a fighter that
       never leaves. */
    const speed = ENEMY_SPEED * e.cls.speed * open;
    e.pos.addScaledVector(e.fwd, speed * dt);
    /* Knockback rides on top and bleeds off, so a hit shoves them visibly
       without taking their flying away for long. */
    e.pos.addScaledVector(e.vel, dt);
    e.vel.multiplyScalar(1 - Math.min(1, dt * 2.2));
    /* The tumble from being hit keeps turning them and slowly settles. */
    e.spin.addScaledVector(e.tumble, dt);
    e.tumble.multiplyScalar(1 - Math.min(1, dt * 0.9));
    e.flash = Math.max(0, e.flash - dt);
    /* Never inside the planet. */
    const alt = e.pos.length();
    if (alt < R + 1.5) e.pos.normalize().multiplyScalar(R + 1.5);

    /* Out of rounds: break off for ten seconds, then come back loaded. */
    if (e.ammo <= 0) {
      e.reload -= dt;
      if (e.reload <= 0) e.ammo = ENEMY_AMMO;
    }
    e.fireAt -= dt;
    if (e.mode === "in" && e.fireAt <= 0 && e.ammo > 0
        && range < ENEMY_FIRE_RANGE * open && dot > 0.9) {
      /* Slower than it was. Four of them at the old rate put up a wall of fire
         that could not be flown through, whatever the player's shield. */
      e.fireAt = 1.6 + Math.random() * 1.6;
      e.ammo -= 1;
      if (e.ammo <= 0) e.reload = ENEMY_RELOAD;
      /* Dead on target, every time. Dodging is the player's job, and a shot
         that misses by design would make that meaningless. */
      enemyFire(c, e, prey.pos);
    }

    /* Wandered off. Let it go and let a fresh one spawn in front. The range
       scales with open space as well, or at deep-space speeds a fighter would
       be out of the world within a few seconds of a turn. */
    if (range > 320 * open) c.enemies.splice(i, 1);
  }

  /* ---- the swarm ----
     Flown as groups rather than as individuals, in its own file. Everything
     above this point has already had its say about damage, wreckage and
     collisions; all that is left is where they go. */
  if (c.flocks.length) {
    const drones = c.enemies.filter((e) => e.drone) as (Enemy & { group: number; slot: number })[];
    stepFlock(c.flocks, drones, dt, { playerPos: w.playerPos, scale: cruiseScale });

    for (let i = drones.length - 1; i >= 0; i--) {
      const d = drones[i];
      const prey = nearestPlayer(w, d.pos);
      const gap = d.pos.distanceTo(prey.pos);
      const open = cruiseScale(d.pos.length() - R);

      /* One round, then thirty seconds of nothing. stepFlock already counted
         the clock down; this only decides whether the shot is taken. */
      if (d.fireAt <= 0 && gap < DRONE_FIRE_RANGE * open) {
        d.fireAt = DRONE_RELOAD;
        droneFire(c, d, prey.pos);
      }

      /* Gone for good. A whole fleet that has run off is a whole fleet still
         being simulated, so the leash matters more here than for a fighter. */
      if (gap > 900 * open) {
        const k = c.enemies.indexOf(d);
        if (k >= 0) c.enemies.splice(k, 1);
      }
    }

    /* Membership changed under them, so slots are handed out again: a group
       down to four should fly as a tight diamond, not as four survivors
       holding four scattered places out of a twenty-four point lattice.

       Counted first and only rebuilt for the groups that actually changed. A
       death is rare and a frame is not, so the common case does no work and
       allocates nothing. */
    for (const g of c.flocks) headCount.set(g.id, 0);
    for (const d of drones) {
      const had = headCount.get(d.group);
      if (had !== undefined) headCount.set(d.group, had + 1);
    }
    for (let i = c.flocks.length - 1; i >= 0; i--) {
      const g = c.flocks[i];
      const now = headCount.get(g.id) ?? 0;
      if (now === 0) { c.flocks.splice(i, 1); continue; }
      if (now !== g.alive) reslot(drones.filter((d) => d.group === g.id));
      g.alive = now;
    }
    headCount.clear();
  }
}

function spawnNear(playerPos: THREE.Vector3, playerFwd: THREE.Vector3, bias = 1): Enemy {
  const up = playerPos.clone().normalize();
  const right = new THREE.Vector3().crossVectors(playerFwd, up).normalize();
  /* Ahead and off to one side, high enough to be seen against the sky rather
     than lost against the surface. */
  const ahead = 70 + Math.random() * 60;
  const side = (Math.random() - 0.5) * 90;
  const lift = 6 + Math.random() * 14;
  const pos = playerPos.clone()
    .addScaledVector(playerFwd, ahead)
    .addScaledVector(right, side)
    .addScaledVector(up, lift);
  if (pos.length() < R + 3) pos.normalize().multiplyScalar(R + 3);
  const fwd = playerPos.clone().sub(pos).normalize();
  const cls = rollTier(bias);
  return {
    pos, fwd, roll: 0,
    cls,
    shield: cls.shieldMax,
    vel: new THREE.Vector3(),
    tumble: new THREE.Vector3(),
    spin: new THREE.Vector3(),
    flash: 0,
    ammo: ENEMY_AMMO,
    reload: 0,
    fireAt: 0.8 + Math.random() * 1.4,
    weave: 1, weaveDir: 1,
    /* Comes in on a pass. The three distances are drawn per fighter so a flight
       of them arrives as a flight rather than as one shape moving together. */
    mode: "in" as const,
    breakAt: 9 + Math.random() * 9,
    rejoinAt: 55 + Math.random() * 45,
    escape: new THREE.Vector3(),
    passFor: 7 + Math.random() * 5,
    wave: 0,
  };
}
