import { useEffect, useRef, useState } from "react";
import { networkPeers, probePeers, type Peer, type Geo } from "./api";
import { resolveGeos } from "./geoCache";
import { loadKnown, recordKnown, type Known } from "./knownPeers";
import { BlockChainViz } from "./BlockChainViz";
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

// A quadratic bezier that always bows UP (control point lifted in -y). `mult`
// scales the curvature — established (purple) arcs use 0.5 so they sit flatter
// than the green probing arcs and don't overlap them.
function upArc(sx: number, sy: number, px: number, py: number, mult = 1): (u: number) => [number, number] {
  const mx = (sx + px) / 2;
  const my = (sy + py) / 2;
  const len = Math.hypot(px - sx, py - sy) || 1;
  const cx = mx;
  const cy = my - Math.min(90, len * 0.3) * mult;
  return (u: number) => {
    const v = 1 - u;
    return [v * v * sx + 2 * v * u * cx + u * u * px, v * v * sy + 2 * v * u * cy + u * u * py];
  };
}

// Time-based label visibility: each peer's label appears for `visibleMs` on a
// per-peer randomised cycle (periodMin..periodMax), fading in and out, so labels
// stagger in time and never all crowd the map at once. Returns 0..1 opacity.
function labelPulse(now: number, ip: string, periodMin: number, periodMax: number, visibleMs: number): number {
  const seed = phaseOf(ip) / (Math.PI * 2); // stable 0..1 per IP
  const period = periodMin + seed * (periodMax - periodMin);
  const local = (now + seed * period) % period;
  if (local >= visibleMs) return 0;
  return Math.sin((local / visibleMs) * Math.PI); // fade in → out
}

