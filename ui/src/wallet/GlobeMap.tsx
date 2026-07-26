import { useEffect, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import earthNight from "../assets/earth-night.jpg";

// The node map on a real 3D globe. Nodes are custom "Node Towers" (a slim square
// pyramid with a sphere on its tip). Connections are double-helix streams of
// flying hex characters (0-9A-F): PURPLE for peer/node links, BLUE for the
// background network. All paths are great-circle arcs so long runs bow over the
// surface. Every glyph is one point in a single GPU points system (one draw
// call), so thousands of characters stay smooth.

export interface GlobePoint {
  ip: string;
  lat: number;
  lng: number;
  kind: "self" | "peer" | "net";
  city?: string;
  country?: string;
}
export interface GlobeArc {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}

const R = 100;

// Node Tower geometry (base = 60% of the earlier width).
const BASE = 1.2;
const PYR_H = 6;
const PYR_CIRC = BASE / Math.SQRT2;
const SPH_R = 0.35;
const TIP_ALT = PYR_H / R;

const COLORS: Record<GlobePoint["kind"], number> = { self: 0xffd23f, peer: 0xff5ea8, net: 0x4aa3ff };
const UP = new THREE.Vector3(0, 1, 0);

// Hex-stream tuning.
const HEX = "0123456789ABCDEF"; // uppercase, 16 glyphs only
const TURNS = 6; // helix twists along a path
const HELIX_R = 0.7;
const SPACING = 1.5; // world-units between characters (small => continuous stream)
const BASE_FLOW = 0.031; // t-per-second at speed 1.0 (1/10 of the earlier speed)
const MAX_PEER = 24;
const MAX_MESH = 120;
const PEER_CH_MAX = 28;
const MESH_CH_MAX = 16;
const PEER_COLOR = new THREE.Color(0xb28cff); // purple
const MESH_COLOR = new THREE.Color(0x4aa3ff); // blue

// A 4x4 atlas of the 16 hex glyphs, built once.
let atlasTex: THREE.Texture | null = null;
function getAtlas(): THREE.Texture {
  if (atlasTex) return atlasTex;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  x.clearRect(0, 0, 256, 256);
  x.fillStyle = "#ffffff";
  x.font = "bold 46px 'Courier New', monospace";
  x.textAlign = "center";
  x.textBaseline = "middle";
  for (let i = 0; i < 16; i++) {
    const col = i % 4, row = Math.floor(i / 4);
    x.fillText(HEX[i], col * 64 + 32, row * 64 + 34);
  }
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
    vGlyph = glyph;
    vColor = gcolor;
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

function makeTower(color: number): THREE.Group {
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.5, metalness: 0.2 });
  const cone = new THREE.ConeGeometry(PYR_CIRC, PYR_H, 4);
  cone.translate(0, PYR_H / 2, 0);
  const sph = new THREE.SphereGeometry(SPH_R, 16, 12);
  sph.translate(0, PYR_H, 0);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(cone, mat));
  g.add(new THREE.Mesh(sph, mat));
  return g;
}

// Great-circle arc between two above-surface points (slerp so it never cuts
// through the planet), bowing outward more for longer runs.
function greatArc(a: THREE.Vector3, b: THREE.Vector3): THREE.CatmullRomCurve3 {
  const da = a.clone().normalize(), db = b.clone().normalize();
  const ra = a.length(), rb = b.length();
  const dot = Math.max(-1, Math.min(1, da.dot(db)));
  const ang = Math.acos(dot);
  const peak = R * Math.min(0.5, 0.05 + ang * 0.16);
  const so = Math.sin(ang);
  const M = Math.max(16, Math.round((ang / Math.PI) * 64) + 10);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= M; i++) {
    const u = i / M;
    let dir: THREE.Vector3;
    if (so < 1e-4) dir = da.clone().lerp(db, u).normalize();
    else {
      const s0 = Math.sin((1 - u) * ang) / so, s1 = Math.sin(u * ang) / so;
      dir = da.clone().multiplyScalar(s0).add(db.clone().multiplyScalar(s1));
    }
    pts.push(dir.multiplyScalar(ra + (rb - ra) * u + peak * Math.sin(Math.PI * u)));
  }
  return new THREE.CatmullRomCurve3(pts);
}

const DEG = Math.PI / 180;
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

// One connection rendered as a double-helix hex stream.
interface Stream {
  pts: THREE.Vector3[];
  normals: THREE.Vector3[];
  binormals: THREE.Vector3[];
  M: number;
  mult: number; // current speed multiplier (0.5..1.5)
  nextDecide: number; // ms timestamp of the next speed decision
  flow: number; // accumulated flow position (t units)
}
// A glyph belongs to a stream + strand, at a fixed base offset along the path.
interface Glyph {
  s: number; // stream index
  dir: number; // +1 / -1 (opposite streams)
  phase: number; // helix angular phase (0 or PI => double helix)
  base: number; // 0..1 position offset along the strand
}

