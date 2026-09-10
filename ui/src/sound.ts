// Instant UI sounds via Web Audio — oscillator tones, so there's no file to
// load and playback is immediate. Each event's waveform + pitch come from the
// theme's --sound-* CSS variables, so a skin defines its own sounds.
//
// ---- THE ONE BUS ----
// Everything that makes a noise in the wallet, the game's guns and music
// included, goes through output(): one master gain into one analyser into
// the speakers. Two reasons, and both are Geoff's:
//   1. "Do you have a sound module that all sounds go through, like you
//      should?" Now there is, and it is this file.
//   2. The game lost its sound four times, and every time the code said it
//      was playing. Nothing on this side could tell the difference between
//      a graph that was making sound and one that was not. The analyser can:
//      it measures what actually reaches the output, and watchAudio() acts
//      on silence where sound is expected, first by kicking the context
//      (suspend and resume, the standard cure for a WebKit context that says
//      "running" and produces nothing) and then by rebuilding it, telling
//      everyone who registered to decode their samples again.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let samples: Float32Array<ArrayBuffer> | null = null;

/** The wallet's one and only audio context, shared with anything else that
 *  needs to make a noise. Browsers cap how many a page may open. */
export function audioContext(): AudioContext | null {
  return getCtx();
}

function getCtx(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Where every sound connects. Never `ctx.destination` directly: a node wired
 * straight to the speakers is a node the watchdog cannot hear.
 */
export function output(): AudioNode | null {
  const c = getCtx();
  if (!c) return null;
  if (!master || !analyser) {
    master = c.createGain();
    master.gain.value = 1;
    analyser = c.createAnalyser();
    analyser.fftSize = 1024;
    samples = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
    master.connect(analyser);
    analyser.connect(c.destination);
  }
  return master;
}

/** What is actually reaching the speakers right now, as an RMS level. Zero
 *  when nothing has been wired yet. */
export function outputLevel(): number {
  if (!analyser || !samples) return 0;
  try {
    analyser.getFloatTimeDomainData(samples);
  } catch {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/* ---- the watchdog ---- */

const rebuildListeners = new Set<() => void>();

/** Register to be told when the context has been thrown away and rebuilt:
 *  decode your samples again, restart anything that should be playing. */
export function onAudioRebuild(fn: () => void): () => void {
  rebuildListeners.add(fn);
  return () => { rebuildListeners.delete(fn); };
}

let kicks = 0;
let rebuilds = 0;
let silentFor = 0;
let lastKickAt = 0;
let lastRebuildAt = 0;

/** Seconds of expected-but-absent sound before the context is kicked, and
 *  before it is rebuilt. The kick is cheap; the rebuild re-decodes everything. */
export const KICK_AFTER = 4;
export const REBUILD_AFTER = 12;
const KICK_GAP = 8;
const REBUILD_GAP = 30;

/** Pure: what the watchdog should do, given how long sound has been expected
 *  and missing. Separate so it can be tested without an audio context. */
export function watchVerdict(
  silentSeconds: number, now: number, kickAt: number, rebuildAt: number,
): "none" | "kick" | "rebuild" {
  if (silentSeconds >= REBUILD_AFTER && now - rebuildAt >= REBUILD_GAP) return "rebuild";
  if (silentSeconds >= KICK_AFTER && now - kickAt >= KICK_GAP) return "kick";
  return "none";
}

/** Suspend and resume: what unsticks a WebKit context that reports running
 *  and outputs nothing. */
export function kickAudio(): void {
  const c = ctx;
  if (!c) return;
  kicks++;
  try { void c.suspend().then(() => c.resume()); } catch { /* then rebuild */ }
}

/** Throw the context away and start again. Everyone who registered decodes
 *  their samples again and restarts what was playing. */
export function rebuildAudio(): void {
  rebuilds++;
  const old = ctx;
  ctx = null; master = null; analyser = null; samples = null;
  try { void old?.close(); } catch { /* gone anyway */ }
  for (const fn of rebuildListeners) { try { fn(); } catch { /* one bad listener is not all of them */ } }
}

/* ---- WHY THE FIX WAITS FOR A GESTURE ----
   WebKit ties a context's right to make sound to a user gesture. A suspend
   and resume, or a new context, done from a timer can leave a context that
   says "running" and is not allowed to play: the exact fault this is meant
   to cure, caused by the cure. So the watchdog only DECIDES; the fix is
   carried out inside the next real key or pointer press, where the browser
   will honour it. Until then the verdict is held. */
let pendingFix: "none" | "kick" | "rebuild" = "none";

/**
 * Call regularly (every couple of seconds is fine) with whether something
 * SHOULD be audible right now. Silence while sound is expected is what it
 * acts on; silence otherwise resets the clock. Returns the verdict; the fix
 * itself waits for settleAudioFromGesture().
 */
export function watchAudio(expectSound: boolean, dtSeconds: number, nowSeconds = Date.now() / 1000): "none" | "kick" | "rebuild" {
  if (!expectSound || !ctx) { silentFor = 0; return "none"; }
  const level = outputLevel();
  if (level > 1e-4) { silentFor = 0; pendingFix = "none"; return "none"; }
  silentFor += dtSeconds;
  const verdict = watchVerdict(silentFor, nowSeconds, lastKickAt, lastRebuildAt);
  if (verdict === "kick") { lastKickAt = nowSeconds; pendingFix = "kick"; }
  if (verdict === "rebuild") { lastRebuildAt = nowSeconds; silentFor = 0; pendingFix = "rebuild"; }
  return verdict;
}

/** What the watchdog is waiting to do, for the black box. */
export function pendingAudioFix(): "none" | "kick" | "rebuild" { return pendingFix; }

/** From a real key or pointer handler: carry out whatever the watchdog
 *  decided. Also resumes a suspended context, which is the ordinary case. */
export function settleAudioFromGesture(): "none" | "kick" | "rebuild" {
  const did = pendingFix;
  pendingFix = "none";
  if (did === "kick") kickAudio();
  else if (did === "rebuild") rebuildAudio();
  else if (ctx && ctx.state === "suspended") void ctx.resume();
  return did;
}

/** For the black box. */
export function audioHealth(): Record<string, unknown> {
  return {
    state: ctx ? ctx.state : "none",
    level: Math.round(outputLevel() * 10000) / 10000,
    silentFor: Math.round(silentFor),
    kicks, rebuilds,
    pending: pendingFix,
    sampleRate: ctx?.sampleRate ?? 0,
    bus: !!master,
  };
}

/** Test hook. */
export function resetSoundForTests(): void {
  ctx = null; master = null; analyser = null; samples = null;
  kicks = 0; rebuilds = 0; silentFor = 0; lastKickAt = 0; lastRebuildAt = 0;
  pendingFix = "none";
  rebuildListeners.clear();
}

function cssVar(name: string, fallback: string): string {
  /* No document, or a document with no styles (tests): the fallback. */
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** The user's master volume, as set by the theme. Anything that plays sound
 *  should scale by it so muting the wallet mutes everything. */
export function masterVolume(): number {
  const v = parseFloat(cssVar("--sound-volume", "0.15"));
  return Number.isFinite(v) ? v : 0.15;
}

export type SoundEvent = "click" | "send" | "receive" | "peer";

const DEFAULT_FREQ: Record<SoundEvent, string> = { click: "660", send: "880", receive: "523", peer: "300" };
const DEFAULT_WAVE: Record<SoundEvent, string> = { click: "sine", send: "triangle", receive: "sine", peer: "sine" };

export function playSound(event: SoundEvent): void {
  const c = getCtx();
  if (!c) return;
  const vol = parseFloat(cssVar("--sound-volume", "0.15"));
  if (!(vol > 0)) return;
  const freq = parseFloat(cssVar(`--sound-${event}-freq`, DEFAULT_FREQ[event])) || 660;
  const wave = (cssVar(`--sound-${event}-wave`, DEFAULT_WAVE[event]) || "sine") as OscillatorType;

  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, now);
  // A tiny upward blip for send, downward for receive, flat for click.
  if (event === "send") osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + 0.1);
  if (event === "receive") osc.frequency.exponentialRampToValueAtTime(freq * 0.7, now + 0.1);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(vol, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

  osc.connect(gain).connect(output() ?? c.destination);
  osc.start(now);
  osc.stop(now + 0.16);
}

// Play a click for any button press — attached in capture phase so it fires
// the instant the pointer goes down, before React handlers run.
export function installClickSound(): void {
  document.addEventListener(
    "pointerdown",
    (e) => {
      const el = e.target as HTMLElement | null;
      // Also match label-based controls styled as buttons (the file pickers are
      // <label class="wl-btn">, not <button>), so they click-sound like the rest.
      if (el && el.closest("button, .wl-btn")) playSound("click");
    },
    true
  );
}
