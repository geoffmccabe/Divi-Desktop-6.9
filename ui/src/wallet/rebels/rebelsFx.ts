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

  /* ---- bullets: a bright core inside a soft halo ----
     Four meshes, one pair per side, each with a plain coloured material. The
     first version used one pair with per-instance colours and came out black:
     not worth debugging when two more draw calls buys certainty. */
  const boltGeo = new THREE.SphereGeometry(1, 10, 8);
  const makeBolt = (colour: number, halo: boolean) => {
    const mat = new THREE.MeshBasicMaterial(halo
      ? { color: colour, transparent: true, opacity: 0.36, blending: THREE.AdditiveBlending, depthWrite: false }
      : { color: colour });
    const mesh = new THREE.InstancedMesh(boltGeo, mat, BULLET_CAP);
    mesh.frustumCulled = false;
    mesh.count = 0;
    group.add(mesh);
    bin.push(mat, mesh);
    return mesh;
  };
  /* Gold going out, hot orange coming back, so you always know whose is whose. */
  const mine = { core: makeBolt(0xffd24a, false), halo: makeBolt(0xffa617, true) };
  const theirs = { core: makeBolt(0xff8a5c, false), halo: makeBolt(0xff3a1c, true) };
  bin.push(boltGeo);

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

  return {
    group,

    drawBullets(bullets) {
      let a = 0, b2 = 0;
      for (const b of bullets) {
        const set = b.hostile ? theirs : mine;
        const i = b.hostile ? b2 : a;
        if (i >= BULLET_CAP) continue;
        dir.copy(b.vel).normalize();
        q.setFromUnitVectors(zAxis, dir);
        /* Stretched along its own path, which is what makes a bullet read as
           moving fast rather than as a floating bead. Half the girth it started
           at: the first pass drew tennis balls. */
        scl.set(0.055, 0.055, 0.31);
        m4.compose(b.pos, q, scl);
        set.core.setMatrixAt(i, m4);
        scl.set(0.17, 0.17, 0.58);
        m4.compose(b.pos, q, scl);
        set.halo.setMatrixAt(i, m4);
        if (b.hostile) b2++; else a++;
      }
      mine.core.count = a; mine.halo.count = a;
      theirs.core.count = b2; theirs.halo.count = b2;
      mine.core.instanceMatrix.needsUpdate = true;
      mine.halo.instanceMatrix.needsUpdate = true;
      theirs.core.instanceMatrix.needsUpdate = true;
      theirs.halo.instanceMatrix.needsUpdate = true;
    },

    boom(at, power, hot = true) {
      /* Everything here is half what it first was. Explosions at the old size
         filled the view and hid the thing you had just shot. */
      const n = Math.min(SHARD_CAP - shardPool.length, Math.round(8 + power * 11));
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar((1.5 + Math.random() * 5.5) * power);
        shardPool.push({
          pos: at.clone(), vel: v,
          spin: new THREE.Vector3().randomDirection().multiplyScalar(6),
          life: 0.4 + Math.random() * 0.55 * power, max: 1.0, size: (0.025 + Math.random() * 0.06) * power,
        });
      }
      const f = flashes.find((x) => x.state === null);
      if (f) {
        f.state = { pos: at.clone(), life: 0.3 * power, max: 0.3 * power, size: 1.3 * power };
        (f.sprite.material as THREE.SpriteMaterial).color.set(hot ? 0xffd9a0 : 0x9fd8ff);
      }
      const r = rings.find((x) => x.state === null);
      if (r && power > 1.2) {
        r.state = { pos: at.clone(), nrm: at.clone().normalize(), life: 0.45, max: 0.45, size: 2.5 * power };
      }
    },

    muzzle(at) {
      const f = flashes.find((x) => x.state === null);
      if (!f) return;
      f.state = { pos: at.clone(), life: 0.09, max: 0.09, size: 0.55 };
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
