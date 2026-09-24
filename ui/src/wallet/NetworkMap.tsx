import { useEffect, useMemo, useRef, useState , useLayoutEffect } from "react";
import { networkPeers, probePeers, noteSetupLog, listNodes, nodeIdentity, networkCrawl, peerAdd, type Peer, type Geo } from "./api";
import { resolveGeos } from "./geoCache";
import { loadKnown, recordKnown, addMyIps, loadLastPeers, saveLastPeers, type Known } from "./knownPeers";
import { emitPeerCount } from "./peerEvents";
/* The map's animation system: every act of communication the app performs is
   drawn here, and nothing is drawn that isn't really happening. The trigger
   catalog lives in mapEvents.ts; see docs/MAP_ANIMATION_V2.md. */
import { beginProbeWave, emitMap, setMapSelf, setMapNodeCount, type ProbeTarget } from "./mapEvents";
import { startMapFeedBridge } from "./mapFeedBridge";
import { copySetupLogNow } from "./SetupLogHotkey";
import { nodeStatus } from "../bridge";
import {
  announcedName, assumedAlive, chunks, counts as probeCounts, firstWave, FIRST_WAVE_TIMEOUT_MS, loadRecords, markDueNow,
  observe, plan, saveRecords, type ProbeRecord,
} from "./probeSchedule";
import { ReconnectClock } from "./reconnectClock";
import { stakingSetupPending } from "./stakeWin";
import { drawMapAnim } from "./mapAnimRender";
import { BlockChainViz } from "./BlockChainViz";
import { createRebels, type RebelsController } from "./rebels/rebelsController";
import { RebelsHud } from "./rebels/RebelsHud";
import { setPlatform } from "./rebels/platform/current";
import { appPlatform } from "./rebels/platform/app";

/* Divi Rebels runs behind a door that answers who the player is, what DIVI is
   worth and what the wallet can do. Inside the app, that door is the wallet.
   Set once, as this module loads, which is before any game can be created. */
setPlatform(appPlatform);
import { PrimerLove } from "./PrimerLove";
import { usePrimer } from "./primerStore";
import { FastestNodes, type FastCandidate } from "./FastestNodes";
import { Mempool } from "./Mempool";
import { GlobeMap, type GlobePoint, type GlobeArc } from "./GlobeMap";
import { NewestNodesPanel } from "./NewestNodesPanel";
import { baselineNewNodes, newNodes, noteSeen, spiralDiameter, takeUnannouncedArrivals, type NewNode } from "./newNodes";
import { classifyNode } from "./nodeTypes";
import { pulseActivity, pulseTrigger, pulseHsl, pulseIcon, pulseActiveUntil, makeLegs, legU, holdOp, pingDone, type Leg } from "./activityPulse";
import { userWonRecently } from "./stakeWin";
import { playSound } from "../sound";
import { Icon } from "../Icon";
import { InstallPanel, type InstallState } from "./setup/InstallPanel";
import { setupInfo } from "../bridge";
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

