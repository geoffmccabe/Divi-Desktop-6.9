import { useEffect, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import earthNight from "../assets/earth-night.jpg";

// The node map on a real 3D globe. Nodes are custom "Node Towers" (a slim square
// pyramid with a sphere on its tip). Peer connections are double-helix streams of
// flying, rotating hex characters (no line); the background network is thin blue
// tubes. All paths follow great-circle arcs so long runs bow over the surface
// instead of cutting through the planet.

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

const R = 100; // globe.gl's default GLOBE_RADIUS

// Node Tower geometry. Base narrowed to 60% of the earlier width.
const BASE = 1.2; // square base side
const PYR_H = 6; // pyramid height
const PYR_CIRC = BASE / Math.SQRT2; // cone circumradius so the square side = BASE
const SPH_R = 0.35; // top sphere radius (the connection point)
const TIP_ALT = PYR_H / R; // altitude of the sphere centre

const COLORS: Record<GlobePoint["kind"], number> = {
  self: 0xffd23f,
  peer: 0xff5ea8,
  net: 0x4aa3ff,
};
const MESH_LINE = 0x4aa3ff;
const UP = new THREE.Vector3(0, 1, 0);

// Hex-stream tuning.
const HEX = "0123456789abcdef";
const CH = 8; // characters per helix strand
const TURNS = 6; // helix twists along a path
const HELIX_R = 0.7; // helix radius
const CHAR_SCALE = 0.8;
const MAX_STREAMS = 30; // cap for performance

// One shared sprite material per hex glyph (green data feel), built once.
let charMats: THREE.SpriteMaterial[] | null = null;
function getCharMats(): THREE.SpriteMaterial[] {
  if (charMats) return charMats;
  charMats = [...HEX].map((ch) => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d")!;
    x.clearRect(0, 0, 64, 64);
    x.font = "bold 46px 'Courier New', monospace";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillStyle = "#c9b6ff";
    x.fillText(ch, 32, 34);
    const tex = new THREE.CanvasTexture(c);
    return new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  });
  return charMats;
}

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

// Great-circle arc between two points ABOVE the sphere: slerp the directions
// (so it hugs the surface, never cutting through) and bow outward in the middle,
// more for longer runs.
function greatArc(a: THREE.Vector3, b: THREE.Vector3): THREE.CatmullRomCurve3 {
  const da = a.clone().normalize(), db = b.clone().normalize();
  const ra = a.length(), rb = b.length();
  const dot = Math.max(-1, Math.min(1, da.dot(db)));
  const ang = Math.acos(dot);
  const peak = R * Math.min(0.5, 0.05 + ang * 0.16); // outward lift grows with distance
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
    const rad = ra + (rb - ra) * u + peak * Math.sin(Math.PI * u);
    pts.push(dir.multiplyScalar(rad));
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
    x += Math.cos(la) * Math.cos(lo);
    y += Math.cos(la) * Math.sin(lo);
    z += Math.sin(la);
  }
  const clat = Math.atan2(z, Math.hypot(x, y)) / DEG;
  const clng = Math.atan2(y, x) / DEG;
  let maxd = 0;
  for (const p of points) maxd = Math.max(maxd, angDeg(clat, clng, p.lat, p.lng));
  return { lat: clat, lng: clng, altitude: Math.max(0.45, Math.min(2.4, maxd / 45)) };
}

interface Strand {
  sprites: { sp: THREE.Sprite; base: number }[];
  dir: number;
  phase: number;
}
interface Stream {
  pts: THREE.Vector3[];
  normals: THREE.Vector3[];
  binormals: THREE.Vector3[];
  M: number;
  strands: Strand[];
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
    const mats = getCharMats();

    const vec = (lat: number, lng: number, alt: number) => {
      const c = g.getCoords(lat, lng, alt);
      return new THREE.Vector3(c.x, c.y, c.z);
    };

    // Towers
    for (const p of points) {
      const t = makeTower(COLORS[p.kind]);
      const s = vec(p.lat, p.lng, 0);
      t.position.copy(s);
      t.quaternion.setFromUnitVectors(UP, s.clone().normalize());
      group.add(t);
    }

    // Peer connections: double-helix hex streams (no line) along a great arc.
    const streams: Stream[] = [];
    const self = points.find((p) => p.kind === "self");
    if (self) {
      const selfTip = vec(self.lat, self.lng, TIP_ALT);
      for (const a of arcs.slice(0, MAX_STREAMS)) {
        const peerTip = vec(a.endLat, a.endLng, TIP_ALT);
        const curve = greatArc(selfTip, peerTip);
        const M = 80;
        const pts = curve.getSpacedPoints(M);
        const fr = curve.computeFrenetFrames(M, false);
        const strands: Strand[] = [];
        for (let sIdx = 0; sIdx < 2; sIdx++) {
          const sprites: Strand["sprites"] = [];
          for (let p = 0; p < CH; p++) {
            const sp = new THREE.Sprite(mats[Math.floor(Math.random() * 16)]);
            sp.scale.set(CHAR_SCALE, CHAR_SCALE, 1);
            group.add(sp);
            sprites.push({ sp, base: p / CH });
          }
          strands.push({ sprites, dir: sIdx === 0 ? 1 : -1, phase: sIdx * Math.PI });
        }
        streams.push({ pts, normals: fr.normals, binormals: fr.binormals, M, strands });
      }
    }

    // Blue background network: thin tubes to each node's 3 nearest neighbours.
    const net = points.filter((p) => p.kind === "net");
    const tips = net.map((p) => vec(p.lat, p.lng, TIP_ALT));
    const drawn = new Set<string>();
    for (let a = 0; a < net.length; a++) {
      const near = net
        .map((_, b) => ({ b, d: a === b ? Infinity : tips[a].distanceTo(tips[b]) }))
        .sort((x, y) => x.d - y.d)
        .slice(0, 3);
      for (const { b } of near) {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        const geo = new THREE.TubeGeometry(greatArc(tips[a], tips[b]), 24, 0.08, 6, false);
        group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: MESH_LINE, transparent: true, opacity: 0.22 })));
      }
    }

    scene.add(group);

    // Animate the hex streams: characters flow along each path (opposite ways per
    // strand) while the whole helix rotates, so it reads as flying, spinning data.
    let raf = 0;
    const off = new THREE.Vector3();
    const animate = () => {
      const now = performance.now();
      const flow = now / 3200;
      const rot = now / 2600;
      for (const st of streams) {
        for (const strand of st.strands) {
          for (const { sp, base } of strand.sprites) {
            let tt = (base + strand.dir * flow) % 1;
            if (tt < 0) tt += 1;
            const idx = Math.min(st.M, Math.max(0, Math.floor(tt * st.M)));
            const c = st.pts[idx], n = st.normals[idx], b = st.binormals[idx];
            const ang = tt * TURNS * 2 * Math.PI + strand.phase + rot * strand.dir;
            const co = Math.cos(ang) * HELIX_R, si = Math.sin(ang) * HELIX_R;
            off.set(n.x * co + b.x * si, n.y * co + b.y * si, n.z * co + b.z * si);
            sp.position.set(c.x + off.x, c.y + off.y, c.z + off.z);
          }
        }
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
        // Sprites reuse the shared glyph materials — never dispose those.
        if (!(o as THREE.Sprite).isSprite) {
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else if (mat) mat.dispose();
        }
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
