import { useEffect, useRef, useState } from "react";
import { networkPeers, type Peer, type Geo } from "./api";
import { resolveGeos } from "./geoCache";
import worldmap from "../assets/worldmap.json";

// A live map of the peers this node is connected to. Peer/our-node locations
// come from IP geolocation; the moving pulses are driven by REAL bytes flowing
// between us and each peer. Transactions have no location on-chain, so nothing
// here pretends to show a transaction's origin — it's honest network topology.

const POLYS: number[][][] = (worldmap as { polys: number[][][] }).polys;

// equirectangular projection
const project = (lon: number, lat: number, w: number, h: number): [number, number] => [
  ((lon + 180) / 360) * w,
  ((90 - lat) / 180) * h,
];

const clusterKey = (lat: number, lon: number) => `${Math.round(lat)},${Math.round(lon)}`;

// Read an HSL triplet CSS var ("280 80% 60%") into a color()-with-alpha helper.
function hslVar(name: string): (a: number) => string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "0 0% 100%";
  const m = raw.match(/([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  const [h, s, l] = m ? [m[1], m[2], m[3]] : ["0", "0", "100"];
  return (a: number) => `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

interface Pulse {
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  born: number;
  strength: number;
  inbound: boolean;
}

export function NetworkMap() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snap, setSnap] = useState<{ peers: Peer[]; selfIp: string | null } | null>(null);
  const [geos, setGeos] = useState<Record<string, Geo>>({});
  const [located, setLocated] = useState(0);

  const geosRef = useRef(geos);
  geosRef.current = geos;
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const prevBytes = useRef<Map<string, number>>(new Map());
  const pulses = useRef<Pulse[]>([]);
  const baseRef = useRef<HTMLCanvasElement | null>(null);

  // Poll peers, resolve any new IP locations, and turn real byte-deltas into pulses.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await networkPeers();
        if (!alive || !s) return;
        setSnap(s);
        const ips = s.peers.map((p) => p.ip);
        if (s.selfIp) ips.push(s.selfIp);
        await resolveGeos(ips, (m) => {
          if (alive) {
            setGeos({ ...m });
            setLocated(s.peers.filter((p) => m[p.ip]).length);
          }
        });
        // Real traffic → pulses (peer → us for received bytes).
        const g = geosRef.current;
        const self = s.selfIp ? g[s.selfIp] : null;
        const wrap = wrapRef.current;
        if (self && wrap) {
          const w = wrap.clientWidth;
          const h = wrap.clientHeight;
          const [sx, sy] = project(self.lon, self.lat, w, h);
          for (const p of s.peers) {
            const pg = g[p.ip];
            if (!pg) continue;
            const prev = prevBytes.current.get(p.ip);
            prevBytes.current.set(p.ip, p.bytesRecv);
            if (prev == null) continue;
            const delta = p.bytesRecv - prev;
            if (delta > 200) {
              const [px, py] = project(pg.lon, pg.lat, w, h);
              pulses.current.push({
                fx: px,
                fy: py,
                tx: sx,
                ty: sy,
                born: performance.now(),
                strength: Math.min(1, delta / 20000),
                inbound: p.inbound,
              });
            }
          }
        }
      } catch {
        /* keep last */
      }
    };
    poll();
    const id = setInterval(poll, 6000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Build the static base layer (world landmasses) at the current size.
  const buildBase = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const base = baseRef.current ?? document.createElement("canvas");
    baseRef.current = base;
    base.width = w * dpr;
    base.height = h * dpr;
    const ctx = base.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const land = hslVar("--foreground");
    const outline = hslVar("--primary");
    ctx.clearRect(0, 0, w, h);
    for (const ring of POLYS) {
      ctx.beginPath();
      for (let i = 0; i < ring.length; i++) {
        const [x, y] = project(ring[i][0], ring[i][1], w, h);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = land(0.08);
      ctx.fill();
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = outline(0.18);
      ctx.stroke();
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      buildBase();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let raf = 0;
    const draw = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (baseRef.current) ctx.drawImage(baseRef.current, 0, 0, w, h);

      const outbound = hslVar("--primary");
      const inbound = hslVar("--accent");
      const selfCol = hslVar("--warning");
      const s = snapRef.current;
      const g = geosRef.current;
      const now = performance.now();

      const self = s?.selfIp ? g[s.selfIp] : null;
      const selfXY = self ? project(self.lon, self.lat, w, h) : null;

      // faint links self→peers
      if (s && selfXY) {
        for (const p of s.peers) {
          const pg = g[p.ip];
          if (!pg) continue;
          const [px, py] = project(pg.lon, pg.lat, w, h);
          ctx.beginPath();
          ctx.moveTo(selfXY[0], selfXY[1]);
          ctx.lineTo(px, py);
          ctx.strokeStyle = (p.inbound ? inbound : outbound)(0.12);
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }

      // traffic pulses (fade over ~3s, travel peer→self)
      pulses.current = pulses.current.filter((p) => now - p.born < 3000);
      for (const p of pulses.current) {
        const t = (now - p.born) / 3000;
        const life = 1 - t;
        const x = p.fx + (p.tx - p.fx) * t;
        const y = p.fy + (p.ty - p.fy) * t;
        const col = (p.inbound ? inbound : outbound);
        ctx.beginPath();
        ctx.moveTo(p.fx, p.fy);
        ctx.lineTo(x, y);
        ctx.strokeStyle = col(0.15 * life * p.strength + 0.05);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 2 + 2 * p.strength, 0, Math.PI * 2);
        ctx.fillStyle = col(0.7 * life);
        ctx.fill();
      }

      // peer dots, clustered by ~1° cell (size by count)
      if (s) {
        const clusters = new Map<string, { x: number; y: number; n: number; inbound: number }>();
        for (const p of s.peers) {
          const pg = g[p.ip];
          if (!pg) continue;
          const k = clusterKey(pg.lat, pg.lon);
          const [x, y] = project(pg.lon, pg.lat, w, h);
          const c = clusters.get(k) ?? { x, y, n: 0, inbound: 0 };
          c.n += 1;
          if (p.inbound) c.inbound += 1;
          clusters.set(k, c);
        }
        for (const c of clusters.values()) {
          const r = 3 + Math.min(9, Math.log2(c.n + 1) * 3);
          const col = c.inbound > c.n / 2 ? inbound : outbound;
          ctx.beginPath();
          ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
          ctx.fillStyle = col(0.85);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(c.x, c.y, r + 3, 0, Math.PI * 2);
          ctx.strokeStyle = col(0.25);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // our node — pulsing ring
      if (selfXY) {
        const pulse = 4 + 2 * Math.sin(now / 400);
        ctx.beginPath();
        ctx.arc(selfXY[0], selfXY[1], 5, 0, Math.PI * 2);
        ctx.fillStyle = selfCol(1);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(selfXY[0], selfXY[1], 5 + pulse, 0, Math.PI * 2);
        ctx.strokeStyle = selfCol(0.5);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const total = snap?.peers.length ?? 0;

  return (
    <div className="netmap">
      <div className="netmap-legend">
        <span className="nm-item"><span className="nm-dot nm-out" /> Outbound</span>
        <span className="nm-item"><span className="nm-dot nm-in" /> Inbound</span>
        <span className="nm-item"><span className="nm-dot nm-self" /> Your node</span>
        <span className="nm-count">
          {total} peers{located < total ? ` · locating ${total - located}…` : located ? " · located" : ""}
        </span>
      </div>
      <div className="netmap-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} className="netmap-canvas" />
        {!snap && <div className="netmap-empty">Reading peers from the node…</div>}
      </div>
    </div>
  );
}
