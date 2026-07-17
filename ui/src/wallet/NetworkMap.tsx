import { useEffect, useRef, useState } from "react";
import { networkPeers, selfGeo, probePeers, type Peer, type Geo } from "./api";
import { resolveGeos } from "./geoCache";
import { loadKnown, recordKnown, type Known } from "./knownPeers";
import { Icon } from "../Icon";
import worldmap from "../assets/worldmap.json";

// A live map of the peers this node is connected to. At boot it centers on you
// with radiating "searching" rings; as each peer is found it appears as a green
// light with a pulsing line back to you. Peer/our-node locations come from IP
// geolocation. Transactions have no location on-chain, so nothing here pretends
// to show a transaction's origin — it's honest network topology.

const POLYS: number[][][] = (worldmap as { polys: number[][][] }).polys;

const project = (lon: number, lat: number, w: number, h: number): [number, number] => [
  ((lon + 180) / 360) * w,
  ((90 - lat) / 180) * h,
];

const clusterKey = (lat: number, lon: number) => `${Math.round(lat)},${Math.round(lon)}`;
// stable per-ip phase so each line pulses a little out of sync
const phaseOf = (ip: string) => {
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = (h * 31 + ip.charCodeAt(i)) % 1000;
  return (h / 1000) * Math.PI * 2;
};

// A quadratic bezier that always bows UP (control point lifted in -y).
function upArc(sx: number, sy: number, px: number, py: number): (u: number) => [number, number] {
  const mx = (sx + px) / 2;
  const my = (sy + py) / 2;
  const len = Math.hypot(px - sx, py - sy) || 1;
  const cx = mx;
  const cy = my - Math.min(90, len * 0.3);
  return (u: number) => {
    const v = 1 - u;
    return [v * v * sx + 2 * v * u * cx + u * u * px, v * v * sy + 2 * v * u * cy + u * u * py];
  };
}

