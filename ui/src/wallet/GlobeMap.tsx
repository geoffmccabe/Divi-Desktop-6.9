import { useEffect, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import earthNight from "../assets/earth-night.jpg";

// The same node/peer data the flat map shows, drawn on a real 3D globe (city
// lights texture from NASA "Black Marble", via three-globe). Drag to spin, wheel
// to zoom, like Google Earth. Pure renderer: NetworkMap feeds it points + arcs.

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

// Match the flat map's legend: your node gold, active peers pink, network blue.
const COLORS: Record<GlobePoint["kind"], string> = {
  self: "#ffd23f",
  peer: "#ff5ea8",
  net: "#4aa3ff",
};

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
  const posed = useRef(false);

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

  const onReady = () => {
    const g = globeRef.current;
    if (!g) return;
    const c = g.controls() as unknown as { autoRotate: boolean; enableDamping: boolean };
    c.autoRotate = false;
    c.enableDamping = true;
    if (center && !posed.current) {
      g.pointOfView({ lat: center.lat, lng: center.lon, altitude: 2 }, 0);
      posed.current = true;
    }
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
        arcsData={arcs}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcColor={() => ["rgba(74,163,255,0.15)", "rgba(255,94,168,0.85)"]}
        arcStroke={0.5}
        arcDashLength={0.4}
        arcDashGap={0.2}
        arcDashAnimateTime={2500}
        arcsTransitionDuration={0}
      />
    </div>
  );
}
