// DFlow for Divi Rebels: where every frame's time goes, written down.
//
// Geoff: "The goal is to track everything that may create lag and low FPS
// so we can fix it. Don't leave anything out that's important."
//
// One collector, always running while the game is attached, cheap enough to
// leave on: a handful of clock reads a frame. Every frame it records how long
// the browser gave us (the real interval between frames), how long each STAGE
// of our own work took (flight, room, combat, events, meshes, each drawing
// pass, the map's own animation, the renderer's submit), what was in the sky
// (counts of everything), what the renderer did (draw calls, triangles,
// programs compiled), what the room sent (messages, bytes), and what the
// audio bus measured. Half-second summaries go into a ring that holds five
// minutes; any frame over the stall line is kept whole, with its breakdown,
// in a worst-frames list. The report is one block of text made for a
// clipboard, with a raw table at the end that a person or a script can read.

export const STALL_MS = 40;          /* a frame this long is a visible hitch */
const SUMMARY_SECONDS = 0.5;
const RING = 600;                    /* five minutes of half seconds */
const WORST_KEEP = 24;
const NOTES_KEEP = 60;

export const STAGES = [
  "approach", "flight", "ship", "room", "combat", "events", "audio", "meshes",
  "draw.bullets", "draw.beams", "draw.drones", "draw.orbs", "draw.torps", "draw.junk",
  "draw.tracers", "draw.coins", "draw.gems", "draw.dock", "draw.peers", "hud",
  "map.sharpen", "map.detail", "map.lights", "map.helix", "gl.render",
] as const;
export type Stage = typeof STAGES[number];

export interface Counts {
  enemies: number; drones: number; bullets: number; coins: number; gems: number;
  tracers: number; junk: number; beams: number; torps: number; peers: number;
  flocks: number; meshes: number;
}
export interface RenderStats {
  calls: number; triangles: number; programs: number; geometries: number; textures: number; ratio: number;
}

interface Summary {
  at: number;                 /* seconds since the collector started */
  frames: number;
  dtAvg: number; dtMax: number;
  stageAvg: Float32Array; stageMax: Float32Array;
  counts: Counts;
  render: RenderStats;
  netMsgs: number; netBytes: number;
  audioLevel: number;
  heapMB: number;
}
interface Worst {
  at: number; dt: number; stages: Record<string, number>; counts: Counts; render: RenderStats; note: string;
}

const BLANK_COUNTS = (): Counts => ({
  enemies: 0, drones: 0, bullets: 0, coins: 0, gems: 0, tracers: 0, junk: 0, beams: 0, torps: 0,
  peers: 0, flocks: 0, meshes: 0,
});
const BLANK_RENDER = (): RenderStats => ({ calls: 0, triangles: 0, programs: 0, geometries: 0, textures: 0, ratio: 0 });

class Dflow {
  private started = 0;
  private stageIdx = new Map<string, number>();
  /* This frame. */
  private frameStages = new Float32Array(STAGES.length);
  private frameDt = 0;
  private frameOpen = false;
  /* This half second. */
  private accStages = new Float32Array(STAGES.length);
  private accMax = new Float32Array(STAGES.length);
  private accFrames = 0;
  private accDt = 0;
  private accDtMax = 0;
  private accNetMsgs = 0;
  private accNetBytes = 0;
  private accSince = 0;
  private lastCounts: Counts = BLANK_COUNTS();
  private lastRender: RenderStats = BLANK_RENDER();
  private lastAudio = 0;
  private lastPrograms = -1;
  private lastDrones = 0;
  /* Totals. */
  private ring: Summary[] = [];
  private worst: Worst[] = [];
  private notes: Array<{ at: number; text: string }> = [];
  private totalFrames = 0;
  private stalls = 0;
  private compiles = 0;
  private netMsgsTotal = 0;
  private netBytesTotal = 0;
  private lastStateBytes = 0;
  private roomStatus = "off";
  private label = "";
  private worstNote = "";

  constructor() {
    STAGES.forEach((s, i) => this.stageIdx.set(s, i));
    this.reset();
  }

  reset(): void {
    this.started = this.now();
    this.ring = []; this.worst = []; this.notes = [];
    this.totalFrames = 0; this.stalls = 0; this.compiles = 0;
    this.netMsgsTotal = 0; this.netBytesTotal = 0;
    this.accStages.fill(0); this.accMax.fill(0);
    this.accFrames = 0; this.accDt = 0; this.accDtMax = 0; this.accNetMsgs = 0; this.accNetBytes = 0;
    this.accSince = 0;
    this.lastPrograms = -1;
  }

