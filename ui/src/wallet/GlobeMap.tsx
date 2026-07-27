import { useEffect, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import earthNight from "../assets/earth-night.jpg";

// The node map on a real 3D globe. Nodes are custom "Node Towers" (a slim square
// pyramid with a sphere on its tip); co-located towers are packed apart. Each
// connection is a thin 1px path line with a double-helix stream of flying
// uppercase hex characters riding it: PURPLE for peer/node links, BLUE for the
// background network. Character spacing is constant along every arc (so a 10x
// longer arc carries 10x more), and arc height drifts slowly over minutes.

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

// Node Tower geometry (base 60% of original; now HALF height + half sphere).
const BASE = 1.2;
const PYR_H = 3;
const PYR_CIRC = BASE / Math.SQRT2;
const SPH_R = 0.175;
const TIP_R = R + PYR_H; // sphere-centre radius (all towers same height)
const PACK_D = 1.5 * BASE;

const COLORS: Record<GlobePoint["kind"], number> = { self: 0xffd23f, peer: 0xff5ea8, net: 0x4aa3ff };
const UP = new THREE.Vector3(0, 1, 0);

// Hex-stream tuning.
const HEX = "0123456789ABCDEF";
const TURNS = 6;
const HELIX_R = 0.6;
const SPACING = 3.5; // world-units between characters (~3 blank spaces); constant per arc
const CH_CAP = 300; // safety only; spacing is otherwise linear with arc length
const BASE_FLOW = 0.062; // t-per-second at speed 1.0 (2x the earlier average)
const MAX_PEER = 24;
const MAX_MESH = 120;
const PEER_COLOR = new THREE.Color(0xb28cff);
const MESH_COLOR = new THREE.Color(0x4aa3ff);

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

interface Stream {
  dirs: THREE.Vector3[];
  normals: THREE.Vector3[];
  binormals: THREE.Vector3[];
  M: number;
  spine: Float32Array; // (M+1)*3, recomputed each frame at the current height
  lineAttr: THREE.BufferAttribute;
  peakBase: number;
  w: number;
  oscPhase: number;
  mult: number;
  nextDecide: number;
  flow: number;
  a: THREE.Vector3; b: THREE.Vector3;
  visible: boolean;
}
interface Glyph { s: number; dir: number; phase: number; base: number; }

export function GlobeMap({ points, center }: { points: GlobePoint[]; arcs: GlobeArc[]; center?: { lat: number; lon: number } | null }) {
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
    const camera = g.camera();
    const group = new THREE.Group();
    const surfaceOf = (lat: number, lng: number) => {
      const c = g.getCoords(lat, lng, 0);
      return new THREE.Vector3(c.x, c.y, c.z);
    };

    // Pack co-located towers apart; record each node's tip position.
    const groups = new Map<string, GlobePoint[]>();
    for (const p of points) {
      const key = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
    }
    const tipOf = new Map<string, THREE.Vector3>();
    for (const grp of groups.values()) {
      const offs = packOffsets(grp.length);
      grp.forEach((p, i) => {
        const base = surfaceOf(p.lat, p.lng);
        const nrm = base.clone().normalize();
        const { east, north } = tangent(nrm);
        const dir = base.clone().add(east.multiplyScalar(offs[i][0])).add(north.multiplyScalar(offs[i][1])).normalize();
        const t = makeTower(COLORS[p.kind]);
        t.position.copy(dir.clone().multiplyScalar(R));
        t.quaternion.setFromUnitVectors(UP, dir);
        group.add(t);
        tipOf.set(p.ip, dir.clone().multiplyScalar(TIP_R));
      });
    }

    // Connections.
    const conns: { a: THREE.Vector3; b: THREE.Vector3; mesh: boolean }[] = [];
    const selfIp = points.find((p) => p.kind === "self")?.ip;
    const selfTip = selfIp ? tipOf.get(selfIp) : undefined;
    if (selfTip) {
      let n = 0;
      for (const p of points) {
        if (p.kind !== "peer" || n >= MAX_PEER) continue;
        const t = tipOf.get(p.ip);
        if (t) { conns.push({ a: selfTip, b: t, mesh: false }); n++; }
      }
    }
    const netTips = points.filter((p) => p.kind === "net").map((p) => tipOf.get(p.ip)!).filter(Boolean);
    const drawn = new Set<string>();
    const meshPairs: [number, number][] = [];
    for (let a = 0; a < netTips.length; a++) {
      const near = netTips.map((_, b) => ({ b, d: a === b ? Infinity : netTips[a].distanceTo(netTips[b]) })).sort((x, y) => x.d - y.d).slice(0, 3);
      for (const { b } of near) {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        meshPairs.push([a, b]);
      }
    }
    for (const [a, b] of meshPairs.slice(0, MAX_MESH)) conns.push({ a: netTips[a], b: netTips[b], mesh: true });

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
      const dirs: THREE.Vector3[] = [];
      const basePts: THREE.Vector3[] = [];
      for (let i = 0; i <= M; i++) {
        const u = i / M;
        let d: THREE.Vector3;
        if (so < 1e-4) d = da.clone().lerp(db, u).normalize();
        else {
          const s0 = Math.sin((1 - u) * ang) / so, s1 = Math.sin(u * ang) / so;
          d = da.clone().multiplyScalar(s0).add(db.clone().multiplyScalar(s1));
        }
        dirs.push(d);
        basePts.push(d.clone().multiplyScalar(TIP_R));
      }
      const fr = new THREE.CatmullRomCurve3(basePts).computeFrenetFrames(M, false);
      const peakBase = R * Math.min(0.6, 0.03 + ang * 0.16) * (0.6 + Math.random() * 0.9);
      const oscPeriod = 120000 + Math.random() * 60000;
      const len = ang * TIP_R;
      const ch = Math.max(3, Math.min(CH_CAP, Math.round(len / SPACING))); // constant spacing => linear with length
      const spine = new Float32Array((M + 1) * 3);
      const lgeo = new THREE.BufferGeometry();
      const lineAttr = new THREE.BufferAttribute(spine, 3);
      lgeo.setAttribute("position", lineAttr);
      const line = new THREE.Line(lgeo, new THREE.LineBasicMaterial({ color: conn.mesh ? MESH_COLOR : PEER_COLOR, transparent: true, opacity: 0.3, depthWrite: false }));
      line.frustumCulled = false;
      group.add(line);
      const sIdx = streams.length;
      streams.push({
        dirs, normals: fr.normals, binormals: fr.binormals, M, spine, lineAttr,
        peakBase, w: (2 * Math.PI) / oscPeriod, oscPhase: Math.random() * 2 * Math.PI,
        mult: 0.7 + Math.random() * 0.6, nextDecide: now0 + Math.random() * 10000, flow: Math.random(),
        a: conn.a, b: conn.b, visible: true,
      });
      for (let strand = 0; strand < 2; strand++)
        for (let p = 0; p < ch; p++) { glyphs.push({ s: sIdx, dir: strand === 0 ? 1 : -1, phase: strand * Math.PI, base: p / ch }); isMesh.push(conn.mesh); }
    }

    let posAttr: THREE.BufferAttribute | null = null;
    if (glyphs.length) {
      const N = glyphs.length;
      const pos = new Float32Array(N * 3);
      const gly = new Float32Array(N);
      const gcol = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        gly[i] = Math.floor(Math.random() * 16);
        const col = isMesh[i] ? MESH_COLOR : PEER_COLOR;
        gcol[i * 3] = col.r; gcol[i * 3 + 1] = col.g; gcol[i * 3 + 2] = col.b;
      }
      const geo = new THREE.BufferGeometry();
      posAttr = new THREE.BufferAttribute(pos, 3);
      geo.setAttribute("position", posAttr);
      geo.setAttribute("glyph", new THREE.BufferAttribute(gly, 1));
      geo.setAttribute("gcolor", new THREE.BufferAttribute(gcol, 3));
      const mat = new THREE.ShaderMaterial({
        uniforms: { atlas: { value: getAtlas() }, sizeScale: { value: 700 } },
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const p = new THREE.Points(geo, mat);
      p.frustumCulled = false;
      group.add(p);
    }

    scene.add(group);

    let raf = 0;
    let last = performance.now();
    const animate = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const cam = camera.position;
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
        // Recompute the spine at the current (drifting) height and update the line.
        if (st.visible) {
          const peakNow = st.peakBase * (1 + 0.35 * Math.sin(now * st.w + st.oscPhase));
          for (let i = 0; i <= st.M; i++) {
            const d = st.dirs[i];
            const rad = TIP_R + peakNow * Math.sin((Math.PI * i) / st.M);
            st.spine[i * 3] = d.x * rad; st.spine[i * 3 + 1] = d.y * rad; st.spine[i * 3 + 2] = d.z * rad;
          }
          st.lineAttr.needsUpdate = true;
        }
      }
      if (posAttr) {
        const arr = posAttr.array as Float32Array;
        for (let i = 0; i < glyphs.length; i++) {
          const gm = glyphs[i];
          const st = streams[gm.s];
          if (!st.visible) continue;
          let tt = (gm.base + gm.dir * st.flow) % 1;
          if (tt < 0) tt += 1;
          const f = tt * st.M;
          let i0 = f | 0; if (i0 > st.M) i0 = st.M;
          const i1 = i0 < st.M ? i0 + 1 : st.M;
          const fr = f - i0;
          const sp = st.spine;
          const cx = sp[i0 * 3] + (sp[i1 * 3] - sp[i0 * 3]) * fr;
          const cy = sp[i0 * 3 + 1] + (sp[i1 * 3 + 1] - sp[i0 * 3 + 1]) * fr;
          const cz = sp[i0 * 3 + 2] + (sp[i1 * 3 + 2] - sp[i0 * 3 + 2]) * fr;
          const N0 = st.normals[i0], N1 = st.normals[i1], B0 = st.binormals[i0], B1 = st.binormals[i1];
          let nx = N0.x + (N1.x - N0.x) * fr, ny = N0.y + (N1.y - N0.y) * fr, nz = N0.z + (N1.z - N0.z) * fr;
          const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
          let bx = B0.x + (B1.x - B0.x) * fr, by = B0.y + (B1.y - B0.y) * fr, bz = B0.z + (B1.z - B0.z) * fr;
          const bl = Math.hypot(bx, by, bz) || 1; bx /= bl; by /= bl; bz /= bl;
          const ang = tt * TURNS * 6.283185 + gm.phase;
          const co = Math.cos(ang) * HELIX_R, si = Math.sin(ang) * HELIX_R;
          arr[i * 3] = cx + nx * co + bx * si;
          arr[i * 3 + 1] = cy + ny * co + by * si;
          arr[i * 3 + 2] = cz + nz * co + bz * si;
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
  }, [points, ready]);

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
