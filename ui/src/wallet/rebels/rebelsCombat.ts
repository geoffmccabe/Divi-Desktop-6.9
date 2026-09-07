// Bullets and enemy fighters: the simulation half, with no THREE objects in it
// beyond vectors. Kept apart from the drawing so it can be tested in node, the
// same way the flight model is.

import * as THREE from "three";
import { R } from "./orbitWorld";

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
/** It keeps firing while the trigger is held, ten times a second. */
export const MINI_INTERVAL = 0.1;
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

const TIER_TOTAL = TIERS.reduce((a, t) => a + t.weight, 0);

/** Roll a tier. Weighted, so the rare ones stay rare. */
export function rollTier(): ShipClass {
  let r = Math.random() * TIER_TOTAL;
  for (const t of TIERS) {
    r -= t.weight;
    if (r <= 0) return t;
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
export const ENEMY_SPEED = 19;
export const ENEMY_TURN = 1.1;        /* radians per second of chase */
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
  /** From the mini gun: quarter damage, drawn smaller. */
  mini?: boolean;
  /** The line this round is drawing behind it. */
  tracer?: Tracer;
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
}

export interface CombatEvent {
  kind: "enemyDown" | "towerHit" | "playerHit" | "bulletSpent" | "torpedoBlast"
      | "enemyHit" | "junkGone" | "enemyShot";
  at: THREE.Vector3;
  /** How big a bang. 1 is a bullet strike, 3 is a fighter coming apart. */
  power: number;
  /** enemyHit only: what the shield is down to, 0..1 of its class maximum. */
  shield?: number;
  /** enemyHit only: damage actually landed, which is what scores. */
  damage?: number;
  /** enemyDown only: which of the seven it was. */
  tier?: number;
}

export interface CombatState {
  bullets: Bullet[];
  torpedoes: Torpedo[];
  enemies: Enemy[];
  junk: Junk[];
  tracers: Tracer[];
  events: CombatEvent[];
  kills: number;
  /** Kills this run, one count per tier, indexed from zero. */
  tierKills: number[];
  spawnAt: number;
}

export function createCombat(): CombatState {
  return {
    bullets: [], torpedoes: [], enemies: [], junk: [], tracers: [], events: [],
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
  });

  /* Shield through nought is the end of it. */
  if (e.shield <= 0) {
    breakUp(c, e);
    const i = c.enemies.indexOf(e);
    if (i >= 0) c.enemies.splice(i, 1);
    c.kills++;
    c.tierKills[e.cls.tier - 1] += 1;
    c.events.push({ kind: "enemyDown", at: e.pos.clone(), power: 3, tier: e.cls.tier });
  }
  return applied;
}

/** A dead fighter comes apart into its body and its two panels. */
function breakUp(c: CombatState, e: Enemy): void {
  const up = e.pos.clone().normalize();
  const right = new THREE.Vector3().crossVectors(e.fwd, up).normalize();
  const kinds: JunkKind[] = ["body", "wingL", "wingR"];
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
}

/** Launched straight down the middle, from between the guns. */
export function fireTorpedo(c: CombatState, pos: THREE.Vector3, fwd: THREE.Vector3): void {
  c.torpedoes.push({
    pos: pos.clone().addScaledVector(fwd, 1.5),
    vel: fwd.clone().multiplyScalar(TORPEDO_SPEED),
    life: TORPEDO_FUSE,
  });
}

/**
 * Blow one up where it is, damaging everything inside the blast.
 *
 * Area damage rather than a direct hit is the whole point of carrying one: a
 * bullet has to touch a fighter, a torpedo only has to be near a few.
 */