  now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  /** What the panel and the report call this run: version, ratio, canvas. */
  setLabel(text: string): void { this.label = text; }

  /* ---- per frame ---- */

  frameStart(dt: number): void {
    /* NOT cleared here. The map's own stages and the renderer's submit are
       added AFTER frameEnd, between frames, and clearing at the start threw
       them away: the first report showed every map stage and gl.render as
       zero. They are cleared at frameEnd, once recorded, so what lands
       between frames counts toward the next one. */
    this.frameDt = dt * 1000;
    this.frameOpen = true;
  }

  /** Milliseconds spent in a stage this frame. Add as many times as needed. */
  add(stage: Stage | string, ms: number): void {
    const i = this.stageIdx.get(stage);
    if (i === undefined) return;
    this.frameStages[i] += ms;
  }

  /** Time a piece of work and file it under a stage. */
  time<T>(stage: Stage | string, fn: () => T): T {
    const t = this.now();
    try { return fn(); } finally { this.add(stage, this.now() - t); }
  }

  counts(c: Partial<Counts>): void { Object.assign(this.lastCounts, c); }
  render(r: Partial<RenderStats>): void {
    Object.assign(this.lastRender, r);
    if (r.programs !== undefined) {
      if (this.lastPrograms >= 0 && r.programs > this.lastPrograms) {
        this.compiles += r.programs - this.lastPrograms;
        this.note(`shader compiled (+${r.programs - this.lastPrograms}, now ${r.programs})`);
        this.worstNote = "shader compile";
      }
      this.lastPrograms = r.programs;
    }
  }
  audio(level: number): void { this.lastAudio = level; }
  net(bytes: number, stateBytes?: number): void {
    this.accNetMsgs++; this.accNetBytes += bytes;
    this.netMsgsTotal++; this.netBytesTotal += bytes;
    if (stateBytes !== undefined) this.lastStateBytes = stateBytes;
  }
  room(status: string): void {
    if (status !== this.roomStatus) { this.note(`room: ${this.roomStatus} -> ${status}`); this.roomStatus = status; }
  }
  note(text: string): void {
    this.notes.push({ at: this.elapsed(), text });
    if (this.notes.length > NOTES_KEEP) this.notes.shift();
  }

  frameEnd(): void {
    if (!this.frameOpen) return;
    this.frameOpen = false;
    this.totalFrames++;
    const dt = this.frameDt;
    /* A flock arriving is worth a note: a jump in drones. */
    if (this.lastCounts.drones >= this.lastDrones + 20) this.note(`flock arrived: drones ${this.lastDrones} -> ${this.lastCounts.drones}`);
    if (this.lastCounts.drones === 0 && this.lastDrones > 0) this.note("drones gone");
    this.lastDrones = this.lastCounts.drones;

    for (let i = 0; i < STAGES.length; i++) {
      this.accStages[i] += this.frameStages[i];
      if (this.frameStages[i] > this.accMax[i]) this.accMax[i] = this.frameStages[i];
    }
    this.accFrames++;
    this.accDt += dt;
    if (dt > this.accDtMax) this.accDtMax = dt;
    this.accSince += dt / 1000;

    if (dt >= STALL_MS) {
      this.stalls++;
      const stages: Record<string, number> = {};
      let ours = 0;
      for (let i = 0; i < STAGES.length; i++) {
        if (this.frameStages[i] > 0.05) stages[STAGES[i]] = Math.round(this.frameStages[i] * 100) / 100;
        ours += this.frameStages[i];
      }
      const note = this.worstNote || (ours < dt * 0.3 ? "outside our code (GC, layout, compositor or GPU)" : "in our code");
      this.worst.push({ at: this.elapsed(), dt, stages, counts: { ...this.lastCounts }, render: { ...this.lastRender }, note });
      this.worst.sort((a, b) => b.dt - a.dt);
      if (this.worst.length > WORST_KEEP) this.worst.length = WORST_KEEP;
    }
    this.worstNote = "";
    this.frameStages.fill(0);

    if (this.accSince >= SUMMARY_SECONDS) this.flush();
  }

