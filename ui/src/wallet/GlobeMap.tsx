import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import earthNight from "../assets/earth-night.jpg";
import diviLogo from "../assets/divi-coin.webp";
import { pulseTrigger, pulseHsl, pulseActiveUntil, makeLegs, legU, pingDone, type Leg } from "./activityPulse";
import { useTheme } from "../theme/ThemeProvider";
import { towerMaterials, tickTowerLights } from "./towerLights";
import { createDetail, type DetailLayer } from "./globeDetail";
import { createBorders, type Borders } from "./globeBorders";

// "H S% L%" (this app's HSL-triplet token format) -> a CSS hsl() string that
// THREE.Color / material `color` params accept directly.
function cssHsl(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  return `hsl(${parts[0] ?? "0"}, ${parts[1] ?? "0%"}, ${parts[2] ?? "0%"})`;
}

// The node map on a real 3D globe. Nodes are custom "Node Towers" (a slim square
// pyramid with a sphere on its tip), packed apart when co-located. Each
// connection is a DOUBLE HELIX: two thin tubes tracing the exact helical paths,
// with uppercase hex characters (0-9A-F) flowing along them in opposite
// directions. PURPLE = peer/node links, BLUE = background network. Characters
// are one GPU points system (single draw call). Great-circle arcs so long runs
// bow over the surface. Rebuilt only when the node set changes.

export interface GlobePoint {
  ip: string;
  lat: number;
  lng: number;
  kind: "self" | "peer" | "net";
  city?: string;
  country?: string;
}
/**
 * How Divi Rebels flies THIS globe.
 *
 * The game does not build a planet of its own. It borrows this one: the same
 * earth, the same node towers, the same double-helix links with hex characters
 * running along them. All it wants is the camera, the scene to put a ship in,
 * and where the tower tips are. Anything else would be a second, worse copy of
 * a map that already exists.
 */
export interface GlobeFlight {
  /** Handed the live scene once it is built, and again if it is rebuilt. */
  attach(api: {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    /** Tip of every tower, keyed by node ip: what you dock with. */
    tips: Map<string, THREE.Vector3>;
    /** Which ip is this wallet's own node, if it is on the map. */
    selfIp: string | null;
    /** Globe radius in scene units. */
    radius: number;
    /**
     * Shrink every tower, and hand back where their tips ended up.
     *
     * Called when a game launches. Halving the towers while halving the ship's
     * speed makes the same Earth feel twice the size, which is cheaper and far
     * more stable than actually scaling the world: the globe, the map's camera
     * and every distance in the flight model all stay exactly as they were.
     *
     * The tips MOVE when the towers shrink, so they are returned rather than
     * left for the caller to guess — docking measures to the tower's axis, and
     * an axis half as tall is a different axis.
     */
    scaleTowers(s: number): Map<string, THREE.Vector3>;
    /** The globe's own canvas, which is where the pointer already is. */
    dom: HTMLCanvasElement;
  }): void;
  /** Every frame while flying. Move the camera here. */
  frame(dt: number): void;
  /** Flying stopped, or the scene is being torn down. */
  detach(): void;
}

export interface GlobeArc {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}

const R = 100;

// Node Tower geometry — ALL dimensions 50% of the original (base, height, tip
// sphere), which also halves the packed-cluster diameter.
const BASE = 0.6;
const PYR_H = 3;
const PYR_CIRC = BASE / Math.SQRT2;
const SPH_R = 0.175;
const TIP_R = R + PYR_H;
const PACK_D = 1.5 * BASE;

const UP = new THREE.Vector3(0, 1, 0);

// Hex-stream + helix tuning.
const HEX = "0123456789ABCDEF";
const HELIX_R = 0.6;
const TUBE_R = 0.1; // helix strand tube radius (world units)
const SPACING = 1.75; // world-units between characters (2x denser); constant per arc
const CH_CAP = 600;
// Below this great-circle angle (~500km on Earth), skip the helix: one simple
// curved arc with characters flowing back and forth on it.
const NEAR_ANG = 500 / 6371;
const BASE_FLOW = 0.062;
const MAX_PEER = 24;
const MAX_MESH = 120;

let atlasTex: THREE.Texture | null = null;
function getAtlas(): THREE.Texture {
  if (atlasTex) return atlasTex;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  x.fillStyle = "#ffffff";
  x.font = "bold 46px 'Courier New', monospace";
  x.textAlign = "center";
  x.textBaseline = "middle";
  for (let i = 0; i < 16; i++) x.fillText(HEX[i], (i % 4) * 64 + 32, Math.floor(i / 4) * 64 + 34);
  atlasTex = new THREE.CanvasTexture(c);
  return atlasTex;
}

const VERT = `
  attribute float glyph;
  attribute vec3 gcolor;
  varying float vGlyph;
  varying vec3 vColor;
  uniform float sizeScale;
  void main() {
    vGlyph = glyph; vColor = gcolor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = sizeScale / max(1.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = `
  precision mediump float;
  uniform sampler2D atlas;
  varying float vGlyph;
  varying vec3 vColor;
  void main() {
    float col = mod(vGlyph, 4.0);
    float row = floor(vGlyph / 4.0);
    vec2 uv = (vec2(col, row) + vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y)) / 4.0;
    vec4 t = texture2D(atlas, uv);
    if (t.a < 0.15) discard;
    gl_FragColor = vec4(vColor * t.a, t.a);
  }