function hslVar(name: string): (a: number) => string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "0 0% 100%";
  const m = raw.match(/([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  const [h, s, l] = m ? [m[1], m[2], m[3]] : ["0", "0", "100"];
  return (a: number) => `hsla(${h}, ${s}%, ${l}%, ${a})`;
}
const GREEN = (a: number) => `hsla(145, 80%, 50%, ${a})`;
const GREY = (a: number) => `hsla(0, 0%, 62%, ${a})`;

type ProbeState = "probing" | "online" | "offline";

interface Pulse {
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  born: number;
  strength: number;
  inbound: boolean;
}

interface HoverPoint {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

function fmtDur(secs: number): string {
  if (secs < 90) return `${Math.max(0, secs)}s`;
  if (secs < 5400) return `${Math.round(secs / 60)}m`;
  if (secs < 172800) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}d`;
}

export function NetworkMap({ onReturn }: { onReturn?: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snap, setSnap] = useState<{ peers: Peer[]; selfIp: string | null } | null>(null);
  const [geos, setGeos] = useState<Record<string, Geo>>({});
  const [self, setSelf] = useState<Geo | null>(null);
  const [hover, setHover] = useState<HoverPoint | null>(null);
  const pointsRef = useRef<HoverPoint[]>([]);

  const geosRef = useRef(geos);
  geosRef.current = geos;
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const selfRef = useRef(self);
  selfRef.current = self;
  const prevBytes = useRef<Map<string, number>>(new Map());
  const pulses = useRef<Pulse[]>([]);
  const revealed = useRef<Map<string, number>>(new Map()); // ip -> first-seen ms
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  // Peers seen in the last 30 days (grey at startup), and the live probe result.
  const knownRef = useRef<Known>({});
  const probeRef = useRef<Map<string, ProbeState>>(new Map());

  // Center on us right away (caller-IP lookup), before any peer connects.
  useEffect(() => {
    let alive = true;
    selfGeo().then((g) => {
      if (alive && g) setSelf(g);
    });

    // Load known peers and immediately probe them for reachability, so the map
    // has something to show at boot and lights up the ones that are online.
    const known = loadKnown();
    knownRef.current = known;
    const ips = Object.keys(known);
    if (ips.length) {
      for (const ip of ips) probeRef.current.set(ip, "probing");
      probePeers(ips)
        .then((res) => {
          if (!alive) return;
          for (const r of res) probeRef.current.set(r.ip, r.online ? "online" : "offline");
          // any not returned → offline
          for (const ip of ips) if (probeRef.current.get(ip) === "probing") probeRef.current.set(ip, "offline");
        })
        .catch(() => {
          for (const ip of ips) probeRef.current.set(ip, "offline");
        });
    }
    return () => {
      alive = false;
    };
  }, []);

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
          if (!alive) return;
          setGeos({ ...m });
          const seen: { ip: string; lat: number; lon: number; city?: string; country?: string }[] = [];
          let newIdx = 0;
          for (const p of s.peers) {
            const pg = m[p.ip];
            if (!pg) continue;
            seen.push({ ip: p.ip, lat: pg.lat, lon: pg.lon, city: pg.city, country: pg.country });
            probeRef.current.set(p.ip, "online"); // connected = definitely online
            // Stagger reveal times so peers pop in one-by-one, not all at once.
            if (!revealed.current.has(p.ip)) {
              revealed.current.set(p.ip, performance.now() + newIdx * 350);
              newIdx++;
            }
          }
          if (seen.length) knownRef.current = recordKnown(knownRef.current, seen);
        });
        // real received-byte deltas → traffic pulses
        const g = geosRef.current;
        const selfG = (s.selfIp && g[s.selfIp]) || selfRef.current;
        const wrap = wrapRef.current;
        if (selfG && wrap) {
          const w = wrap.clientWidth;
          const h = wrap.clientHeight;
          const [sx, sy] = project(selfG.lon, selfG.lat, w, h);
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
    const id = setInterval(poll, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

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

    const onMove = (e: MouseEvent) => {
      const rect = wrap.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let best: HoverPoint | null = null;
      let bestD = 16 * 16;
      for (const pt of pointsRef.current) {
        const d = (pt.x - mx) ** 2 + (pt.y - my) ** 2;
        if (d < bestD) {
          bestD = d;
          best = pt;
        }
      }
      setHover(best ? { ...best, x: mx, y: my } : null);
    };
    const onLeave = () => setHover(null);
    wrap.addEventListener("mousemove", onMove);
    wrap.addEventListener("mouseleave", onLeave);

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
      const inbound = hslVar("--info"); // blue — clearly distinct from purple outbound
      const selfCol = hslVar("--warning");
      const s = snapRef.current;
      const g = geosRef.current;
      const now = performance.now();

      const selfG = (s?.selfIp && g[s.selfIp]) || selfRef.current;
      const selfXY = selfG ? project(selfG.lon, selfG.lat, w, h) : null;
      const peerCount = s?.peers.filter((p) => g[p.ip]).length ?? 0;
      const liveIps = new Set((s?.peers ?? []).filter((p) => g[p.ip]).map((p) => p.ip));

      // Known peers (last 30 days) that aren't currently connected: faint grey so
      // there's something at startup, or a green "probing" arc + flashing "?"
      // while we're checking if they're reachable.
      if (selfXY) {
        const [sx, sy] = selfXY;
        for (const [ip, kp] of Object.entries(knownRef.current)) {
          if (liveIps.has(ip)) continue; // connected ones are drawn below
          const [px, py] = project(kp.lon, kp.lat, w, h);
          // Default to "probing" so arcs appear the instant the map opens (the
          // same moment as the grey dots), then persist for reachable peers.
          // Only peers the probe found unreachable drop to a static grey dot.
          const st = probeRef.current.get(ip) ?? "probing";
          if (st === "offline") {
            // known but unreachable: faint grey dot
            ctx.beginPath();
            ctx.arc(px, py, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = GREY(0.28);
            ctx.fill();
          } else {
            // probing OR reachable → the pulsing green up-arc (grows from us to
            // the peer, ≤50% at the tip, desynced per-IP). The flashing "?" only
            // shows while we're still checking; once reachable it drops away.
            const dx = px - sx, dy = py - sy;
            const len = Math.hypot(dx, dy) || 1;
            const bez = upArc(sx, sy, px, py);
            const period = 1400, travel = 1000;
            const local = (now + (phaseOf(ip) / (Math.PI * 2)) * period) % period;
            if (local < travel) {
              const headU = local / travel;
              let prev = bez(0);
              for (let u = 0.04; u <= headU + 1e-6; u += 0.04) {
                const p2 = bez(u);
                ctx.beginPath();
                ctx.moveTo(prev[0], prev[1]);
                ctx.lineTo(p2[0], p2[1]);
                ctx.strokeStyle = GREEN(0.5 * (u / headU));
                ctx.lineWidth = 1;
                ctx.stroke();
                prev = p2;
              }
              const [hx, hy] = bez(headU);
              ctx.beginPath();
              ctx.arc(hx, hy, 2, 0, Math.PI * 2);
              ctx.fillStyle = GREEN(0.5);
              ctx.fill();
            }
            if (st === "probing") {
              const qx = px + (dx / len) * 12, qy = py + (dy / len) * 12;
              ctx.fillStyle = GREEN(0.2 + 0.3 * Math.abs(Math.sin(now / 450)));
              ctx.font = "bold 12px system-ui";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText("?", qx, qy);
            }
          }
        }
      }

      // radiating "searching" rings from our node (stronger while few peers)
      if (selfXY) {
        const intensity = peerCount < 4 ? 1 : 0.35;
        const maxR = 150;
        for (let k = 0; k < 4; k++) {
          const prog = ((now / 2600 + k / 4) % 1);
          ctx.beginPath();
          ctx.arc(selfXY[0], selfXY[1], prog * maxR, 0, Math.PI * 2);
          ctx.strokeStyle = selfCol((1 - prog) * 0.35 * intensity);
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
      }

      // arced links self→peer, revealed one-by-one (staggered reveal time), each
      // greeting with a brief green flash then settling to its inbound/outbound
      // colour with a gentle pulse.
      if (s && selfXY) {
        for (const p of s.peers) {
          const pg = g[p.ip];
          if (!pg) continue;
          const rev = revealed.current.get(p.ip);
          if (rev == null || rev > now) continue; // its turn hasn't come yet
          const [px, py] = project(pg.lon, pg.lat, w, h);
          const revAge = now - rev;
          const fresh = revAge < 2200;
          const pulse = 0.12 + 0.1 * (0.5 + 0.5 * Math.sin(now / 500 + phaseOf(p.ip)));
          const bez = upArc(selfXY[0], selfXY[1], px, py);
          ctx.beginPath();
          for (let u = 0; u <= 1.0001; u += 0.05) {
            const [x, y] = bez(u);
            u === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.strokeStyle = fresh ? GREEN(0.6 * (1 - revAge / 2200) + 0.2) : (p.inbound ? inbound : outbound)(pulse);
          ctx.lineWidth = fresh ? 1.6 : 0.8;
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
        const col = p.inbound ? inbound : outbound;
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
          const rev = revealed.current.get(p.ip);
          if (rev == null || rev > now) continue; // not revealed yet
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
        // green "appear" burst for freshly-located peers
        for (const p of s.peers) {
          const pg = g[p.ip];
          if (!pg) continue;
          const rev = revealed.current.get(p.ip);
          if (rev == null || rev > now) continue;
          const revAge = now - rev;
          if (revAge >= 1800) continue;
          const t = revAge / 1800;
          const [x, y] = project(pg.lon, pg.lat, w, h);
          ctx.beginPath();
          ctx.arc(x, y, 4 + 26 * t, 0, Math.PI * 2);
          ctx.strokeStyle = GREEN((1 - t) * 0.8);
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fillStyle = GREEN(0.5 + 0.5 * (1 - t));
          ctx.fill();
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

      // Collect hover targets (screen positions + real details). Note: a peer's
      // IP tells us nothing about any wallet address — that isn't on the network,
      // so it's never shown here.
      const pts: HoverPoint[] = [];
      if (selfXY && selfG) {
        pts.push({
          x: selfXY[0],
          y: selfXY[1],
          title: "Your node",
          lines: [selfG.ip, [selfG.city, selfG.country].filter(Boolean).join(", ")].filter(Boolean),
        });
      }
      if (s) {
        for (const p of s.peers) {
          const pg = g[p.ip];
          if (!pg) continue;
          const rev = revealed.current.get(p.ip);
          if (rev == null || rev > now) continue;
          const [x, y] = project(pg.lon, pg.lat, w, h);
          pts.push({
            x,
            y,
            title: pg.city ? `${pg.city}, ${pg.country}` : p.ip,
            lines: [
              p.ip,
              p.inbound ? "Inbound peer" : "Outbound peer",
              `Ping ${Math.round(p.pingMs)} ms · connected ${fmtDur(p.connSecs)}`,
              p.subver || "",
              `Block ${p.height.toLocaleString()}`,
            ].filter(Boolean),
          });
        }
      }
      const liveNow = new Set((s?.peers ?? []).filter((p) => g[p.ip]).map((p) => p.ip));
      for (const [ip, kp] of Object.entries(knownRef.current)) {
        if (liveNow.has(ip)) continue;
        const [x, y] = project(kp.lon, kp.lat, w, h);
        const st = probeRef.current.get(ip) ?? "probing";
        const loc = [kp.city, kp.country].filter(Boolean).join(", ");
        pts.push({
          x,
          y,
          title: loc || ip,
          lines: [
            loc ? ip : "",
            st === "online" ? "Reachable (not connected)" : st === "probing" ? "Checking…" : "Idle / unreachable",
            "Seen in the last 30 days",
          ].filter(Boolean),
        });
      }
      pointsRef.current = pts;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      wrap.removeEventListener("mousemove", onMove);
      wrap.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <div className="netmap">
      <div className="netmap-topbar">
        <button type="button" className="netmap-return" onClick={onReturn}>
          <Icon name="overview" size={14} /> Return to Overview
        </button>
        <div className="netmap-legend">
          <span className="nm-item"><span className="nm-dot nm-out" /> Outbound</span>
          <span className="nm-item"><span className="nm-dot nm-in" /> Inbound</span>
          <span className="nm-item"><span className="nm-dot nm-self" /> Your node</span>
        </div>
      </div>
      <div className="netmap-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} className="netmap-canvas" />
        {hover && (
          <div
            className="netmap-tip"
            style={{
              left: Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 9999) - 220),
              top: Math.max(8, hover.y - 10),
            }}
          >
            <div className="netmap-tip-title">{hover.title}</div>
            {hover.lines.map((l, i) => (
              <div key={i} className="netmap-tip-line">{l}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