  private flush(): void {
    const n = Math.max(1, this.accFrames);
    const stageAvg = new Float32Array(STAGES.length);
    for (let i = 0; i < STAGES.length; i++) stageAvg[i] = this.accStages[i] / n;
    let heap = 0;
    try {
      const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      if (m) heap = m.usedJSHeapSize / 1048576;
    } catch { /* not here */ }
    this.ring.push({
      at: this.elapsed(), frames: this.accFrames,
      dtAvg: this.accDt / n, dtMax: this.accDtMax,
      stageAvg, stageMax: this.accMax.slice(),
      counts: { ...this.lastCounts }, render: { ...this.lastRender },
      netMsgs: this.accNetMsgs, netBytes: this.accNetBytes,
      audioLevel: this.lastAudio, heapMB: heap,
    });
    if (this.ring.length > RING) this.ring.shift();
    this.accStages.fill(0); this.accMax.fill(0);
    this.accFrames = 0; this.accDt = 0; this.accDtMax = 0; this.accNetMsgs = 0; this.accNetBytes = 0;
    this.accSince = 0;
  }

  elapsed(): number { return (this.now() - this.started) / 1000; }

  /* ---- for the panel ---- */

  live(): {
    fps: number; dtAvg: number; dtMax: number; frames: number; stalls: number; compiles: number;
    top: Array<[string, number]>; counts: Counts; render: RenderStats; net: { msgs: number; bytes: number; state: number };
    audio: number; room: string; seconds: number;
  } {
    const last = this.ring[this.ring.length - 1];
    const recent = this.ring.slice(-10);
    const dtAvg = recent.length ? recent.reduce((a, s) => a + s.dtAvg, 0) / recent.length : 0;
    const dtMax = recent.reduce((a, s) => Math.max(a, s.dtMax), 0);
    const top: Array<[string, number]> = [];
    if (last) {
      STAGES.forEach((s, i) => { if (last.stageAvg[i] > 0.02) top.push([s, last.stageAvg[i]]); });
      top.sort((a, b) => b[1] - a[1]);
    }
    return {
      fps: dtAvg > 0 ? 1000 / dtAvg : 0, dtAvg, dtMax,
      frames: this.totalFrames, stalls: this.stalls, compiles: this.compiles,
      top: top.slice(0, 8), counts: this.lastCounts, render: this.lastRender,
      net: { msgs: last?.netMsgs ?? 0, bytes: last?.netBytes ?? 0, state: this.lastStateBytes },
      audio: this.lastAudio, room: this.roomStatus, seconds: this.elapsed(),
    };
  }

  /* ---- the report ---- */

  report(): string {
    const L: string[] = [];
    const f = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "-");
    const ring = this.ring;
    const frames = ring.reduce((a, s) => a + s.frames, 0);
    const secs = ring.reduce((a, s) => a + s.frames * s.dtAvg, 0) / 1000;
    const dts = ring.map((s) => s.dtAvg).sort((a, b) => a - b);
    const p = (q: number) => dts.length ? dts[Math.min(dts.length - 1, Math.floor(dts.length * q))] : 0;
    const worstDt = ring.reduce((a, s) => Math.max(a, s.dtMax), 0);

