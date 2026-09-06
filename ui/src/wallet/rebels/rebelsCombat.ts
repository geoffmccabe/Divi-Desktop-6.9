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
export const ENEMY_SPEED = 19;
export const ENEMY_TURN = 1.1;        /* radians per second of chase */
export const ENEMY_FIRE_RANGE = 70;
export const TOWER_HIT_R = 2.2;

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
  hp: number;
  fireAt: number;
  /** Seconds left of the little sidestep that stops them flying in a line. */
  weave: number;
  weaveDir: number;
}

export interface CombatEvent {
  kind: "enemyDown" | "towerHit" | "playerHit" | "bulletSpent";
  at: THREE.Vector3;
  /** How big a bang. 1 is a bullet strike, 3 is a fighter coming apart. */
  power: number;
}

export interface CombatState {
  bullets: Bullet[];
  enemies: Enemy[];
  events: CombatEvent[];
  kills: number;
  spawnAt: number;
}

export function createCombat(): CombatState {
  return { bullets: [], enemies: [], events: [], kills: 0, spawnAt: 2 };
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
        e.hp -= 1;
        if (e.hp <= 0) {
          c.events.push({ kind: "enemyDown", at: e.pos.clone(), power: 3 });
          c.enemies.splice(j, 1);
          c.kills++;
        } else {
          c.events.push({ kind: "bulletSpent", at: b.pos.clone(), power: 0.7 });
        }
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
  return { pos, fwd, roll: 0, hp: 2, fireAt: 0.8 + Math.random() * 1.4, weave: 1, weaveDir: 1 };
}
