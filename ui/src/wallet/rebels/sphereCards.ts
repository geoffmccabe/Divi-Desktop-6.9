// The little turning spheres on the inventory's cards.
//
// ONE WebGL renderer for all of them. A browser allows about a dozen GL
// contexts per page and an inventory can have forty cards, so each card owns
// a plain 2D canvas and, once a frame, the shared renderer draws its sphere
// and copies the pixels across. Cards register and unregister; the loop runs
// only while something is registered.
//
// A SEALED sphere is a glossy ball in its tier colour with the tier's glow and
// nothing written on it (Geoff: "it just shows as the sphere ... with the glow
// around it for its tier colour"). An OPENED item is the same ball with the
// placeholder print, "T2 D", until real models exist.

import * as THREE from "three";
import { itemTierColour } from "./itemCatalog";

export interface SphereLook {
  tier: number;
  /** The print on it, or nothing for a sealed sphere. */
  label?: string;
  /** An egg: taller than it is wide. */
  oval?: boolean;
}

interface Card { canvas: HTMLCanvasElement; look: SphereLook; phase: number }

const SIZE = 192;
const cards = new Set<Card>();
let rig: {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  ball: THREE.Mesh; glow: THREE.Mesh; halo: THREE.Sprite;
  plain: THREE.MeshStandardMaterial; printed: Map<string, THREE.MeshStandardMaterial>;
  glowMat: THREE.MeshBasicMaterial; haloMat: THREE.SpriteMaterial;
} | null = null;
let raf = 0;

function build(): typeof rig {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 0.35, 4.6);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xbcd4ff, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-2, 2.4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fbcff, 1.6);
  rim.position.set(2.5, -0.6, -2.5);
  scene.add(rim);

  const plain = new THREE.MeshStandardMaterial({ metalness: 0.35, roughness: 0.28, emissive: 0x000000 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), plain);
  scene.add(ball);
  const glowMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1.28, 24, 18), glowMat);
  scene.add(glow);
  /* A soft halo behind, so the glow reads as light in the panel and not
     as a second, bigger ball. */
  const haloMat = new THREE.SpriteMaterial({ map: haloTexture(), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.setScalar(4.2);
  halo.position.z = -0.5;
  scene.add(halo);
  return { renderer, scene, camera, ball, glow, halo, plain, printed: new Map(), glowMat, haloMat };
}

function haloTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.35, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function printedMaterial(r: NonNullable<typeof rig>, tier: number, label: string): THREE.MeshStandardMaterial {
  const id = `${tier}:${label}`;
  let m = r.printed.get(id);
  if (m) return m;
  const col = new THREE.Color(itemTierColour(tier));
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = `#${col.getHexString()}`;
  ctx.fillRect(0, 0, 512, 256);
  const lum = col.r * 0.3 + col.g * 0.59 + col.b * 0.11;
  ctx.fillStyle = lum > 0.55 ? "#101418" : "#f6f8ff";
  ctx.font = "bold 150px system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(label, 128, 128);
  ctx.fillText(label, 384, 128);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshStandardMaterial({ map: t, metalness: 0.3, roughness: 0.3 });
  r.printed.set(id, m);
  return m;
}

function frame(now: number): void {
  raf = 0;
  if (!rig || cards.size === 0) return;
  const r = rig;
  for (const c of cards) {
    const w = c.canvas.clientWidth || 96, h = c.canvas.clientHeight || 96;
    if (c.canvas.width !== w * 2 || c.canvas.height !== h * 2) { c.canvas.width = w * 2; c.canvas.height = h * 2; }
    const colour = itemTierColour(c.look.tier);
    if (c.look.label) r.ball.material = printedMaterial(r, c.look.tier, c.look.label);
    else { r.plain.color.setHex(colour); r.ball.material = r.plain; }
    r.glowMat.color.setHex(colour);
    r.haloMat.color.setHex(colour);
    r.ball.rotation.y = now * 0.0007 + c.phase;
    r.ball.rotation.x = 0.18;
    r.ball.scale.set(c.look.oval ? 0.82 : 1, c.look.oval ? 1.15 : 1, c.look.oval ? 0.82 : 1);
    r.glow.scale.copy(r.ball.scale);
    r.renderer.render(r.scene, r.camera);
    const ctx = c.canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
      ctx.drawImage(r.renderer.domElement, 0, 0, c.canvas.width, c.canvas.height);
    }
  }
  raf = requestAnimationFrame(frame);
}

/** Show this sphere on this canvas until the returned function is called. */
export function showSphere(canvas: HTMLCanvasElement, look: SphereLook): () => void {
  if (typeof document === "undefined") return () => {};
  if (!rig) { try { rig = build(); } catch { return () => {}; } }
  const card: Card = { canvas, look, phase: Math.random() * 6.28 };
  cards.add(card);
  if (!raf) raf = requestAnimationFrame(frame);
  return () => {
    cards.delete(card);
    if (cards.size === 0 && raf) { cancelAnimationFrame(raf); raf = 0; }
  };
}
