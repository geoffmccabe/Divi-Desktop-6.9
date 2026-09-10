// Everything the game draws into the map's scene: the enemy fighters, the
// bullets, the explosions and the light that makes them look like objects
// rather than stickers.
//
// The whole lot is pooled and instanced. A dogfight can have fifty bullets and
// three explosions going at once, and allocating geometry per shot would hitch
// the globe every time a trigger was pulled.

import * as THREE from "three";
import diviLogo from "../../assets/divi-coin.webp";
import { DRONE_SIZE, droneClass, SHAPE_COUNTS, DRONE_TIERS } from "./rebelsFlock";
import { SHIELD_SHOW, COIN_RADIUS } from "./rebelsCombat";

const BULLET_CAP = 160;
const SHARD_CAP = 320;
const FLASH_CAP = 14;
const RING_CAP = 10;
const JUNK_CAP = 64;
const TRACER_CAP = 220;
const COIN_CAP = 400;
const GEM_CAP = 300;
const DOCK_RUNGS = 14;
/** How long a struck drone glows white. */
const FLASH_FOR = 0.32;
/** Swarm drones on screen at once. Matches the simulation's own cap. */
const DRONE_CAP = 144;
/** Their rounds. One per drone per thirty seconds, but they last a while. */
const ORB_CAP = 96;
/**
 * How big a coin is drawn.
 *
 * It was a tenth of a fighter's hull ball, which is six hundredths of a unit
 * across: a red speck. That was fine while it was only a thing to fly into, and
 * hopeless the moment it had to carry a logo somebody could read. Geoff: "make
 * sure the logo is readable."
 *
 * At a third of a unit it is about a quarter of a ship's length, which is a
 * coin you can see from a boost away and identify from close up. It changes
 * nothing about catching one: the pickup radius is 2.2 units and lives in the
 * simulation, not here.
 */
/* Drawn at the size the simulation treats it as. */
/* Warm gold going out, green coming back, pale for the mini gun: the same
   language the rounds themselves use. */
