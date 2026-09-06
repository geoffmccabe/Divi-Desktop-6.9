// Everything the game draws into the map's scene: the enemy fighters, the
// bullets, the explosions and the light that makes them look like objects
// rather than stickers.
//
// The whole lot is pooled and instanced. A dogfight can have fifty bullets and
// three explosions going at once, and allocating geometry per shot would hitch
// the globe every time a trigger was pulled.

import * as THREE from "three";

const BULLET_CAP = 160;
const SHARD_CAP = 320;
const FLASH_CAP = 14;
const RING_CAP = 10;

/** A soft round blob, drawn once and reused for every flash and glow. */
function glowTexture(): THREE.Texture {
  /* No document means the headless tests, which check the simulation and never
     look at a pixel. An empty texture keeps everything constructible. */
  if (typeof document === "undefined") return new THREE.Texture();
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.65)");
  g.addColorStop(0.6, "rgba(255,255,255,0.15)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------- the fighter */
/**
 * A TIE fighter as an actual model: a faceted cockpit ball with a window, two
 * hexagonal panels edge-on to it, and the pylons between. Solid geometry with
 * bright edge lines over it, so it reads as a machine up close and as the
 * familiar silhouette at distance.
 */
export function makeFighter(): THREE.Group {
  const g = new THREE.Group();

  const hull = new THREE.MeshStandardMaterial({ color: 0x30363f, metalness: 0.65, roughness: 0.42 });
  const panelMat = new THREE.MeshStandardMaterial({
    color: 0x1e232b, metalness: 0.5, roughness: 0.6, side: THREE.DoubleSide,
  });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.85 });

  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.36, 1), hull);
  g.add(ball);
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(ball.geometry), edgeMat));

  /* The window, facing the way it flies (nose is -Z, like the camera). */
  const eye = new THREE.Mesh(
    new THREE.CircleGeometry(0.2, 12),
    new THREE.MeshBasicMaterial({ color: 0xff5c7a }),
  );
  eye.position.set(0, 0, -0.35);
  eye.rotation.y = Math.PI;
  g.add(eye);

  for (const sx of [-1, 1]) {
    /* A hexagonal plate standing on edge: a six-sided cylinder turned so its
       axis runs across the ship. */
    const panel = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.07, 6), panelMat);
    panel.rotation.z = Math.PI / 2;
    panel.rotation.x = Math.PI / 12;
    panel.position.x = 0.96 * sx;
    g.add(panel);
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(panel.geometry), edgeMat);
    frame.rotation.copy(panel.rotation);
    frame.position.copy(panel.position);
    g.add(frame);

    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.13, 0.13), hull);
    pylon.position.x = 0.55 * sx;
    g.add(pylon);
  }

  /* Engine, so you can tell one that is running from one that is wreckage. */
  const engine = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff8a5c }),
  );
  engine.position.z = 0.34;
  g.add(engine);

  return g;
}

/* ---------------------------------------------------------------- the show */
interface Shard { pos: THREE.Vector3; vel: THREE.Vector3; spin: THREE.Vector3; life: number; max: number; size: number; }
interface Flash { pos: THREE.Vector3; life: number; max: number; size: number; }
interface Ring { pos: THREE.Vector3; nrm: THREE.Vector3; life: number; max: number; size: number; }

export interface Fx {
  group: THREE.Group;
  /** Point the bullet meshes at the live bullet list. */
  drawBullets(bullets: { pos: THREE.Vector3; vel: THREE.Vector3; hostile: boolean }[]): void;
  boom(at: THREE.Vector3, power: number, hot?: boolean): void;
  muzzle(at: THREE.Vector3): void;
  step(dt: number, camera: THREE.Camera): void;
  dispose(): void;
}

