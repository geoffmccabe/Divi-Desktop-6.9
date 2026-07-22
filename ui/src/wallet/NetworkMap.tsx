import { useEffect, useMemo, useRef, useState } from "react";
import { networkPeers, probePeers, listNodes, type Peer, type Geo } from "./api";
import { resolveGeos } from "./geoCache";
import { loadKnown, recordKnown, type Known } from "./knownPeers";
import { emitPeerCount } from "./peerEvents";
import { BlockChainViz } from "./BlockChainViz";
import { PrimerLove } from "./PrimerLove";
import { usePrimer } from "./primerStore";
import { userWonRecently } from "./stakeWin";
import { Icon } from "../Icon";
import worldmap from "../assets/worldmap.json";

// A live map of the peers this node is connected to. At boot it centers on you
// with radiating "searching" rings; as each peer is found it appears as a green
// light with a pulsing line back to you. Peer/our-node locations come from IP
// geolocation. Transactions have no location on-chain, so nothing here pretends
// to show a transaction's origin — it's honest network topology.

const POLYS: number[][][] = (worldmap as { polys: number[][][] }).polys;

// Equirectangular projection with SQUARE pixels: the same pixels-per-degree on
// both axes, so the Earth is never stretched no matter the canvas shape. The
// old version scaled x by w/360 and y by h/180 independently, which fills any
// rectangle — and distorts the moment the canvas isn't a perfect 2:1 (a phone,
// or right after a fullscreen toggle changes its shape). The map is sized to fit
// inside the canvas and centred; the view transform still zooms/pans on top.
const project = (lon: number, lat: number, w: number, h: number): [number, number] => {
  const ppd = Math.min(w / 360, h / 180); // fit the whole world, square pixels
  const offX = (w - 360 * ppd) / 2;
  const offY = (h - 180 * ppd) / 2;
  return [offX + (lon + 180) * ppd, offY + (90 - lat) * ppd];
};

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