export function detonate(c: CombatState, t: Torpedo, w: CombatWorld): void {
  c.events.push({ kind: "torpedoBlast", at: t.pos.clone(), power: 6 });
  for (let i = c.enemies.length - 1; i >= 0; i--) {
    const e = c.enemies[i];
    if (e.pos.distanceTo(t.pos) > TORPEDO_BLAST) continue;
    /* Five lasers' worth, so a torpedo strips a full shield and the hull under
       it in one go. */
    hurtEnemy(c, e, LASER_MAX * TORPEDO_DAMAGE, t.pos);
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
export function detonateOldest(c: CombatState, w: CombatWorld): boolean {
  if (c.torpedoes.length === 0) return false;
  detonate(c, c.torpedoes[0], w);
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
): [THREE.Vector3, THREE.Vector3] {
  const m: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  gunMuzzles(pos, fwd, up, fovDeg, aspect, m);
  /* Both barrels are aimed at the same point down the middle, so the two
     streams cross where the crosshair is and anything under it is on the line. */
  const target = new THREE.Vector3().copy(pos).addScaledVector(fwd, CONVERGE);
  for (const muzzle of m) {
    const vel = target.clone().sub(muzzle).normalize().multiplyScalar(BULLET_SPEED);
    const b: Bullet = { pos: muzzle.clone(), vel, life: BULLET_LIFE, hostile: false };
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
  pos: THREE.Vector3,
  fwd: THREE.Vector3,
  up: THREE.Vector3,
  fovDeg: number,
  aspect: number,
  out: THREE.Vector3,
): void {
  const d = 2.2;
  const halfH = Math.tan((fovDeg * Math.PI) / 360) * d;
  const halfW = halfH * aspect;
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  out.copy(pos)
    .addScaledVector(fwd, d)
    .addScaledVector(right, halfW * 0.94)
    .addScaledVector(up, halfH * 0.86);
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
): void {
  const target = aimFrom.clone().addScaledVector(aimDir, CONVERGE);
  const vel = target.sub(muzzle).normalize().multiplyScalar(BULLET_SPEED * MINI_SPEED_MULT);
  const b: Bullet = { pos: muzzle.clone(), vel, life: BULLET_LIFE, hostile: false, mini: true };
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

export interface CombatWorld {
  /** Tower tips, straight off the map. */
  tips: THREE.Vector3[];
  playerPos: THREE.Vector3;
  playerFwd: THREE.Vector3;
  /** Difficulty, roughly how many fighters should be in the air. */
  wanted: number;
  /** Multiplies everything the player's guns do. Three for a minute after
   *  winning a stake on your node. */
  damageScale: number;
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
        if (!segmentHit(from, b.pos, e.pos, ENEMY_R)) continue;
        spent = true;
        const scale = (b.mini ? MINI_DAMAGE : 1) * w.damageScale;
        hurtEnemy(c, e, rollLaserDamage() * scale, from);
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
    } else if (segmentHit(from, b.pos, w.playerPos, 1.4)) {
      spent = true;
      c.events.push({
        kind: "playerHit", at: b.pos.clone(), power: 1.4, damage: rollLaserDamage(),
      });
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
      if (e.pos.distanceTo(j.pos) > ENEMY_R + JUNK_R) continue;
      struck = true;
      hurtEnemy(c, e, rollLaserDamage(), j.pos);
    }
    if (!struck && j.pos.distanceTo(w.playerPos) < 1.4 + JUNK_R) {
      struck = true;
      c.events.push({
        kind: "playerHit", at: j.pos.clone(), power: 1.6, damage: rollLaserDamage(),
      });
    }
    if (struck) {
      c.events.push({ kind: "junkGone", at: j.pos.clone(), power: 1.4 });
      c.junk.splice(i, 1);
    }
  }

  /* ---- fighters ---- */
  c.spawnAt -= dt;
  if (c.enemies.length < w.wanted && c.spawnAt <= 0) {
    c.spawnAt = 1.6 + Math.random() * 2.4;
    c.enemies.push(spawnNear(w.playerPos, w.playerFwd));
  }

  const toPlayer = new THREE.Vector3();
  const axis = new THREE.Vector3();
  for (let i = c.enemies.length - 1; i >= 0; i--) {
    const e = c.enemies[i];
    toPlayer.copy(w.playerPos).sub(e.pos);
    const range = toPlayer.length();
    toPlayer.normalize();

    /* Turn toward the player, but only so fast: a fighter that snapped onto
       your tail every frame would be unshakeable and no fun. */
    const dot = Math.max(-1, Math.min(1, e.fwd.dot(toPlayer)));
    const off = Math.acos(dot);
    if (off > 1e-3) {
      axis.crossVectors(e.fwd, toPlayer);
      if (axis.lengthSq() > 1e-9) {
        axis.normalize();
        /* They turn faster too, or a fast one would fly in a straight line
           past you and never come back. */
        e.fwd.applyAxisAngle(axis, Math.min(off, ENEMY_TURN * e.cls.speed * dt)).normalize();
      }
    }

    /* A slow sidestep so they do not fly in on rails. */
    e.weave -= dt;
    if (e.weave <= 0) { e.weave = 0.8 + Math.random(); e.weaveDir = Math.random() < 0.5 ? -1 : 1; }
    const up = e.pos.clone().normalize();
    e.fwd.applyAxisAngle(up, e.weaveDir * 0.5 * dt).normalize();
    e.roll += (e.weaveDir * 0.8 - e.roll) * Math.min(1, dt * 3);

    /* Break off rather than ram, then come round again. Rarer tiers fly
       faster, which is most of what makes them dangerous. */
    const speed = (range < 8 ? ENEMY_SPEED * 1.35 : ENEMY_SPEED) * e.cls.speed;
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
    if (e.fireAt <= 0 && e.ammo > 0 && range < ENEMY_FIRE_RANGE && dot > 0.9) {
      /* Slower than it was. Four of them at the old rate put up a wall of fire
         that could not be flown through, whatever the player's shield. */
      e.fireAt = 1.6 + Math.random() * 1.6;
      e.ammo -= 1;
      if (e.ammo <= 0) e.reload = ENEMY_RELOAD;
      /* Dead on target, every time. Dodging is the player's job, and a shot
         that misses by design would make that meaningless. */
      enemyFire(c, e, w.playerPos);
    }

    /* Wandered off. Let it go and let a fresh one spawn in front. */
    if (range > 320) c.enemies.splice(i, 1);
  }
}

function spawnNear(playerPos: THREE.Vector3, playerFwd: THREE.Vector3): Enemy {
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
  const cls = rollTier();
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
  };
}
