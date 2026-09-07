// Bullets and enemy fighters: the simulation half, with no THREE objects in it
// beyond vectors. Kept apart from the drawing so it can be tested in node, the
// same way the flight model is.

import * as THREE from "three";
import { R } from "./orbitWorld";

export const BULLET_SPEED = 120;      /* globe units per second */
export const BULLET_LIFE = 2.2;
export const BULLET_R = 0.16;         /* what it hits with */
export const CONVERGE = 55;           /* where the two guns cross, in units ahead */
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

/** A ship class. Only one exists today, but shield capacity and colour live
 *  here so a tougher or differently-coloured ship later is a data change. */
export interface ShipClass {
  shieldMax: number;
  hullMax: number;
  /** Shown on the shield bubble. Room for future ships to differ. */
  colour: number;
}
export const FIGHTER: ShipClass = { shieldMax: 100, hullMax: 100, colour: 0x66ccff };

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
export const TOWER_HIT_R = 2.2;

/* ---- torpedoes ----
   Two per sortie, replenished only at your own tower. Slow enough to watch, and
   detonated either by a second control-click or by their own four-second fuse.
   Five times the damage of a bullet, over an area, which is what makes carrying
   only two a real decision. */
export const TORPEDO_MAX = 2;
export const TORPEDO_SPEED = 52;
export const TORPEDO_FUSE = 4;
export const TORPEDO_DAMAGE = 5;
/** Everything inside this radius takes the hit, not just what it touched. */
export const TORPEDO_BLAST = 11;

export interface Bullet {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  /** Whose it is. Enemy fire is drawn differently and hurts you, not them. */
  hostile: boolean;
}

export interface Enemy {
  pos: THREE.Vector3;
  fwd: THREE.Vector3;
  roll: number;
  cls: ShipClass;
  shield: number;
  hull: number;
  /** Knockback, decaying. Sits on top of ordinary flight. */
  vel: THREE.Vector3;
  /** Tumble from being hit: axis times radians per second, decaying. */
  tumble: THREE.Vector3;
  /** Accumulated rotation from that tumble, so it keeps spinning visually. */
  spin: THREE.Vector3;
  /** Seconds left showing the shield bubble. */
  flash: number;
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
      | "enemyHit" | "junkGone";
  at: THREE.Vector3;
  /** How big a bang. 1 is a bullet strike, 3 is a fighter coming apart. */
  power: number;
  /** enemyHit only: what the shield is down to, 0..1 of its class maximum. */
  shield?: number;
}

export interface CombatState {
  bullets: Bullet[];
  torpedoes: Torpedo[];
  enemies: Enemy[];
  junk: Junk[];
  events: CombatEvent[];
  kills: number;
  spawnAt: number;
}

export function createCombat(): CombatState {
  return { bullets: [], torpedoes: [], enemies: [], junk: [], events: [], kills: 0, spawnAt: 2 };
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
): boolean {
  const push = e.pos.clone().sub(from);
  if (push.lengthSq() < 1e-9) push.copy(e.fwd);
  push.normalize();
  e.vel.addScaledVector(push, amount * KNOCK_PER_DAMAGE);
  /* A random axis, so a fighter tumbles rather than pivoting neatly. */
  e.tumble.addScaledVector(new THREE.Vector3().randomDirection(), amount * SPIN_PER_DAMAGE);
  e.flash = SHIELD_SHOW;

  const soaked = Math.min(e.shield, amount);
  e.shield -= soaked;
  const through = amount - soaked;
  /* Once the shield is gone even a single point gets through. */
  if (through > 0) e.hull -= through;

  c.events.push({
    kind: "enemyHit", at: e.pos.clone(), power: Math.min(2, 0.4 + amount / 90),
    shield: e.shield / e.cls.shieldMax,
  });

  if (e.hull <= 0) {
    breakUp(c, e);
    const i = c.enemies.indexOf(e);
    if (i >= 0) c.enemies.splice(i, 1);
    c.kills++;
    c.events.push({ kind: "enemyDown", at: e.pos.clone(), power: 3 });
    return true;
  }
  return false;
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
    c.bullets.push({ pos: muzzle.clone(), vel, life: BULLET_LIFE, hostile: false });
  }
  return m;
}

export function enemyFire(c: CombatState, e: Enemy, at: THREE.Vector3): void {
  const vel = at.clone().sub(e.pos).normalize().multiplyScalar(BULLET_SPEED * 0.6);
  c.bullets.push({ pos: e.pos.clone().addScaledVector(vel, 0.02), vel, life: BULLET_LIFE * 1.4, hostile: true });
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

export function stepCombat(c: CombatState, dt: number, w: CombatWorld): void {
  c.events.length = 0;

  /* ---- bullets ---- */
  for (let i = c.bullets.length - 1; i >= 0; i--) {
    const b = c.bullets[i];
    const from = b.pos.clone();
    b.pos.addScaledVector(b.vel, dt);
    b.life -= dt;
    let spent = false;

    if (!b.hostile) {
      for (let j = c.enemies.length - 1; j >= 0 && !spent; j--) {
        const e = c.enemies[j];
        if (!segmentHit(from, b.pos, e.pos, ENEMY_R)) continue;
        spent = true;
        hurtEnemy(c, e, rollLaserDamage() * w.damageScale, from);
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
      c.events.push({ kind: "playerHit", at: b.pos.clone(), power: 1.4 });
    }

    /* Into the planet. */
    if (!spent && b.pos.length() < R) {
      spent = true;
      c.events.push({ kind: "bulletSpent", at: b.pos.clone(), power: 1 });
    }
    if (spent || b.life <= 0) c.bullets.splice(i, 1);
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
      c.events.push({ kind: "playerHit", at: j.pos.clone(), power: 1.6 });
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
        e.fwd.applyAxisAngle(axis, Math.min(off, ENEMY_TURN * dt)).normalize();
      }
    }

    /* A slow sidestep so they do not fly in on rails. */
    e.weave -= dt;
    if (e.weave <= 0) { e.weave = 0.8 + Math.random(); e.weaveDir = Math.random() < 0.5 ? -1 : 1; }
    const up = e.pos.clone().normalize();
    e.fwd.applyAxisAngle(up, e.weaveDir * 0.5 * dt).normalize();
    e.roll += (e.weaveDir * 0.8 - e.roll) * Math.min(1, dt * 3);

    /* Break off rather than ram, then come round again. */
    const speed = range < 8 ? ENEMY_SPEED * 1.35 : ENEMY_SPEED;
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

    e.fireAt -= dt;
    if (e.fireAt <= 0 && range < ENEMY_FIRE_RANGE && dot > 0.9) {
      e.fireAt = 1.1 + Math.random() * 1.6;
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
  return {
    pos, fwd, roll: 0,
    cls: FIGHTER,
    shield: FIGHTER.shieldMax,
    hull: FIGHTER.hullMax,
    vel: new THREE.Vector3(),
    tumble: new THREE.Vector3(),
    spin: new THREE.Vector3(),
    flash: 0,
    fireAt: 0.8 + Math.random() * 1.4,
    weave: 1, weaveDir: 1,
  };
}