const MINE_TRAIL = [1.0, 0.78, 0.25] as const;
const MINI_TRAIL = [1.0, 0.94, 0.72] as const;
const HOSTILE_TRAIL = [0.45, 1.0, 0.25] as const;

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
  drawBullets(bullets: {
    pos: THREE.Vector3; vel: THREE.Vector3; hostile: boolean; mini?: boolean; orb?: boolean;
  }[]): void;
  boom(at: THREE.Vector3, power: number, style?: BoomStyle): void;
  /** Torpedoes in flight. There are only ever two, so they get real meshes. */
  drawTorpedoes(torpedoes: { pos: THREE.Vector3; vel: THREE.Vector3 }[]): void;
  /** Wreckage in orbit. Instanced, because a long fight makes a lot of it. */
  drawJunk(junk: { pos: THREE.Vector3; rot: THREE.Vector3; kind: string }[]): void;
  /** The line between ship and tower while a resupply runs. */
  drawDockLink(from: THREE.Vector3 | null, to: THREE.Vector3 | null, seconds: number): void;
  /** DIVI in orbit, waiting to be flown into. */
  drawCoins(coins: { pos: THREE.Vector3; spin: number }[]): void;
  /** Gems: faceted, in their tier's colour, turning. */
  drawGems(gems: { pos: THREE.Vector3; spin: number; tier: number }[]): void;
  /** The swarm: glowing spheres, breathing out of step with each other. */
  drawDrones(drones: {
    pos: THREE.Vector3; pulse?: number; flash: number; cls: { colour: number };
  }[], now: number): void;
  /** Their fire: red energy spheres, pulsing in size and brightness. */
  drawOrbs(orbs: { pos: THREE.Vector3; phase?: number }[], now: number): void;
  /** Beams, lit for half a second each. A cone rather than a line, because
   *  that is what they hit. */
  drawBeams(beams: Array<{
    pos: THREE.Vector3; fwd: THREE.Vector3; life: number;
    half: number; reach: number; colour: number;
  }>, maxLife: number): void;
  /** The lines rounds leave behind them. */
  drawTracers(tracers: {
    from: THREE.Vector3; to: THREE.Vector3; life: number; hostile: boolean; mini: boolean; live: boolean;
  }[], maxLife: number): void;
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

  /* ---- swarm drones ----
     A low-poly ball. Two subdivisions of an icosahedron is eighty triangles,
     which at a hundred and forty-four instances is under twelve thousand: an
     instanced mesh saves draw calls, not vertices, and a smooth sphere here
     would cost more than the instancing saved. Faceted also suits them: these
     are meant to look grown rather than machined. */
  const droneGeo = new THREE.IcosahedronGeometry(1, 2);
  const droneCoreMat = new THREE.MeshStandardMaterial({
    metalness: 0.1, roughness: 0.35,
    emissive: 0x222222, emissiveIntensity: 1,
  });
  const droneGlowMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const droneCore = new THREE.InstancedMesh(droneGeo, droneCoreMat, DRONE_CAP);
  const droneGlow = new THREE.InstancedMesh(droneGeo, droneGlowMat, DRONE_CAP);
  for (const m of [droneCore, droneGlow]) {
    /* See drawDrones: an InstancedMesh is culled as one object, so a spread
       out flock would disappear all at once. */
    m.frustumCulled = false;
    m.count = 0;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    /* Allocate the colour buffer up front. Without this the first setColorAt
       creates it lazily and the sizes can end up out of step. */
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DRONE_CAP * 3), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    group.add(m);
  }
  /* Additive glow must be drawn after the solid bodies. */
  droneGlow.renderOrder = 2;
  bin.push(droneGeo, droneCoreMat, droneGlowMat, droneCore, droneGlow);

  /* ---- THE LIVING PART ----
     Geoff: "make them more complex by having some shapes like spikes growing
     in and out and pulsating from the main sphere... spikes, lines, rods,
     cones, capsules... The higher the tier, the more of these extra shapes
     that grow and pulse away from the center." And "small spheres radiating
     around them, spinning around them like in orbit."

     One instanced mesh PER TIER: its geometry is that tier's set of shapes
     (6 to 18 of them, cones, rods and capsules in turn) merged into one, set
     round the sphere on a Fibonacci lattice, each pointing outward. The
     growing and pulsing is done in the vertex shader: every vertex carries
     the axis of its shape and the shape's number, each instance carries its
     drone's pulse phase, and the shader stretches each shape along its axis
     by a sine of time, so the whole swarm breathes with no CPU work at all.
     Seven draw calls for every drone in the sky, whatever the count.

     The motes are one more instanced mesh: up to eight tiny spheres per
     drone, placed on the CPU each frame (a thousand small matrices, cheap)
     on tilted orbits at different rates, so they wheel round the body. */
  const livingMeshes: THREE.InstancedMesh[] = [];
  const livingPhase: THREE.InstancedBufferAttribute[] = [];
  const livingMats: THREE.MeshStandardMaterial[] = [];
  const livingUniforms = { uTime: { value: 0 } };
  for (let t = 0; t < DRONE_TIERS.length; t++) {
    const geo = livingGeometry(SHAPE_COUNTS[t] ?? 6);
    const phase = new THREE.InstancedBufferAttribute(new Float32Array(DRONE_CAP), 1);
    phase.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aPhase", phase);
    const mat = new THREE.MeshStandardMaterial({
      metalness: 0.15, roughness: 0.4, emissive: 0x181818, emissiveIntensity: 1,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = livingUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>
          attribute vec3 aDir;
          attribute float aK;
          attribute float aPhase;
          uniform float uTime;`)
        .replace("#include <begin_vertex>", `
          vec3 transformed = vec3(position);
          /* Each shape grows out and draws back on its own beat: the sine
             is offset by the drone's phase and the shape's number. */
          float grow = 0.55 + 0.45 * sin(uTime * 2.1 + aPhase + aK * 0.9);
          float along = dot(transformed, aDir);
          transformed += aDir * (along * (grow - 1.0));`);
    };
    const mesh = new THREE.InstancedMesh(geo, mat, DRONE_CAP);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DRONE_CAP * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
    livingMeshes.push(mesh);
    livingPhase.push(phase);
    livingMats.push(mat);
    bin.push(geo, mat, mesh);
  }
  const MOTE_CAP = DRONE_CAP * 8;
  const moteGeo = new THREE.IcosahedronGeometry(0.11, 1);
  const moteMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const motes = new THREE.InstancedMesh(moteGeo, moteMat, MOTE_CAP);
  motes.frustumCulled = false;
  motes.count = 0;
  motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  motes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MOTE_CAP * 3), 3);
  motes.instanceColor.setUsage(THREE.DynamicDrawUsage);
  motes.renderOrder = 2;
  group.add(motes);
  bin.push(moteGeo, moteMat, motes);
  const livingCount = new Int32Array(DRONE_TIERS.length);
  const moteAxis = new THREE.Vector3();
  const motePos = new THREE.Vector3();
  const moteQ = new THREE.Quaternion();

  /* ---- their rounds ---- */
  const ORB_RED = new THREE.Color(0xff2b2b);
  const WHITE = new THREE.Color(0xffffff);
  const orbGeo = new THREE.IcosahedronGeometry(1, 1);
  const orbCoreMat = new THREE.MeshBasicMaterial({ color: 0xffdede });
  const orbGlowMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.75,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const orbCore = new THREE.InstancedMesh(orbGeo, orbCoreMat, ORB_CAP);
  const orbGlow = new THREE.InstancedMesh(orbGeo, orbGlowMat, ORB_CAP);
  for (const m of [orbCore, orbGlow]) {
    m.frustumCulled = false;
    m.count = 0;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(m);
  }
  orbGlow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ORB_CAP * 3), 3);
  orbGlow.instanceColor.setUsage(THREE.DynamicDrawUsage);
  orbGlow.renderOrder = 2;
  bin.push(orbGeo, orbCoreMat, orbGlowMat, orbCore, orbGlow);

  /* ---- beams ----
     A cone, drawn as it is aimed: the same shape the damage is worked out in,
     so what a player sees is what the beam actually covers. A cylinder would
     be prettier and would lie about the edges.

     Built pointing down -Z with its tip at the origin, so placing one is a
     look-at and a scale rather than any arithmetic at the call site. Additive
     and unlit, because a beam is light rather than a thing. */
  /* Apex at the origin, opening along +Z: see beamGeometry. */
  const beamGeo = beamGeometry();
  const beamMats: THREE.MeshBasicMaterial[] = [];
  const beamCoreMats: THREE.MeshBasicMaterial[] = [];
  const beamMeshes: THREE.Mesh[] = [];
  const beamCores: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const [mat, coreMat] = beamMaterials();
    const mesh = new THREE.Mesh(beamGeo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    group.add(mesh);
    /* The bright core rides inside the cone: same place, same direction,
       a third of the width. It is what makes the wide cone read as glow
       around a beam rather than as the beam itself. */
    const core = new THREE.Mesh(beamGeo, coreMat);
    core.visible = false;
    core.frustumCulled = false;
    core.renderOrder = 3;
    group.add(core);
    beamMats.push(mat);
    beamCoreMats.push(coreMat);
    beamMeshes.push(mesh);
    beamCores.push(core);
    /* The geometry is shared and disposed once below; only the materials are
       this mesh's own. */
    bin.push(mat, coreMat);
  }
  bin.push(beamGeo);

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

  /* The docking tether. */
  const dockGeo = new THREE.BufferGeometry();
  dockGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(DOCK_RUNGS * 6), 3));
  const dockMat = new THREE.LineBasicMaterial({
    color: 0x8fffd0, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const dockLink = new THREE.LineSegments(dockGeo, dockMat);
  dockLink.frustumCulled = false;
  dockLink.visible = false;
  group.add(dockLink);
  bin.push(dockGeo, dockMat);

  /* DIVI coins. The logo is tiled three across and two around, which wraps it
     onto the sphere six times, one to a face. */
  /* No document means the headless tests, where a texture loader reaches for an
     Image that is not there. The coins are still there, just plain. */
  /* ---- WHY THE LOGO WAS INVISIBLE ----
     The artwork is a WHITE D on a red disc. The material multiplied the whole
     texture by red, and white times red is red, so the D was being erased by
     the tint that was supposed to make the coin look like a coin. Geoff: "I
     don't see the Divi D logo in them so nobody will know what they are."

     So the colour is left alone and the artwork carries it, which is what the
     artwork was for. The transparent corners of the disc are filled with the
     same red first: at three across and two down the tiles meet, and an
     unfilled corner is a hole in the coin rather than a gap between logos. */
  const coinTex = typeof document === "undefined" ? null : (() => {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const t = new THREE.CanvasTexture(canvas);
    if (ctx) {
      ctx.fillStyle = "#e8253f";
      ctx.fillRect(0, 0, size, size);
      const img = new Image();
      img.onload = () => {
        /* Inset a little so each D sits ON the red rather than running to the
           edge and touching the one on the next face. */
        const pad = size * 0.06;
        ctx.drawImage(img, pad, pad, size - pad * 2, size - pad * 2);
        t.needsUpdate = true;
      };
      img.src = diviLogo;
    }
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    /* Six of them: three round the equator and two from pole to pole, so
       whichever way a coin is spinning there is always one facing you. */
    t.repeat.set(3, 2);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  })();
  /* ---- gems ----
     A coin's size, but faceted and lit rather than a printed ball, so the
     two are never confused: one is money and one is property. Colour per
     instance from the tier, a glow behind it so it can be found. */
  const gemGeo = new THREE.OctahedronGeometry(COIN_RADIUS * 1.15, 0);
  const gemMat = new THREE.MeshStandardMaterial({ metalness: 0.3, roughness: 0.25, emissive: 0x111111 });
  const gemMesh = new THREE.InstancedMesh(gemGeo, gemMat, GEM_CAP);
  const gemGlowMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const gemGlow = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), gemGlowMat, GEM_CAP);
  for (const m of [gemMesh, gemGlow]) {
    m.frustumCulled = false;
    m.count = 0;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GEM_CAP * 3), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    group.add(m);
  }
  gemGlow.renderOrder = 2;
  bin.push(gemGeo, gemMat, gemMesh, gemGlowMat, gemGlow);

  const coinGeo = new THREE.SphereGeometry(COIN_RADIUS, 20, 14);
  /* White, so the artwork's own colours survive. See above. */
  const coinMat = new THREE.MeshBasicMaterial({ map: coinTex, color: 0xffffff });
  const coinMesh = new THREE.InstancedMesh(coinGeo, coinMat, COIN_CAP);
  coinMesh.frustumCulled = false;
  coinMesh.count = 0;
  const coinGlowMat = new THREE.MeshBasicMaterial({
    color: 0xff3a3a, transparent: true, opacity: 0.28,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const coinGlow = new THREE.InstancedMesh(coinGeo, coinGlowMat, COIN_CAP);
  coinGlow.frustumCulled = false;
  coinGlow.count = 0;
  group.add(coinMesh, coinGlow);
  bin.push(coinGeo, coinMat, coinGlowMat, coinMesh, coinGlow);
  if (coinTex) bin.push(coinTex);
  const upAxis = new THREE.Vector3(0, 1, 0);
  /* Scratch. Two of them, and reused rather than cloned per instance: at a
     hundred and forty-four drones a frame, cloning would throw away seventeen
     thousand Colors a second, and a garbage collection pause is a far more
     likely cause of a dropped frame here than any of the arithmetic. */
  const colour = new THREE.Color();
  const tinted = new THREE.Color();

  /* Tracers: one line list for every trail on screen, coloured per vertex so a
     fading trail costs nothing but a colour write. */
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRACER_CAP * 6), 3));
  tracerGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(TRACER_CAP * 6), 3));
  const tracerMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const tracerMesh = new THREE.LineSegments(tracerGeo, tracerMat);
  tracerMesh.frustumCulled = false;
  tracerGeo.setDrawRange(0, 0);
  group.add(tracerMesh);
  bin.push(tracerGeo, tracerMat);

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
        /* Swarm rounds get their own pass: they are spheres of light, not
           stretched bolts, and drawing them here as well would put a hard
           bright streak through the middle of each one. */
        if (b.orb) continue;
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

    /* ---- the swarm ----
       One draw call for the bodies and one for the glow around them, whether
       there are four of them or a hundred and forty-four. Both are told not to
       frustum-cull: three.js culls an InstancedMesh as ONE object against a
       bounding sphere taken from the geometry rather than from where the
       instances actually are, so a flock that spreads out would vanish
       wholesale the moment its notional bounds left the view. */
    drawDrones(list, now) {
      let n = 0;
      for (const d of list) {
        if (n >= DRONE_CAP) break;
        /* Each breathes on its own clock. In unison it reads as one object
           flashing; out of step it reads as a swarm of living things. */
        const beat = Math.sin(now * 2.4 + (d.pulse ?? 0));
        const size = DRONE_SIZE * (1 + beat * 0.16);
        /* A hit whitens it for a moment, which is the only feedback there is
           that a sphere with no cockpit and no wings was struck.

           Read off the TOP of the timer, not the bottom. A hit sets flash to
           SHIELD_SHOW, which is nearly two and a half seconds, because a
           fighter's shield bubble is meant to linger. Dividing that by a half
           second the obvious way would peg a drone at full white for two
           solid seconds after every graze, and a swarm under fire would read
           as a swarm of white balls. What is wanted is a flash, so only the
           first third of a second of the timer counts. */
        const struck = Math.max(0, (d.flash - (SHIELD_SHOW - FLASH_FOR)) / FLASH_FOR);

        colour.setHex(d.cls.colour);
        droneCore.setMatrixAt(n, m4.compose(d.pos, q.identity(), scl.setScalar(size)));
        droneCore.setColorAt(n, tinted.copy(colour).lerp(WHITE, 0.15 + struck * 0.5));

        /* The halo is additive, and under additive blending dimming a colour
           and making it more transparent are THE SAME THING: what lands on the
           screen is colour times coverage either way. So the pulse rides on
           the instance colour, and a per-instance transparency comes out of it
           for nothing, with no custom shader and no second material. */
        const glowLift = 0.55 + beat * 0.3 + struck * 0.5;
        droneGlow.setMatrixAt(n, m4.compose(d.pos, q.identity(),
          scl.setScalar(size * (2.3 + beat * 0.5))));
        droneGlow.setColorAt(n, tinted.copy(colour).multiplyScalar(Math.max(0.12, glowLift)));
        n++;
      }
      droneCore.count = n;
      droneGlow.count = n;
      droneCore.instanceMatrix.needsUpdate = true;
      droneGlow.instanceMatrix.needsUpdate = true;

      /* ---- the living shapes and the motes ---- */
      livingUniforms.uTime.value = now;
      livingCount.fill(0);
      let mo = 0;
      let seen = 0;
      for (const d of list) {
        if (seen++ >= DRONE_CAP) break;
        const tier = (d.cls as unknown as { tier?: number }).tier ?? 1;
        const t = Math.max(0, Math.min(DRONE_TIERS.length - 1, tier - 1));
        const beat = Math.sin(now * 2.4 + (d.pulse ?? 0));
        const size = DRONE_SIZE * (1 + beat * 0.16);
        const k = livingCount[t]++;
        const mesh = livingMeshes[t];
        /* Turning slowly on its own axis, each at its own rate. */
        q.setFromAxisAngle(upAxis, now * 0.5 + (d.pulse ?? 0));
        mesh.setMatrixAt(k, m4.compose(d.pos, q, scl.setScalar(size)));
        colour.setHex(d.cls.colour);
        mesh.setColorAt(k, tinted.copy(colour).multiplyScalar(0.85));
        livingPhase[t].setX(k, d.pulse ?? 0);
        /* Motes: two at tier one, one more per tier. */
        const count = 2 + t;
        for (let j = 0; j < count && mo < MOTE_CAP; j++) {
          const radius = size * (1.7 + 0.18 * j);
          const angle = now * (1.1 + 0.23 * j) + (d.pulse ?? 0) + j * 2.1;
          moteAxis.set(Math.sin(j * 1.3), Math.cos(j * 0.7), Math.sin(j * 2.9 + 0.4)).normalize();
          moteQ.setFromAxisAngle(moteAxis, angle);
          motePos.set(radius, 0, 0).applyQuaternion(moteQ).add(d.pos);
          motes.setMatrixAt(mo, m4.compose(motePos, q.identity(), scl.setScalar(1)));
          motes.setColorAt(mo, tinted.copy(colour).lerp(WHITE, 0.35));
          mo++;
        }
      }
      for (let t = 0; t < livingMeshes.length; t++) {
        livingMeshes[t].count = livingCount[t];
        livingMeshes[t].instanceMatrix.needsUpdate = true;
        livingPhase[t].needsUpdate = true;
        const ic = livingMeshes[t].instanceColor;
        if (ic) ic.needsUpdate = true;
      }
      motes.count = mo;
      motes.instanceMatrix.needsUpdate = true;
      if (motes.instanceColor) motes.instanceColor.needsUpdate = true;
      /* Forgetting these is the classic InstancedMesh bug: the matrices go up
         and the colours silently do not. */
      if (droneCore.instanceColor) droneCore.instanceColor.needsUpdate = true;
      if (droneGlow.instanceColor) droneGlow.instanceColor.needsUpdate = true;
    },

    /* ---- their fire ----
       Not a bolt. A round sphere of red light that swells and fades as it
       comes, which is what makes it read as energy rather than as ammunition,
       and which also makes it easy to pick out of a sky already full of gold
       and green tracer. */
    drawOrbs(list, now) {
      let n = 0;
      for (const o of list) {
        if (n >= ORB_CAP) break;
        const beat = Math.sin(now * 7 + (o.phase ?? 0));
        const size = 0.26 * (1 + beat * 0.3);
        orbCore.setMatrixAt(n, m4.compose(o.pos, q.identity(), scl.setScalar(size * 0.45)));
        orbGlow.setMatrixAt(n, m4.compose(o.pos, q.identity(), scl.setScalar(size * 2.2)));
        /* Same trick as the drones: on an additive material the instance
           colour IS the transparency. */
        orbGlow.setColorAt(n, tinted.copy(ORB_RED).multiplyScalar(0.5 + beat * 0.35));
        n++;
      }
      orbCore.count = n;
      orbGlow.count = n;
      orbCore.instanceMatrix.needsUpdate = true;
      orbGlow.instanceMatrix.needsUpdate = true;
      if (orbGlow.instanceColor) orbGlow.instanceColor.needsUpdate = true;
    },

    drawBeams(beams, maxLife) {
      for (let i = 0; i < beamMeshes.length; i++) {
        const b = beams[i];
        const mesh = beamMeshes[i];
        const core = beamCores[i];
        if (!b) { mesh.visible = false; core.visible = false; continue; }
        mesh.visible = true;
        core.visible = true;
        mesh.position.copy(b.pos);
        core.position.copy(b.pos);
        dir.copy(b.fwd).normalize();
        /* The cone's apex is at the origin and it opens along +Z (checked:
           its bounding box after the rotate runs 0 to +1 in z). It used to be
           turned to face MINUS the firing direction on the belief that it
           opened down -Z, so every beam was drawn pointing backwards out of
           the ship while its damage went forwards. From the cockpit that is
           invisible, behind the camera; in the shop it was a cone on top of
           the hull pointing the wrong way. */
        mesh.quaternion.copy(beamOrientation(dir));
        core.quaternion.copy(mesh.quaternion);
        /* The radius at the far end is what the half-angle actually subtends,
           so the drawn edge is the edge that does damage. */
        const rad = Math.tan(b.half) * b.reach;
        mesh.scale.set(rad, rad, b.reach);
        core.scale.set(rad * BEAM_CORE, rad * BEAM_CORE, b.reach);
        /* Brightest at the instant it fires and fading over its half second,
           which is what makes a held trigger read as a pulsing beam rather
           than a solid bar. */
        const k = Math.max(0, Math.min(1, b.life / Math.max(0.001, maxLife)));
        beamMats[i].color.setHex(b.colour);
        beamMats[i].opacity = 0.14 + 0.4 * k;
        beamCoreMats[i].color.setHex(b.colour);
        beamCoreMats[i].opacity = 0.35 + 0.6 * k;
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

    drawDockLink(from, to, seconds) {
      if (!from || !to) { dockLink.visible = false; return; }
      dockLink.visible = true;
      const a = dockGeo.getAttribute("position") as THREE.BufferAttribute;
      const arr = a.array as Float32Array;
      /* A ladder of rungs running up the tether, sliding toward the tower, so
         the resupply reads as something flowing rather than a static line. */
      const dir = to.clone().sub(from);
      const len = dir.length() || 1;
      dir.normalize();
      const rungs = DOCK_RUNGS;
      for (let i = 0; i < rungs; i++) {
        const t = ((i / rungs) + (seconds * 0.6) % 1) % 1;
        const at = from.clone().addScaledVector(dir, t * len);
        const o = i * 6;
        arr[o] = at.x; arr[o + 1] = at.y; arr[o + 2] = at.z;
        arr[o + 3] = at.x + dir.x * 0.35;
        arr[o + 4] = at.y + dir.y * 0.35;
        arr[o + 5] = at.z + dir.z * 0.35;
      }
      a.needsUpdate = true;
    },

    drawGems(gems) {
      const n = Math.min(gems.length, GEM_CAP);
      for (let i = 0; i < n; i++) {
        const g = gems[i];
        q.setFromAxisAngle(upAxis, g.spin);
        m4.compose(g.pos, q, scl.setScalar(1));
        gemMesh.setMatrixAt(i, m4);
        colour.setHex(droneClass(g.tier).colour);
        gemMesh.setColorAt(i, colour);
        m4.compose(g.pos, q, scl.setScalar(3.2));
        gemGlow.setMatrixAt(i, m4);
        gemGlow.setColorAt(i, tinted.copy(colour).multiplyScalar(0.5));
      }
      gemMesh.count = n;
      gemGlow.count = n;
      gemMesh.instanceMatrix.needsUpdate = true;
      gemGlow.instanceMatrix.needsUpdate = true;
      if (gemMesh.instanceColor) gemMesh.instanceColor.needsUpdate = true;
      if (gemGlow.instanceColor) gemGlow.instanceColor.needsUpdate = true;
    },
    drawCoins(coins) {
      const n = Math.min(coins.length, COIN_CAP);
      for (let i = 0; i < n; i++) {
        const k = coins[i];
        q.setFromAxisAngle(upAxis, k.spin);
        scl.setScalar(1);
        m4.compose(k.pos, q, scl);
        coinMesh.setMatrixAt(i, m4);
        /* A halo, so something a thirtieth of a unit across can still be seen
           from across the sky. Without it these would be invisible, which is
           what a tenth of a hull actually works out to at this scale. */
        scl.setScalar(9);
        m4.compose(k.pos, q, scl);
        coinGlow.setMatrixAt(i, m4);
      }
      coinMesh.count = n;
      coinGlow.count = n;
      coinMesh.instanceMatrix.needsUpdate = true;
      coinGlow.instanceMatrix.needsUpdate = true;
    },

    drawTracers(tracers, maxLife) {
      const pos = tracerGeo.getAttribute("position") as THREE.BufferAttribute;
      const col = tracerGeo.getAttribute("color") as THREE.BufferAttribute;
      const p = pos.array as Float32Array;
      const c = col.array as Float32Array;
      let n = 0;
      for (const t of tracers) {
        if (n >= TRACER_CAP) break;
        const o = n * 6;
        p[o] = t.from.x; p[o + 1] = t.from.y; p[o + 2] = t.from.z;
        p[o + 3] = t.to.x; p[o + 4] = t.to.y; p[o + 5] = t.to.z;
        /* Additive blending, so fading to black IS fading out. A live round's
           line is at full strength; once it has landed the line dims over its
           remaining life. */
        const k = t.live ? 1 : Math.max(0, t.life / maxLife);
        const tint = t.hostile ? HOSTILE_TRAIL : t.mini ? MINI_TRAIL : MINE_TRAIL;
        /* Brighter at the head than the tail, which is what makes the
           direction of travel readable at a glance. */
        for (const [end, w] of [[0, 0.35], [3, 1]] as const) {
          c[o + end] = tint[0] * k * w;
          c[o + end + 1] = tint[1] * k * w;
          c[o + end + 2] = tint[2] * k * w;
        }
        n++;
      }
      tracerGeo.setDrawRange(0, n * 2);
      pos.needsUpdate = true;
      col.needsUpdate = true;
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


/* ---- the beam's shape, shared with the shop's preview ---- */

/**
 * A unit cone with its apex at the origin opening along +Z: scale it by
 * (radius, radius, reach) and it is the beam.
 *
 * ---- WHY IT HAS VERTEX COLOURS ----
 * A single-colour open cone drawn additively with no lighting is a flat
 * wedge from any angle: there is nothing on it to say which part is near.
 * Geoff: "it's a 3D cone, not a flat thing". So the colour fades along the
 * length, full at the apex and gone at the far end, which under additive
 * blending is a fade to transparent: the beam is brightest at the muzzle and
 * thins into the distance, and the eye reads that as depth. Drawn with a
 * narrower, brighter core inside it (see the callers) it reads as a volume.
 * More segments along the length so the fade is smooth.
 */
export function beamGeometry(): THREE.ConeGeometry {
  const g = new THREE.ConeGeometry(1, 1, 32, 12, true);
  g.translate(0, -0.5, 0);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    /* z runs 0 at the apex to 1 at the base. Bright near, dark far, with a
       curve so the middle still carries some light. */
    const t = Math.max(0, Math.min(1, pos.getZ(i)));
    const k = Math.pow(1 - t, 1.6);
    col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = k;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

/** The two materials a beam is drawn with: the wide cone and the bright core. */
export function beamMaterials(): [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial] {
  const shell = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.5, vertexColors: true,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const core = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.9, vertexColors: true,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  return [shell, core];
}

/** How much narrower the core is than the cone. */
export const BEAM_CORE = 0.35;

const _beamZ = new THREE.Vector3(0, 0, 1);
const _beamQ = new THREE.Quaternion();
/** Turns beamGeometry so it opens along `fwd`. */
export function beamOrientation(fwd: THREE.Vector3): THREE.Quaternion {
  return _beamQ.setFromUnitVectors(_beamZ, fwd);
}


/* ---- a tier's set of shapes, as one geometry ----
   Cones (spikes), rods and capsules in turn, on a Fibonacci lattice round a
   unit sphere, each pointing straight out. Every vertex carries its shape's
   outward axis (aDir) and its number (aK) for the shader that breathes them. */
export function livingGeometry(count: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const dir = new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta)).normalize();
    const kind = i % 3;
    let g: THREE.BufferGeometry;
    const len = 0.9 + 0.35 * ((i * 7) % 5) / 4;
    if (kind === 0) g = new THREE.ConeGeometry(0.16, len, 6, 1);           /* spike */
    else if (kind === 1) g = new THREE.CylinderGeometry(0.06, 0.06, len, 5, 1); /* rod */
    else g = new THREE.CapsuleGeometry(0.1, len * 0.7, 2, 6);             /* capsule */
    g = g.toNonIndexed();
    /* Base on the sphere's surface, pointing out along dir. Cone/cylinder
       geometry stands along +Y with its middle at the origin. */
    g.translate(0, 0.85 + len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.applyQuaternion(q);
    const n = g.getAttribute("position").count;
    const dirs = new Float32Array(n * 3);
    const ks = new Float32Array(n);
    for (let v = 0; v < n; v++) { dirs[v * 3] = dir.x; dirs[v * 3 + 1] = dir.y; dirs[v * 3 + 2] = dir.z; ks[v] = i; }
    g.setAttribute("aDir", new THREE.BufferAttribute(dirs, 3));
    g.setAttribute("aK", new THREE.BufferAttribute(ks, 1));
    parts.push(g);
  }
  /* Merge: positions, normals, and the two custom attributes, end to end. */
  const total = parts.reduce((a, g) => a + g.getAttribute("position").count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  const dirs = new Float32Array(total * 3), ks = new Float32Array(total);
  let at = 0;
  for (const g of parts) {
    const p = g.getAttribute("position"), nn = g.getAttribute("normal");
    const d = g.getAttribute("aDir"), k = g.getAttribute("aK");
    pos.set(p.array as Float32Array, at * 3);
    nor.set(nn.array as Float32Array, at * 3);
    dirs.set(d.array as Float32Array, at * 3);
    ks.set(k.array as Float32Array, at);
    at += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("aDir", new THREE.BufferAttribute(dirs, 3));
  out.setAttribute("aK", new THREE.BufferAttribute(ks, 1));
  return out;
}