export function createFx(): Fx {
  const group = new THREE.Group();
  const bin: { dispose(): void }[] = [];
  const tex = glowTexture();
  bin.push(tex);

  /* ---- bullets: a bright core inside a soft halo, both instanced ---- */
  const boltGeo = new THREE.SphereGeometry(1, 10, 8);
  const coreMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const haloMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.32,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const core = new THREE.InstancedMesh(boltGeo, coreMat, BULLET_CAP);
  const halo = new THREE.InstancedMesh(boltGeo, haloMat, BULLET_CAP);
  core.frustumCulled = false; halo.frustumCulled = false;
  core.count = 0; halo.count = 0;
  group.add(core, halo);
  bin.push(boltGeo, coreMat, haloMat, core, halo);

  /* ---- explosion debris ---- */
  const shardGeo = new THREE.TetrahedronGeometry(1, 0);
  const shardMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const shards = new THREE.InstancedMesh(shardGeo, shardMat, SHARD_CAP);
  shards.frustumCulled = false;
  shards.count = 0;
  group.add(shards);
  bin.push(shardGeo, shardMat, shards);
  const shardPool: Shard[] = [];

  /* ---- the flash at the heart of a bang, and muzzle flashes ---- */
  const flashMat = new THREE.SpriteMaterial({
    map: tex, color: 0xffd9a0, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flashes: { sprite: THREE.Sprite; state: Flash | null }[] = [];
  for (let i = 0; i < FLASH_CAP; i++) {
    const s = new THREE.Sprite(flashMat.clone());
    s.visible = false;
    group.add(s);
    flashes.push({ sprite: s, state: null });
  }
  bin.push(flashMat);

  /* ---- the shockwave ring ---- */
  const ringGeo = new THREE.RingGeometry(0.82, 1, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffc76a, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const rings: { mesh: THREE.Mesh; state: Ring | null }[] = [];
  for (let i = 0; i < RING_CAP; i++) {
    const m = new THREE.Mesh(ringGeo, ringMat.clone());
    m.visible = false;
    group.add(m);
    rings.push({ mesh: m, state: null });
  }
  bin.push(ringGeo, ringMat);

  /* A light that rides with the camera, so ships and debris close by are lit
     as solid objects. Kept short-range so the planet itself is untouched. */
  const lamp = new THREE.PointLight(0xbfd4ff, 2.2, 90, 1.6);
  group.add(lamp);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const dir = new THREE.Vector3();

  const PLAYER_CORE = new THREE.Color(0x9ff0ff);
  const PLAYER_HALO = new THREE.Color(0x3fa8ff);
  const HOSTILE_CORE = new THREE.Color(0xffd0a0);
  const HOSTILE_HALO = new THREE.Color(0xff5a3c);

  return {
    group,

    drawBullets(bullets) {
      const n = Math.min(bullets.length, BULLET_CAP);
      for (let i = 0; i < n; i++) {
        const b = bullets[i];
        dir.copy(b.vel).normalize();
        q.setFromUnitVectors(zAxis, dir);
        /* Stretched along its own path, which is what makes a bullet read as
           moving fast rather than as a floating bead. */
        scl.set(0.11, 0.11, 0.62);
        m4.compose(b.pos, q, scl);
        core.setMatrixAt(i, m4);
        scl.set(0.34, 0.34, 1.15);
        m4.compose(b.pos, q, scl);
        halo.setMatrixAt(i, m4);
        core.setColorAt(i, b.hostile ? HOSTILE_CORE : PLAYER_CORE);
        halo.setColorAt(i, b.hostile ? HOSTILE_HALO : PLAYER_HALO);
      }
      core.count = n; halo.count = n;
      core.instanceMatrix.needsUpdate = true;
      halo.instanceMatrix.needsUpdate = true;
      if (core.instanceColor) core.instanceColor.needsUpdate = true;
      if (halo.instanceColor) halo.instanceColor.needsUpdate = true;
    },

    boom(at, power, hot = true) {
      const n = Math.min(SHARD_CAP - shardPool.length, Math.round(10 + power * 14));
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar((3 + Math.random() * 11) * power);
        shardPool.push({
          pos: at.clone(), vel: v,
          spin: new THREE.Vector3().randomDirection().multiplyScalar(6),
          life: 0.5 + Math.random() * 0.7 * power, max: 1.2, size: (0.05 + Math.random() * 0.12) * power,
        });
      }
      const f = flashes.find((x) => x.state === null);
      if (f) {
        f.state = { pos: at.clone(), life: 0.34 * power, max: 0.34 * power, size: 2.6 * power };
        (f.sprite.material as THREE.SpriteMaterial).color.set(hot ? 0xffd9a0 : 0x9fd8ff);
      }
      const r = rings.find((x) => x.state === null);
      if (r && power > 1.2) {
        r.state = { pos: at.clone(), nrm: at.clone().normalize(), life: 0.5, max: 0.5, size: 5 * power };
      }
    },

    muzzle(at) {
      const f = flashes.find((x) => x.state === null);
      if (!f) return;
      f.state = { pos: at.clone(), life: 0.09, max: 0.09, size: 1.1 };
      (f.sprite.material as THREE.SpriteMaterial).color.set(0xbfefff);
    },

    step(dt, camera) {
      lamp.position.copy(camera.position);

      /* debris */
      let live = 0;
      for (let i = shardPool.length - 1; i >= 0; i--) {
        const s = shardPool[i];
        s.life -= dt;
        if (s.life <= 0) { shardPool.splice(i, 1); continue; }
        s.pos.addScaledVector(s.vel, dt);
        s.vel.multiplyScalar(1 - Math.min(1, dt * 1.2));   /* drag, so it settles */
      }
      for (let i = 0; i < shardPool.length && live < SHARD_CAP; i++) {
        const s = shardPool[i];
        const f = s.life / s.max;
        q.setFromAxisAngle(s.spin.clone().normalize(), s.life * 6);
        scl.setScalar(s.size * (0.35 + f));
        m4.compose(s.pos, q, scl);
        shards.setMatrixAt(live, m4);
        /* Cooling from white through orange to a dull red as it fades. */
        col.setRGB(1, 0.35 + f * 0.6, 0.12 + f * 0.7).multiplyScalar(0.25 + f);
        shards.setColorAt(live, col);
        live++;
      }
      shards.count = live;
      shards.instanceMatrix.needsUpdate = true;
      if (shards.instanceColor) shards.instanceColor.needsUpdate = true;

      /* flashes */
      for (const f of flashes) {
        if (!f.state) { f.sprite.visible = false; continue; }
        f.state.life -= dt;
        if (f.state.life <= 0) { f.state = null; f.sprite.visible = false; continue; }
        const k = f.state.life / f.state.max;
        f.sprite.visible = true;
        f.sprite.position.copy(f.state.pos);
        const s = f.state.size * (1.4 - k * 0.6);
        f.sprite.scale.set(s, s, 1);
        (f.sprite.material as THREE.SpriteMaterial).opacity = k;
      }

      /* shockwaves */
      for (const r of rings) {
        if (!r.state) { r.mesh.visible = false; continue; }
        r.state.life -= dt;
        if (r.state.life <= 0) { r.state = null; r.mesh.visible = false; continue; }
        const k = 1 - r.state.life / r.state.max;
        r.mesh.visible = true;
        r.mesh.position.copy(r.state.pos);
        r.mesh.lookAt(camera.position);
        const s = r.state.size * (0.2 + k * 1.5);
        r.mesh.scale.set(s, s, 1);
        (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.85;
      }
    },

    dispose() {
      for (const f of flashes) (f.sprite.material as THREE.Material).dispose();
      for (const r of rings) (r.mesh.material as THREE.Material).dispose();
      for (const d of bin) d.dispose();
      group.clear();
    },
  };
}
