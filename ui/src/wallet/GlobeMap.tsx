import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import earthNight from "../assets/earth-night.jpg";

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

const COLORS: Record<GlobePoint["kind"], number> = { self: 0xffd23f, peer: 0xff5ea8, net: 0x4aa3ff };
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
interface Stream { strands: Strand[]; mult: number; nextDecide: number; flow: number; a: THREE.Vector3; b: THREE.Vector3; visible: boolean; }
interface Glyph { s: number; strand: number; base: number; }

export function GlobeMap({ points, center }: { points: GlobePoint[]; arcs: GlobeArc[]; center?: { lat: number; lon: number } | null }) {
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
  // Rebuild the scene only when the set of nodes changes, not on every 10s poll
  // (rebuilding all the helix tubes each poll would hitch).
  const sig = useMemo(() => points.map((p) => `${p.ip}:${p.kind}`).sort().join("|"), [points]);

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
    for (const grp of groups.values()) {
      const offs = packOffsets(grp.length);
      grp.forEach((p, i) => {
        const base = surfaceOf(p.lat, p.lng);
        const dir = base.clone().normalize();
        const { east, north } = tangent(dir);
        const d2 = base.clone().add(east.multiplyScalar(offs[i][0])).add(north.multiplyScalar(offs[i][1])).normalize();
        const t = makeTower(COLORS[p.kind]);
        t.position.copy(d2.clone().multiplyScalar(R));
        t.quaternion.setFromUnitVectors(UP, d2);
        t.userData.node = p; // for hover
        group.add(t);
        towerObjs.push(t);
        tipOf.set(p.ip, d2.clone().multiplyScalar(TIP_R));
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
    const netTips = pts0.filter((p) => p.kind === "net").map((p) => tipOf.get(p.ip)!).filter(Boolean);
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
      // Close nodes (< ~300km): no helix, a single straight arc; characters flow
      // both ways on it. Far nodes: full double helix.
      const helix = ang >= NEAR_ANG;
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
          group.add(new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: conn.mesh ? MESH_COLOR : PEER_COLOR, transparent: true, opacity: 0.2, depthWrite: false })));
        }
        strands.push({ hp, K, dir: strand === 0 ? 1 : -1 });
      }
      streams.push({ strands, mult: 0.7 + Math.random() * 0.6, nextDecide: now0 + Math.random() * 10000, flow: Math.random(), a: conn.a, b: conn.b, visible: true });
      const ch = Math.max(3, Math.min(CH_CAP, Math.round(len / SPACING)));
      for (let strand = 0; strand < 2; strand++)
        for (let p = 0; p < ch; p++) { glyphs.push({ s: sIdx, strand, base: p / ch }); isMesh.push(conn.mesh); }
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
      const pp = new THREE.Points(geo, mat);
      pp.frustumCulled = false;
      group.add(pp);
    }

    scene.add(group);

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
      }
      if (posAttr) {
        const arr = posAttr.array as Float32Array;
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
        }
        posAttr.needsUpdate = true;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      dom.removeEventListener("pointermove", onMove);
      scene.remove(group);
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
    };
  }, [sig, ready]);

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