`;

/**
 * The beam that marks your own node.
 *
 * Straight up, away from the centre of the planet, five tower-heights tall, and
 * fading from full at the mast to nothing at the top. It exists so a player can
 * find home from across the world without hunting for one red spire among two
 * hundred grey ones.
 *
 * Built from vertex colours on an open cylinder with additive blending: the
 * fade IS the colour going to black, which costs nothing and needs no texture.
 */
function makeHomeBeacon(colour: THREE.ColorRepresentation, height: number): THREE.Mesh {
  const len = height * 5;
  const geo = new THREE.CylinderGeometry(BASE * 0.42, BASE * 0.18, len, 10, 1, true);
  /* Its own origin sits at its middle, so it is shifted up to start at the
     mast rather than half way down the tower. */
  geo.translate(0, len / 2, 0);

  const pos = geo.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color(colour);
  for (let i = 0; i < pos.count; i++) {
    /* Full at the bottom, nothing at the top, linear across the five heights. */
    const k = 1 - Math.min(1, Math.max(0, pos.getY(i) / len));
    col[i * 3] = c.r * k;
    col[i * 3 + 1] = c.g * k;
    col[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

function makeTower(color: THREE.ColorRepresentation, scale = 1): THREE.Group {
  const h = PYR_H * scale;
  /* Shared materials, one pair per colour, carrying the window shader. See
     towerLights.ts for why this is not a texture and not a per-tower anything. */
  const { spire, beacon } = towerMaterials(color, h, PYR_CIRC * scale, SPH_R * scale);
  const cone = new THREE.ConeGeometry(PYR_CIRC * scale, h, 4);
  cone.translate(0, h / 2, 0);
  /* The sphere is POSITIONED at the tip rather than having the offset baked
     into its geometry, so its local coordinates stay centred on itself. The
     spinning windows are wrapped using those coordinates and would smear if
     the origin sat down at the tower's foot. */
  const sph = new THREE.SphereGeometry(SPH_R * scale, 20, 14);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(cone, spire));
  const tip = new THREE.Mesh(sph, beacon);
  tip.position.y = h;
  g.add(tip);
  return g;
}

// ── Stake-winner coin ──────────────────────────────────────────────────────
const COIN_R = SPH_R * 3; // coin diameter = 3x the usual sphere
const COIN_THICK = COIN_R * 2 * 0.07; // thickness = 7% of the coin diameter
const WIN_H = PYR_H * 2; // winner pyramid grows to 2x the normal size

let logoTexCache: THREE.Texture | null = null;
function getLogoTex(): THREE.Texture {
  if (logoTexCache) return logoTexCache;
  logoTexCache = new THREE.TextureLoader().load(diviLogo);
  logoTexCache.colorSpace = THREE.SRGBColorSpace;
  return logoTexCache;
}
let glowTexCache: THREE.Texture | null = null;
function getGlowTex(): THREE.Texture {
  if (glowTexCache) return glowTexCache;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,220,140,0.85)");
  g.addColorStop(1, "rgba(255,200,80,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  glowTexCache = new THREE.CanvasTexture(c);
  return glowTexCache;
}

interface WinnerDeco { deco: THREE.Group; pivot: THREE.Group; glow: THREE.Sprite; particles: THREE.Sprite[]; }
// A 2x gold pyramid topped by a spinning Divi coin, with a golden glow + a few
// orbiting particles. Positioned onto the winning tower each block.
function makeWinnerDeco(selfColor: THREE.ColorRepresentation, edgeColor: THREE.ColorRepresentation): WinnerDeco {
  const deco = new THREE.Group();
  const cone = new THREE.ConeGeometry(PYR_CIRC * 2, WIN_H, 4);
  cone.translate(0, WIN_H / 2, 0);
  deco.add(new THREE.Mesh(cone, new THREE.MeshStandardMaterial({ color: selfColor, emissive: selfColor, emissiveIntensity: 0.6, roughness: 0.5, metalness: 0.3 })));
  // Coin = flattened cylinder laid on its edge (flat faces point sideways) so it
  // spins face-to-camera around the tower's up axis.
  const pivot = new THREE.Group();
  pivot.position.set(0, WIN_H, 0);
  const coinGeo = new THREE.CylinderGeometry(COIN_R, COIN_R, COIN_THICK, 48);
  coinGeo.rotateZ(Math.PI / 2);
  const edge = new THREE.MeshStandardMaterial({ color: edgeColor, emissive: edgeColor, emissiveIntensity: 0.25, roughness: 0.4, metalness: 0.55 });
  const face = new THREE.MeshBasicMaterial({ map: getLogoTex(), transparent: true });
  pivot.add(new THREE.Mesh(coinGeo, [edge, face, face])); // [side, top, bottom]
  deco.add(pivot);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTex(), color: 0xffcc55, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.position.set(0, WIN_H, 0);
  glow.scale.set(COIN_R * 6, COIN_R * 6, 1);
  deco.add(glow);
  const particles: THREE.Sprite[] = [];
  for (let i = 0; i < 12; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTex(), color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.set(0.14, 0.14, 1);
    deco.add(s);
    particles.push(s);
  }
  deco.visible = false;
  return { deco, pivot, glow, particles };
}

function ring(n: number, r: number, rot = 0): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const a = rot + (i / n) * 2 * Math.PI;
    return [r * Math.cos(a), r * Math.sin(a)] as [number, number];
  });
}
function packOffsets(n: number): [number, number][] {
  const D = PACK_D;
  if (n <= 1) return [[0, 0]];
  if (n === 2) return [[-D / 2, 0], [D / 2, 0]];
  if (n === 3) return ring(3, D / Math.sqrt(3), Math.PI / 2);
  if (n === 4) return ring(4, D / Math.SQRT2, Math.PI / 4);
  if (n === 5) return [[0, 0], ...ring(4, D, 0)];
  if (n === 6) return [[0, 0], ...ring(5, D, Math.PI / 2)];
  const out: [number, number][] = [[0, 0]];
  let k = 1;
  while (out.length < n) {
    const r = k * D;
    const cap = Math.max(1, Math.floor(Math.PI / Math.asin(Math.min(0.999, D / (2 * r)))));
    out.push(...ring(Math.min(cap, n - out.length), r, k * 0.6));
    k++;
  }
  return out;
}
function tangent(nrm: THREE.Vector3): { east: THREE.Vector3; north: THREE.Vector3 } {
  const ref = Math.abs(nrm.y) < 0.99 ? UP : new THREE.Vector3(1, 0, 0);
  const east = new THREE.Vector3().crossVectors(ref, nrm).normalize();
  const north = new THREE.Vector3().crossVectors(nrm, east).normalize();
  return { east, north };
}

// Coils scale with distance so a helix is never over-compressed or over-stretched:
// ~50km per coil near the 300km helix threshold, easing (smoothstep) out to
// ~200km per coil at 1000km, and a constant 200km per coil beyond.
function coilsFor(ang: number): number {
  const km = ang * 6371; // globe angle -> Earth km
  const t = Math.max(0, Math.min(1, (km - 300) / 700));
  const s = t * t * (3 - 2 * t);
  const W = 50 + 150 * s; // km per coil
  return Math.max(1, 0.5 * km / W); // half the coils
}

const DEG = Math.PI / 180;
// Initial compass bearing (deg 0-360) from A to B, for spreading mesh links by
// direction so they don't stack on top of each other.
function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const la1 = aLat * DEG, la2 = bLat * DEG, dlo = (bLng - aLng) * DEG;
  const y = Math.sin(dlo) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dlo);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}
function angDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
// Greedily pick n candidates whose bearings are spread as far apart as possible
// (seed with the first = nearest, then keep adding the most different bearing).
function pickSpread<T extends { bearing: number }>(cands: T[], n: number): T[] {
  if (cands.length <= n) return cands.slice();
  const picked: T[] = [cands[0]];
  while (picked.length < n) {
    let best: T | null = null, bestGap = -1;
    for (const c of cands) {
      if (picked.includes(c)) continue;
      let minGap = 360;
      for (const p of picked) minGap = Math.min(minGap, angDiffDeg(c.bearing, p.bearing));
      if (minGap > bestGap) { bestGap = minGap; best = c; }
    }
    if (!best) break;
    picked.push(best);
  }
  return picked;
}
function angDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const la1 = aLat * DEG, la2 = bLat * DEG, dlo = (bLng - aLng) * DEG;
  const c = Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(dlo);
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}
function frameNodes(points: GlobePoint[]): { lat: number; lng: number; altitude: number } | null {
  if (!points.length) return null;
  let x = 0, y = 0, z = 0;
  for (const p of points) {
    const la = p.lat * DEG, lo = p.lng * DEG;
    x += Math.cos(la) * Math.cos(lo); y += Math.cos(la) * Math.sin(lo); z += Math.sin(la);
  }
  const clat = Math.atan2(z, Math.hypot(x, y)) / DEG;
  const clng = Math.atan2(y, x) / DEG;
  let maxd = 0;
  for (const p of points) maxd = Math.max(maxd, angDeg(clat, clng, p.lat, p.lng));
  return { lat: clat, lng: clng, altitude: Math.max(0.45, Math.min(2.4, maxd / 45)) };
}

interface Strand { hp: Float32Array; K: number; dir: number; }
interface Stream {
  strands: Strand[]; mult: number; nextDecide: number; flow: number;
  a: THREE.Vector3; b: THREE.Vector3; visible: boolean; mesh: boolean;
  legs: Leg[]; // per-stream jittered ping legs (built each pulse)
  headU: number; // current gold-head position 0..1 along the arc, or -1 = idle
  tubeMats: THREE.MeshBasicMaterial[]; // strand materials (opacity while active)
  tubeCols: { attr: THREE.BufferAttribute; K: number; base: THREE.Color }[]; // per-vertex gold band
}
interface Glyph { s: number; strand: number; base: number; }

export function GlobeMap({ points, center, getWinnerIp, flight }: { points: GlobePoint[]; arcs: GlobeArc[]; center?: { lat: number; lon: number } | null; getWinnerIp?: () => string | null; flight?: GlobeFlight | null }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; title: string; lines: string[] } | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const centerRef = useRef(center);
  centerRef.current = center;
  const userMovedRef = useRef(false);
  /* Held in a ref, not a dependency: starting or leaving the game must not
     rebuild every tower and helix on the planet. */
  const flightRef = useRef<GlobeFlight | null | undefined>(flight);
  flightRef.current = flight;
  const attachedRef = useRef<GlobeFlight | null>(null);
  // Rebuild the scene only when the set of nodes changes, not on every 10s poll
  // (rebuilding all the helix tubes each poll would hitch).
  const sig = useMemo(() => points.map((p) => `${p.ip}:${p.kind}`).sort().join("|"), [points]);

  // Map palette — shared with the flat network map (see NetworkMap.tsx's
  // hslVar()) so both always match the active skin. Read as raw strings so
  // they're stable dependency-array values; the scene effect below rebuilds
  // whenever one of these changes (colors only — no geometry-affecting data),
  // which does mean actively dragging a map color slider can visibly rebuild
  // the scene while the globe is on screen, since colors are baked into the
  // tube/glyph geometry at construction time rather than kept live-updatable.
  const { theme } = useTheme();
  const mapSelf = theme.mapSelf ?? "45 93% 47%";
  const mapPeerLink = theme.mapPeerLink ?? "280 80% 60%";
  const mapNetworkLink = theme.mapNetworkLink ?? "207 90% 54%";
  const mapActivityPulse = theme.mapActivityPulse ?? "45 100% 55%";
  const mapStakeAccent = theme.mapStakeAccent ?? "353 76% 50%";
  /* The winner's tower has its own gold. It used to borrow the "your node"
     colour, so once your own tower went red the winner would have gone red with
     it and the two would be confusable again, just the other way round. */
  const mapStakeTower = theme.mapStakeTower ?? "45 93% 47%";
  const mapBackground = theme.mapBackground ?? "216 33% 6%";
  const mapAtmosphere = theme.mapAtmosphere ?? "211 100% 68%";
  /* The close-up surface, and the outlines over it. Both live in the theme's
     Maps group rather than in a control of their own, so the detailed map can
     be turned off again without a new button anywhere. */
  const mapDetail = theme.mapDetail ?? "detailed";
  const mapBorders = theme.mapBorders ?? "on";
  const mapBorderColor = theme.mapBorderColor ?? "207 90% 54%";

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const g = globeRef.current;
      if (!g || userMovedRef.current) return;
      const c = centerRef.current;
      const pov = frameNodes(pointsRef.current) ?? (c ? { lat: c.lat, lng: c.lon, altitude: 1.2 } : null);
      if (pov) g.pointOfView(pov, 1600);
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  const onReady = () => {
    const g = globeRef.current;
    if (!g) return;
    const c = g.controls() as unknown as { autoRotate: boolean; enableDamping: boolean; addEventListener: (e: string, f: () => void) => void };
    c.autoRotate = false;
    c.enableDamping = true;
    c.addEventListener("start", () => (userMovedRef.current = true));
    if (center) g.pointOfView({ lat: center.lat, lng: center.lon, altitude: 2.2 }, 0);
    setReady(true);
  };

  useEffect(() => {
    const g = globeRef.current;
    if (!ready || !g) return;
    const pts0 = pointsRef.current;
    const scene = g.scene();
    const camera = g.camera();
    const group = new THREE.Group();

    /* ---- the ground, close up ----
       Two layers over the globe's own picture: the detail tile for wherever
       the viewer is, and the country outlines. Both are built from getCoords,
       the same call the towers are placed with, so neither can drift out of
       register with them. Both are ordinary objects in the scene, so switching
       the detailed map off is removing one of them rather than undoing a
       shader. */
    const coordsAt = (lat: number, lng: number, alt: number) => g.getCoords(lat, lng, alt);
    /* Anisotropic filtering is what a surface seen at a grazing angle needs,
       and flying low over the planet is nothing but grazing angles. Nothing
       was asking for it, on the globe's own map either. */
    let maxAniso = 1;
    try { maxAniso = g.renderer().capabilities.getMaxAnisotropy(); } catch { /* no renderer yet */ }
    const detail: DetailLayer = createDetail(coordsAt, maxAniso);
    const borders: Borders = createBorders(coordsAt);
    detail.setEnabled(mapDetail !== "classic");
    borders.setColour(cssHsl(mapBorderColor), 0.18);
    borders.object.visible = mapBorders !== "off";
    scene.add(detail.object);
    scene.add(borders.object);

    /* And give the globe's OWN picture the same filtering. It is loaded
       asynchronously by three-globe, so this waits for it rather than assuming
       it has arrived. */
    let anisoDone = false;
    const sharpenGlobe = () => {
      if (anisoDone) return;
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const mat = mesh.material as THREE.MeshPhongMaterial | undefined;
        if (!mesh.isMesh || !mat || !mat.map || mat.map.anisotropy === maxAniso) return;
        mat.map.anisotropy = maxAniso;
        mat.map.needsUpdate = true;
        anisoDone = true;
      });
    };

    // Colors from the active skin. self/peer/net towers and the peer/mesh
    // connection tubes reuse the same "peer" and "network" roles as their
    // matching links, so a skin creator gets one cohesive dial per role
    // instead of node and line colors drifting apart.
    const selfCss = cssHsl(mapSelf);
    const peerCss = cssHsl(mapPeerLink);
    const netCss = cssHsl(mapNetworkLink);
    const COLORS: Record<GlobePoint["kind"], string> = { self: selfCss, peer: peerCss, net: netCss };
    const PEER_COLOR = new THREE.Color(peerCss);
    const MESH_COLOR = new THREE.Color(netCss);
    // Dimmer blue for the network glyphs (additive blend => halved colour ~ 50%
    // opacity), to cut clutter.
    const MESH_GLYPH = new THREE.Color(netCss).multiplyScalar(0.5);
    // Traveling gold-band color for the query ripple, as 0-1 float components
    // (computed once here, not per-frame, since `animate` runs every tick).
    const activityColor = new THREE.Color(cssHsl(mapActivityPulse));
    // Mutable so a typed pulse (PoE = light blue, Send = green…) recolours the
    // travelling band live, matching the flat map.
    let GR = activityColor.r, GG = activityColor.g, GB = activityColor.b;
    const surfaceOf = (lat: number, lng: number) => {
      const c = g.getCoords(lat, lng, 0);
      return new THREE.Vector3(c.x, c.y, c.z);
    };

    // Pack co-located towers apart; record each node's tip position.
    const groups = new Map<string, GlobePoint[]>();
    for (const p of pts0) {
      const key = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
    }
    const tipOf = new Map<string, THREE.Vector3>();
    const towerObjs: THREE.Object3D[] = []; // for hover raycasting
    const towerByIp = new Map<string, THREE.Group>(); // for the stake-winner coin
    for (const grp of groups.values()) {
      const offs = packOffsets(grp.length);
      grp.forEach((p, i) => {
        const base = surfaceOf(p.lat, p.lng);
        const dir = base.clone().normalize();
        const { east, north } = tangent(dir);
        const d2 = base.clone().add(east.multiplyScalar(offs[i][0])).add(north.multiplyScalar(offs[i][1])).normalize();
        const scale = p.kind === "self" ? 2 : 1; // your node is twice the size
        const t = makeTower(COLORS[p.kind], scale);
        /* Only yours gets a beam. Two hundred of them would be a forest. */
        if (p.kind === "self") t.add(makeHomeBeacon(COLORS.self, PYR_H * scale));
        t.position.copy(d2.clone().multiplyScalar(R));
        t.quaternion.setFromUnitVectors(UP, d2);
        t.userData.node = p; // for hover
        group.add(t);
        towerObjs.push(t);
        towerByIp.set(p.ip, t);
        tipOf.set(p.ip, d2.clone().multiplyScalar(R + PYR_H * scale)); // connect at the sphere centre
      });
    }

    const conns: { a: THREE.Vector3; b: THREE.Vector3; mesh: boolean }[] = [];
    const selfIp = pts0.find((p) => p.kind === "self")?.ip;
    const selfTip = selfIp ? tipOf.get(selfIp) : undefined;
    if (selfTip) {
      let n = 0;
      for (const p of pts0) {
        if (p.kind !== "peer" || n >= MAX_PEER) continue;
        const t = tipOf.get(p.ip);
        if (t) { conns.push({ a: selfTip, b: t, mesh: false }); n++; }
      }
    }
    // Background network meshed PER CITY (not per tower), so grouped towers don't
    // each sprout their own tangle. Each city links to a few near + a few far
    // cities, chosen so their bearings fan out rather than stack up.
    interface City { lat: number; lng: number; tip: THREE.Vector3; dir: THREE.Vector3; }
    const cities: City[] = [];
    for (const grp of groups.values()) {
      if (!grp.some((p) => p.kind === "net")) continue;
      const p0 = grp[0];
      const dir = surfaceOf(p0.lat, p0.lng).normalize();
      cities.push({ lat: p0.lat, lng: p0.lng, dir, tip: dir.clone().multiplyScalar(TIP_R) });
    }
    const NEAR_N = 3, FAR_N = 3, NEAR_POOL = 8;
    const meshKeys = new Set<string>();
    for (let i = 0; i < cities.length; i++) {
      const ci = cities[i];
      const cand = cities
        .map((cj, j) => ({
          j,
          ang: Math.acos(Math.max(-1, Math.min(1, ci.dir.dot(cj.dir)))),
          bearing: bearingDeg(ci.lat, ci.lng, cj.lat, cj.lng),
        }))
        .filter((c) => c.j !== i)
        .sort((a, b) => a.ang - b.ang);
      const chosen = [...pickSpread(cand.slice(0, NEAR_POOL), NEAR_N), ...pickSpread(cand.slice(NEAR_POOL), FAR_N)];
      for (const c of chosen) {
        const key = i < c.j ? `${i}-${c.j}` : `${c.j}-${i}`;
        if (meshKeys.has(key)) continue;
        meshKeys.add(key);
        if (conns.length < MAX_MESH + MAX_PEER) conns.push({ a: ci.tip, b: cities[c.j].tip, mesh: true });
      }
    }

    const streams: Stream[] = [];
    const glyphs: Glyph[] = [];
    const isMesh: boolean[] = [];
    const now0 = performance.now();
    for (const conn of conns) {
      const da = conn.a.clone().normalize(), db = conn.b.clone().normalize();
      const dot = Math.max(-1, Math.min(1, da.dot(db)));
      const ang = Math.acos(dot);
      const so = Math.sin(ang);
      const M = Math.max(16, Math.round((ang / Math.PI) * 96) + 12);
      const peak = R * Math.min(0.6, 0.03 + ang * 0.16) * (0.6 + Math.random() * 0.9);
      // Great-circle centreline with a static outward bow.
      const centerPts: THREE.Vector3[] = [];
      for (let i = 0; i <= M; i++) {
        const u = i / M;
        let d: THREE.Vector3;
        if (so < 1e-4) d = da.clone().lerp(db, u).normalize();
        else {
          const s0 = Math.sin((1 - u) * ang) / so, s1 = Math.sin(u * ang) / so;
          d = da.clone().multiplyScalar(s0).add(db.clone().multiplyScalar(s1));
        }
        centerPts.push(d.multiplyScalar(TIP_R + peak * Math.sin(Math.PI * u)));
      }
      const curve = new THREE.CatmullRomCurve3(centerPts);
      const len = ang * TIP_R;
      const turns = coilsFor(ang);
      const K = Math.max(96, Math.min(800, Math.round(turns * 16) + Math.round(len)));
      const spinePts = curve.getSpacedPoints(K);
      const fr = curve.computeFrenetFrames(K, false);
      const sIdx = streams.length;
      const strands: Strand[] = [];
      const tubeMats: THREE.MeshBasicMaterial[] = [];
      const tubeCols: { attr: THREE.BufferAttribute; K: number; base: THREE.Color }[] = [];
      // Close nodes (< ~300km): no helix, a single straight arc; characters flow
      // both ways on it. Far nodes: full double helix.
      // Double helix is for PEERS only; the blue network is always a simple arc
      // (characters flow both ways along it).
      const helix = !conn.mesh && ang >= NEAR_ANG;
      const hr = helix ? HELIX_R : 0;
      for (let strand = 0; strand < 2; strand++) {
        const phase = strand * Math.PI;
        const hpVec: THREE.Vector3[] = [];
        const hp = new Float32Array((K + 1) * 3);
        for (let k = 0; k <= K; k++) {
          const t = k / K;
          const c = spinePts[k], nrm = fr.normals[k], bn = fr.binormals[k];
          const th = t * turns * 2 * Math.PI + phase;
          const co = Math.cos(th) * hr, si = Math.sin(th) * hr;
          const px = c.x + nrm.x * co + bn.x * si, py = c.y + nrm.y * co + bn.y * si, pz = c.z + nrm.z * co + bn.z * si;
          hp[k * 3] = px; hp[k * 3 + 1] = py; hp[k * 3 + 2] = pz;
          hpVec.push(new THREE.Vector3(px, py, pz));
        }
        // Draw a screen-space 2px line per helix strand; for a straight arc only
        // one (both strands share the same centreline). Pixel width is constant
        // at any zoom (unlike a world-space tube, which balloons when zoomed in).
        if (helix || strand === 0) {
          const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hpVec), K, TUBE_R, 4, false);
          const base = conn.mesh ? MESH_COLOR : PEER_COLOR;
          // Per-vertex colours so a gold HEAD can travel ALONG the strand instead
          // of the whole tube flashing at once. Material colour is white; the
          // vertex colours carry the real hue.
          const vcount = tube.attributes.position.count;
          const cols = new Float32Array(vcount * 3);
          for (let v = 0; v < vcount; v++) { cols[v * 3] = base.r; cols[v * 3 + 1] = base.g; cols[v * 3 + 2] = base.b; }
          const cattr = new THREE.BufferAttribute(cols, 3);
          tube.setAttribute("color", cattr);
          const tmat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: conn.mesh ? 0.1 : 0.2, depthWrite: false });
          tubeMats.push(tmat);
          tubeCols.push({ attr: cattr, K, base });
          group.add(new THREE.Mesh(tube, tmat));
        }
        strands.push({ hp, K, dir: strand === 0 ? 1 : -1 });
      }
      // mesh = a peer→network arc (stage B/C of the query ripple); !mesh = a
      // self→peer helix (stage A/D). off = ±200ms per-connection timing jitter so
      // the gold pulses stagger instead of moving in lockstep.
      streams.push({ strands, mult: 0.7 + Math.random() * 0.6, nextDecide: now0 + Math.random() * 10000, flow: Math.random(), a: conn.a, b: conn.b, visible: true, mesh: conn.mesh, legs: [], headU: -1, tubeMats, tubeCols });
      const ch = Math.max(3, Math.min(CH_CAP, Math.round(len / SPACING)));
      for (let strand = 0; strand < 2; strand++)
        for (let p = 0; p < ch; p++) { glyphs.push({ s: sIdx, strand, base: p / ch }); isMesh.push(conn.mesh); }
    }

    let posAttr: THREE.BufferAttribute | null = null;
    let gcolAttr: THREE.BufferAttribute | null = null; // retinted gold during a pulse
    let baseColors: Float32Array | null = null; // resting colours to restore to
    if (glyphs.length) {
      const N = glyphs.length;
      const pos = new Float32Array(N * 3);
      const gly = new Float32Array(N);
      const gcol = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        gly[i] = Math.floor(Math.random() * 16);
        const col = isMesh[i] ? MESH_GLYPH : PEER_COLOR;
        gcol[i * 3] = col.r; gcol[i * 3 + 1] = col.g; gcol[i * 3 + 2] = col.b;
      }
      baseColors = gcol.slice(); // remember the resting colours to restore to
      const geo = new THREE.BufferGeometry();
      posAttr = new THREE.BufferAttribute(pos, 3);
      geo.setAttribute("position", posAttr);
      geo.setAttribute("glyph", new THREE.BufferAttribute(gly, 1));
      gcolAttr = new THREE.BufferAttribute(gcol, 3);
      geo.setAttribute("gcolor", gcolAttr);
      const mat = new THREE.ShaderMaterial({
        uniforms: { atlas: { value: getAtlas() }, sizeScale: { value: 700 } },
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const pp = new THREE.Points(geo, mat);
      pp.frustumCulled = false;
      group.add(pp);
    }

    scene.add(group);

    /* Hand the live scene to the game, if one is running. These are the REAL
       tower tips off the real map, so docking lines up with the towers you can
       see rather than with a second set built from the same numbers. */
    const attachFlight = () => {
      const f = flightRef.current;
      if (!f || attachedRef.current === f) return;
      if (attachedRef.current) attachedRef.current.detach();
      attachedRef.current = f;
      f.attach({
        scene,
        camera: camera as THREE.PerspectiveCamera,
        tips: tipOf,
        selfIp: selfIp ?? null,
        radius: R,
        dom,
        scaleTowers(s: number) {
          for (const [ip, t] of towerByIp) {
            t.scale.setScalar(s);
            const p = t.userData.node as { kind: keyof typeof COLORS } | undefined;
            const built = p?.kind === "self" ? 2 : 1;
            /* The tip is the top of the mast, so it comes down with it. */
            tipOf.set(ip, t.position.clone().normalize().multiplyScalar(R + PYR_H * built * s));
          }
          return tipOf;
        },
      });
    };
    const detachFlight = () => {
      if (!attachedRef.current) return;
      attachedRef.current.detach();
      attachedRef.current = null;
    };

    // Hover tooltips: raycast the towers on pointer move. A hit farther from the
    // camera than the globe centre is on the back side (occluded) — ignore it.
    const raycaster = new THREE.Raycaster();
    const dom = g.renderer().domElement as HTMLCanvasElement;
    const ndc = new THREE.Vector2();
    const onMove = (e: PointerEvent) => {
      const rect = dom.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      ndc.set((mx / rect.width) * 2 - 1, -(my / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const camLen = camera.position.length();
      let hit: GlobePoint | null = null;
      for (const h of raycaster.intersectObjects(towerObjs, true)) {
        if (h.point.distanceTo(camera.position) >= camLen) continue; // far side
        let o: THREE.Object3D | null = h.object;
        while (o && !o.userData.node) o = o.parent;
        if (o) { hit = o.userData.node as GlobePoint; break; }
      }
      if (hit) {
        const loc = [hit.city, hit.country].filter(Boolean).join(", ");
        const role = hit.kind === "self" ? "Your node" : hit.kind === "peer" ? "Connected peer" : "Network node";
        setHover({ x: mx, y: my, title: loc || hit.ip, lines: [loc ? hit.ip : "", role].filter(Boolean) });
      } else setHover(null);
    };
    dom.addEventListener("pointermove", onMove);

    // Stake-winner coin: a spinning Divi coin on a 2x gold pyramid, moved onto
    // whichever tower currently holds the (placeholder) winner.
    const { deco: winnerDeco, pivot: coinPivot, glow: winnerGlow, particles: winnerParticles } = makeWinnerDeco(cssHsl(mapStakeTower), cssHsl(mapStakeAccent));
    group.add(winnerDeco);
    let curWinner: string | null = null;

    let raf = 0;
    let last = performance.now();
    let goldOn = false; // was the gold ripple painting last frame (to restore once)
    let lastTrig = 0; // last pulse trigger seen (to hand out fresh legs)
    const controls = g.controls() as unknown as { enabled: boolean; autoRotate: boolean; update: () => void };
    let wasFlying = false;
    const animate = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      /* The game owns the camera while it runs. Orbit controls have to be off
         or they fight it back to their own target every frame. Everything else
         in this loop keeps running, which is the point: the helix characters,
         the query ripple and the stake-winner coin all carry on animating
         while you fly through them. */
      /* ---- the ground under whoever is looking ----
         The camera's own position, turned back into a place on Earth. That is
         the right question in both views without knowing which one is running:
         orbiting the map, it is what is centred; flying, it is where the ship
         is. Altitude comes back in globe radii, which is what decides whether
         any of this is worth fetching. */
      sharpenGlobe();
      const eye = camera.position;
      const geo = g.toGeoCoords({ x: eye.x, y: eye.y, z: eye.z });
      detail.update(geo.lat, geo.lng, geo.altitude, dt);

      const isFlying = !!flightRef.current;
      if (isFlying !== wasFlying) {
        wasFlying = isFlying;
        if (isFlying) { attachFlight(); controls.enabled = false; controls.autoRotate = false; }
        else { detachFlight(); controls.enabled = true; }
      }
      if (isFlying) {
        attachFlight();
        flightRef.current!.frame(dt);
      }

      tickTowerLights(now / 1000);

      const cam = camera.position;

      // Move / show the winner coin when the winning node changes.
      const wip = getWinnerIp ? getWinnerIp() : null;
      if (wip !== curWinner) {
        if (curWinner) { const old = towerByIp.get(curWinner); if (old) old.visible = true; }
        curWinner = wip;
        const t = wip ? towerByIp.get(wip) : undefined;
        if (t) {
          winnerDeco.position.copy(t.position);
          winnerDeco.quaternion.copy(t.quaternion);
          t.visible = false;
          winnerDeco.visible = true;
        } else winnerDeco.visible = false;
      }
      if (winnerDeco.visible) {
        const ts = now / 1000;
        coinPivot.rotation.y = ts * Math.PI * 2; // 1 revolution per second
        const pulse = 0.8 + 0.2 * Math.sin(now / 280);
        (winnerGlow.material as THREE.SpriteMaterial).opacity = 0.55 * pulse;
        winnerGlow.scale.set(COIN_R * 6 * pulse, COIN_R * 6 * pulse, 1);
        for (let i = 0; i < winnerParticles.length; i++) {
          const a = (i / winnerParticles.length) * Math.PI * 2 + ts * 0.8;
          const r = 0.9 + 0.2 * Math.sin(ts * 1.3 + i);
          const py = WIN_H + 0.7 * Math.sin(ts * 1.1 + i * 1.7);
          winnerParticles[i].position.set(Math.cos(a) * r, py, Math.sin(a) * r);
          (winnerParticles[i].material as THREE.SpriteMaterial).opacity = 0.45 + 0.4 * Math.sin(ts * 2 + i);
        }
      }

      // Gold query ripple: each connection runs its OWN jittered ping, and the
      // gold travels as a HEAD along the arc (not the whole thing flashing). A new
      // pulse hands every stream a fresh set of jittered legs.
      const trig = pulseTrigger();
      if (trig && trig !== lastTrig) {
        lastTrig = trig;
        for (const st of streams) st.legs = makeLegs(trig);
        // Recolour the band to this pulse's colour (light blue for PoE, etc.).
        const pc = new THREE.Color(cssHsl(pulseHsl()));
        GR = pc.r; GG = pc.g; GB = pc.b;
      } else if (now < pulseActiveUntil() && streams.length && pingDone(streams[0].legs, now)) {
        // Keep re-rippling while a transaction pulse is still in flight, so it's
        // watchable after switching to the globe (matches the flat map).
        for (const st of streams) st.legs = makeLegs(now);
      }
      // Gold concentration at a point `pos` (0..1 along the arc) given head `u`.
      const band = (pos: number, u: number) => (u < 0 ? 0 : Math.exp(-(((pos - u) / 0.15) * ((pos - u) / 0.15))));
      // GR/GG/GB come from the activity-pulse skin color, computed once above.
      let anyActive = false;
      for (const st of streams) {
        const da = (cam.x - st.a.x) * st.a.x + (cam.y - st.a.y) * st.a.y + (cam.z - st.a.z) * st.a.z;
        const db = (cam.x - st.b.x) * st.b.x + (cam.y - st.b.y) * st.b.y + (cam.z - st.b.z) * st.b.z;
        st.visible = da > -R * R * 0.15 || db > -R * R * 0.15;
        if (now >= st.nextDecide) {
          st.nextDecide = now + 10000;
          let d = Math.random() < 0.5 ? -1 : 1;
          if (st.mult >= 1.5) d = -1; else if (st.mult <= 0.5) d = 1;
          st.mult = Math.max(0.5, Math.min(1.5, st.mult + d * 0.1));
        }
        st.flow += BASE_FLOW * st.mult * dt;

        // Head position along a→b. Self→peer helixes travel out on leg0 / back on
        // leg3; peer→network arcs out on leg1 / back on leg2 — so the ripple rolls
        // outward from your node and returns, each leg independently jittered.
        let u = -1;
        if (st.legs.length) {
          const outLeg = st.mesh ? st.legs[1] : st.legs[0];
          const retLeg = st.mesh ? st.legs[2] : st.legs[3];
          let p = legU(outLeg, now);
          if (p >= 0) u = p;
          else { p = legU(retLeg, now); if (p >= 0) u = 1 - p; }
        }
        const wasActive = st.headU >= 0;
        st.headU = u;
        if (u >= 0) anyActive = true;

        // Paint the tube: a gold band travelling at the head; restore to base when
        // the ping leaves (one final pass on the frame it goes idle).
        if (u >= 0 || wasActive) {
          for (const m of st.tubeMats) m.opacity = u >= 0 ? (st.mesh ? 0.35 : 0.5) : st.mesh ? 0.1 : 0.2;
          for (const tc of st.tubeCols) {
            const arr = tc.attr.array as Float32Array;
            const n = arr.length / 3;
            for (let vi = 0; vi < n; vi++) {
              const pos = Math.floor(vi / 5) / tc.K; // 5 = radialSegments(4)+1
              const gg = band(pos, u);
              arr[vi * 3] = tc.base.r + (GR - tc.base.r) * gg;
              arr[vi * 3 + 1] = tc.base.g + (GG - tc.base.g) * gg;
              arr[vi * 3 + 2] = tc.base.b + (GB - tc.base.b) * gg;
            }
            tc.attr.needsUpdate = true;
          }
        }
      }
      // Move the flowing characters, and gild the ones riding the gold head.
      if (posAttr) {
        const arr = posAttr.array as Float32Array;
        const gc = gcolAttr && baseColors ? (gcolAttr.array as Float32Array) : null;
        const paint = gc !== null && (anyActive || goldOn);
        for (let i = 0; i < glyphs.length; i++) {
          const gm = glyphs[i];
          const st = streams[gm.s];
          if (!st.visible) continue;
          const strand = st.strands[gm.strand];
          let tt = (gm.base + strand.dir * st.flow) % 1;
          if (tt < 0) tt += 1;
          const f = tt * strand.K;
          let i0 = f | 0; if (i0 > strand.K) i0 = strand.K;
          const i1 = i0 < strand.K ? i0 + 1 : strand.K;
          const fr2 = f - i0;
          const hp = strand.hp;
          arr[i * 3] = hp[i0 * 3] + (hp[i1 * 3] - hp[i0 * 3]) * fr2;
          arr[i * 3 + 1] = hp[i0 * 3 + 1] + (hp[i1 * 3 + 1] - hp[i0 * 3 + 1]) * fr2;
          arr[i * 3 + 2] = hp[i0 * 3 + 2] + (hp[i1 * 3 + 2] - hp[i0 * 3 + 2]) * fr2;
          if (paint && gc && baseColors) {
            const gg = band(tt, st.headU);
            const b0 = baseColors[i * 3], b1 = baseColors[i * 3 + 1], b2 = baseColors[i * 3 + 2];
            gc[i * 3] = b0 + (GR - b0) * gg;
            gc[i * 3 + 1] = b1 + (GG - b1) * gg;
            gc[i * 3 + 2] = b2 + (GB - b2) * gg;
          }
        }
        posAttr.needsUpdate = true;
        if (paint && gcolAttr) { gcolAttr.needsUpdate = true; goldOn = anyActive; }
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      detachFlight();
      dom.removeEventListener("pointermove", onMove);
      scene.remove(detail.object);
      scene.remove(borders.object);
      detail.dispose();
      borders.dispose();
      scene.remove(group);
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        /* Shared tower materials outlive any one scene build. Disposing one
           here would blank every tower the next time the map is opened. */
        const drop = (x: THREE.Material) => { if (!x.userData?.shared) x.dispose(); };
        if (Array.isArray(mat)) mat.forEach(drop);
        else if (mat) drop(mat);
      });
    };
    /* The surface settings are in here so that switching between the detailed
       map and the classic one rebuilds the scene with the right layers, the
       same way changing a tower colour already does. */
  }, [sig, ready, mapSelf, mapPeerLink, mapNetworkLink, mapActivityPulse, mapStakeAccent,
      mapStakeTower, mapDetail, mapBorders, mapBorderColor]);

  return (
    <div className="netmap-globe" ref={wrapRef}>
      <Globe
        ref={globeRef}
        width={size.w}
        height={size.h}
        backgroundColor={cssHsl(mapBackground)}
        globeImageUrl={earthNight}
        showAtmosphere
        atmosphereColor={cssHsl(mapAtmosphere)}
        atmosphereAltitude={0.18}
        onGlobeReady={onReady}
      />
      {hover && (
        <div
          className="netmap-tip"
          style={{ left: Math.min(hover.x + 14, size.w - 200), top: Math.max(8, hover.y - 10) }}
        >
          <div className="netmap-tip-title">{hover.title}</div>
          {hover.lines.map((l, i) => (
            <div key={i} className="netmap-tip-line">{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
