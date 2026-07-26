import { useEffect, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import earthNight from "../assets/earth-night.jpg";

// The node map on a real 3D globe (city-lights texture, drag/spin/zoom). Nodes
// are custom three.js "Node Towers": a tall square pyramid with a sphere at its
// tip. Connection lines run to the centre of that top sphere. Peers link to your
// node (purple); the background network links neighbour-to-neighbour (blue).

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

// Node Tower geometry. Pyramid is 3x taller than a base side; the top sphere's
// diameter is 1/3 of a side, centred exactly on the pyramid's tip.
const SIDE = 2;
const PYR_H = 3 * SIDE; // pyramid height
const PYR_CIRC = SIDE / Math.SQRT2; // cone circumradius so the square base side = SIDE
const SPH_R = SIDE / 6; // sphere radius (diameter = SIDE/3)
const TIP_ALT = PYR_H / R; // altitude (radius units) of the sphere centre

const COLORS: Record<GlobePoint["kind"], number> = {
  self: 0xffd23f, // gold
  peer: 0xff5ea8, // pink
  net: 0x4aa3ff, // blue
};
const PEER_LINE = 0xb28cff; // purple, like the flat map
const MESH_LINE = 0x4aa3ff; // blue background network
const UP = new THREE.Vector3(0, 1, 0);

// One Node Tower: pyramid (base on surface) + sphere at the tip, coloured.
function makeTower(color: number): THREE.Group {
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.5, metalness: 0.2 });
  const cone = new THREE.ConeGeometry(PYR_CIRC, PYR_H, 4);
  cone.translate(0, PYR_H / 2, 0); // base at y=0, tip at y=PYR_H
  const sph = new THREE.SphereGeometry(SPH_R, 16, 12);
  sph.translate(0, PYR_H, 0); // sphere centre on the tip
  const g = new THREE.Group();
  g.add(new THREE.Mesh(cone, mat));
  g.add(new THREE.Mesh(sph, mat));
  return g;
}

// A tube line following a gentle outward-bowing curve between two tip points.
function makeLine(a: THREE.Vector3, b: THREE.Vector3, radius: number, color: number, opacity: number) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const lift = a.distanceTo(b) * 0.18;
  const ctrl = mid.clone().add(mid.clone().normalize().multiplyScalar(lift));
  const curve = new THREE.QuadraticBezierCurve3(a, ctrl, b);
  const geo = new THREE.TubeGeometry(curve, 24, radius, 8, false);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity });
  return { mesh: new THREE.Mesh(geo, mat), curve };
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

  // Start where it is; 3s after mount glide in to frame the nodes, but never if
  // the user has already moved the globe (so a data poll can't yank the camera).
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

  // Build the towers + lines into a group on the globe's scene, and animate a dot
  // along each peer line. Rebuilt whenever the node/arc data changes.
  useEffect(() => {
    const g = globeRef.current;
    if (!ready || !g) return;
    const scene = g.scene();
    const group = new THREE.Group();

    const tipOf = (lat: number, lng: number) => {
      const c = g.getCoords(lat, lng, TIP_ALT);
      return new THREE.Vector3(c.x, c.y, c.z);
    };

    // Towers
    for (const p of points) {
      const t = makeTower(COLORS[p.kind]);
      const s = g.getCoords(p.lat, p.lng, 0);
      const pos = new THREE.Vector3(s.x, s.y, s.z);
      t.position.copy(pos);
      t.quaternion.setFromUnitVectors(UP, pos.clone().normalize()); // stand up radially
      group.add(t);
    }

    // Peer lines: your node's tip -> each peer's tip (2px-ish purple), with a dot.
    const self = points.find((p) => p.kind === "self");
    const dots: { curve: THREE.QuadraticBezierCurve3; mesh: THREE.Mesh; phase: number }[] = [];
    if (self) {
      const selfTip = tipOf(self.lat, self.lng);
      let i = 0;
      for (const a of arcs) {
        const peerTip = tipOf(a.endLat, a.endLng);
        const { mesh, curve } = makeLine(selfTip, peerTip, 0.3, PEER_LINE, 0.5);
        group.add(mesh);
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.38, 12, 10),
          new THREE.MeshBasicMaterial({ color: 0xe6d6ff })
        );
        group.add(dot);
        dots.push({ curve, mesh: dot, phase: (i * 0.618) % 1 });
        i++;
      }
    }

    // Blue background network: link each network node to its 3 nearest neighbours.
    const net = points.filter((p) => p.kind === "net");
    const tips = net.map((p) => tipOf(p.lat, p.lng));
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
        group.add(makeLine(tips[a], tips[b], 0.16, MESH_LINE, 0.22).mesh);
      }
    }

    scene.add(group);

    // Dots zip back and forth toward your node.
    let raf = 0;
    const PERIOD = 4200;
    const animate = () => {
      const now = performance.now();
      for (const d of dots) {
        const cycle = ((now + d.phase * PERIOD) % PERIOD) / PERIOD;
        const u = 0.5 - 0.5 * Math.cos(2 * Math.PI * cycle);
        const p = d.curve.getPoint(1 - u); // travel toward self (curve starts at self)
        d.mesh.position.set(p.x, p.y, p.z);
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
