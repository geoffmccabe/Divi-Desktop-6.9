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
const JUNK_CAP = 64;

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
export function makeFighter(colour = 0x9aa3ad): THREE.Group {
  const g = new THREE.Group();

  /* The tier's colour runs through the whole ship: a dark version on the hull
     and panels, the bright one on the edge lines, which is what makes a rare
     one identifiable across a hundred units of sky. */
  const base = new THREE.Color(colour);
  const dark = base.clone().multiplyScalar(0.26);
  const hull = new THREE.MeshStandardMaterial({ color: dark, metalness: 0.65, roughness: 0.42 });
  const panelMat = new THREE.MeshStandardMaterial({
    color: dark.clone().multiplyScalar(0.7), metalness: 0.5, roughness: 0.6, side: THREE.DoubleSide,
  });
  const edgeMat = new THREE.LineBasicMaterial({ color: base, transparent: true, opacity: 0.9 });

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
interface Shard {
  pos: THREE.Vector3; vel: THREE.Vector3; spin: THREE.Vector3;
  life: number; max: number; size: number;
  /** Torpedo debris burns violet-white rather than orange. */
  cold: boolean;
}
interface Flash { pos: THREE.Vector3; life: number; max: number; size: number; }
interface Ring { pos: THREE.Vector3; nrm: THREE.Vector3; life: number; max: number; size: number; }

/** hot = ordinary fire and wreckage. cold = damage taken. torpedo = the big
 *  one: a different colour, three times the debris and twice the radius. */
export type BoomStyle = "hot" | "cold" | "torpedo";

export interface Fx {
  group: THREE.Group;
  /** Point the bullet meshes at the live bullet list. */
  drawBullets(bullets: { pos: THREE.Vector3; vel: THREE.Vector3; hostile: boolean; mini?: boolean }[]): void;
  boom(at: THREE.Vector3, power: number, style?: BoomStyle): void;
  /** Torpedoes in flight. There are only ever two, so they get real meshes. */
  drawTorpedoes(torpedoes: { pos: THREE.Vector3; vel: THREE.Vector3 }[]): void;
  /** Wreckage in orbit. Instanced, because a long fight makes a lot of it. */
  drawJunk(junk: { pos: THREE.Vector3; rot: THREE.Vector3; kind: string }[]): void;
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
  /* Gold going out, bright green coming back, so you always know whose is
     whose at a glance in a crowded fight. */
  const mine = { core: makeBolt(0xffd24a, false), halo: makeBolt(0xffa617, true) };
  const theirs = { core: makeBolt(0xc8ff5a, false), halo: makeBolt(0x4bff2e, true) };
  /* Mini rounds: paler and thinner, so a stream of them is obviously not the
     main guns. */
  const small = { core: makeBolt(0xfff4c2, false), halo: makeBolt(0xffd98a, true) };
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

  /* The torpedoes. Only two can ever be in the air, so they are real objects
     rather than instances: a bright violet core in a soft shell. */
  const torpedoGeo = new THREE.CapsuleGeometry(0.16, 0.5, 4, 8);
  torpedoGeo.rotateX(Math.PI / 2);
  const torpedoCoreMat = new THREE.MeshBasicMaterial({ color: 0xe6d4ff });
  const torpedoGlowMat = new THREE.MeshBasicMaterial({
    color: 0xa46bff, transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const torpedoMeshes: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const holder = new THREE.Group();
    holder.add(new THREE.Mesh(torpedoGeo, torpedoCoreMat));
    const glow = new THREE.Mesh(torpedoGeo, torpedoGlowMat);
    glow.scale.set(2.4, 2.4, 1.7);
    holder.add(glow);
    holder.visible = false;
    group.add(holder);
    torpedoMeshes.push(holder);
  }
  bin.push(torpedoGeo, torpedoCoreMat, torpedoGlowMat);

  /* Wreckage. Two shapes, both instanced: the cockpit ball, and the panels.
     They are the fighter's own parts, so a dead one visibly comes apart into
     the thing it was made of. */
  const junkBodyGeo = new THREE.IcosahedronGeometry(0.36, 0);
  const junkWingGeo = new THREE.CylinderGeometry(1.0, 1.0, 0.07, 6);
  junkWingGeo.rotateZ(Math.PI / 2);
  const junkMat = new THREE.MeshStandardMaterial({
    color: 0x2b313a, metalness: 0.6, roughness: 0.55, side: THREE.DoubleSide,
  });
  const junkBodies = new THREE.InstancedMesh(junkBodyGeo, junkMat, JUNK_CAP);
  const junkWings = new THREE.InstancedMesh(junkWingGeo, junkMat, JUNK_CAP);
  junkBodies.frustumCulled = false; junkWings.frustumCulled = false;
  junkBodies.count = 0; junkWings.count = 0;
  group.add(junkBodies, junkWings);
  bin.push(junkBodyGeo, junkWingGeo, junkMat, junkBodies, junkWings);

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
  const eul = new THREE.Euler();

  return {
    group,

    drawBullets(bullets) {
      let a = 0, b2 = 0, c2 = 0;
      for (const b of bullets) {
        const kind = b.hostile ? 2 : b.mini ? 1 : 0;
        const set = kind === 2 ? theirs : kind === 1 ? small : mine;
        const i = kind === 2 ? b2 : kind === 1 ? c2 : a;
        if (i >= BULLET_CAP) continue;
        dir.copy(b.vel).normalize();
        q.setFromUnitVectors(zAxis, dir);
        /* Stretched along its own path, which is what makes a bullet read as
           moving fast rather than as a floating bead. Half the girth it started
           at: the first pass drew tennis balls. */
        const k = kind === 1 ? 0.6 : 1;
        scl.set(0.055 * k, 0.055 * k, 0.31 * k);
        m4.compose(b.pos, q, scl);
        set.core.setMatrixAt(i, m4);
        scl.set(0.17 * k, 0.17 * k, 0.58 * k);
        m4.compose(b.pos, q, scl);
        set.halo.setMatrixAt(i, m4);
        if (kind === 2) b2++; else if (kind === 1) c2++; else a++;
      }
      mine.core.count = a; mine.halo.count = a;
      theirs.core.count = b2; theirs.halo.count = b2;
      small.core.count = c2; small.halo.count = c2;
      for (const m of [mine, theirs, small]) {
        m.core.instanceMatrix.needsUpdate = true;
        m.halo.instanceMatrix.needsUpdate = true;
      }
    },

    drawTorpedoes(torpedoes) {
      for (let i = 0; i < torpedoMeshes.length; i++) {
        const t = torpedoes[i];
        const m = torpedoMeshes[i];
        if (!t) { m.visible = false; continue; }
        m.visible = true;
        m.position.copy(t.pos);
        dir.copy(t.vel).normalize();
        m.quaternion.setFromUnitVectors(zAxis, dir);
      }
    },

    drawJunk(junk) {
      let nBody = 0, nWing = 0;
      for (const j of junk) {
        const wing = j.kind !== "body";
        const mesh = wing ? junkWings : junkBodies;
        const i = wing ? nWing : nBody;
        if (i >= JUNK_CAP) continue;
        eul.set(j.rot.x, j.rot.y, j.rot.z);
        q.setFromEuler(eul);
        scl.setScalar(1);
        m4.compose(j.pos, q, scl);
        mesh.setMatrixAt(i, m4);
        if (wing) nWing++; else nBody++;
      }
      junkBodies.count = nBody;
      junkWings.count = nWing;
      junkBodies.instanceMatrix.needsUpdate = true;
      junkWings.instanceMatrix.needsUpdate = true;
    },

    boom(at, power, style = "hot") {
      /* Ordinary explosions are half what they first were: at the old size they
         filled the view and hid the thing you had just shot. A torpedo is the
         deliberate exception, and gets three times the debris and twice the
         reach so it reads as something else entirely. */
      const torp = style === "torpedo";
      const detail = torp ? 3 : 1;
      const reach = torp ? 2 : 1;
      const n = Math.min(SHARD_CAP - shardPool.length, Math.round((8 + power * 11) * detail));
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3().randomDirection()
          .multiplyScalar((1.5 + Math.random() * 5.5) * power * reach);
        shardPool.push({
          pos: at.clone(), vel: v,
          spin: new THREE.Vector3().randomDirection().multiplyScalar(6),
          life: 0.4 + Math.random() * 0.55 * power, max: 1.0,
          size: (0.025 + Math.random() * 0.06) * power * (torp ? 1.4 : 1),
          cold: torp,
        });
      }
      const f = flashes.find((x) => x.state === null);
      if (f) {
        f.state = {
          pos: at.clone(), life: 0.3 * power, max: 0.3 * power,
          size: 1.3 * power * reach,
        };
        (f.sprite.material as THREE.SpriteMaterial).color.set(
          torp ? 0xd7b0ff : style === "hot" ? 0xffd9a0 : 0x9fd8ff);
      }
      const r = rings.find((x) => x.state === null);
      if (r && power > 1.2) {
        r.state = {
          pos: at.clone(), nrm: at.clone().normalize(),
          life: torp ? 0.7 : 0.45, max: torp ? 0.7 : 0.45, size: 2.5 * power * reach,
        };
        (r.mesh.material as THREE.MeshBasicMaterial).color.set(torp ? 0xc79dff : 0xffc76a);
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
        /* Cooling from white through orange to a dull red as it fades, or
           through violet for torpedo debris. */
        if (s.cold) col.setRGB(0.6 + f * 0.4, 0.35 + f * 0.5, 1).multiplyScalar(0.3 + f);
        else col.setRGB(1, 0.35 + f * 0.6, 0.12 + f * 0.7).multiplyScalar(0.25 + f);
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

/* ------------------------------------------------------------ shield rig */
/**
 * The bubble that flares around a fighter when it is hit, and the number.
 *
 * One of these hangs off each fighter's model. The bubble's brightness is the
 * shield level, so a nearly-broken ship visibly glows less than a fresh one,
 * and it pulses: the radius by a tenth and the brightness by a fifth, quickly,
 * so it reads as something being held up rather than a decal.
 *
 * The label is drawn to a canvas only when the number changes, which is on a
 * hit and never per frame.
 */
export interface ShieldRig {
  group: THREE.Group;
  /** Recoloured when the model is reused for a different tier. */
  setColour(colour: number): void;
  /** The shield the ship has left, and what it started with. The number shown
   *  is the points remaining; the fraction drives the brightness. */
  setLevel(current: number, max: number): void;
  /** `seconds` drives the pulse; `strength` fades the whole thing out. */
  step(seconds: number, strength: number): void;
  dispose(): void;
}

/** Pulses a second on a shield bubble. */
const PULSE_HZ = 3;

export function makeShieldRig(colour = 0x66ccff): ShieldRig {
  const group = new THREE.Group();

  const geo = new THREE.SphereGeometry(1.55, 24, 18);
  const mat = new THREE.MeshBasicMaterial({
    color: colour, transparent: true, opacity: 0, wireframe: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const shell = new THREE.Mesh(geo, mat);
  group.add(shell);

  const skinGeo = new THREE.SphereGeometry(1.5, 20, 14);
  const skinMat = new THREE.MeshBasicMaterial({
    color: colour, transparent: true, opacity: 0, side: THREE.BackSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const skin = new THREE.Mesh(skinGeo, skinMat);
  group.add(skin);

  let canvas: HTMLCanvasElement | null = null;
  let tex: THREE.Texture | null = null;
  let label: THREE.Sprite | null = null;
  let labelMat: THREE.SpriteMaterial | null = null;
  if (typeof document !== "undefined") {
    canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 96;
    tex = new THREE.CanvasTexture(canvas);
    labelMat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, depthTest: false,
    });
    label = new THREE.Sprite(labelMat);
    label.scale.set(2.6, 1.0, 1);
    label.position.y = 2.1;
    group.add(label);
  }

  let level = 1;
  let points = 0;
  let shown = -1;

  function redraw() {
    if (!canvas || !tex) return;
    const x = canvas.getContext("2d");
    if (!x) return;
    x.clearRect(0, 0, canvas.width, canvas.height);
    x.font = "bold 62px ui-monospace, Menlo, monospace";
    x.textAlign = "center";
    x.textBaseline = "middle";
    /* The points left before it comes apart, not a percentage: a rare ship
       carrying two hundred and eighty and a common one carrying a hundred both
       read "50%" at the same moment, which tells the player nothing about how
       many more shots it will take. */
    x.fillStyle = level > 0.33 ? "#9fe4ff" : "#ff8a8a";
    x.shadowColor = "#000";
    x.shadowBlur = 12;
    x.fillText(String(Math.max(0, Math.round(points))), 128, 50);
    tex.needsUpdate = true;
  }

  return {
    group,
    setColour(c) {
      mat.color.set(c);
      skinMat.color.set(c);
    },
    setLevel(current, max) {
      points = current;
      level = max > 0 ? current / max : 0;
      const n = Math.max(0, Math.round(current));
      if (n !== shown) { shown = n; redraw(); }
    },
    step(seconds, strength) {
      const on = strength > 0.001;
      group.visible = on;
      if (!on) return;
      /* Three pulses a second, a fifth of the radius each way. */
      const pulse = Math.sin(seconds * Math.PI * 2 * PULSE_HZ);
      const r = 1 + pulse * 0.2;
      shell.scale.setScalar(r);
      skin.scale.setScalar(r * 0.97);
      /* Halved again: at the old level the bubble read as a solid ball and hid
         the ship it was protecting. */
      const bright = Math.max(0, Math.min(1.4, level)) * (1 + pulse * 0.2) * strength;
      mat.opacity = 0.28 * bright;
      skinMat.opacity = 0.08 * bright;
      if (labelMat) labelMat.opacity = Math.min(1, strength * 1.6);
    },
    dispose() {
      geo.dispose(); mat.dispose();
      skinGeo.dispose(); skinMat.dispose();
      tex?.dispose(); labelMat?.dispose();
    },
  };
}

/**
 * The player's guard: a red shell seen from the INSIDE.
 *
 * Drawn with BackSide, because the camera sits within it. Kept faint on purpose
 * at three tenths: this is over the whole view, and anything more solid would
 * hide the fight it is protecting you from.
 */
export function makeGuardShell(): { mesh: THREE.Object3D; step(seconds: number, strength: number): void; dispose(): void } {
  const geo = new THREE.SphereGeometry(3.2, 22, 16);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff3a3a, wireframe: true, transparent: true, opacity: 0,
    side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  mesh.renderOrder = 20;
  return {
    mesh,
    step(seconds, strength) {
      mesh.visible = strength > 0.001;
      if (!mesh.visible) return;
      /* The same three-a-second pulse the fighters' shields use, so the two
         read as the same kind of thing. */
      const pulse = Math.sin(seconds * Math.PI * 2 * PULSE_HZ);
      mesh.scale.setScalar(1 + pulse * 0.06);
      mat.opacity = 0.3 * strength * (1 + pulse * 0.2);
      mesh.rotation.y += 0.004;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