export function GlobeMap({
  points,
  arcs,
  center,
}: {
  points: GlobePoint[];
  arcs: GlobeArc[];
  center?: { lat: number; lon: number } | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [ready, setReady] = useState(false);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const centerRef = useRef(center);
  centerRef.current = center;
  const userMovedRef = useRef(false);

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
    const scene = g.scene();
    const group = new THREE.Group();
    const vec = (lat: number, lng: number, alt: number) => {
      const c = g.getCoords(lat, lng, alt);
      return new THREE.Vector3(c.x, c.y, c.z);
    };

    for (const p of points) {
      const t = makeTower(COLORS[p.kind]);
      const s = vec(p.lat, p.lng, 0);
      t.position.copy(s);
      t.quaternion.setFromUnitVectors(UP, s.clone().normalize());
      group.add(t);
    }

    // Collect connections: peer (purple) + network mesh (blue).
    const conns: { a: THREE.Vector3; b: THREE.Vector3; color: THREE.Color; maxCh: number }[] = [];
    const self = points.find((p) => p.kind === "self");
    if (self) {
      const selfTip = vec(self.lat, self.lng, TIP_ALT);
      for (const arc of arcs.slice(0, MAX_PEER)) {
        conns.push({ a: selfTip, b: vec(arc.endLat, arc.endLng, TIP_ALT), color: PEER_COLOR, maxCh: PEER_CH_MAX });
      }
    }
    const net = points.filter((p) => p.kind === "net");
    const tips = net.map((p) => vec(p.lat, p.lng, TIP_ALT));
    const drawn = new Set<string>();
    const mesh: [number, number][] = [];
    for (let a = 0; a < net.length; a++) {
      const near = net.map((_, b) => ({ b, d: a === b ? Infinity : tips[a].distanceTo(tips[b]) })).sort((x, y) => x.d - y.d).slice(0, 3);
      for (const { b } of near) {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        mesh.push([a, b]);
      }
    }
    for (const [a, b] of mesh.slice(0, MAX_MESH)) conns.push({ a: tips[a], b: tips[b], color: MESH_COLOR, maxCh: MESH_CH_MAX });

    // Build stream frames + the flat glyph list.
    const streams: Stream[] = [];
    const glyphs: Glyph[] = [];
    const now0 = performance.now();
    for (const conn of conns) {
      const curve = greatArc(conn.a, conn.b);
      const M = 80;
      const cpts = curve.getSpacedPoints(M);
      const fr = curve.computeFrenetFrames(M, false);
      const len = curve.getLength();
      const ch = Math.max(4, Math.min(conn.maxCh, Math.round(len / SPACING)));
      const sIdx = streams.length;
      streams.push({ pts: cpts, normals: fr.normals, binormals: fr.binormals, M, mult: 0.7 + Math.random() * 0.6, nextDecide: now0 + Math.random() * 10000, flow: Math.random() });
      // Two strands (double helix), opposite flow directions.
      for (let strand = 0; strand < 2; strand++) {
        for (let p = 0; p < ch; p++) {
          glyphs.push({ s: sIdx, dir: strand === 0 ? 1 : -1, phase: strand * Math.PI, base: p / ch });
        }
      }
    }

    // Build the GPU points system: position (animated), glyph index, colour.
    let pointsObj: THREE.Points | null = null;
    let posAttr: THREE.BufferAttribute | null = null;
    if (glyphs.length) {
      const N = glyphs.length;
      const pos = new Float32Array(N * 3);
      const gly = new Float32Array(N);
      const gcol = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        gly[i] = Math.floor(Math.random() * 16);
        const isMesh = conns[glyphs[i].s].color === MESH_COLOR;
        const col = isMesh ? MESH_COLOR : PEER_COLOR;
        gcol[i * 3] = col.r; gcol[i * 3 + 1] = col.g; gcol[i * 3 + 2] = col.b;
      }
      const geo = new THREE.BufferGeometry();
      posAttr = new THREE.BufferAttribute(pos, 3);
      geo.setAttribute("position", posAttr);
      geo.setAttribute("glyph", new THREE.BufferAttribute(gly, 1));
      geo.setAttribute("gcolor", new THREE.BufferAttribute(gcol, 3));
      const mat = new THREE.ShaderMaterial({
        uniforms: { atlas: { value: getAtlas() }, sizeScale: { value: 700 } },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      pointsObj = new THREE.Points(geo, mat);
      pointsObj.frustumCulled = false;
      group.add(pointsObj);
    }

    scene.add(group);

    let raf = 0;
    let last = performance.now();
    const off = new THREE.Vector3();
    const animate = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // Per-stream speed drift: every 10s step 10%, walled at 0.5..1.5.
      for (const st of streams) {
        if (now >= st.nextDecide) {
          st.nextDecide = now + 10000;
          let d = Math.random() < 0.5 ? -1 : 1;
          if (st.mult >= 1.5) d = -1;
          else if (st.mult <= 0.5) d = 1;
          st.mult = Math.max(0.5, Math.min(1.5, st.mult + d * 0.1));
        }
        st.flow += BASE_FLOW * st.mult * dt;
      }
      if (posAttr) {
        const arr = posAttr.array as Float32Array;
        for (let i = 0; i < glyphs.length; i++) {
          const gm = glyphs[i];
          const st = streams[gm.s];
          let tt = (gm.base + gm.dir * st.flow) % 1;
          if (tt < 0) tt += 1;
          const idx = Math.min(st.M, Math.max(0, Math.floor(tt * st.M)));
          const c = st.pts[idx], n = st.normals[idx], b = st.binormals[idx];
          const ang = tt * TURNS * 2 * Math.PI + gm.phase;
          const co = Math.cos(ang) * HELIX_R, si = Math.sin(ang) * HELIX_R;
          off.set(n.x * co + b.x * si, n.y * co + b.y * si, n.z * co + b.z * si);
          arr[i * 3] = c.x + off.x; arr[i * 3 + 1] = c.y + off.y; arr[i * 3 + 2] = c.z + off.z;
        }
        posAttr.needsUpdate = true;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      scene.remove(group);
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
    };
  }, [points, arcs, ready]);

  return (
    <div className="netmap-globe" ref={wrapRef}>
      <Globe
        ref={globeRef}
        width={size.w}
        height={size.h}
        backgroundColor="#0a0e14"
        globeImageUrl={earthNight}
        showAtmosphere
        atmosphereColor="#5aa9ff"
        atmosphereAltitude={0.18}
        onGlobeReady={onReady}
      />
    </div>
  );
}