    L.push("DIVI REBELS DFLOW REPORT");
    L.push(`${this.label}`);
    L.push(`captured ${f(secs, 0)}s, ${frames} frames, ${new Date().toISOString()}`);
    L.push("");
    L.push("FRAME TIME (the browser's interval between frames; 16.7ms is 60fps, 8.3ms is 120)");
    L.push(`  average ${f(p(0.5), 1)}ms (${f(p(0.5) > 0 ? 1000 / p(0.5) : 0, 0)} fps), 95th ${f(p(0.95), 1)}ms, worst ${f(worstDt, 1)}ms`);
    L.push(`  stalls over ${STALL_MS}ms: ${this.stalls}   shader compiles seen: ${this.compiles}`);
    L.push("");
    L.push("WHERE OUR TIME GOES (ms per frame, averaged over the capture; max is the worst half-second average)");
    const avg = new Float32Array(STAGES.length), mx = new Float32Array(STAGES.length);
    for (const s of ring) for (let i = 0; i < STAGES.length; i++) {
      avg[i] += s.stageAvg[i] * s.frames;
      if (s.stageMax[i] > mx[i]) mx[i] = s.stageMax[i];
    }
    const rows: Array<[string, number, number]> = [];
    for (let i = 0; i < STAGES.length; i++) rows.push([STAGES[i], frames ? avg[i] / frames : 0, mx[i]]);
    rows.sort((a, b) => b[1] - a[1]);
    let ours = 0;
    for (const [name, a, m] of rows) { ours += a; if (a > 0.005 || m > 0.5) L.push(`  ${name.padEnd(14)} avg ${f(a, 3).padStart(7)}  max ${f(m, 2).padStart(7)}`); }
    L.push(`  ${"OUR TOTAL".padEnd(14)} avg ${f(ours, 3).padStart(7)}   of a ${f(p(0.5), 1)}ms frame; the rest is the browser, the GPU and the map's own drawing`);
    L.push("");
    L.push("WHAT WAS IN THE SKY (average / max over the capture)");
    const keys = Object.keys(BLANK_COUNTS()) as Array<keyof Counts>;
    for (const k of keys) {
      const a = ring.length ? ring.reduce((x, s) => x + s.counts[k], 0) / ring.length : 0;
      const m = ring.reduce((x, s) => Math.max(x, s.counts[k]), 0);
      L.push(`  ${k.padEnd(10)} ${f(a, 1).padStart(7)} / ${String(m).padStart(5)}`);
    }
    L.push("");
    L.push("RENDERER (last)");
    const r = this.lastRender;
    L.push(`  draw calls ${r.calls}, triangles ${r.triangles}, programs ${r.programs}, geometries ${r.geometries}, textures ${r.textures}, pixel ratio ${r.ratio}`);
    const calls = ring.map((s) => s.render.calls);
    L.push(`  draw calls over the capture: min ${Math.min(...calls, Infinity)}, max ${Math.max(...calls, 0)}`);
    L.push("");
    L.push("ROOM");
    L.push(`  status ${this.roomStatus}; messages ${this.netMsgsTotal}, bytes ${this.netBytesTotal}; last state message ${this.lastStateBytes} bytes`);
    const msgsPerSec = secs > 0 ? this.netMsgsTotal / secs : 0;
    L.push(`  ${f(msgsPerSec, 1)} messages/s, ${f(secs > 0 ? this.netBytesTotal / secs / 1024 : 0, 1)} KB/s`);
    L.push("");
    L.push("AUDIO");
    L.push(`  bus level (last) ${f(this.lastAudio, 4)}`);
    const heaps = ring.map((s) => s.heapMB).filter((h) => h > 0);
    L.push("");
    L.push("MEMORY");
    L.push(heaps.length ? `  JS heap ${f(Math.min(...heaps), 0)} to ${f(Math.max(...heaps), 0)} MB` : "  JS heap: not exposed by this webview");
    L.push("");
    L.push(`WORST FRAMES (over ${STALL_MS}ms; what we were doing in them)`);
    if (!this.worst.length) L.push("  none");
    for (const w of this.worst) {
      const parts = Object.entries(w.stages).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${f(v, 1)}`).join(", ");
      L.push(`  t=${f(w.at, 1)}s ${f(w.dt, 0).padStart(4)}ms  ${w.note}  [${parts || "nothing of ours"}]  drones ${w.counts.drones} enemies ${w.counts.enemies} bullets ${w.counts.bullets} coins ${w.counts.coins} calls ${w.render.calls}`);
    }
    L.push("");
    L.push("NOTES (things that happened)");
    if (!this.notes.length) L.push("  none");
    for (const n of this.notes) L.push(`  t=${f(n.at, 1)}s ${n.text}`);
    L.push("");
    L.push("RAW (one line per half second: t, frames, dtAvg, dtMax, then each stage's avg ms, then counts, then calls, triangles, msgs, bytes, audio, heap)");
    L.push(`  t,frames,dtAvg,dtMax,${STAGES.join(",")},${keys.join(",")},calls,tris,msgs,bytes,audio,heapMB`);
    for (const s of ring) {
      const stage = Array.from(s.stageAvg).map((v) => f(v, 3)).join(",");
      const cnt = keys.map((k) => s.counts[k]).join(",");
      L.push(`  ${f(s.at, 1)},${s.frames},${f(s.dtAvg, 2)},${f(s.dtMax, 1)},${stage},${cnt},${s.render.calls},${s.render.triangles},${s.netMsgs},${s.netBytes},${f(s.audioLevel, 4)},${f(s.heapMB, 0)}`);
    }
    return L.join("\n");
  }
}

export const dflow = new Dflow();

/** Test hook: a fresh collector. */
export function newDflowForTests(): Dflow { return new Dflow(); }
export type { Dflow };