// Draw ONE red "data channel" arc from a source (snapshot server or a peer) to
// the user's node, with hex glyphs + arrowheads streaming inward. "snapshot" =
// thick firehose, dense/fast; "nodes" = thin, sparser/slower. Reuses upArc().
const HEXCH = "0123456789abcdef";
function drawDataFlow(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number, dx: number, dy: number,
  now: number, big: boolean,
) {
  const bez = upArc(sx, sy, dx, dy, 0.5);
  ctx.save();
  ctx.lineCap = "round";
  // the channel itself (glowing red)
  ctx.strokeStyle = `hsl(0 88% 47% / ${big ? 0.55 : 0.4})`;
  ctx.lineWidth = big ? 5 : 2;
  ctx.shadowColor = "hsl(0 92% 55% / 0.85)";
  ctx.shadowBlur = big ? 16 : 7;
  ctx.beginPath();
  const STEPS = 44;
  for (let i = 0; i <= STEPS; i++) { const [x, y] = bez(i / STEPS); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
  ctx.stroke();
  ctx.shadowBlur = 0;
  // streaming hex glyphs, flowing source -> node
  const count = big ? 26 : 8;
  const speed = big ? 0.00055 : 0.00028; // u per ms
  const fpx = big ? 11 : 9;
  ctx.font = `bold ${fpx}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let k = 0; k < count; k++) {
    const u = (now * speed + k / count) % 1;
    const [x, y] = bez(u);
    const ch = HEXCH[(Math.floor(now / 60) + k * 7) & 15];
    const fade = Math.sin(u * Math.PI); // dim at the ends, bright in the middle
    ctx.fillStyle = `hsl(0 92% ${big ? 70 : 62}% / ${0.3 + 0.65 * fade})`;
    ctx.fillText(ch, x, y);
  }
  // arrowhead chevrons racing toward the node
  const arrows = big ? 4 : 2;
  ctx.strokeStyle = "hsl(0 92% 64% / 0.9)";
  ctx.lineWidth = big ? 2.5 : 1.5;
  for (let a = 0; a < arrows; a++) {
    const u = (now * speed * 1.1 + a / arrows) % 1;
    const [x, y] = bez(u);
    const [x2, y2] = bez(Math.min(1, u + 0.02));
    const ang = Math.atan2(y2 - y, x2 - x);
    const s = big ? 7 : 4;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(ang - 0.5) * s, y - Math.sin(ang - 0.5) * s);
    ctx.lineTo(x, y);
    ctx.lineTo(x - Math.cos(ang + 0.5) * s, y - Math.sin(ang + 0.5) * s);
    ctx.stroke();
  }
  ctx.restore();
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
/**
 * A heart marking a node that runs this software.
 *
 * `beat` runs 0..1 and blends purple to fuchsia, so the whole set pulses
 * together and reads as one population rather than scattered dots.
 */
function drawHeart(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  beat: number,
  isSelf: boolean,
) {
  // 280 is the peer purple, 320 the fuchsia; slide between them.
  const hue = 280 + (320 - 280) * beat;
  const col = `hsl(${hue}, 85%, ${58 + beat * 10}%)`;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(r / 16, r / 16);
  ctx.beginPath();
  // Two lobes and a point, drawn about the origin.
  ctx.moveTo(0, 5);
  ctx.bezierCurveTo(-2, 1, -8, -1, -8, -6);
  ctx.bezierCurveTo(-8, -11, -3, -12, 0, -8);
  ctx.bezierCurveTo(3, -12, 8, -11, 8, -6);
  ctx.bezierCurveTo(8, -1, 2, 1, 0, 5);
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 14 + beat * 10;
  ctx.fill();
  if (isSelf) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.stroke();
  }
  ctx.restore();
}

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

// A slowly-spinning aqua spiral marking a newly-seen node. 1px Archimedean
// spiral of ~3 turns, hue pulsing green-blue ↔ blue-green once a second, spinning
// 3 rev/min. Drawn in a top pass so a busy (VPN) location can't bury it.
function drawSpiral(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  diameter: number,
  now: number,
  highlighted: boolean,
  baseHue: number,
) {
  const dia = highlighted ? diameter * 2 : diameter;
  const outer = dia / 2;
  if (outer < 1) return;
  const TURNS = 3;
  // 9 rev/min base (3x the earlier 3 rev/min), 3x faster again when highlighted.
  const revMs = highlighted ? 20000 / 9 : 20000 / 3;
  const spin = ((now % revMs) / revMs) * Math.PI * 2;
  // hue pulses ±18° around the theme's "new node" hue once per second
  const hue = baseHue + 18 * Math.sin((now / 1000) * Math.PI * 2);
  const maxT = TURNS * Math.PI * 2;
  const STEPS = 72;
  ctx.save();
  ctx.lineWidth = 1;
  if (highlighted) (ctx.shadowColor = `hsla(${hue}, 85%, 58%, 0.9)`), (ctx.shadowBlur = 6);
  // Draw segment-by-segment so opacity can fade OUTWARD: fully opaque at the
  // centre, down to 40% at the rim.
  let prevX = cx;
  let prevY = cy;
  for (let i = 1; i <= STEPS; i++) {
    const t = (i / STEPS) * maxT;
    const frac = t / maxT; // 0 at centre → 1 at rim
    const r = outer * frac; // Archimedean
    const a = t + spin;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    const alpha = 1 - 0.6 * frac; // 100% centre → 40% rim
    ctx.strokeStyle = `hsla(${hue}, 85%, 58%, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(prevX, prevY);
    ctx.lineTo(x, y);
    ctx.stroke();
    prevX = x;
    prevY = y;
  }
  ctx.restore();
}

/* "assumed": answered within the last day, drawn and counted as alive from
   the first frame, being confirmed by the first wave. See probeSchedule. */
type ProbeState = "probing" | "online" | "offline" | "assumed";


interface HoverPoint {
  x: number;
  y: number;
  /** The name the node's owner gave it, announced in its user agent. "" = none. */
  name?: string;
  /** The node's address, for the right-click menu. Absent for our own node. */
  ip?: string;
  /** Already connected to our node. */
  isPeer?: boolean;
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

// Each of the user's own nodes, remembered by its public IP + location as it's
// visited, so the OTHER node(s) can be plotted on the current map even when the
// two aren't P2P peers (e.g. the Costa Rica desktop node on the scanner's map).
interface SelfNode {
  ip: string;
  lat: number;
  lon: number;
  city?: string;
  country?: string;
}
function loadSelfNode(scope: string): SelfNode | null {
  try {
    const s = localStorage.getItem(`dd69.selfNode.${scope || "desktop"}`);
    return s ? (JSON.parse(s) as SelfNode) : null;
  } catch {
    return null;
  }
}
function saveSelfNode(scope: string, n: SelfNode) {
  try {
    localStorage.setItem(`dd69.selfNode.${scope || "desktop"}`, JSON.stringify(n));
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

export function NetworkMap({ onReturn, autoplay = false }: {
  onReturn?: () => void;
  /** Open in globe view with the game already running. The sidebar's
   *  "Divi Rebels Game" entry, which should land in the cockpit rather than on
   *  a map with a button on it. */
  autoplay?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snap, setSnap] = useState<{ peers: Peer[]; selfIp: string | null } | null>(null);
  // Which node the map is drawing. Refetched on mount and whenever My Nodes
  // switches (via the dd69:nodeswitch event) so the map follows the active node.
  const [nodeId, setNodeId] = useState<string | null>(null);
  // Label + mode of the active node, so the speed panel can say truthfully where
  // its pings were measured from (the app always pings from THIS computer).
  const [activeNode, setActiveNode] = useState<{ label: string; remote: boolean }>({
    label: "this node",
    remote: false,
  });
  // One overlay panel at a time, chosen from the hamburger menu (all top-right).
  const [panel, setPanel] = useState<null | "country" | "mempool" | "newest" | "speed">(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /* DD69-only view. A node announces which software it runs in its subversion
     string; ours carries a "dd69" marker. Anyone else shipping node software
     can identify themselves the same way, with their own marker. */
  const [dd69Only, setDd69Only] = useState(false);
  /* Opening the hearts view runs a real handshake over every known node so
     the view reflects what each node announces NOW, not what it announced
     the last time it happened to be a peer. Also every thirty minutes. */
  const lastAnnounceRefresh = useRef(0);
  useEffect(() => {
    if (!dd69Only) return;
    if (Date.now() - lastAnnounceRefresh.current < 60_000) return;
    lastAnnounceRefresh.current = Date.now();
    void runNetworkRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dd69Only]);
  useEffect(() => {
    const id = setInterval(() => {
      lastAnnounceRefresh.current = Date.now();
      void runNetworkRefresh();
    }, 30 * 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dd69OnlyRef = useRef(false);
  dd69OnlyRef.current = dd69Only;
  // First-run install side-panel. Opens automatically when the node still needs
  // setting up; also openable from the menu to preview/re-run. installingRef is
  // read by the draw loop to flash the user's own node red while setting up.
  const [setupOpen, setSetupOpen] = useState(false);
  // Cmd/Ctrl-N: developer simulator. Pretends this is a brand-new install (no
  // blockchain) and plays the whole setup sequence, WITHOUT touching the real
  // wallet/node or downloading anything. Press again to exit — nothing real was
  // created, so there is nothing to clean up.
  const [simulateNew, setSimulateNew] = useState(false);
  const installingRef = useRef(false);
  // Which data-flow animation the map should draw while setting up: a thick
  // firehose from the snapshot server ("snapshot"), thin arcs from live peers
  // ("nodes"), or none. Read by the draw loop.
  const flowModeRef = useRef<null | "snapshot" | "nodes">(null);
  // The snapshot server's REAL [lon,lat], resolved from its IP, so the firehose
  // starts at its actual location on the map (not a placeholder point).
  const snapSrcRef = useRef<[number, number] | null>(null);
  // Auto-open the install panel on first run (node not set up yet).
  useEffect(() => {
    setupInfo().then((s) => { if (s.needsSetup) setSetupOpen(true); }).catch(() => {});
  }, []);
  // This install's node name → shown on the self marker. Reloads instantly when
  // the user changes it in Settings (dd69:nodename), no restart needed.
  useEffect(() => {
    nodeIdentity().then((i) => { nodeNameRef.current = i.name || ""; }).catch(() => {});
    const onName = (e: Event) => {
      const d = (e as CustomEvent).detail as { name?: string } | undefined;
      nodeNameRef.current = d?.name ?? "";
    };
    window.addEventListener("dd69:nodename", onName);
    return () => window.removeEventListener("dd69:nodename", onName);
  }, []);
  // The snapshot server sits behind Cloudflare, so its public IP geolocates to a
  // Cloudflare edge (Canada), NOT the real origin. So we hard-set the true origin
  // location: the fasthosts node in London. (If the server ever moves, update
  // this one coordinate.)
  useEffect(() => {
    snapSrcRef.current = [-0.1278, 51.5074]; // London
  }, []);
  // Cmd/Ctrl-N toggles the new-install simulator.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        setSimulateNew((on) => {
          const next = !on;
          setSetupOpen(next);
          if (!next) { installingRef.current = false; flowModeRef.current = null; } // exiting: node back to gold
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [blockDim, setBlockDim] = useState(false); // eye toggle dims the blockstream
  // Divi Rebels flies the globe you are already looking at. Not a copy of it:
  // the controller is handed THIS scene, THESE towers and THESE links through
  // GlobeMap's flight hook, and only adds a ship. Everything carries on
  // animating while you fly through it.
  /* Whether the game is running, readable from inside the canvas handlers,
     which close over the first render. Map popups over the cockpit were the
     result of not having this: Geoff, 2026-Sep-22, "while I'm playing it
     still is bringing up modals for various nodes". */
  const rebelsRef = useRef<RebelsController | null>(null);
  const [rebels, setRebels] = useState<RebelsController | null>(null);
  rebelsRef.current = rebels;
  const playing = rebels !== null;
  /* Asked to start flying: the same thing the play button does, once. The
     controller attaches itself to the globe when the globe is ready, so it is
     safe to make it before the globe has drawn a frame. */
  useEffect(() => {
    if (!autoplay) return;
    /* The sidebar's "Divi Rebels Game" and the plain "Network Map" are the
       same component in the same place, so React keeps the instance when the
       user goes from one to the other, and a map that was flat STAYS flat:
       the initial state above only counts on a fresh mount. Seen in a
       browser copy: the game's card over the flat map, saying the globe was
       not ready, because there was no globe. So the globe is asked for here
       as well, every time autoplay is switched on. */
    setGlobe(true);
    setRebels((cur) => cur ?? createRebels(labelForIp));
    // The label function is stable for the life of the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay]);
  // FLAT vs GLOBE view. When GLOBE is on, the 2D canvas loop pauses (see draw())
  // and the WebGL globe renders the same nodes/arcs on top.
  const [globe, setGlobe] = useState(autoplay);
  const globeActiveRef = useRef(false);
  globeActiveRef.current = globe;
  // New-node spirals: the list the draw loop animates, refreshed off the poll (a
  // ref so drawing never triggers a re-render). highlightIp = the row the user is
  // hovering/clicking in the panel → its spiral grows 2x and spins 3x faster.
  const newNodesRef = useRef<NewNode[]>([]);
  const highlightIpRef = useRef<string | null>(null);
  const arrivalFxRef = useRef<Map<string, number>>(new Map()); // ip → flash start ms
  // Independent gold pings (built per pulse): each a peer + 1-2 network nodes + 4
  // jittered legs. `lastPulseRef` detects a fresh pulse to rebuild the set.
  const pingsRef = useRef<{ peer: [number, number]; nets: [number, number][]; legs: Leg[] }[]>([]);
  const lastPulseRef = useRef(0);

  // EVERY node the map knows (live peers + 30-day known), with its country, for
  // the node-speed ping. Read fresh each time the user starts a scan.
  const fastCandidates = (): FastCandidate[] => {
    const out = new Map<string, FastCandidate>();
    const place = (ip: string, kpCity?: string, kpCountry?: string, kpCc?: string): FastCandidate => ({
      ip,
      city: kpCity || geosRef.current[ip]?.city,
      country: kpCountry || geosRef.current[ip]?.country,
      cc: kpCc || geosRef.current[ip]?.countryCode,
    });
    for (const [ip, kp] of Object.entries(knownRef.current)) {
      out.set(ip, place(ip, kp.city, kp.country, kp.cc));
    }
    for (const p of snap?.peers ?? []) {
      if (!out.has(p.ip)) out.set(p.ip, place(p.ip));
    }
    return [...out.values()];
  };
  const [geos, setGeos] = useState<Record<string, Geo>>({});
  const [hover, setHover] = useState<HoverPoint | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; ip: string; isPeer: boolean; label: string; note: string | null; busy: boolean } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuH, setMenuH] = useState(240);
  useLayoutEffect(() => {
    if (menu && menuRef.current) setMenuH(menuRef.current.offsetHeight);
  });
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);
  /* ---- CONNECTING TO A NODE, WITH AN ANSWER ----
     "Add as peer" put the address on the node's keep-connected list and
     stopped there; the node walks that list every two minutes, so nothing
     happened on screen and a second click hit "already added". Now both
     buttons ask for an immediate try and then WATCH the peer list for up to
     45 seconds: the fuchsia dot and the line come from that list the moment
     the node reports the connection, and the menu says so, or says plainly
     that the other node did not accept the connection. */
  const connectTo = (ip: string, keep: boolean) => {
    setMenu((m) => m && { ...m, busy: true, note: keep ? "Adding, and connecting\u2026" : "Connecting\u2026" });
    const kp = knownRef.current[ip];
    if (kp) emitMap("node.seek", { lat: kp.lat, lon: kp.lon, ip });
    const started = Date.now();
    const watch = async (): Promise<void> => {
      for (;;) {
        const s = await networkPeers().catch(() => null);
        if (s && s.peers.some((p) => p.ip === ip)) {
          setSnap(s);
          setMenu((m) => m && { ...m, busy: false, isPeer: true, note: keep ? "Connected. Your node will keep this connection." : "Connected." });
          return;
        }
        const secs = Math.round((Date.now() - started) / 1000);
        if (secs >= 45) {
          setMenu((m) => m && { ...m, busy: false, note: "Your node tried for 45 seconds and it did not connect. That node may not accept incoming connections, or may be full." });
          return;
        }
        setMenu((m) => m && { ...m, note: `Connecting\u2026 ${secs}s` });
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    peerAdd(ip, keep)
      .then(() => watch())
      .catch((e) => setMenu((m) => m && { ...m, busy: false, note: String(e).replace(/^Error:\s*/i, "") }));
  };
  const pointsRef = useRef<HoverPoint[]>([]);
  // When the node last told us something true. Drives the "this map is frozen"
  // notice; see the note by the poll below.
  /* How many polls IN A ROW have actually been attempted and failed. Not
     elapsed time -- see the note by the poll. */
  const missedPolls = useRef(0);
  const [stale, setStale] = useState<number | null>(null);
  /* The node's phase as the wallet reports it, so the map can tell "starting"
     from "was talking and stopped". */
  const nodePhaseRef = useRef<string>("");
  useEffect(() => {
    let alive = true;
    const ask = () => nodeStatus().then((s) => { if (alive) nodePhaseRef.current = s.phase; }).catch(() => {});
    ask();
    const id = setInterval(ask, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const [copiedDiag, setCopiedDiag] = useState<string | null>(null);

  const geosRef = useRef(geos);
  geosRef.current = geos;
  const snapRef = useRef(snap);
  snapRef.current = snap;
  // The node's OWN location, from its real public IP (as peers report it). This
  // is where the node actually runs — cached so it stays put and never flickers.
  // We deliberately do NOT use the app's caller IP: with a remote node that's a
  // different machine, which would place the node in the wrong city.
  const selfRef = useRef<Geo | null>(null);
  const nodeListRef = useRef<string[]>([]); // all of the user's configured node ids
  const myNodeIpsRef = useRef<Set<string>>(new Set()); // the user's own nodes — always shown, never probed off
  const nodeNameRef = useRef<string>(""); // this install's chosen node name (shown on the self marker)
  const instantRevealRef = useRef(false); // true right after a (re)mount: show peers settled, no green
  const revealed = useRef<Map<string, number>>(new Map()); // ip -> first-seen ms
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  // Peers seen in the last 30 days (grey at startup), and the live probe result.
  const knownRef = useRef<Known>({});
  /** Every node we know of, stored plus in-memory. THE one definition of "how
   *  many nodes", shared by the bottom-left counter and the by-country list.
   *  They used to count different things — 76 against 219 for the USA alone —
   *  which just reads as the app contradicting itself. */

  const probeRef = useRef<Map<string, ProbeState>>(new Map());
  /* Per-node liveness with memory: misses, when asked, when it last answered.
     Persisted, so the once-a-day recheck of a node written off survives a
     restart. See probeSchedule.ts for the rules. */
  const recordsRef = useRef<Map<string, ProbeRecord>>(loadRecords());
  // Bumped whenever a probe wave settles, so the count and the country list recompute.
  const [probeTick, setProbeTick] = useState(0);
  /* THE NUMBER THE WALLET CALLS "NODES". Not every address we have ever
     heard of: after the crawl that is 600-plus, most of them nodes that
     answered someone weeks ago and may be long gone. Geoff, 2026-Sep-22:
     "625 which I think must be wrong... we don't have that many nodes."
     A node counts when this wallet has verified it alive: it is a peer
     right now, or it answered our last probe. The by-country list uses the
     same rule, so the two figures cannot disagree. */
  const verifiedNodes = (): Set<string> => {
    const v = new Set<string>();
    for (const p of snapRef.current?.peers ?? []) v.add(p.ip);
    for (const [ip, st] of probeRef.current) {
      if (st === "online" || st === "assumed") v.add(ip);
      // A node that missed once or twice is still counted; only "down" is not.
      else if (st === "offline" && probeCounts(recordsRef.current.get(ip)) && recordsRef.current.get(ip)?.aliveAt) v.add(ip);
    }
    for (const ip of myNodeIpsRef.current) v.add(ip);
    return v;
  };
  // v2: which IPs were peers on the LAST poll, so we can fire node.peer once on
  // connect and node.lost once on disconnect, rather than every poll.
  const peeredRef = useRef<Set<string>>(new Set());
  /* Supervisor-side events (RPC round-trips, new blocks). Rust sends meaning
     only; we supply the location from what the map has already verified. */
  useEffect(
    () =>
      startMapFeedBridge((ip) => {
        const kp = knownRef.current[ip];
        return kp && typeof kp.lat === "number" && typeof kp.lon === "number"
          ? { lat: kp.lat, lon: kp.lon }
          : null;
      }),
    [],
  );
  /* What U does. It used to be the animation and nothing else: no request left
     the machine, so it could never find a node our own node had not already
     dialled. It now speaks Divi to every node we know, marks each alive or dead
     by whether it actually completed a handshake, and asks a few of them for
     their own address books — which is how a node nobody here has connected to
     becomes visible. */
  const crawlBusy = useRef(false);
  const runNetworkRefresh = async () => {
    if (crawlBusy.current) return;
    crawlBusy.current = true;
    try {
      const known = Object.keys(knownRef.current).filter((ip) => !myNodeIpsRef.current.has(ip));
      const live = (snapRef.current?.peers ?? []).map((p) => p.ip);
      const ips = Array.from(new Set([...live, ...known]));
      if (!ips.length) return;

      const targets: ProbeTarget[] = [];
      for (const ip of ips) {
        const kp = knownRef.current[ip];
        if (kp && typeof kp.lat === "number" && typeof kp.lon === "number") {
          targets.push({ ip, lat: kp.lat, lon: kp.lon });
        }
      }
      const resolve = beginProbeWave(targets);

      const reply = await networkCrawl(ips, 6);
      // Alive means it spoke Divi to us, not merely that a port answered.
      resolve(reply.results.map((r) => ({ ip: r.ip, online: r.alive })));
      for (const r of reply.results) {
        probeRef.current.set(r.ip, r.alive ? "online" : "offline");
        /* Remember what it called itself. The handshake returns each node's
           user agent, and this was being thrown away: the map only ever
           learned a node's user agent from getpeerinfo, i.e. from nodes we
           happened to be connected to. So a node that upgraded to a build
           announcing "dd69" -- the UK and Europe servers, Andy -- stayed
           filed under its OLD announcement unless it was a peer, and the
           hearts view could not find it. Geoff, 2026-Sep-22: "only see my
           own node with a heart." */
        if (r.alive && r.subver && knownRef.current[r.ip]) {
          knownRef.current = { ...knownRef.current, [r.ip]: { ...knownRef.current[r.ip], subver: r.subver } };
        }
      }
      setProbeTick((t) => t + 1);

      // Learned second-hand from other nodes' address books: the ones our own
      // node has never connected to and so could never show.
      if (reply.discovered.length) {
        const fresh = reply.discovered.slice(0, 200);
        await resolveGeos(fresh, (m) => {
          const seen = fresh
            .filter((ip) => m[ip])
            .map((ip) => ({
              ip,
              lat: m[ip].lat,
              lon: m[ip].lon,
              city: m[ip].city,
              country: m[ip].country,
              cc: m[ip].countryCode,
            }));
          if (!seen.length) return;
          knownRef.current = recordKnown(knownRef.current, seen);
          /* Heard of, not seen: these are NOT registered as new. An address
             earns its spiral when it first answers (see applyAnswers). */
          newNodesRef.current = newNodes(knownRef.current);
          setMapNodeCount(verifiedNodes().size);
          for (const n of seen) {
            emitMap("node.discovered", { lat: n.lat, lon: n.lon, ip: n.ip });
          }
        });
      }
    } catch {
      /* best-effort; the map keeps what it had */
    } finally {
      crawlBusy.current = false;
    }
  };

  /* The reconnect stopwatch: one line into the setup log per map open. */
  const clockRef = useRef<ReconnectClock | null>(null);
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
        .then((r) => {
          nodeListRef.current = r.nodes.map((n) => n.id);
          const act = r.nodes.find((n) => n.id === r.active);
          setActiveNode({ label: act?.label || "this node", remote: act?.mode === "remote" });
          setNodeId(r.active);
        })
        .catch(() => setNodeId("desktop"));
    load();
    const onSwitch = () => load();
    window.addEventListener("dd69:nodeswitch", onSwitch);
    return () => window.removeEventListener("dd69:nodeswitch", onSwitch);
  }, []);

  // One-time: freeze today's known network as "existing" and seed the Costa Rica
  // test node at day 0. Idempotent (flag-guarded in newNodes.ts). Then prime the
  // spiral list from storage so a just-opened map shows spirals immediately.
  useEffect(() => {
    baselineNewNodes();
    newNodesRef.current = newNodes(loadKnown());
    setMapNodeCount(verifiedNodes().size);
  }, []);

  // Press "u" (Update) to fire the gold query ripple — your node pinging the
  // network and the answer returning. Ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if ((e.key === "u" || e.key === "U") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        pulseActivity();
        void runNetworkRefresh();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!nodeId) return;
    let alive = true;

    // The node is already running and connected, and the map remounts every time
    // it's opened — so ALWAYS show its existing peers + known network instantly
    // (settled/online), never a fake "searching" sweep. Only a genuinely new peer
    // that appears later (in a subsequent poll) flashes green.
    instantRevealRef.current = true;

    // Register every IP this wallet has ever used as its own node (current +
    // historical, across all node profiles and the legacy self-location keys),
    // so old IPs from VPN/ISP/location changes are stripped from the network
    // list instead of lingering as phantom nodes at your location.
    try {
      const selfIps: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !(key.startsWith("dd69.selfNode") || key.startsWith("dd69.selfGeo"))) continue;
        try {
          const j = JSON.parse(localStorage.getItem(key) || "{}");
          if (j && typeof j.ip === "string") selfIps.push(j.ip);
        } catch {
          /* skip */
        }
      }
      if (selfIps.length) addMyIps(selfIps);
    } catch {
      /* best-effort */
    }

    // Self is per-node, so the "your node" marker follows the active node on a
    // switch. The broader network mesh (below) is shared and stays intact.
    selfRef.current = loadSelfGeo(nodeId);
    // Use the cached location straight away, so events arriving before the
    // first poll have somewhere to land instead of being dropped.
    if (selfRef.current) setMapSelf(selfRef.current.lat, selfRef.current.lon);

    // Load the 30-day known network + geolocate them (for city labels).
    const known = loadKnown();
    knownRef.current = known;

    // Plot the user's OTHER nodes (from their remembered location) as network
    // nodes, so e.g. the Costa Rica desktop node shows on the scanner's map even
    // though the two aren't P2P peers. Each node is captured once it's visited.
    myNodeIpsRef.current = new Set();
    for (const id of nodeListRef.current) {
      if (id === nodeId) continue;
      const sn = loadSelfNode(id);
      if (sn && sn.ip) {
        knownRef.current[sn.ip] = { lat: sn.lat, lon: sn.lon, city: sn.city, country: sn.country, lastSeen: Date.now() };
        myNodeIpsRef.current.add(sn.ip);
      }
    }

    /* ---- DRAW FROM MEMORY FIRST, VERIFY SECOND ----
       Remembered nodes used to start as dim ghosts until the first probe
       wave answered, ten to forty seconds after opening and up to a minute
       more to animate. Geoff: "it should be able to nearly instantly
       reconnect if we do it right and are optimistic". So a node that
       answered within the last day is drawn and counted as alive at once
       ("assumed"), and the first wave, sent this same moment, confirms or
       corrects it. Three misses still send it grey. Nodes that never
       answered, or were written off, start dim as before. */
    const now0 = Date.now();
    recordsRef.current = markDueNow(recordsRef.current, now0);
    const assumed: string[] = [];
    for (const ip of Object.keys(knownRef.current)) {
      if (myNodeIpsRef.current.has(ip)) continue;
      const yes = assumedAlive(recordsRef.current.get(ip), now0);
      probeRef.current.set(ip, yes ? "assumed" : "offline");
      if (yes) assumed.push(ip);
    }
    clockRef.current = new ReconnectClock(now0, assumed);
    setMapNodeCount(verifiedNodes().size);

    const ips = Object.keys(knownRef.current);
    if (ips.length) {
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

    /* ---- THE PROBE WAVES ----
       Answers are applied as each part of a wave returns (parts of 48), not
       when the slowest probe in the whole wave finishes; a node that answers
       in 200 ms is blue in 200 ms. The animation gets only the nodes that
       were NOT already drawn alive (ghosts being checked), and its stagger
       is capped so a whole wave finishes drawing within three seconds
       rather than a minute. */
    const applyAnswers = (res: { ip: string; online: boolean }[]) => {
      const now = Date.now();
      const alive: string[] = [];
      for (const r of res) {
        recordsRef.current.set(r.ip, observe(recordsRef.current.get(r.ip), r.online, now));
        probeRef.current.set(r.ip, r.online ? "online" : "offline");
        if (r.online) { clockRef.current?.confirm(r.ip, now); alive.push(r.ip); }
      }
      /* A node that just answered for the first time ever is genuinely new
         to this wallet: registered now, so it gets its spiral. */
      if (alive.length) {
        noteSeen(alive);
        newNodesRef.current = newNodes(knownRef.current);
      }
      setMapNodeCount(verifiedNodes().size);
      setProbeTick((t) => t + 1);
      const c = clockRef.current;
      if (c && c.shouldReport(now)) void noteSetupLog(c.report(now).line);
    };
    const runWave = async (list: string[], timeoutMs: number, animate: boolean): Promise<void> => {
      if (!list.length) return;
      for (const ip of list) if (probeRef.current.get(ip) === "offline") probeRef.current.set(ip, "probing");
      let resolveWave: ReturnType<typeof beginProbeWave> | null = null;
      if (animate) {
        const targets: ProbeTarget[] = [];
        for (const ip of list) {
          if (probeRef.current.get(ip) !== "probing") continue; // already drawn alive: nothing to show
          const kp = knownRef.current[ip];
          if (kp && typeof kp.lat === "number" && typeof kp.lon === "number") targets.push({ ip, lat: kp.lat, lon: kp.lon });
        }
        if (targets.length) resolveWave = beginProbeWave(targets, Math.min(90, 3000 / targets.length));
      }
      const results: { ip: string; online: boolean }[] = [];
      await Promise.all(
        chunks(list).map((part) =>
          probePeers(part, timeoutMs)
            .then((res) => {
              if (!alive) return;
              results.push(...res);
              applyAnswers(res);
            })
            .catch(() => {
              if (!alive) return;
              for (const ip of part) {
                results.push({ ip, online: false });
                probeRef.current.set(ip, "offline");
              }
            }),
        ),
      );
      if (!alive) return;
      resolveWave?.(results.map((r) => ({ ip: r.ip, online: r.online })));
      for (const ip of list) if (probeRef.current.get(ip) === "probing") probeRef.current.set(ip, "offline");
      saveRecords(recordsRef.current);
      setMapNodeCount(verifiedNodes().size);
      setProbeTick((t) => t + 1);
    };
    /* The whole known network, by how much doubt there is about each node. */
    const runMainWave = async (): Promise<void> => {
      const all = Object.keys(knownRef.current).filter((ip) => !myNodeIpsRef.current.has(ip));
      const p = plan(recordsRef.current, all, Date.now());
      const kips = [...p.quick, ...p.patient];
      /* The slow lane runs alongside and is not waited for: a few written-off
         addresses with a long timeout, never holding the live wave. */
      void runWave(p.recheck, p.timeoutRecheck, true);
      await Promise.all([runWave(p.quick, p.timeoutQuick, true), runWave(p.patient, p.timeoutPatient, true)]);
      if (!alive) return;
      const now = Date.now();
      const c = clockRef.current;
      if (c) {
        c.waveDone(now);
        if (c.shouldReport(now)) void noteSetupLog(c.report(now).line);
      }
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
    };
    /* At once: last session's peers and the freshest memories, quick timeout.
       Then the whole network two seconds later, and every minute after. */
    void runWave(firstWave(recordsRef.current, loadLastPeers(nodeId), Date.now()), FIRST_WAVE_TIMEOUT_MS, false);
    const firstMain = setTimeout(() => { void runMainWave(); }, 2000);
    const mainId = setInterval(() => { void runMainWave(); }, 60000);

    const poll = async () => {
      try {
        const s = await networkPeers();
        if (!alive) return;
        if (!s) {
          // Asked, got nothing back. That is a miss, and it is counted --
          // but one or two in a row is an ordinary busy spell, not a fault.
          missedPolls.current += 1;
          return;
        }
        missedPolls.current = 0;
        setStale(null);
        setSnap(s);
        /* self.ok / self.fail are emitted by the Rust side now (rpc.rs), which
           sees EVERY call rather than just this poll. Emitting here too would
           double every heartbeat. */
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
        /* The probe waves run on the map's own clock now (see runMainWave
           below), not on this poll and not on the node having a peer. */
        saveLastPeers(nodeId, s.peers.map((p) => p.ip));
        {
          const c = clockRef.current;
          if (c && s.peers.length) {
            const nowC = Date.now();
            c.peerSeen(nowC);
            for (const p of s.peers) c.confirm(p.ip, nowC);
            if (c.shouldReport(nowC)) void noteSetupLog(c.report(nowC).line);
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
            // v2: let events about ourselves that arrive from the Rust side be
            // placed without every producer having to know any geography.
            setMapSelf(m[s.selfIp].lat, m[s.selfIp].lon);
            saveSelfGeo(nodeId, m[s.selfIp]);
            const g0 = m[s.selfIp];
            // If our public IP just CHANGED (travel / new ISP), the IP we had
            // stored is still THIS node — mark it ours so it's stripped from the
            // network list instead of lingering for 90 days as a phantom node at
            // the old town. addMyIps purges it from the shared store immediately.
            const prev = loadSelfNode(nodeId);
            if (prev && prev.ip && prev.ip !== s.selfIp) addMyIps([prev.ip]);
            saveSelfNode(nodeId, { ip: s.selfIp, lat: g0.lat, lon: g0.lon, city: g0.city, country: g0.country });
            addMyIps([s.selfIp]); // our current IP is ours, never a network node
          }
          const seen: {
            ip: string;
            lat: number;
            lon: number;
            city?: string;
            country?: string;
            cc?: string;
            subver?: string;
          }[] = [];
          let newIdx = 0;
          for (const p of s.peers) {
            const pg = m[p.ip];
            if (!pg) continue;
            // Remember the client each peer advertises, so its TYPE persists in
            // the 90-day store even after it stops being a live peer.
            seen.push({ ip: p.ip, lat: pg.lat, lon: pg.lon, city: pg.city, country: pg.country, cc: pg.countryCode, subver: p.subver });
            // v2: a node we are genuinely connected to is a PEER — fuchsia.
            // Only fire on the transition, so a standing peer doesn't re-pulse
            // every ten seconds.
            if (!peeredRef.current.has(p.ip)) {
              peeredRef.current.add(p.ip);
              emitMap("node.peer", { lat: pg.lat, lon: pg.lon, ip: p.ip });
            }
            probeRef.current.set(p.ip, "online"); // connected = definitely online
            if (!revealed.current.has(p.ip)) {
              // After a switch, reveal already-connected peers as settled (a past
              // timestamp → no green flash). On boot, stagger them in one-by-one.
              revealed.current.set(
                p.ip,
                instantRevealRef.current ? performance.now() - 5000 : performance.now() + newIdx * 350,
              );
              newIdx++;
            }
          }
          // v2: a peer that was in the last list and isn't in this one has
          // genuinely dropped — grey rings where it used to be, and the Peers
          // count falls by one at the same instant.
          {
            const liveNow = new Set(s.peers.map((p) => p.ip));
            for (const ip of [...peeredRef.current]) {
              if (liveNow.has(ip)) continue;
              peeredRef.current.delete(ip);
              const kp = knownRef.current[ip];
              if (kp) emitMap("node.lost", { lat: kp.lat, lon: kp.lon, ip });
            }
          }
          // Always re-fold the authoritative stored list back in, so the map's
          // ref can never sit below the full ~92 (which starved the node count).
          knownRef.current = seen.length
            ? recordKnown(knownRef.current, seen)
            : { ...loadKnown(), ...knownRef.current };
          // Register any first-ever-seen IPs (append-only; a re-added node keeps
          // its original date, so no false spirals), then refresh the spiral list
          // and fire the one-time arrival cue for genuinely brand-new nodes.
          noteSeen(seen.map((x) => x.ip));
          newNodesRef.current = newNodes(knownRef.current);
          setMapNodeCount(verifiedNodes().size);
          for (const arr of takeUnannouncedArrivals(knownRef.current)) {
            arrivalFxRef.current.set(arr.ip, performance.now());
            playSound("receive");
            // v2: an address this wallet has never seen before appears as a
            // grey ghost. It stays grey until a probe actually answers.
            {
              const kp = knownRef.current[arr.ip];
              if (kp) emitMap("node.discovered", { lat: kp.lat, lon: kp.lon, ip: arr.ip });
            }
          }
          instantRevealRef.current = false; // only the first poll after a switch is instant
        });
      } catch {
        /* keep last — the red "node did not answer" rings come from rpc.rs */
      }
    };
    /* ── SAYING SO WHEN THE MAP IS NOT LIVE, AND ONLY THEN ───────────────
       When the node really does stop answering, this poll quietly keeps the
       last picture on screen -- spirals turning, peers pink, none of it
       true. Worth saying out loud.

       But the first version of this warning measured ELAPSED TIME since the
       last good poll, and that is not the same thing at all. A browser
       throttles timers in a background tab and stops them entirely while
       the machine sleeps, so no poll is even ATTEMPTED -- and on returning
       to the app the clock had moved and the map announced the node had
       been silent for minutes. Geoff, 2026-Sep-21, on a node whose log
       showed 36 peers and a healthy reply: "please stop it from writing
       stupid messages unless it's real."

       Which is the same error this whole day has been spent removing:
       reporting not-knowing as a definite bad state. So count actual
       failures instead. Four polls in a row that were really made and
       really came back empty is about forty seconds of genuine silence,
       and cannot be produced by a sleeping laptop. */
    // Six, not four. The map's poll asks for the whole peer list, which is a
    // heavier question than the watchdog's, and on a heavily loaded machine
    // it can miss a few in a row while the node is otherwise answering.
    const MISSES_BEFORE_WARNING = 6;
    const tick = () => {
      if (document.visibilityState !== "visible") return; // nothing is being polled
      /* Starting staking on a large wallet stops the node answering for a
         minute or two while it goes through every coin under its lock.
         Geoff's 20.5M-DIVI wallet, 2026-Sep-22: no blocks processed for two
         minutes after pressing Start Staking, then four at once. That is the
         node working, at the wallet's own request, and warning about it is
         crying wolf. The staking button says "setting up" for that time. */
      if (stakingSetupPending()) {
        missedPolls.current = 0;
        setStale(null);
        return;
      }
      /* A node that is STARTING is not a node that has gone quiet. It
         answers nothing while it loads the block index, one to two minutes
         on this chain. Ask the wallet what state the node is in and keep
         silent while it is starting or still checking. */
      const ph = nodePhaseRef.current;
      if (ph === "starting" || ph === "checking" || ph === "stopped" || ph === "crashed" || ph === "unreachable") {
        missedPolls.current = 0;
        setStale(null);
        return;
      }
      setStale(
        missedPolls.current >= MISSES_BEFORE_WARNING
          ? missedPolls.current * 10
          : null,
      );
    };
    /* Coming back to the window: whatever happened while it was away is not
       evidence of anything. Start again from a clean slate and ask now. */
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      missedPolls.current = 0;
      setStale(null);
      void poll();
    };
    /* Coming back from hidden (a sleep, another window): the recent peers
       are asked again at once, so a laptop that woke up sees its network
       confirmed in a second rather than at the next minute's wave. */
    const onShown = () => {
      if (document.visibilityState !== "visible") return;
      void runWave(firstWave(recordsRef.current, loadLastPeers(nodeId), Date.now()), FIRST_WAVE_TIMEOUT_MS, false);
    };
    document.addEventListener("visibilitychange", onShown);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    poll();
    const staleId = setInterval(tick, 5000);
    const id = setInterval(poll, 10000);
    return () => {
      alive = false;
      clearInterval(id);
      clearInterval(staleId);
      clearTimeout(firstMain);
      clearInterval(mainId);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("visibilitychange", onShown);
      window.removeEventListener("focus", onVisible);
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
      if (rebelsRef.current) { setHover(null); return; } // the game owns the mouse
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
      /* The game's panels sit inside this wrapper, and this handler was
         taking every wheel event on them for map zoom and cancelling it, so
         the weapon list and the ship's specs could not be scrolled at all.
         Anything over the game's own surfaces is theirs. */
      const t = e.target as Element | null;
      if (t?.closest?.(".orbit-hud, .ship-market, .rebels-hud")) return;
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
    /* ── RIGHT-CLICK A NODE ────────────────────────────────────────────────
       Geoff, 2026-Sep-20: "right-click on any node in the map to attempt to
       ping it and make it a peer." The menu offers a real handshake ping,
       adding it as a kept peer, connecting once, and copying the address.
       Everything it does is drawn on the map like any other real event. */
    const onContext = (e: MouseEvent) => {
      if (rebelsRef.current) return; // the game owns the mouse
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      let best: HoverPoint | null = null;
      let bestD = 18 * 18;
      for (const pt of pointsRef.current) {
        const d = (pt.x - mx) ** 2 + (pt.y - my) ** 2;
        if (d < bestD) { bestD = d; best = pt; }
      }
      if (best?.ip) {
        setHover(null);
        setMenu({ x: mx, y: my, ip: best.ip, isPeer: !!best.isPeer, label: best.name || best.title, note: null, busy: false });
      } else {
        setMenu(null);
      }
    };
    wrap.addEventListener("contextmenu", onContext);
    wrap.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);

    let raf = 0;
    // Full-display-rate canvas repaints were burning GPU the whole time the
    // map tab was open. 30fps is indistinguishable for drifting arcs and dots
    // and halves the render cost (or better, on 120 Hz screens).
    let lastFrame = 0;
    const draw = () => {
      // GLOBE view is showing: skip all 2D work, just keep the loop alive so it
      // resumes instantly when the user switches back to FLAT.
      if (globeActiveRef.current) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const nowTs = performance.now();
      if (nowTs - lastFrame < 33) {
        raf = requestAnimationFrame(draw);
        return;
      }
      lastFrame = nowTs;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const outbound = hslVar("--map-peer-link");
      const inbound = hslVar("--map-network-link"); // clearly distinct from peer-link by default
      // Peer arcs vary their colour between their base and HSB(268,67,100); each
      // arc (and its dot) picks a random point in that range.
      const primaryHsl = parseHslNums("--map-peer-link");
      const infoHsl = parseHslNums("--map-network-link");
      const ARC_TARGET: [number, number, number] = [268, 100, 66.5]; // HSB 268,67,100 in HSL
      const mixArcCol = (base: [number, number, number], t: number) => {
        const h = base[0] + (ARC_TARGET[0] - base[0]) * t;
        const s = base[1] + (ARC_TARGET[1] - base[1]) * t;
        const l = base[2] + (ARC_TARGET[2] - base[2]) * t;
        return (a: number) => `hsla(${h}, ${s}%, ${l}%, ${a})`;
      };
      const selfCol = hslVar("--map-self");
      const GREEN = hslVar("--map-discovery-pulse");
      const newNodeHue = parseHslNums("--map-new-node")[0];
      const s = snapRef.current;
      const g = geosRef.current;
      const now = performance.now();
      const netOnly = networkOnlyRef.current;
      const BLUE = hslVar("--map-network-link");
      const GREY = hslVar("--map-offline");
      const USER_IS_WINNER = userWonRecently(); // deck out our node right after a win

      // The node's true location comes from its own public IP; cache it so it's
      // stable (and never falls back to the app machine's location).
      if (s?.selfIp && g[s.selfIp]) selfRef.current = g[s.selfIp];
      const selfG = selfRef.current;
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
      /* Every known node is drawn. This was capped at the 150 most recently
         seen, from when the map knew of about ninety. After the crawl it
         knows of six hundred, and the cap silently dropped the rest -- the
         crawl-found ones had only ever been visible as spirals, so when the
         spirals were reset they vanished. Geoff, 2026-Sep-22: "we have lost
         on the map so many nodes... like Nigeria and Vietnam." A few hundred
         dots cost nothing to draw. */
      const blueNodes = Object.entries(knownRef.current)
        .filter(([ip]) => !liveIps.has(ip))
        .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
        .slice(0, 2000);

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
        // Keep the snapshot server in frame while its firehose is showing.
        if (flowModeRef.current === "snapshot" && snapSrcRef.current) {
          nodePts.push(wpx(snapSrcRef.current[0], snapSrcRef.current[1]));
        }
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
          online: probeRef.current.get(ip) === "online" || probeRef.current.get(ip) === "assumed", // verified, or trusted from the last day
          // Missed once or twice, being rechecked: drawn dimmer, still a node.
          unsure: probeRef.current.get(ip) !== "online" && probeCounts(recordsRef.current.get(ip)) && !!recordsRef.current.get(ip)?.aliveAt,
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
          ctx.fillStyle = b.online ? BLUE(0.35) : b.unsure ? BLUE(0.18) : GREY(0.3); // blue = live, dim blue = missed once or twice, grey = not answering
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
              ctx.fillStyle = b.online ? BLUE(0.3 * env) : b.unsure ? BLUE(0.16 * env) : GREY(0.3 * env);
              ctx.fillText(label, lx, ly);
            }
          }
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

      // ── First-run install: red data channels pouring into the user's node
      // from their REAL sources. SNAPSHOT = one heavy firehose from the snapshot
      // server's actual location; NODES = a thin channel from each real connected
      // peer. Drawn UNDER the node so the node + its red pulse rings sit on top.
      if (selfXY && flowModeRef.current) {
        if (flowModeRef.current === "snapshot") {
          if (snapSrcRef.current) {
            const [sx, sy] = P(snapSrcRef.current[0], snapSrcRef.current[1]);
            drawDataFlow(ctx, sx, sy, selfXY[0], selfXY[1], now, true);
          }
        } else if (s) {
          let n = 0;
          for (const p of s.peers) {
            const pg = g[p.ip];
            if (!pg) continue;
            const [px, py] = P(pg.lon, pg.lat);
            drawDataFlow(ctx, px, py, selfXY[0], selfXY[1], now, false);
            if (++n >= 8) break;
          }
        }
      }

      // our node — gold dot (3× and decked out when the user is the stake winner)
      if (selfXY) {
        // While first-run setup is downloading, flash the node RED so the user
        // can spot "that's me joining the network"; otherwise the usual gold.
        const inst = installingRef.current;
        const col = inst ? (a: number) => `hsl(0 85% 56% / ${a})` : selfCol;
        const r = (USER_IS_WINNER ? 15 : 5) + (inst ? 2 : 0);
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
        // Installing = fast, bright flash + an extra expanding ring; otherwise
        // a calm gold pulse.
        ctx.beginPath();
        ctx.arc(selfXY[0], selfXY[1], r, 0, Math.PI * 2);
        ctx.fillStyle = col(inst ? 0.65 + 0.35 * Math.sin(now / 160) : 1);
        ctx.fill();
        const pulse = inst ? 5 + 4 * Math.sin(now / 170) : 4 + 2 * Math.sin(now / 400);
        ctx.beginPath();
        ctx.arc(selfXY[0], selfXY[1], r + pulse, 0, Math.PI * 2);
        ctx.strokeStyle = col(inst ? 0.7 : 0.5);
        ctx.lineWidth = inst ? 2.5 : 1.5;
        ctx.stroke();
        if (inst) {
          const p2 = (now / 700) % 1;
          ctx.beginPath();
          ctx.arc(selfXY[0], selfXY[1], r + p2 * 26, 0, Math.PI * 2);
          ctx.strokeStyle = col((1 - p2) * 0.6);
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (USER_IS_WINNER) drawGlasses(ctx, selfXY[0], selfXY[1], r);
        // "YOU" (or "INSTALLING" during setup) label below the dot.
        ctx.fillStyle = col(1);
        ctx.font = "bold 11px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(inst ? "INSTALLING" : "YOU", selfXY[0], selfXY[1] + r + 6);
      }

      // Map-animation icon (e.g. PoE 🔗) bobbing above the node while a pulse is
      // active — whatever the triggering feature/app chose to show.
      if (selfXY && now < pulseActiveUntil()) {
        const icon = pulseIcon();
        if (icon) {
          const bob = Math.sin(now / 300) * 3;
          ctx.font = "18px system-ui";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(icon, selfXY[0], selfXY[1] - 28 + bob);
        }
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
          // Show the chosen node name (if any) as the first line, above the IP.
          lines: [nodeNameRef.current ? `“${nodeNameRef.current}”` : "", selfG.ip, [selfG.city, selfG.country].filter(Boolean).join(", "), selfG.isp || ""].filter(Boolean),
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
            ip: p.ip,
            isPeer: true,
            title: pg.city ? `${pg.city}, ${pg.country}` : p.ip,
            lines: [
              p.ip,
              p.inbound ? "Inbound peer" : "Outbound peer",
              `Ping ${Math.round(p.pingMs)} ms · connected ${fmtDur(p.connSecs)}`,
              pg.isp || "",
              classifyNode(p.subver).label,
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
        const online = st === "online" || st === "assumed";
        const rec = recordsRef.current.get(ip);
        const unsure = !online && st !== "probing" && probeCounts(rec) && !!rec?.aliveAt;
        const agoMin = rec?.aliveAt ? Math.max(1, Math.round((Date.now() - rec.aliveAt) / 60000)) : 0;
        const ago = agoMin >= 120 ? `${Math.round(agoMin / 60)} h ago` : `${agoMin} min ago`;
        const name = announcedName(kp.subver);
        const [x, y] = P(kp.lon, kp.lat);
        const loc = [kp.city || g[ip]?.city, kp.country || g[ip]?.country].filter(Boolean).join(", ");
        const isp = g[ip]?.isp || "";
        pts.push({
          x,
          y,
          ip,
          isPeer: false,
          title: loc || ip,
          name,
          lines: [
            loc ? ip : "",
            st === "assumed"
              ? `Last confirmed ${ago} · checking now`
              : online
              ? "Active now · not connected"
              : st === "probing"
                ? "Checking…"
                : unsure
                  ? `Missed ${rec?.misses ?? 1} check${(rec?.misses ?? 1) === 1 ? "" : "s"} · trying again soon`
                  : rec?.aliveAt
                    ? "Not answering · rechecked daily"
                    : "Seen in the last 90 days",
            isp,
            // Node type from the client it last advertised (remembered in the store).
            kp.subver ? classifyNode(kp.subver).label : "",
          ].filter(Boolean),
          tone: online ? "blue" : undefined,
        });
      }
      pointsRef.current = pts;

      // ── Blockchain-activity ripple (gold) ────────────────────────────────
      // Each peer gets its OWN independent ping (built once when a pulse fires):
      // 4 legs — home→peer, peer→1-2 random network nodes, back, back home —
      // each leg independently jittered ±0.2s. So the map shows many little
      // round-trips at staggered times, not four synchronised group flashes.
      // Spawn a wave on a fresh trigger, AND keep re-spawning while a typed
      // transaction pulse is still "active" (its lingering window) so it stays
      // watchable after switching to the map. Waves are based at `now` so a
      // late-arriving viewer still sees fresh ripples, not ones already expired.
      const trig = pulseTrigger();
      const pulseLive = now < pulseActiveUntil();
      const freshTrig = !!trig && trig !== lastPulseRef.current;
      if (selfXY && (freshTrig || (pulseLive && pingsRef.current.length === 0))) {
        if (freshTrig) lastPulseRef.current = trig;
        const netLL: [number, number][] = blueNodes.map(([, kp]) => [kp.lon, kp.lat]);
        const pings: { peer: [number, number]; nets: [number, number][]; legs: Leg[] }[] = [];
        for (const p of s?.peers ?? []) {
          const pg = g[p.ip];
          if (!pg) continue;
          const nets: [number, number][] = [];
          const count = netLL.length ? 1 + Math.floor(Math.random() * 2) : 0; // 1-2
          for (let i = 0; i < count; i++) nets.push(netLL[Math.floor(Math.random() * netLL.length)]);
          pings.push({ peer: [pg.lon, pg.lat], nets, legs: makeLegs(now) });
        }
        pingsRef.current = pings;
      }
      if (selfXY && pingsRef.current.length) {
        // Tint the ripple with the active pulse's colour (PoE = light blue, etc.).
        const triple = pulseHsl();
        const GOLD = (a: number) => `hsl(${triple} / ${a})`;
        const ripple = (from: [number, number], to: [number, number], u: number) => {
          const bez = upArc(from[0], from[1], to[0], to[1], 0.5);
          ctx.lineWidth = 1;
          const STEP = 0.1;
          let prev = bez(0);
          for (let t = STEP; t <= 1.0001; t += STEP) {
            const cur = bez(t);
            const glow = Math.exp(-(((t - u) / 0.25) * ((t - u) / 0.25)));
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(cur[0], cur[1]);
            ctx.strokeStyle = GOLD(0.1 + 0.72 * glow);
            ctx.stroke();
            prev = cur;
          }
          const [hx, hy] = bez(u);
          ctx.beginPath();
          ctx.arc(hx, hy, 5, 0, Math.PI * 2);
          ctx.fillStyle = GOLD(0.18);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(hx, hy, 2.4, 0, Math.PI * 2);
          ctx.fillStyle = GOLD(0.95);
          ctx.fill();
        };
        const query = (pt: [number, number], op: number) => {
          if (op <= 0.02) return;
          ctx.font = "bold 12px 'Courier New', monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillStyle = GOLD(op);
          ctx.fillText("?", pt[0], pt[1] - 6);
        };
        for (const pg of pingsRef.current) {
          if (pingDone(pg.legs, now)) continue;
          const peerPt = P(pg.peer[0], pg.peer[1]);
          const netPts = pg.nets.map((n) => P(n[0], n[1]));
          const [lA, lB, lC, lD] = pg.legs;
          let u = legU(lA, now);
          if (u >= 0) ripple(selfXY, peerPt, u); // home → peer
          u = legU(lB, now);
          if (u >= 0) for (const np of netPts) ripple(peerPt, np, u); // peer → network
          u = legU(lC, now);
          if (u >= 0) for (const np of netPts) ripple(np, peerPt, u); // network → peer
          u = legU(lD, now);
          if (u >= 0) ripple(peerPt, selfXY, u); // peer → home
          query(peerPt, holdOp(lA.t1, lD.t0, now)); // peer holds the query
          const nq = holdOp(lB.t1, lC.t0, now);
          for (const np of netPts) query(np, nq); // network nodes hold the query
        }
        // Drop finished pings so the loop stays cheap between pulses.
        if (pingsRef.current.every((pg) => pingDone(pg.legs, now))) pingsRef.current = [];
      }

      // ── New-node spirals (TOP pass) ──────────────────────────────────────
      // Drawn last so a busy/VPN location can never hide them. Spirals sharing a
      // location fan out a few px apart (stable angle per IP) so each is visible.
      const news = newNodesRef.current;
      if (news.length) {
        const groups = new Map<string, NewNode[]>();
        for (const n of news) {
          const key = `${n.lat.toFixed(1)},${n.lon.toFixed(1)}`;
          (groups.get(key) ?? groups.set(key, []).get(key)!).push(n);
        }
        for (const group of groups.values()) {
          group.forEach((n, idx) => {
            const [bx, by] = P(n.lon, n.lat);
            // fan-out: idx 0 centred, others nudged on a small ring (6px)
            const ang = phaseOf(n.ip);
            const off = idx === 0 ? 0 : 6;
            const cx = bx + Math.cos(ang) * off;
            const cy = by + Math.sin(ang) * off;
            // recompute the diameter live so it shrinks over the day boundary
            const dia = spiralDiameter(n.firstSeen);
            if (dia <= 0) return;
            drawSpiral(ctx, cx, cy, dia, now, highlightIpRef.current === n.ip, newNodeHue);
            // one-time arrival flash: an expanding aqua ring, ~800ms
            const t0 = arrivalFxRef.current.get(n.ip);
            if (t0 != null) {
              const dt = now - t0;
              if (dt > 800) arrivalFxRef.current.delete(n.ip);
              else {
                const p = dt / 800;
                ctx.save();
                ctx.beginPath();
                ctx.arc(cx, cy, 6 + p * 26, 0, Math.PI * 2);
                ctx.strokeStyle = `hsla(${newNodeHue}, 85%, 60%, ${0.7 * (1 - p)})`;
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.restore();
              }
            }
          });
        }
      }

      // ── v2 animation layer ────────────────────────────────────────────────
      // Drawn last, on top of everything, from the real event queue. Uses the
      // map's own zoom/pan-aware projection so arcs and rings stay glued to
      // their nodes while the user drags and zooms. Inert when the flag is off.
      {
        // Reset the transform first. P() already returns final screen pixels,
        // so if any earlier layer left a transform on the context our rings
        // would land somewhere other than on their nodes.
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawMapAnim(ctx, nowTs, {
          project: (lat, lon) => P(lon, lat),
          self: selfXY,
        });
        ctx.restore();
      }


      // ── DD69-only view ───────────────────────────────────────────────────
      // Everything else is hidden and the nodes running this software are drawn
      // as hearts that pulse between purple and fuchsia. A node says which
      // software it runs in its subversion string; ours carries "dd69".
      if (dd69OnlyRef.current) {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // Dim the rest of the map so only the hearts read.
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, 0, w, h);
        const beat = (Math.sin(nowTs / 420) + 1) / 2; // purple <-> fuchsia
        let found = 0;
        for (const [ip, kp] of Object.entries(knownRef.current)) {
          const sv = (kp.subver ?? "").toLowerCase();
          if (!sv.includes("dd69")) continue;
          if (typeof kp.lat !== "number" || typeof kp.lon !== "number") continue;
          found++;
          const [hx, hy] = P(kp.lon, kp.lat);
          drawHeart(ctx, hx, hy, 9, beat, ip === (snapRef.current?.selfIp ?? ""));
        }
        // Our own node counts: it runs this software by definition.
        if (selfXY) drawHeart(ctx, selfXY[0], selfXY[1], 11, beat, true);
        ctx.font = "12px 'Courier New', Courier, monospace";
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillText(
          found === 0
            ? "No other DD69 nodes seen yet — they appear as they upgrade."
            : `${found + 1} DD69 node${found ? "s" : ""}`,
          16,
          h - 16,
        );
        ctx.restore();
      }

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
      wrap.removeEventListener("contextmenu", onContext);
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
    // Count from the AUTHORITATIVE stored list (union-healed to the full ~92),
    // not the map's in-memory ref which could momentarily read low. Overlaid
    // with the ref so any self-nodes the map injected are still included.
    const full = { ...loadKnown(), ...knownRef.current };
    const alive = verifiedNodes();
    for (const [ip, kp] of Object.entries(full)) {
      if (alive.has(ip)) add(ip, kp.country || geos[ip]?.country);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [snap, geos, probeTick]);

  // What to call a tower. Same sources the map's own tooltips use, so the
  // cockpit and the tooltip never disagree about where you are.
  const labelForIp = (ip: string): string => {
    if (!ip) return "";
    const self = selfRef.current;
    if (self && self.ip === ip) {
      return [self.city, self.country].filter(Boolean).join(", ") || ip;
    }
    const g = geos[ip];
    const kp = knownRef.current[ip];
    const city = g?.city ?? kp?.city;
    const country = g?.country ?? kp?.country;
    return [city, country].filter(Boolean).join(", ") || ip;
  };

  // The SAME nodes/arcs the flat map shows, shaped for the globe: self + peers +
  // the 30-day known network as points, and an arc from our node to each peer.
  const globeData = useMemo(() => {
    const pts: GlobePoint[] = [];
    const arcs: GlobeArc[] = [];
    const seen = new Set<string>();
    const push = (ip: string, lat: number, lon: number, kind: GlobePoint["kind"], city?: string, country?: string) => {
      if (!ip || seen.has(ip) || lat == null || lon == null) return;
      seen.add(ip);
      pts.push({ ip, lat, lng: lon, kind, city, country });
    };
    const self = selfRef.current;
    if (self) push(self.ip, self.lat, self.lon, "self", self.city, self.country);
    // Peers first, and ALWAYS as "peer" — fall back to the stored known-node
    // coords when the live geo lookup hasn't resolved yet, otherwise a peer would
    // fall through and get drawn as a blue "net" tower instead of a pink one.
    for (const p of snap?.peers ?? []) {
      const g = geos[p.ip];
      const kp = knownRef.current[p.ip];
      const lat = g?.lat ?? kp?.lat;
      const lon = g?.lon ?? kp?.lon;
      if (lat != null && lon != null) push(p.ip, lat, lon, "peer", g?.city ?? kp?.city, g?.country ?? kp?.country);
    }
    /* ---- ONLY NODES VERIFIED ALIVE ----
       This drew every address the app had ever heard of (about six hundred)
       while the count next to it said 118, and the game's towers are these
       towers. Geoff: "one or the other is wrong." The count is the honest
       one: peers, nodes that answered a probe, and our own. So the globe
       draws that set and nothing that has never answered or is known down. */
    const full = { ...loadKnown(), ...knownRef.current };
    for (const ip of verifiedNodes()) {
      const kp = full[ip];
      if (!kp) continue;
      push(ip, kp.lat, kp.lon, "net", kp.city, kp.country || geos[ip]?.country);
    }
    if (self) {
      for (const p of snap?.peers ?? []) {
        const g = geos[p.ip];
        const kp = knownRef.current[p.ip];
        const lat = g?.lat ?? kp?.lat;
        const lon = g?.lon ?? kp?.lon;
        if (lat != null && lon != null) arcs.push({ startLat: self.lat, startLng: self.lon, endLat: lat, endLng: lon });
      }
    }
    return { pts, arcs, center: self };
  }, [snap, geos]);

  return (
    <div className="netmap">
      <div className="netmap-topbar">
        <button type="button" className="netmap-return" onClick={onReturn}>
          <Icon name="overview" size={14} /> Return to Overview
        </button>
        <div className="netmap-legend">
          <span className="nm-item"><span className="nm-dot nm-seek" /> Seeking</span>
          <span className="nm-item"><span className="nm-dot nm-ghost" /> No answer yet</span>
          <span className="nm-item"><span className="nm-dot nm-deadc" /> No answer</span>
          <span className="nm-item"><span className="nm-dot nm-self" /> Alive</span>
          <span className="nm-item"><span className="nm-dot nm-out" /> Peer</span>
          <span className="nm-item"><span className="nm-dot nm-extc" /> Outside Divi</span>
        </div>
        <div className="netmap-tools">
          {globe && (
            <button
              type="button"
              className={"netmap-play" + (playing ? " on" : "")}
              onClick={() => setRebels((cur) => {
                if (cur) { cur.dispose(); return null; }
                return createRebels(labelForIp);
              })}
              title={playing ? "Leave Divi Rebels" : "Play Divi Rebels"}
            >
              <Icon name="tie" size={15} />
            </button>
          )}
          <div className="netmap-viewtoggle" role="group" aria-label="Map view">
            <button type="button" className={globe ? "" : "on"} onClick={() => { setGlobe(false); setRebels((c) => { c?.dispose(); return null; }); }}>
              Flat
            </button>
            <button type="button" className={globe ? "on" : ""} onClick={() => setGlobe(true)}>
              Globe
            </button>
          </div>
          <button
            type="button"
            className={"netmap-burger" + (menuOpen ? " on" : "")}
            onClick={() => { setMenuOpen((v) => !v); setPanel(null); }}
            title="Menu"
          >
            <Icon name="menu" size={16} />
          </button>
        </div>
      </div>
      <div className="netmap-body">
        {setupOpen && (
          <InstallPanel
            simulate={simulateNew}
            onClose={() => { setSetupOpen(false); setSimulateNew(false); installingRef.current = false; flowModeRef.current = null; }}
            onStateChange={(s: InstallState) => {
              installingRef.current = s.installing;
              flowModeRef.current = s.installing && (s.method === "snapshot" || s.method === "nodes") ? s.method : null;
            }}
          />
        )}
      <div
        className={"netmap-canvas-wrap" + (playing ? " netmap-flying" : "")}
        ref={wrapRef}
        onMouseDown={() => {
          // Clicking the map (outside any panel/menu, which stop propagation)
          // closes an open panel and the menu.
          setPanel(null);
          setMenuOpen(false);
        }}
      >
        <canvas ref={canvasRef} className="netmap-canvas" />
        {globe && (
          <GlobeMap
            points={globeData.pts}
            arcs={globeData.arcs}
            center={globeData.center}
            getWinnerIp={() => (userWonRecently() ? selfRef.current?.ip ?? null : winnerRef.current)}
            flight={rebels}
          />
        )}
        {/* Hamburger menu (top-right): opens one overlay panel at a time. */}
        {menuOpen && (
          <div className="netmap-menu" onMouseDown={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => { setPanel("mempool"); setMenuOpen(false); }}>Mempool</button>
            <button type="button" onClick={() => { setPanel("newest"); setMenuOpen(false); }}>Newest Nodes</button>
            <button type="button" onClick={() => { setPanel("speed"); setMenuOpen(false); }}>Node Speed</button>
            <button type="button" onClick={() => { setPanel("country"); setMenuOpen(false); }}>Nodes by Country</button>
            <button type="button" onClick={() => { setDd69Only(true); setMenuOpen(false); }}>DD69 Nodes</button>
            <button type="button" onClick={() => { setSetupOpen(true); setMenuOpen(false); }}>Set up wallet</button>
          </div>
        )}
        {dd69Only && (
          <div className="netmap-dd69bar" onMouseDown={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setDd69Only(false)}>RETURN TO NORMAL MAP</button>
          </div>
        )}
        {/* The map is showing a remembered picture, not a live one. Said
            plainly, because a map that looks live when it is not is a lie.
            Selectable, and with its own copy button — Geoff, 2026-Sep-21:
            "It's not text so I can't copy/paste it and it doesn't have a
            copy button (of course it should)." Any message worth showing is
            worth being able to send to someone. */}
        {stale !== null && !rebels && (
          <div className="netmap-frozen" onMouseDown={(e) => e.stopPropagation()}>
            <span className="netmap-frozen-text">
              <b>The node has gone quiet.</b> It hasn't answered for about{" "}
              {stale < 120 ? `${stale} seconds` : `${Math.round(stale / 60)} minutes`}, so what's
              on the map is the last thing we knew rather than what's happening now. It usually
              comes back on its own.
            </span>
            <button
              type="button"
              className="netmap-frozen-copy"
              onClick={() => {
                /* The whole diagnostic, not just this sentence — that is what
                   is actually useful to send. Kept warm by SetupLogHotkey, so
                   the clipboard write happens inside the click. */
                const shown =
                  `Map warning: "The node has gone quiet." ` +
                  `No answer to the map's peer poll for about ${stale} seconds ` +
                  `(${missedPolls.current} polls in a row came back empty). ` +
                  `Copied at ${new Date().toISOString()}.`;
                void copySetupLogNow(shown).then((r) => setCopiedDiag(r.ok ? "Copied" : "Press ⌘L"));
                window.setTimeout(() => setCopiedDiag(null), 2500);
              }}
            >
              {copiedDiag ?? "Copy details"}
            </button>
          </div>
        )}
        {rebels && (
          <div className="netmap-game" onMouseDown={(e) => e.stopPropagation()}>
            <RebelsHud ctl={rebels} onExit={() => setRebels((c) => { c?.dispose(); return null; })} />
          </div>
        )}
        {panel === "country" && <NodesByCountry data={nodesByCountry} />}
        {panel === "speed" && <FastestNodes getNodes={fastCandidates} origin={activeNode} />}
        {panel === "mempool" && <Mempool />}
        {panel === "newest" && <NewestNodesPanel onHighlight={(ip) => (highlightIpRef.current = ip)} />}
        {/* Blockstream visibility toggle (eye). Closed => dim to 10%. Both it
            and the stream itself are hidden while flying: the game needs the
            whole window and the stream sits right where the ship does. */}
        {!playing && <button
          type="button"
          className="netmap-eye"
          onClick={() => setBlockDim((v) => !v)}
          title={blockDim ? "Show blockstream" : "Hide blockstream"}
        >
          <Icon name={blockDim ? "eyeOff" : "eye"} size={10} />
        </button>}
        {!playing && (
          <div className="bv-dim" style={{ opacity: blockDim ? 0.1 : 1 }}>
            {primer.active ? <PrimerLove /> : <BlockChainViz />}
          </div>
        )}
        {menu && !rebels && (
          <div
            ref={menuRef}
            className="netmap-menu netmap-ctx"
            style={{
              left: Math.min(menu.x + 8, (wrapRef.current?.clientWidth ?? 9999) - 230),
              /* Kept inside the map: near the bottom the menu used to run off
                 it and the Close button with it. */
              top: Math.max(8, Math.min(menu.y - 8, (wrapRef.current?.clientHeight ?? 9999) - menuH - 8)),
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="netmap-ctx-head">{menu.label}<small>{menu.ip}</small></div>
            <button type="button" disabled={menu.busy} onClick={() => {
              setMenu((m) => m && { ...m, busy: true, note: "Pinging\u2026" });
              const kp = knownRef.current[menu.ip];
              const resolve = kp ? beginProbeWave([{ ip: menu.ip, lat: kp.lat, lon: kp.lon }]) : null;
              networkCrawl([menu.ip], 0).then((r) => {
                const hit = r.results.find((x) => x.ip === menu.ip);
                resolve?.([{ ip: menu.ip, online: !!hit?.alive }]);
                if (hit?.alive) {
                  probeRef.current.set(menu.ip, "online");
                  if (kp && hit.subver) knownRef.current = { ...knownRef.current, [menu.ip]: { ...kp, subver: hit.subver } };
                }
                setMenu((m) => m && { ...m, busy: false, note: hit?.alive ? `Answered. ${hit.subver || "Divi node"}, block ${hit.height}` : "No answer." });
              }).catch((e) => setMenu((m) => m && { ...m, busy: false, note: String(e) }));
            }}>Ping it</button>
            {!menu.isPeer && (
              <button type="button" disabled={menu.busy} onClick={() => connectTo(menu.ip, true)}>Add as peer</button>
            )}
            {!menu.isPeer && (
              <button type="button" disabled={menu.busy} onClick={() => connectTo(menu.ip, false)}>Connect once</button>
            )}
            <button type="button" onClick={() => { navigator.clipboard?.writeText(menu.ip); setMenu((m) => m && { ...m, note: "Address copied." }); }}>Copy address</button>
            {menu.note && <div className="netmap-ctx-note">{menu.note}</div>}
            <button type="button" className="netmap-ctx-close" onClick={() => setMenu(null)}>Close</button>
          </div>
        )}
        {hover && !menu && !rebels && (
          <div
            className={"netmap-tip" + (hover.tone === "blue" ? " netmap-tip-blue" : "")}
            style={{
              left: Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 9999) - 220),
              top: Math.max(8, hover.y - 10),
            }}
          >
            {hover.name && <div className="netmap-tip-name">{hover.name}</div>}
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
    </div>
  );
}

// Bottom-left overlay: node counts by country, scrollable. Styled like the
// moving blocks below it but blue-bordered to match the network lines. It stops
// wheel/mousedown from reaching the map so scrolling it doesn't zoom or pan.
/** The pre-clipboard-API way of copying. Still the reliable fallback when the
    async clipboard is refused, and it works inside a click without waiting. */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("style", "position:fixed;left:-9999px;top:0;opacity:0");
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function NodesByCountry({ data }: { data: [string, number][] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  /* ── PASTING THIS INTO A SPREADSHEET ────────────────────────────────────
     Sheets, Excel and Numbers all split a pasted block on TAB characters
     and newlines, so tab-separated text lands in three real columns with
     no import step and no "split text to columns" afterwards. Commas would
     not: a country like "Korea, Republic of" would break its own row in
     half. A header row comes first so the columns are labelled. */
  const asTsv = () =>
    ["Country\tFull nodes\tLovenodes", ...data.map(([c, n]) => `${c}\t${n}\t0`)].join("\n");

  /* Called straight from the click, with the text already in hand: the
     clipboard is only writable while the click is still live, so there is
     deliberately nothing awaited before the write. */
  const copy = () => {
    const text = asTsv();
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => {
        if (legacyCopy(text)) done();
      });
      return;
    }
    if (legacyCopy(text)) done();
  };

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
    <div className="nbc glass-panel" ref={ref}>
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
      <div className="nbc-foot">
        <button type="button" className="nbc-copy" onClick={copy} disabled={!data.length}>
          {/* Two overlapping sheets — the usual "copy" glyph. */}
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <rect x="5.2" y="1.6" width="9.2" height="11" rx="1.6"
              fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M10.8 14.4H3.2a1.6 1.6 0 0 1-1.6-1.6V4.4"
              fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          {copied ? "Copied" : "Copy List"}
        </button>
      </div>
    </div>
  );
}