// Per-arc "flex" animation + colour blend, chosen randomly and kept per peer so
// each connection arc bends and shifts colour independently.
interface ArcFx {
  arcT: number; // colour blend 0..1 (base → HSB 268,67,100) for the arc
  dotT: number; // colour blend for the travelling dot
  amp: number; // 0.5..1.5 × the base curvature
  half: number; // ms to flex from one extreme to the other (1..10s)
  cycles: number; // 3..10 full flexes before re-rolling amplitude + speed
  anchor: number; // time this parameter set began
}
function newArcFx(t: number): ArcFx {
  return {
    arcT: Math.random(),
    dotT: Math.random(),
    amp: 0.5 + Math.random(),
    half: 2000 + Math.random() * 18000, // 2-20s to flex (slower/less distracting)
    cycles: 3 + Math.floor(Math.random() * 8),
    anchor: t,
  };
}
// Read a CSS HSL token (e.g. --primary) as numeric [h, s, l] for interpolation.
function parseHslNums(name: string): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = raw.match(/([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : [280, 80, 60];
}

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
  won?: boolean; // this node just won the stake (shows STAKE WON! in the tooltip)
}

// The node's last-known location, persisted so the map shows instantly on boot
// (even offline / before the node answers) and only updates once verified.
function loadSelfGeo(scope: string): Geo | null {
  try {
    const s = localStorage.getItem(`dd69.selfGeo.${scope || "desktop"}`);
    return s ? (JSON.parse(s) as Geo) : null;
  } catch {
    return null;
  }
}
function saveSelfGeo(scope: string, g: Geo) {
  try {
    localStorage.setItem(`dd69.selfGeo.${scope || "desktop"}`, JSON.stringify(g));
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
  // Which node the map is drawing. Refetched on mount and whenever My Nodes
  // switches (via the dd69:nodeswitch event) so the map follows the active node.
  const [nodeId, setNodeId] = useState<string | null>(null);
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
  const arcFx = useRef<Map<string, ArcFx>>(new Map()); // per-peer flex + colour state
  // Clicking our own node toggles "network only": hide the purple peer layer and
  // brighten the blue network so it isn't covered up.
  const networkOnlyRef = useRef(false);
  // When the startup search ends, the leftover green probe lines fade out one per
  // second instead of all at once. ip → the time its green line finishes fading.
  const greenExit = useRef<Map<string, number>>(new Map());
  const firstProbeDone = useRef(false);
  // The node currently wearing the "stake winner" sunglasses. NOTE: the real
  // winner (an address) can't be mapped to a node/IP, so for now this rotates to
  // a peer each block-interval as a visual placeholder.
  const winnerRef = useRef<string | null>(null);
  const winnerAt = useRef(0);
  // View transform: auto-fit the active network to the viewport, or the user's
  // manual scroll-zoom. `auto` re-fits every frame until the user scrolls.
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0, auto: true });

  // Track the active node; refetch on mount and on every My Nodes switch.
  useEffect(() => {
    const load = () =>
      listNodes()
        .then((r) => setNodeId(r.active))
        .catch(() => setNodeId("desktop"));
    load();
    const onSwitch = () => load();
    window.addEventListener("dd69:nodeswitch", onSwitch);
    return () => window.removeEventListener("dd69:nodeswitch", onSwitch);
  }, []);

  useEffect(() => {
    if (!nodeId) return;
    let alive = true;

    // Clear only the live-peer layer so it visibly repaints for the newly-active
    // node; the shared blue network mesh (knownRef/geos) is left untouched.
    setSnap(null);
    revealed.current.clear();

    // Self is per-node, so the "your node" marker follows the active node on a
    // switch. The broader network mesh (below) is shared and stays intact.
    selfRef.current = loadSelfGeo(nodeId);

    // Load the 30-day known network + geolocate them (for city labels). We DON'T
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
  }, [nodeId]);

  useEffect(() => {
    if (!nodeId) return;
    let alive = true;
    const poll = async () => {
      try {
        const s = await networkPeers();
        if (!alive || !s) return;
        setSnap(s);
        // Tell the Peers counter what we just saw, so it ticks up (and flashes)
        // at the same moment the peer turns pink on the map rather than up to
        // five seconds later on its own poll.
        emitPeerCount(s.peers.length);
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
                // First search finished: fade the leftover green lines out one per
                // second (nodes that didn't answer and didn't become peers), rather
                // than all vanishing together.
                if (!firstProbeDone.current) {
                  firstProbeDone.current = true;
                  let slot = performance.now();
                  for (const ip of kips) {
                    if (probeRef.current.get(ip) === "offline") {
                      slot += 1000;
                      greenExit.current.set(ip, slot);
                    }
                  }
                }
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
            saveSelfGeo(nodeId, m[s.selfIp]);
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
  }, [nodeId]);

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
    const onUp = (e: MouseEvent) => {
      const moved = Math.hypot(e.clientX - dsx, e.clientY - dsy);
      dragging = false;
      // A click (not a pan) on our own node toggles the network-only view.
      if (moved < 5) {
        const rect = wrap.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        let best: HoverPoint | null = null;
        let bestD = 18 * 18;
        for (const pt of pointsRef.current) {
          const d = (pt.x - mx) ** 2 + (pt.y - my) ** 2;
          if (d < bestD) { bestD = d; best = pt; }
        }
        if (best && best.title === "Your node") networkOnlyRef.current = !networkOnlyRef.current;
      }
    };
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
      // Peer arcs vary their colour between their base and HSB(268,67,100); each
      // arc (and its dot) picks a random point in that range.
      const primaryHsl = parseHslNums("--primary");
      const infoHsl = parseHslNums("--info");
      const ARC_TARGET: [number, number, number] = [268, 100, 66.5]; // HSB 268,67,100 in HSL
      const mixArcCol = (base: [number, number, number], t: number) => {
        const h = base[0] + (ARC_TARGET[0] - base[0]) * t;
        const s = base[1] + (ARC_TARGET[1] - base[1]) * t;
        const l = base[2] + (ARC_TARGET[2] - base[2]) * t;
        return (a: number) => `hsla(${h}, ${s}%, ${l}%, ${a})`;
      };
      const selfCol = hslVar("--warning");
      const s = snapRef.current;
      const g = geosRef.current;
      const now = performance.now();
      const netOnly = networkOnlyRef.current;
      const BLUE = (a: number) => `hsla(210, 85%, 62%, ${a})`;
      const GREY = (a: number) => `hsla(215, 14%, 58%, ${a})`; // remembered but not verified-live now
      const USER_IS_WINNER = userWonRecently(); // deck out our node right after a win

      // The node's true location comes from its own public IP; cache it so it's
      // stable (and never falls back to the app machine's location).
      if (s?.selfIp && g[s.selfIp]) selfRef.current = g[s.selfIp];
      const selfG = selfRef.current;
      const peerCount = s?.peers.filter((p) => g[p.ip]).length ?? 0;
      const liveIps = new Set((s?.peers ?? []).filter((p) => g[p.ip]).map((p) => p.ip));
      // Anchors of labels already drawn this frame — shared by all loops.
      const labelAnchors: [number, number][] = [];

      // The active background nodes (verified-active 30-day nodes, not connected),
      // computed once and reused for both the auto-fit and the mesh drawing.
      // EVERY node seen in the last 30 days (minus current live peers), newest
      // first. We no longer require a live probe-online result or a 20-peer floor:
      // a node you connected to yesterday belongs on the map even if it's offline
      // or firewalled right now (most nodes won't accept our probe). Verified-live
      // ones draw blue; the rest draw faint grey. Cap high, not at 40.
      const blueNodes = Object.entries(knownRef.current)
        .filter(([ip]) => !liveIps.has(ip))
        .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
        .slice(0, 150);

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
      if (selfXY && blueNodes.length) {
        const blue = blueNodes.map(([ip, kp]) => ({
          ip,
          kp,
          xy: P(kp.lon, kp.lat),
          online: probeRef.current.get(ip) === "online", // verified reachable right now
        }));
        // Mesh lines to each node's 3–5 nearest neighbours (faint, slowly pulsing).
        //
        // Nodes sharing a city land on IDENTICAL coordinates, and a zero-length
        // line draws nothing. Because those duplicates sort first by distance,
        // a node's "nearest neighbours" were often all co-located with it, so it
        // spent its whole quota on invisible lines and the mesh looked far
        // sparser than the node count suggested. Anything closer than a pixel is
        // now skipped so the quota goes to neighbours you can actually see.
        // Our connected peers (the purple points) take part in the mesh too, so
        // they read as nodes sitting IN the network rather than floating above
        // an unrelated one.
        const meshSeen = new Set<string>();
        const mesh: { ip: string; xy: [number, number] }[] = [];
        for (const b of blue) {
          // Only verified-live nodes join the mesh, so faint remembered nodes
          // don't imply connections we can't confirm — they still get a dot.
          if (!b.online || meshSeen.has(b.ip)) continue;
          meshSeen.add(b.ip);
          mesh.push({ ip: b.ip, xy: b.xy });
        }
        for (const p of s?.peers ?? []) {
          const pg = g[p.ip];
          if (!pg || meshSeen.has(p.ip)) continue;
          meshSeen.add(p.ip);
          mesh.push({ ip: p.ip, xy: P(pg.lon, pg.lat) });
        }

        // Each node links to its 3–5 nearest neighbours. Pairs are de-duplicated
        // so a link isn't drawn (and animated) twice from both ends.
        const drawn = new Set<string>();
        const links: { a: [number, number]; b: [number, number]; ip: string }[] = [];
        for (let i = 0; i < mesh.length; i++) {
          const a = mesh[i];
          const cand = mesh
            .map((b, j) => ({ j, d: j === i ? Infinity : Math.hypot(a.xy[0] - b.xy[0], a.xy[1] - b.xy[1]) }))
            .filter((n) => n.d > 1 && n.d < Infinity)
            .sort((x, y) => x.d - y.d);

          // 3 nearest, PLUS 2 from further out. Nearest-only made the mesh clump:
          // every node linked to whoever it was already sitting next to, so cities
          // formed tight knots with nothing spanning between them. The long links
          // are what make it read as one network instead of separate clusters.
          const near = cand.slice(0, 3);
          const rest = cand.slice(3);
          // Draw the long links from the MIDDLE of what's left, not the far tail —
          // the tail is all the way across the world and would just crosshatch the
          // whole map.
          const band = rest.slice(Math.floor(rest.length * 0.2), Math.max(1, Math.floor(rest.length * 0.7)));
          const far: typeof cand = [];
          // Deterministic per-node choice: it must pick the SAME two every frame,
          // or the long links strobe.
          const seed = phaseOf(a.ip) / (Math.PI * 2);
          for (let k = 0; k < 2 && band.length; k++) {
            const idx = Math.floor((seed * (k + 1) * 9973) % band.length);
            const pick = band.splice(idx, 1)[0];
            if (pick) far.push(pick);
          }
          for (const { j } of [...near, ...far]) {
            const key = i < j ? `${i}-${j}` : `${j}-${i}`;
            if (drawn.has(key)) continue;
            drawn.add(key);
            links.push({ a: a.xy, b: mesh[j].xy, ip: a.ip + mesh[j].ip });
          }
        }

        // Each link carries a dot running along it, mirroring the purple arcs but
        // at HALF the period (twice as fast) and 60% of the size. The line itself
        // breathes between 10% and 50% opacity, brightest around the dot.
        const MESH_PERIOD = 3000; // purple arcs use 6000
        const STEP_M = 0.125;
        for (const ln of links) {
          const bez = upArc(ln.a[0], ln.a[1], ln.b[0], ln.b[1], 0.35);
          const ph = phaseOf(ln.ip);
          const cycle = ((now + (ph / (Math.PI * 2)) * MESH_PERIOD) % MESH_PERIOD) / MESH_PERIOD;
          const uDot = 0.5 - 0.5 * Math.cos(2 * Math.PI * cycle);
          const wave = 0.5 + 0.5 * Math.sin(now / 1600 + ph);

          ctx.lineWidth = 0.6;
          let prev = bez(0);
          for (let u = STEP_M; u <= 1.0001; u += STEP_M) {
            const cur = bez(u);
            const d = Math.abs(u - STEP_M / 2 - uDot);
            const glow = Math.exp(-((d / 0.3) * (d / 0.3)));
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(cur[0], cur[1]);
            // held inside 10%–50%: a slow breath, lifted where the dot is
            // Dimmed 50% normally (too bright); back to full in network-only view.
            ctx.strokeStyle = BLUE((0.1 + 0.4 * Math.max(0.35 * wave, glow)) * (netOnly ? 1 : 0.5));
            ctx.stroke();
            prev = cur;
          }

          // 60% of the purple dot's size, pulsing twice as fast (260ms → 130ms)
          const pulse = 0.5 + 0.5 * Math.sin(now / 130 + ph * 3);
          const [hx, hy] = bez(uDot);
          const dotR = (2.0 + 1.6 * pulse) * 0.3; // 50% of former size
          const dotOp = (0.55 + 0.45 * pulse) * 0.65; // 65% of former opacity
          ctx.beginPath();
          ctx.arc(hx, hy, dotR + 0.8, 0, Math.PI * 2);
          ctx.fillStyle = BLUE(0.12 * dotOp);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(hx, hy, dotR, 0, Math.PI * 2);
          ctx.fillStyle = BLUE(dotOp * 0.85);
          ctx.fill();
        }
        // small slowly-pulsing blue dots (≈35%) + blue city labels (≈30%, every 20-50s for 3s)
        for (const b of blue) {
          const r = 3.2 + 1.0 * Math.sin(now / 1300 + phaseOf(b.ip)); // 2× diameter — easier to see
          ctx.beginPath();
          ctx.arc(b.xy[0], b.xy[1], r, 0, Math.PI * 2);
          ctx.fillStyle = b.online ? BLUE(0.35) : GREY(0.3); // blue = verified-live, grey = remembered
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
              ctx.fillStyle = b.online ? BLUE(0.3 * env) : GREY(0.3 * env);
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
          // Green shows while probing, and while an offline node's line does its
          // staggered one-per-second fade-out after the first search finishes.
          const exit = greenExit.current.get(ip);
          if (exit != null && now >= exit) greenExit.current.delete(ip);
          const fading = exit != null && now < exit;
          if (st !== "probing" && !fading) continue; // online → blue; offline+done → gone
          const fadeK = fading ? Math.min(1, (exit! - now) / 1000) : 1;
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
                ctx.strokeStyle = GREEN(0.5 * (u / headU) * fadeK);
                ctx.lineWidth = 1;
                ctx.stroke();
                prev = p2;
              }
              const [hx, hy] = bez(headU);
              ctx.beginPath();
              ctx.arc(hx, hy, 2, 0, Math.PI * 2);
              ctx.fillStyle = GREEN(0.5 * fadeK);
              ctx.fill();
            }
            // "city ?" on the FAR side of the dot (across from the green arc),
            // small Courier — one machine hailing another, questioning whether
            // anyone is still there.
            //
            // This is held VISIBLE for as long as the node is being probed. It
            // used to only appear on the same random 2s-every-4-7s flash the
            // other labels use, and since a node is only "probing" briefly, the
            // question mark almost never actually made it onto the screen. The
            // pulse now just adds a shimmer on top of a steady floor.
            const env = Math.max(0.75, labelPulse(now, ip, 4000, 7000, 2000));
            {
              const label = kp.city || g[ip]?.city || ip;
              const ux = dx / len, uy = dy / len;
              // 15px (was 9) = one extra Courier char out, so the dot-side "?"
              // clears the node circle instead of hiding under it.
              const lx = px + ux * 15, ly = py + uy * 15;
              const overlaps = labelAnchors.some(([ax, ay]) => Math.hypot(ax - lx, ay - ly) < 22);
              if (!overlaps) {
                labelAnchors.push([lx, ly]);
                ctx.font = "10px 'Courier New', Courier, monospace";
                ctx.textAlign = ux >= 0 ? "left" : "right";
                ctx.textBaseline = "middle";
                ctx.fillStyle = GREEN(0.7 * env * fadeK);
                ctx.fillText(`?${label}?`, lx, ly);
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
      // Hidden entirely in network-only view so the blue network isn't covered.
      if (!netOnly && s && selfXY) {
        for (const p of s.peers) {
          const pg = g[p.ip];
          if (!pg) continue;
          const rev = revealed.current.get(p.ip);
          if (rev == null || rev > now) continue; // its turn hasn't come yet
          const [px, py] = P(pg.lon, pg.lat);
          const revAge = now - rev;
          const fresh = revAge < 2200;
          // Per-arc flexing curvature: swings ±amp×0.5 around flat (bows up, flat,
          // bows the other way), re-rolling amplitude + speed after cycles flexes.
          let fx = arcFx.current.get(p.ip);
          if (!fx) {
            fx = newArcFx(now);
            arcFx.current.set(p.ip, fx);
          }
          if (now - fx.anchor >= fx.cycles * 2 * fx.half) {
            fx.amp = 0.5 + Math.random();
            fx.half = 2000 + Math.random() * 18000;
            fx.cycles = 3 + Math.floor(Math.random() * 8);
            fx.anchor = now;
          }
          const mult = fx.amp * 0.5 * Math.sin((Math.PI * (now - fx.anchor)) / fx.half);
          const baseHsl = p.inbound ? infoHsl : primaryHsl;
          const arcCol = mixArcCol(baseHsl, fx.arcT);
          const dotCol = mixArcCol(baseHsl, fx.dotT);
          const bez = upArc(selfXY[0], selfXY[1], px, py, mult);

          if (fresh) {
            // green flash while first connecting — solid arc, no travelling dot yet
            ctx.beginPath();
            for (let u = 0; u <= 1.0001; u += 0.05) {
              const [x, y] = bez(u);
              u === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.strokeStyle = GREEN(0.6 * (1 - revAge / 2200) + 0.2);
            ctx.lineWidth = 1.6;
            ctx.stroke();
          } else {
            // A dot bounces back and forth along the arc (you⇄peer), desynced per
            // peer. The arc glows around the dot and fades to ~10% at both ends, so
            // the bright patch travels with it.
            const period = 6000; // full there-and-back
            const cycle = ((now + (phaseOf(p.ip) / (Math.PI * 2)) * period) % period) / period;
            const uDot = 0.5 - 0.5 * Math.cos(2 * Math.PI * cycle); // eased 0(you)↔1(peer)

            ctx.lineWidth = 1;
            const STEP = 0.05;
            let prev = bez(0);
            for (let u = STEP; u <= 1.0001; u += STEP) {
              const cur = bez(u);
              const d = Math.abs(u - STEP / 2 - uDot); // arc-distance from the dot
              const glow = Math.exp(-((d / 0.28) * (d / 0.28)));
              ctx.beginPath();
              ctx.moveTo(prev[0], prev[1]);
              ctx.lineTo(cur[0], cur[1]);
              ctx.strokeStyle = arcCol(0.1 + 0.7 * glow); // 10% far ends → ~80% at the dot
              ctx.stroke();
              prev = cur;
            }

            // the travelling dot, pulsing in size + opacity so it feels alive
            const pulse = 0.5 + 0.5 * Math.sin(now / 260 + phaseOf(p.ip) * 3);
            const [hx, hy] = bez(uDot);
            const dotR = 2.0 + 1.6 * pulse;
            const dotOp = 0.55 + 0.45 * pulse;
            ctx.beginPath(); // soft halo for glow
            ctx.arc(hx, hy, dotR + 2.6, 0, Math.PI * 2);
            ctx.fillStyle = dotCol(0.12 * dotOp);
            ctx.fill();
            ctx.beginPath(); // core
            ctx.arc(hx, hy, dotR, 0, Math.PI * 2);
            ctx.fillStyle = dotCol(dotOp);
            ctx.fill();

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
                ctx.fillStyle = arcCol(0.85 * env);
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
          const r = (3 + Math.min(9, Math.log2(c.n + 1) * 3)) * (netOnly ? 0.5 : 1);
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

      // our node — gold dot (3× and decked out when the user is the stake winner)
      if (selfXY) {
        const r = USER_IS_WINNER ? 15 : 5;
        // when winning: bright, bigger concentric pulse rings (like the search intro)
        if (USER_IS_WINNER) {
          const maxR = 75;
          for (let k = 0; k < 4; k++) {
            const prog = (now / 900 + k / 4) % 1;
            ctx.beginPath();
            ctx.arc(selfXY[0], selfXY[1], r + prog * maxR, 0, Math.PI * 2);
            ctx.strokeStyle = selfCol((1 - prog) * 0.85);
            ctx.lineWidth = 2.5;
            ctx.stroke();
          }
        }
        ctx.beginPath();
        ctx.arc(selfXY[0], selfXY[1], r, 0, Math.PI * 2);
        ctx.fillStyle = selfCol(1);
        ctx.fill();
        const pulse = 4 + 2 * Math.sin(now / 400);
        ctx.beginPath();
        ctx.arc(selfXY[0], selfXY[1], r + pulse, 0, Math.PI * 2);
        ctx.strokeStyle = selfCol(0.5);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (USER_IS_WINNER) drawGlasses(ctx, selfXY[0], selfXY[1], r);
        // "YOU" label below the dot, in matching gold
        ctx.fillStyle = selfCol(1);
        ctx.font = "bold 11px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText("YOU", selfXY[0], selfXY[1] + r + 6);
      }

      // stake-winner sunglasses on a peer (only when the winner ISN'T the user —
      // when it is, the glasses are on our own big gold node above). Drawn LAST.
      if (!USER_IS_WINNER) {
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
          won: USER_IS_WINNER,
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
            won: !USER_IS_WINNER && p.ip === winnerRef.current,
          });
        }
      }
      const liveNow = new Set((s?.peers ?? []).filter((p) => g[p.ip]).map((p) => p.ip));
      // Offer a tooltip on every painted node. blueNodes now includes ALL nodes
      // seen in the last 30 days (drawn blue when verified-live, grey otherwise),
      // so each gets an accurate hover instead of "Active Network" for everything.
      const drawnBlue = new Set(blueNodes.map(([ip]) => ip));
      for (const [ip, kp] of Object.entries(knownRef.current)) {
        if (liveNow.has(ip) || !drawnBlue.has(ip)) continue;
        const st = probeRef.current.get(ip) ?? "probing";
        const online = st === "online";
        const [x, y] = P(kp.lon, kp.lat);
        const loc = [kp.city || g[ip]?.city, kp.country || g[ip]?.country].filter(Boolean).join(", ");
        const isp = g[ip]?.isp || "";
        pts.push({
          x,
          y,
          title: loc || ip,
          lines: [
            loc ? ip : "",
            online ? "Active now · not connected" : st === "probing" ? "Checking…" : "Seen in the last 30 days",
            isp,
          ].filter(Boolean),
          tone: online ? "blue" : undefined,
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
      wrap.removeEventListener("wheel", onWheel);
      wrap.removeEventListener("dblclick", onDbl);
      wrap.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Every node (live peers + 30-day known), deduped by IP, tallied by country.
  const primer = usePrimer();

  const nodesByCountry = useMemo(() => {
    const seen = new Set<string>();
    const counts = new Map<string, number>();
    const add = (ip: string, country?: string) => {
      if (!ip || seen.has(ip)) return;
      seen.add(ip);
      const c = country && country.trim() ? country.trim() : "Unknown";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    };
    const self = selfRef.current;
    if (self) add(self.ip, self.country); // our own node counts too
    for (const p of snap?.peers ?? []) add(p.ip, geos[p.ip]?.country);
    for (const [ip, kp] of Object.entries(knownRef.current)) add(ip, kp.country || geos[ip]?.country);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [snap, geos]);

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
        <NodesByCountry data={nodesByCountry} />
        {primer.active ? <PrimerLove /> : <BlockChainViz />}
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
              <div key={i} className="netmap-tip-line">
                {l}
                {hover.won && i === hover.lines.length - 1 && <span className="netmap-tip-won">STAKE WON!</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Bottom-left overlay: node counts by country, scrollable. Styled like the
// moving blocks below it but blue-bordered to match the network lines. It stops
// wheel/mousedown from reaching the map so scrolling it doesn't zoom or pan.
function NodesByCountry({ data }: { data: [string, number][] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener("wheel", stop, { passive: false });
    el.addEventListener("mousedown", stop);
    return () => {
      el.removeEventListener("wheel", stop);
      el.removeEventListener("mousedown", stop);
    };
  }, []);
  return (
    <div className="nbc" ref={ref}>
      <div className="nbc-head">
        <span className="nbc-title">Nodes</span>
        <span className="nbc-h-full">FULL</span>
        <span className="nbc-h-love" title="Lovenodes">♥</span>
      </div>
      <div className="nbc-list">
        {data.length === 0 ? (
          <div className="nbc-empty">Locating nodes…</div>
        ) : (
          data.map(([c, n]) => (
            <div key={c} className="nbc-row">
              <span className="nbc-country">{c}</span>
              <span className="nbc-full">{n}</span>
              <span className="nbc-love">0</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