function hslVar(name: string): (a: number) => string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "0 0% 100%";
  const m = raw.match(/([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  const [h, s, l] = m ? [m[1], m[2], m[3]] : ["0", "0", "100"];
  return (a: number) => `hsla(${h}, ${s}%, ${l}%, ${a})`;
}
const GREEN = (a: number) => `hsla(145, 80%, 50%, ${a})`;

// Dark sunglasses drawn above the centre of a node's circle (the "face"), scaled
// to it — the stake-winner marker. Drawn last so nothing covers it.
function drawGlasses(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const s = Math.max(6, r * 1.5); // glasses half-width
  const gy = cy - r * 0.35; // sit above centre
  const lx = cx - s * 0.5, rx = cx + s * 0.5;
  const lensRx = s * 0.42, lensRy = s * 0.34;
  ctx.save();
  ctx.fillStyle = "rgba(8,8,12,0.95)";
  ctx.strokeStyle = "rgba(8,8,12,0.95)";
  ctx.lineWidth = Math.max(1, s * 0.16);
  ctx.beginPath(); ctx.ellipse(lx, gy, lensRx, lensRy, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(rx, gy, lensRx, lensRy, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(lx + lensRx * 0.7, gy - lensRy * 0.2); ctx.lineTo(rx - lensRx * 0.7, gy - lensRy * 0.2); ctx.stroke();
  // subtle shine on each lens
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath(); ctx.ellipse(lx - lensRx * 0.3, gy - lensRy * 0.3, lensRx * 0.25, lensRy * 0.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(rx - lensRx * 0.3, gy - lensRy * 0.3, lensRx * 0.25, lensRy * 0.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

type ProbeState = "probing" | "online" | "offline";


interface HoverPoint {
  x: number;
  y: number;
  title: string;
  lines: string[];
  tone?: "blue"; // active-but-not-connected background node
}

// The node's last-known location, persisted so the map shows instantly on boot
// (even offline / before the node answers) and only updates once verified.
function loadSelfGeo(): Geo | null {
  try {
    const s = localStorage.getItem("dd69.selfGeo");
    return s ? (JSON.parse(s) as Geo) : null;
  } catch {
    return null;
  }
}
function saveSelfGeo(g: Geo) {
  try {
    localStorage.setItem("dd69.selfGeo", JSON.stringify(g));
  } catch {
    /* storage unavailable */
  }
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
  const [hover, setHover] = useState<HoverPoint | null>(null);
  const pointsRef = useRef<HoverPoint[]>([]);

  const geosRef = useRef(geos);
  geosRef.current = geos;
  const snapRef = useRef(snap);
  snapRef.current = snap;
  // The node's OWN location, from its real public IP (as peers report it). This
  // is where the node actually runs — cached so it stays put and never flickers.
  // We deliberately do NOT use the app's caller IP: with a remote node that's a
  // different machine, which would place the node in the wrong city.
  const selfRef = useRef<Geo | null>(null);
  const revealed = useRef<Map<string, number>>(new Map()); // ip -> first-seen ms
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  // Peers seen in the last 30 days (grey at startup), and the live probe result.
  const knownRef = useRef<Known>({});
  const probeRef = useRef<Map<string, ProbeState>>(new Map());
  const lastProbe = useRef(0); // last re-ping time (re-ping every 60s)
  // The node currently wearing the "stake winner" sunglasses. NOTE: the real
  // winner (an address) can't be mapped to a node/IP, so for now this rotates to
  // a peer each block-interval as a visual placeholder.
  const winnerRef = useRef<string | null>(null);
  const winnerAt = useRef(0);
  // View transform: auto-fit the active network to the viewport, or the user's
  // manual scroll-zoom. `auto` re-fits every frame until the user scrolls.
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0, auto: true });

  useEffect(() => {
    let alive = true;
    // Show the last-known node location immediately, from disk.
    selfRef.current = loadSelfGeo();

    // Load the 30-day known peers + geolocate them (for city labels). We DON'T
    // ping them yet — that starts once we have 20 live peers (see the poll).
    const known = loadKnown();
    knownRef.current = known;
    const ips = Object.keys(known);
    if (ips.length) {
      for (const ip of ips) probeRef.current.set(ip, "probing");
      resolveGeos(ips, (m) => {
        if (alive) setGeos((prev) => ({ ...prev, ...m }));
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
        // Rotate the "stake winner" sunglasses to a peer each ~block-interval
        // (placeholder — the real winner address can't be mapped to a node).
        const nowW = performance.now();
        if (s.peers.length && nowW - winnerAt.current > 60000) {
          winnerAt.current = nowW;
          const idx = Math.floor(((nowW / 60000) % s.peers.length + s.peers.length) % s.peers.length);
          winnerRef.current = s.peers[idx].ip;
        }
        // Once well-connected (20+ peers), (re)ping the 30-day known nodes to see
        // which are still active — first at 20 peers, then every 60s. Each wave
        // flips nodes back to "probing" (a green wave) before settling to blue
        // (active) or dropping off the map (dead).
        const nowMs = performance.now();
        if (s.peers.length >= 20 && nowMs - lastProbe.current > 60000) {
          lastProbe.current = nowMs;
          const kips = Object.keys(knownRef.current);
          if (kips.length) {
            for (const ip of kips) if (probeRef.current.get(ip) === "offline") probeRef.current.set(ip, "probing");
            probePeers(kips)
              .then((res) => {
                if (!alive) return;
                for (const r of res) probeRef.current.set(r.ip, r.online ? "online" : "offline");
                for (const ip of kips) if (probeRef.current.get(ip) === "probing") probeRef.current.set(ip, "offline");
              })
              .catch(() => {
                for (const ip of kips) probeRef.current.set(ip, "offline");
              });
          }
        }
        const ips = s.peers.map((p) => p.ip);
        if (s.selfIp) ips.push(s.selfIp);
        await resolveGeos(ips, (m) => {
          if (!alive) return;
          setGeos({ ...m });
          // The node's verified location → cache it (stable + persisted to disk).
          if (s.selfIp && m[s.selfIp]) {
            selfRef.current = m[s.selfIp];
            saveSelfGeo(m[s.selfIp]);
          }
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

    // Keep the view in bounds: never zoom out past the full map (scale ≥ 1) and
    // never pan the world off the viewport.
    const clampView = () => {
      const v = viewRef.current;
      const cw = wrap.clientWidth, ch = wrap.clientHeight;
      v.scale = Math.min(Math.max(v.scale, 1), 40);
      v.tx = Math.min(0, Math.max(cw - cw * v.scale, v.tx));
      v.ty = Math.min(0, Math.max(ch - ch * v.scale, v.ty));
    };
    let dragging = false;
    let dsx = 0, dsy = 0, dtx = 0, dty = 0;
    const onMove = (e: MouseEvent) => {
      if (dragging) {
        const v = viewRef.current;
        v.tx = dtx + (e.clientX - dsx);
        v.ty = dty + (e.clientY - dsy);
        clampView();
        return;
      }
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
    const onDown = (e: MouseEvent) => {
      dragging = true;
      dsx = e.clientX; dsy = e.clientY;
      dtx = viewRef.current.tx; dty = viewRef.current.ty;
      viewRef.current.auto = false;
      setHover(null);
    };
    const onUp = () => { dragging = false; };
    // Scroll wheel zooms about the cursor; double-click re-enables auto-fit.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const v = viewRef.current;
      v.auto = false;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const ns = Math.min(Math.max(v.scale * factor, 1), 40);
      v.tx = mx - ((mx - v.tx) / v.scale) * ns;
      v.ty = my - ((my - v.ty) / v.scale) * ns;
      v.scale = ns;
      clampView();
    };
    const onDbl = () => {
      viewRef.current.auto = true;
    };
    wrap.addEventListener("mousemove", onMove);
    wrap.addEventListener("mouseleave", onLeave);
    wrap.addEventListener("wheel", onWheel, { passive: false });
    wrap.addEventListener("dblclick", onDbl);
    wrap.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);

    let raf = 0;
    const draw = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const outbound = hslVar("--primary");
      const inbound = hslVar("--info"); // blue — clearly distinct from purple outbound
      const selfCol = hslVar("--warning");
      const s = snapRef.current;
      const g = geosRef.current;
      const now = performance.now();
      const BLUE = (a: number) => `hsla(210, 85%, 62%, ${a})`;

      // The node's true location comes from its own public IP; cache it so it's
      // stable (and never falls back to the app machine's location).
      if (s?.selfIp && g[s.selfIp]) selfRef.current = g[s.selfIp];
      const selfG = selfRef.current;
      const peerCount = s?.peers.filter((p) => g[p.ip]).length ?? 0;
      const liveCount = s?.peers.length ?? 0;
      const liveIps = new Set((s?.peers ?? []).filter((p) => g[p.ip]).map((p) => p.ip));
      // Anchors of labels already drawn this frame — shared by all loops.
      const labelAnchors: [number, number][] = [];

      // The active background nodes (verified-active 30-day nodes, not connected),
      // computed once and reused for both the auto-fit and the mesh drawing.
      const blueNodes =
        liveCount >= 20
          ? Object.entries(knownRef.current)
              .filter(([ip]) => !liveIps.has(ip) && probeRef.current.get(ip) === "online")
              .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
              .slice(0, 40)
          : [];

      // ── View transform: auto-fit into the viewport with a 2% margin, or honour
      // the user's manual pan/zoom. project() = full-world pixels; the view then
      // scales/pans those onto the screen, and P() applies it. The fit must cover
      // BOTH the node points AND the arcs, which bow up above the nodes.
      const wpx = (lon: number, lat: number) => project(lon, lat, w, h);
      if (viewRef.current.auto) {
        const selfPt = selfG ? wpx(selfG.lon, selfG.lat) : null;
        const nodePts: [number, number][] = [];
        if (selfPt) nodePts.push(selfPt);
        if (s) for (const p of s.peers) { const pg = g[p.ip]; if (pg) nodePts.push(wpx(pg.lon, pg.lat)); }
        for (const [, kp] of blueNodes) nodePts.push(wpx(kp.lon, kp.lat));
        const pts: [number, number][] = [...nodePts];
        // add each arc's apex: it rises above the self→node midpoint by the (green,
        // worst-case) lift, which is in screen px — convert to world via the scale.
        if (selfPt) {
          const ps = viewRef.current.scale || 1;
          for (const b of nodePts) {
            if (b === selfPt) continue;
            const mx = (selfPt[0] + b[0]) / 2, my = (selfPt[1] + b[1]) / 2;
            const worldLen = Math.hypot(b[0] - selfPt[0], b[1] - selfPt[1]);
            const liftWorld = Math.min(90, worldLen * ps * 0.3) / ps;
            pts.push([mx, my - liftWorld]);
          }
        }
        if (pts.length >= 2) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
          const bw = Math.max(maxX - minX, 30), bh = Math.max(maxY - minY, 30);
          const scale = Math.min((w * 0.96) / bw, (h * 0.96) / bh, 14);
          viewRef.current.scale = scale;
          viewRef.current.tx = w / 2 - ((minX + maxX) / 2) * scale;
          viewRef.current.ty = h / 2 - ((minY + maxY) / 2) * scale;
        }
      }
      const view = viewRef.current;
      const P = (lon: number, lat: number): [number, number] => {
        const [x, y] = wpx(lon, lat);
        return [x * view.scale + view.tx, y * view.scale + view.ty];
      };

      // base world map, scaled/panned by the view
      if (baseRef.current) ctx.drawImage(baseRef.current, view.tx, view.ty, w * view.scale, h * view.scale);

      const selfXY = selfG ? P(selfG.lon, selfG.lat) : null;

      // ── Background network mesh: active 30-day nodes as a faint-blue living
      // network UNDER the real connection arcs (3-nearest-neighbour topology).
      if (selfXY && liveCount >= 20) {
        const blue = blueNodes.map(([ip, kp]) => ({ ip, kp, xy: P(kp.lon, kp.lat) }));
        // 3-nearest-neighbour mesh lines (faint, slowly pulsing, ≤20%)
        for (let i = 0; i < blue.length; i++) {
          const a = blue[i];
          const near = blue
            .map((b, j) => ({ j, d: j === i ? Infinity : Math.hypot(a.xy[0] - b.xy[0], a.xy[1] - b.xy[1]) }))
            .sort((x, y) => x.d - y.d)
            .slice(0, 3);
          for (const { j } of near) {
            const b = blue[j];
            const pulse = 0.1 + 0.1 * (0.5 + 0.5 * Math.sin(now / 1600 + phaseOf(a.ip)));
            ctx.beginPath();
            ctx.moveTo(a.xy[0], a.xy[1]);
            ctx.lineTo(b.xy[0], b.xy[1]);
            ctx.strokeStyle = BLUE(pulse);
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
        // small slowly-pulsing blue dots (≈35%) + blue city labels (≈30%, every 20-50s for 3s)
        for (const b of blue) {
          const r = 1.6 + 0.5 * Math.sin(now / 1300 + phaseOf(b.ip));
          ctx.beginPath();
          ctx.arc(b.xy[0], b.xy[1], r, 0, Math.PI * 2);
          ctx.fillStyle = BLUE(0.35);
          ctx.fill();
          const env = labelPulse(now, b.ip, 20000, 50000, 3000);
          if (env > 0.02) {
            const label = b.kp.city || g[b.ip]?.city || b.ip;
            const lx = b.xy[0] + 6, ly = b.xy[1];
            if (!labelAnchors.some(([ax, ay]) => Math.hypot(ax - lx, ay - ly) < 20)) {
              labelAnchors.push([lx, ly]);
              ctx.font = "10px 'Courier New', Courier, monospace";
              ctx.textAlign = "left";
              ctx.textBaseline = "middle";
              ctx.fillStyle = BLUE(0.3 * env);
              ctx.fillText(label, lx, ly);
            }
          }
        }
      }

      // DISCOVERY pings: any known node currently being pinged shows a green
      // probing arc + "city ?" label. Before the first ping (pre-20-peers) every
      // node is "probing" → continuous green; afterward the periodic re-ping
      // (every 60s) makes green waves. Reachable nodes live in the blue layer
      // above; dead ones simply aren't drawn.
      if (selfXY) {
        const [sx, sy] = selfXY;
        for (const [ip, kp] of Object.entries(knownRef.current)) {
          if (liveIps.has(ip)) continue; // connected ones are drawn below
          const st = probeRef.current.get(ip) ?? "probing";
          if (st !== "probing") continue; // online → blue layer; offline → hidden
          const [px, py] = P(kp.lon, kp.lat);
          {
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
            // "city ?" on the FAR side of the dot (across from the green arc),
            // small Courier — one machine hailing another. Flashes ~every 2-5s for
            // 2s (desynced per IP), and is skipped if it'd land on another label.
            const env = labelPulse(now, ip, 4000, 7000, 2000);
            if (env > 0.02) {
              const label = kp.city || g[ip]?.city || ip;
              const ux = dx / len, uy = dy / len;
              const lx = px + ux * 9, ly = py + uy * 9;
              const overlaps = labelAnchors.some(([ax, ay]) => Math.hypot(ax - lx, ay - ly) < 22);
              if (!overlaps) {
                labelAnchors.push([lx, ly]);
                ctx.font = "10px 'Courier New', Courier, monospace";
                ctx.textAlign = ux >= 0 ? "left" : "right";
                ctx.textBaseline = "middle";
                ctx.fillStyle = GREEN(0.7 * env);
                ctx.fillText(`${label} ?`, lx, ly);
              }
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

      // Established connections: a solid purple/blue arc at HALF the curvature of
      // the green probing arcs (so they don't overlap), revealed one-by-one. Each
      // carries a slow, per-peer desynced pulse travelling peer→you — continual
      // communication, much slower than the probes, NOT a synchronised burst.
      if (s && selfXY) {
        for (const p of s.peers) {
          const pg = g[p.ip];
          if (!pg) continue;
          const rev = revealed.current.get(p.ip);
          if (rev == null || rev > now) continue; // its turn hasn't come yet
          const [px, py] = P(pg.lon, pg.lat);
          const revAge = now - rev;
          const fresh = revAge < 2200;
          const col = p.inbound ? inbound : outbound;
          const bez = upArc(selfXY[0], selfXY[1], px, py, 0.5); // half curvature
          ctx.beginPath();
          for (let u = 0; u <= 1.0001; u += 0.05) {
            const [x, y] = bez(u);
            u === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          // green flash while first connecting, then a clearly-visible colour arc
          ctx.strokeStyle = fresh ? GREEN(0.6 * (1 - revAge / 2200) + 0.2) : col(0.55);
          ctx.lineWidth = fresh ? 1.6 : 1;
          ctx.stroke();
          // slow continual comms pulse (desynced per peer), up to ~80% opacity
          if (!fresh) {
            const period = 4200; // much slower than the green ~1.4s
            const travel = 3000;
            const local = (now + (phaseOf(p.ip) / (Math.PI * 2)) * period) % period;
            if (local < travel) {
              const u = 1 - local / travel; // travel from the peer (u=1) toward you (u=0)
              const [hx, hy] = bez(u);
              ctx.beginPath();
              ctx.arc(hx, hy, 2.4, 0, Math.PI * 2);
              ctx.fillStyle = col(0.8);
              ctx.fill();
            }
            // city label in the peer's colour, flashing only ~every 10-20s so
            // connected nodes stay uncluttered.
            const env = labelPulse(now, p.ip, 10000, 20000, 2500);
            if (env > 0.02) {
              const dx = px - selfXY[0], dy = py - selfXY[1];
              const len = Math.hypot(dx, dy) || 1;
              const ux = dx / len, uy = dy / len;
              const lx = px + ux * 9, ly = py + uy * 9;
              if (!labelAnchors.some(([ax, ay]) => Math.hypot(ax - lx, ay - ly) < 22)) {
                labelAnchors.push([lx, ly]);
                ctx.font = "10px 'Courier New', Courier, monospace";
                ctx.textAlign = ux >= 0 ? "left" : "right";
                ctx.textBaseline = "middle";
                ctx.fillStyle = col(0.85 * env);
                ctx.fillText(g[p.ip]?.city || p.ip, lx, ly);
              }
            }
          }
        }
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
          const [x, y] = P(pg.lon, pg.lat);
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
          const [x, y] = P(pg.lon, pg.lat);
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

      // stake-winner sunglasses — drawn LAST so no other node's circle covers it
      {
        const wip = winnerRef.current;
        const wg = wip ? g[wip] : null;
        if (wg) {
          const [wx, wy] = P(wg.lon, wg.lat);
          drawGlasses(ctx, wx, wy, 6);
        }
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
          lines: [selfG.ip, [selfG.city, selfG.country].filter(Boolean).join(", "), selfG.isp || ""].filter(Boolean),
        });
      }
      if (s) {
        for (const p of s.peers) {
          const pg = g[p.ip];
          if (!pg) continue;
          const rev = revealed.current.get(p.ip);
          if (rev == null || rev > now) continue;
          const [x, y] = P(pg.lon, pg.lat);
          pts.push({
            x,
            y,
            title: pg.city ? `${pg.city}, ${pg.country}` : p.ip,
            lines: [
              p.ip,
              p.inbound ? "Inbound peer" : "Outbound peer",
              `Ping ${Math.round(p.pingMs)} ms · connected ${fmtDur(p.connSecs)}`,
              pg.isp || "",
              p.subver || "",
              `Block ${p.height.toLocaleString()}`,
            ].filter(Boolean),
          });
        }
      }
      const liveNow = new Set((s?.peers ?? []).filter((p) => g[p.ip]).map((p) => p.ip));
      for (const [ip, kp] of Object.entries(knownRef.current)) {
        if (liveNow.has(ip)) continue;
        const st = probeRef.current.get(ip) ?? "probing";
        const [x, y] = P(kp.lon, kp.lat);
        const loc = [kp.city || g[ip]?.city, kp.country || g[ip]?.country].filter(Boolean).join(", ");
        const isp = g[ip]?.isp || "";
        if (st === "online") {
          // Active background node (not one of our peers) — styled blue.
          pts.push({ x, y, title: loc || ip, lines: ["Active Network", "Not Connected", isp, loc ? ip : ""].filter(Boolean), tone: "blue" });
        } else {
          pts.push({
            x,
            y,
            title: loc || ip,
            lines: [loc ? ip : "", st === "probing" ? "Checking…" : "Idle / unreachable", isp, "Seen in the last 30 days"].filter(Boolean),
          });
        }
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
      wrap.removeEventListener("wheel", onWheel);
      wrap.removeEventListener("dblclick", onDbl);
      wrap.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div className="netmap">
      <div className="netmap-topbar">
        <button type="button" className="netmap-return" onClick={onReturn}>
          <Icon name="overview" size={14} /> Return to Overview
        </button>
        <div className="netmap-legend">
          <span className="nm-item"><span className="nm-dot nm-out" /> Active Peers</span>
          <span className="nm-item"><span className="nm-dot nm-in" /> Full Network</span>
          <span className="nm-item"><span className="nm-dot nm-self" /> Your node</span>
        </div>
      </div>
      <div className="netmap-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} className="netmap-canvas" />
        <BlockChainViz />
        {hover && (
          <div
            className={"netmap-tip" + (hover.tone === "blue" ? " netmap-tip-blue" : "")}
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
