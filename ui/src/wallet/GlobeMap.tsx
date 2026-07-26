import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import earthNight from "../assets/earth-night.jpg";

// The same node/peer data the flat map shows, drawn on a real 3D globe (city
// lights texture from NASA "Black Marble", via three-globe). Drag to spin, wheel
// to zoom, like Google Earth. Pure renderer: NetworkMap feeds it points + arcs.
//
// Arc styling mirrors the flat map: a faint, thin, transparent purple line with
// a brighter dot that zips along it toward your node. We express that as TWO
// globe arcs per connection (a static "line" + an animated "dot"), told apart by
// per-arc accessor functions.

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
interface ArcObj {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  role: "line" | "dot";
  phase: number;
}

// Match the flat map's legend: your node gold, active peers pink, network blue.
const COLORS: Record<GlobePoint["kind"], string> = {
  self: "#ffd23f",
  peer: "#ff5ea8",
  net: "#4aa3ff",
};

// Purple, like the flat map's connection arcs. Line is faint + transparent; the
// travelling dot is a short bright segment.
const LINE_COLOR = ["rgba(178,140,255,0.22)", "rgba(178,140,255,0.22)"];
const DOT_COLOR = ["rgba(224,200,255,0.15)", "rgba(238,222,255,0.98)"];

const DEG = Math.PI / 180;

// Great-circle angle (degrees) between two lat/lng points.
function angDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const la1 = aLat * DEG, la2 = bLat * DEG, dlo = (bLng - aLng) * DEG;
  const c = Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(dlo);
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}

// A point of view that frames most of the nodes, like the flat map's auto-fit:
// centroid of the nodes, with an altitude scaled to how spread out they are.
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
  // ~45deg spread fills a comfortable view; clamp so we never zoom absurdly.
  const altitude = Math.max(0.45, Math.min(2.4, maxd / 45));
  return { lat: clat, lng: clng, altitude };
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
  const pointsRef = useRef(points);
  pointsRef.current = points;

  // Size the WebGL canvas to its container (react-globe.gl needs explicit px).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Start where it is, then after 3s glide in to frame the node cloud.
  useEffect(() => {
    const t = setTimeout(() => {
      const g = globeRef.current;
      if (!g) return;
      const pov = frameNodes(pointsRef.current) ??
        (center ? { lat: center.lat, lng: center.lon, altitude: 1.2 } : null);
      if (pov) g.pointOfView(pov, 1600);
    }, 3000);
    return () => clearTimeout(t);
  }, [center]);

  // Two arcs per connection: a faint static line + a bright dot zipping toward
  // our node (so start=peer, end=self). Staggered so dots don't all line up.
  const arcObjs = useMemo<ArcObj[]>(
    () =>
      arcs.flatMap((a, i) => {
        const base = { startLat: a.endLat, startLng: a.endLng, endLat: a.startLat, endLng: a.startLng };
        return [
          { ...base, role: "line" as const, phase: 0 },
          { ...base, role: "dot" as const, phase: (i * 0.618) % 1 },
        ];
      }),
    [arcs]
  );

  const onReady = () => {
    const g = globeRef.current;
    if (!g) return;
    const c = g.controls() as unknown as { autoRotate: boolean; enableDamping: boolean };
    c.autoRotate = false;
    c.enableDamping = true;
    if (center) g.pointOfView({ lat: center.lat, lng: center.lon, altitude: 2.2 }, 0);
  };

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
        pointsData={points}
        pointLat="lat"
        pointLng="lng"
        pointColor={(d) => COLORS[(d as GlobePoint).kind]}
        pointAltitude={(d) => ((d as GlobePoint).kind === "self" ? 0.06 : 0.02)}
        pointRadius={(d) => {
          const k = (d as GlobePoint).kind;
          return k === "self" ? 0.7 : k === "peer" ? 0.45 : 0.32;
        }}
        pointLabel={(d) => {
          const p = d as GlobePoint;
          const place = [p.city, p.country].filter(Boolean).join(", ");
          return `<div class="globe-tip">${place ? place + "<br/>" : ""}${p.ip}</div>`;
        }}
        arcsData={arcObjs}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcAltitudeAutoScale={0.4}
        arcColor={(d: object) => ((d as ArcObj).role === "dot" ? DOT_COLOR : LINE_COLOR)}
        arcDashLength={(d: object) => ((d as ArcObj).role === "dot" ? 0.06 : 1)}
        arcDashGap={(d: object) => ((d as ArcObj).role === "dot" ? 3 : 0)}
        arcDashInitialGap={(d: object) => (d as ArcObj).phase * 3}
        arcDashAnimateTime={(d: object) => ((d as ArcObj).role === "dot" ? 2600 : 0)}
        arcsTransitionDuration={0}
      />
    </div>
  );
}
