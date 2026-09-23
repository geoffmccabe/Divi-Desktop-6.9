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
    /* Not just "suspended". WebKit has a state of its own, "interrupted",
       which it uses when something else on the machine took the audio
       hardware: a call, another app, the screen locking. A context left in
       it renders nothing and never comes back on its own, and every
       measurement on this side still looks healthy. */
    if (ctx.state !== "running") void ctx.resume();
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
    connectToSpeakers(c, analyser);
  }
  return master;
}

/* ---- TWO WAYS TO THE SPEAKERS ----
   2026-Sep-23, Geoff's Mac: the test tone reached the output meter at a
   healthy level, the engine said "running", the Mac's default output was
   its own speakers at 69% and not muted, and he heard nothing. So the sound
   is made and then lost between this page and the speakers, inside WebKit's
   own Web Audio output. A browser has a SECOND route to the speakers, the
   one that plays audio files: hand the whole bus to an <audio> element as
   a stream and let the media pipeline carry it. Same trick people use on
   iOS to get Web Audio past the silent switch.

   Which route is used is a setting, so the test button can try both and a
   machine where the direct route works keeps it. Default: the bridge on a
   Mac inside the desktop app (where it was proven silent), direct elsewhere. */
export type SoundRoute = "direct" | "bridge";
const ROUTE_KEY = "dd69.sound.route";
let bridgeEl: HTMLAudioElement | null = null;
let bridgeWantsPlay = false;

export function soundRoute(): SoundRoute {
  try {
    const v = localStorage.getItem(ROUTE_KEY);
    if (v === "direct" || v === "bridge") return v;
  } catch { /* no storage */ }
  const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform ?? "");
  const desktop = typeof window !== "undefined" && !!(window as unknown as { __TAURI__?: unknown }).__TAURI__;
  return mac && desktop ? "bridge" : "direct";
}

export function setSoundRoute(r: SoundRoute): void {
  try { localStorage.setItem(ROUTE_KEY, r); } catch { /* no storage */ }
  rebuildAudio();
}

function connectToSpeakers(c: AudioContext, from: AudioNode): void {
  if (soundRoute() !== "bridge" || typeof document === "undefined" || !c.createMediaStreamDestination) {
    from.connect(c.destination);
    return;
  }
  try {
    const dest = c.createMediaStreamDestination();
    from.connect(dest);
    const el = document.createElement("audio");
    el.autoplay = true;
    el.setAttribute("playsinline", "");
    el.srcObject = dest.stream;
    el.volume = 1;
    bridgeEl = el;
    /* Playing needs a gesture. Most first calls come from one; if not, the
       next gesture's settle() tries again. */
    el.play().then(() => { bridgeWantsPlay = false; }).catch(() => { bridgeWantsPlay = true; });
  } catch {
    from.connect(c.destination);
  }
}

/** The bridge's own state, for the black box and the test. */
export function bridgeState(): string {
  if (soundRoute() !== "bridge") return "direct";
  if (!bridgeEl) return "bridge: not built";
  return `bridge: ${bridgeEl.paused ? "PAUSED" : "playing"}${bridgeWantsPlay ? ", waiting for a click" : ""}`;
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
/** The audio clock at the last check, and how often it has been found
 *  stopped. See watchAudio. */
let lastClock = -1;
let stalls = 0;
/* ---- WHAT THE METER CANNOT SEE, AND HOW TO CATCH IT ANYWAY ----
   Geoff, on the fifth or sixth silence: "The sound is completely gone in the
   game again... zero sound. I've never, in so many years, had the sound going
   out in my projects over and over and unable to be fixed."

   His own black box said everything was fine: context running, the level
   varying between 0.008 and 0.057, the audio clock advancing, no stalls, no
   device changes. Two numbers in it were the whole story.

   `deviceApi: false`. This webview has no navigator.mediaDevices at all, so the
   one detector written for exactly this failure - the speakers changing under
   us - can never fire. Its zero reading means nothing, and the note beside it
   saying "the browser does announce the change" is wrong HERE.

   `ctxAge: 33674`. The context had been alive nine and a half hours. And
   macOS's own audio daemon had two device contexts open, one of them an
   aggregate device made for a video call: the machine's output arrangement had
   genuinely changed under a context created hours earlier, and WebKit went on
   rendering into the old route with every measurement on this side reading
   perfectly healthy.

   So there are three things to watch that need no API:

   1. THE WALL CLOCK against the audio clock. The audio clock only advances
      while the stream is really being rendered. The frame loop stops while the
      machine sleeps, so comparing the audio clock with the FRAME's own dt
      cannot see a sleep at all; comparing it with the wall can. A gap in one
      and not the other means the stream was interrupted.
   2. WHAT THE MACHINE SAYS ABOUT ITS OUTPUT. The latencies and the channel
      count are the only things visible from below the destination, and a device
      swap changes them. Nothing was watching them.
   3. HOW OLD IT IS. When none of the above fires and the sound is still gone,
      age is the correlate: a context that has been running for hours has had
      every chance to be re-routed. Past a point it is simply replaced, at the
      next keypress, which costs a fraction of a second of silence instead of
      all of it. */
let lastWall = -1;
/** Seconds of wall time the audio clock has fallen behind by, all told. */
let drift = 0;
let interruptions = 0;
/** What the machine last said about its own output, to notice it change. */
let lastShape = "";
let shapeChanges = 0;
/** When this context was made, on whatever clock the watchdog is given. Taken
 *  from the first reading rather than from Date.now, so it is the SAME clock
 *  the checks above use and a test can drive it. */
let bornAt = -1;
let agedOut = 0;
/**
 * How old a context may get before it is replaced, in seconds.
 *
 * Twenty minutes. Long enough that nobody meets it in a short session, short
 * enough that a silence caused by something nothing here can measure cannot
 * last a whole evening. The replacement happens at the next gesture, and
 * everything that decoded a sample decodes it again.
 */
const MAX_AGE = 20 * 60;

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
  try {
    /* A context that is not running wants resuming, not suspending: asking a
       suspended or interrupted one to suspend is a no-op and the resume
       never happens. */
    if (c.state !== "running") void c.resume();
    else void c.suspend().then(() => c.resume());
  } catch { /* then rebuild */ }
}

/** Throw the context away and start again. Everyone who registered decodes
 *  their samples again and restarts what was playing. */
export function rebuildAudio(): void {
  rebuilds++;
  const old = ctx;
  ctx = null; master = null; analyser = null; samples = null;
  try { if (bridgeEl) { bridgeEl.pause(); bridgeEl.srcObject = null; } } catch { /* gone */ }
  bridgeEl = null; bridgeWantsPlay = false;
  /* The new context starts its clock at zero, so the old reading would look
     like a clock that had gone backwards and the watchdog would call it a
     stall and rebuild again, for ever. */
  lastClock = -1;
  silentFor = 0;
  /* A fresh context is a fresh age, a fresh wall reading and a fresh shape, or
     the age cap would fire again immediately and the wall check would see the
     whole of the old context's life as one interruption. */
  bornAt = -1;
  lastWall = -1;
  lastShape = "";
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
  if (!expectSound || !ctx) {
    silentFor = 0;
    lastClock = ctx ? ctx.currentTime : -1;
    return "none";
  }

  /* ---- THE AUDIO CLOCK IS THE HONEST WITNESS ----
     A context's currentTime advances only while the stream behind it is
     actually being rendered. If it stops while the context still says
     "running", the stream has died: nothing will be heard again, and this is
     the one failure the meter cannot see, because the graph is still
     producing samples and they are going nowhere. Measured rather than
     guessed at, which is what was missing when the sound kept dying in long
     sessions. Geoff, 2026-Sep-12: "The sounds seems to disappear if the game
     has been on for a while. If I restart it, then it comes back." */
  const clock = ctx.currentTime;
  const ran = lastClock >= 0 ? clock - lastClock : dtSeconds;
  lastClock = clock;

  /* ---- 1. THE WALL CLOCK IS THE OTHER HONEST WITNESS ----
     The check below compares the audio clock with the FRAME's dt, and cannot
     see a sleep or an interruption: the frame loop stops too, so both agree.
     Against the WALL they disagree, and the gap is how long the stream was not
     being rendered. */
  const wallRan = lastWall >= 0 ? Math.max(0, nowSeconds - lastWall) : dtSeconds;
  lastWall = nowSeconds;
  if (wallRan > 5 && ran < wallRan * 0.5) {
    drift += wallRan - ran;
    interruptions++;
    lastRebuildAt = nowSeconds;
    silentFor = 0;
    pendingFix = "rebuild";
    return "rebuild";
  }

  /* ---- 2. AND WHAT THE MACHINE SAYS ABOUT ITS OWN OUTPUT ----
     The only things visible from below the destination. A device swap changes
     them, and nothing was looking. */
  const shape = outputShape();
  if (lastShape && shape !== lastShape) {
    shapeChanges++;
    lastShape = shape;
    lastRebuildAt = nowSeconds;
    silentFor = 0;
    pendingFix = "rebuild";
    return "rebuild";
  }
  lastShape = shape;

  /* ---- 3. AND SHEER AGE ----
     Last, because it is the only one of the three that is not evidence of
     anything: it is the admission that this webview cannot be told its
     speakers moved. */
  if (bornAt < 0) bornAt = nowSeconds;
  if (nowSeconds - bornAt > MAX_AGE) {
    agedOut++;
    bornAt = nowSeconds;
    lastRebuildAt = nowSeconds;
    silentFor = 0;
    pendingFix = "rebuild";
    return "rebuild";
  }
  if (ctx.state === "running" && ran < dtSeconds * 0.25) {
    stalls++;
    lastRebuildAt = nowSeconds;
    silentFor = 0;
    pendingFix = "rebuild";
    return "rebuild";
  }
  /* And a context that has been taken away from us wants waking, now, not in
     eight seconds of measured silence. */
  if (ctx.state !== "running") {
    lastKickAt = nowSeconds;
    pendingFix = "kick";
    return "kick";
  }

  const level = outputLevel();
  if (level > 1e-4) { silentFor = 0; pendingFix = "none"; return "none"; }
  silentFor += dtSeconds;
  const verdict = watchVerdict(silentFor, nowSeconds, lastKickAt, lastRebuildAt);
  if (verdict === "kick") { lastKickAt = nowSeconds; pendingFix = "kick"; }
  if (verdict === "rebuild") { lastRebuildAt = nowSeconds; silentFor = 0; pendingFix = "rebuild"; }
  return verdict;
}

/** What the machine says about its own output, as one string to compare. */
function outputShape(): string {
  if (!ctx) return "";
  const out = (ctx as unknown as { outputLatency?: number }).outputLatency ?? 0;
  return [
    Math.round(out * 1000),
    Math.round((ctx.baseLatency ?? 0) * 10000),
    ctx.destination?.maxChannelCount ?? 0,
    Math.round(ctx.sampleRate ?? 0),
  ].join("/");
}

/** What the watchdog is waiting to do, for the black box. */
export function pendingAudioFix(): "none" | "kick" | "rebuild" { return pendingFix; }

/* ---- WHEN THE SPEAKERS CHANGE UNDER US ----
   Headphones in or out, a Bluetooth device, a call starting: macOS moves the
   default output and WebKit's context can be left rendering into the device
   that is gone, with every measurement on this side still reading fine. That
   is the one silence a meter before the output cannot see. The browser does
   announce the change, and the answer is a fresh context on the new device,
   from the next gesture. */
let deviceChanges = 0;
let deviceWatch = false;
export function watchOutputDevices(): void {
  if (deviceWatch) return;
  deviceWatch = true;
  try {
    navigator.mediaDevices?.addEventListener?.("devicechange", () => {
      deviceChanges++;
      if (ctx) pendingFix = "rebuild";
    });
  } catch { /* no such thing here */ }
}

/**
 * Throw the sound away and start again, NOW, from a gesture.
 *
 * There is one silence nothing here can measure. The meter sits on the bus,
 * one node before the speakers, so it reads the graph rather than what comes
 * out of the machine; the context can be running, its clock advancing, real
 * varying signal arriving, and the sound still going nowhere, because
 * something below the destination has moved. Geoff's black box read exactly
 * that on 2026-Sep-12: running, level 0.0236 and changing, no stalls, no
 * device changes, eighteen minutes of clock, and not a sound in the room.
 *
 * A webview usually has no device-change event to tell us, so this is the
 * honest answer: a key the player can press that does what restarting the
 * app did. Everything that decoded a sample decodes it again and whatever
 * was playing starts again.
 */
export function resetAudioNow(): void {
  rebuildAudio();
  const c = getCtx();
  if (c && c.state !== "running") void c.resume();
}

/** Ask for a fresh context at the next gesture, without a reason the meter
 *  can see. The game does this when its panel is reopened: if the sound had
 *  died in a way nothing here can measure, coming back to the game gets a
 *  new start rather than the same dead one. */
export function requestAudioRebuild(): void {
  if (ctx) pendingFix = "rebuild";
}

/* The last readings, so a frozen output (the same number every time) can be
   told from a live one in the black box. */
const history: number[] = [];
export function noteLevel(): void {
  history.push(Math.round(outputLevel() * 10000) / 10000);
  if (history.length > 8) history.shift();
}

/** From a real key or pointer handler: carry out whatever the watchdog
 *  decided. Also resumes a suspended context, which is the ordinary case. */
export function settleAudioFromGesture(): "none" | "kick" | "rebuild" {
  const did = pendingFix;
  pendingFix = "none";
  if (did === "kick") kickAudio();
  else if (did === "rebuild") rebuildAudio();
  else if (ctx && ctx.state !== "running") void ctx.resume();
  if (bridgeEl && (bridgeWantsPlay || bridgeEl.paused)) {
    bridgeEl.play().then(() => { bridgeWantsPlay = false; }).catch(() => { bridgeWantsPlay = true; });
  }
  return did;
}

/** For the black box. */
export function audioHealth(): Record<string, unknown> {
  return {
    state: ctx ? ctx.state : "none",
    level: Math.round(outputLevel() * 10000) / 10000,
    silentFor: Math.round(silentFor),
    kicks, rebuilds, stalls,
    /* Whether this webview can even tell us the speakers changed. When it
       cannot, deviceChanges being zero means nothing. */
    deviceApi: typeof navigator !== "undefined" && !!navigator.mediaDevices,
    /* What the machine says about its own output. On a dead sink these tend
       to go to zero, which is the only hint from below the destination. */
    outLatency: Math.round(((ctx as unknown as { outputLatency?: number })?.outputLatency ?? 0) * 10000) / 10000,
    baseLatency: Math.round((ctx?.baseLatency ?? 0) * 10000) / 10000,
    channels: ctx?.destination?.maxChannelCount ?? 0,
    pending: pendingFix,
    deviceChanges,
    /* The three that do not need an API the webview has not got. Read these
       first on a "no sound" report: they are what the meter cannot see. */
    interruptions,
    drift: Math.round(drift),
    shapeChanges,
    shape: outputShape(),
    agedOut,
    ageSeconds: bornAt < 0 ? 0 : Math.round(Date.now() / 1000 - bornAt),
    history: history.slice(),
    ctxAge: ctx ? Math.round(ctx.currentTime) : 0,
    sampleRate: ctx?.sampleRate ?? 0,
    bus: !!master,
    route: bridgeState(),
  };
}

/** Test hook. */
export function resetSoundForTests(): void {
  lastClock = -1;
  stalls = 0;
  ctx = null; master = null; analyser = null; samples = null;
  kicks = 0; rebuilds = 0; silentFor = 0; lastKickAt = 0; lastRebuildAt = 0;
  pendingFix = "none"; deviceChanges = 0; history.length = 0;
  /* The three that need no API, and the state they watch. Left behind once and
     the next test inherited another test's output shape, which read as the
     speakers moving. */
  lastWall = -1; drift = 0; interruptions = 0;
  lastShape = ""; shapeChanges = 0;
  bornAt = -1; agedOut = 0;
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

/* ── WHY THE GAME IS SILENT, IN ONE LINE ──────────────────────────────────
   Every game sound scales by the theme's Volume and returns early at zero,
   with no sign anywhere that this is why. After a dozen "fixes" reasoned
   from the code, the one thing missing was a way to SEE the engine's state
   on the machine that is silent. This is that: a plain sentence the HUD
   shows, and "" when there is nothing wrong. */
export function soundProblem(): string {
  if (!(masterVolume() > 0)) return "Sound is off: Volume is 0 in Theme > Sounds";
  if (!ctx) return "";
  if (ctx.state === "suspended") return "Sound engine is paused; click or press a key to wake it";
  if ((ctx.state as string) === "interrupted") return "Sound engine was interrupted by another app; restarting it";
  if (ctx.state === "closed") return "Sound engine closed; restarting it";
  return "";
}

/** A short sine as a WAV file, for the media-file route of the test. */
function beepWav(freq: number, seconds: number, gain: number): string {
  const rate = 22050;
  const n = Math.round(rate * seconds);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 400, (n - i) / 400);
    v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * gain * env * 32767), true);
  }
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(bin);
}

/**
 * Three beeps, three routes, so one press says which of them reaches the
 * ears. Proof, not inference:
 *   1. LOW-MIDDLE (660 Hz) through the bus and whichever route is in use.
 *   2. LOW (330 Hz) straight into WebKit's own Web Audio output, bypassing
 *      the bus and any bridge.
 *   3. HIGH (1320 Hz) as an ordinary audio FILE, the media pipeline alone.
 * Geoff's Mac, 2026-Sep-23: route 1 reached the meter and was not heard.
 */
export function soundTest(): Promise<{ state: string; volume: number; meterMoved: boolean; detail: string }> {
  return new Promise((resolve) => {
    const c = getCtx();
    const out = output();
    const volume = masterVolume();
    if (!c || !out) return resolve({ state: "none", volume, meterMoved: false, detail: "no audio engine" });
    if ((c.state as string) !== "running") void c.resume();
    const level = Math.max(0.05, volume);
    try {
      const t = c.currentTime;
      /* 1: the bus */
      const o1 = c.createOscillator(); const g1 = c.createGain();
      o1.type = "sine"; o1.frequency.value = 660; g1.gain.value = level;
      o1.connect(g1).connect(out); o1.start(t); o1.stop(t + 0.35);
      /* 2: direct to WebKit's output, no bus */
      const o2 = c.createOscillator(); const g2 = c.createGain();
      o2.type = "sine"; o2.frequency.value = 330; g2.gain.value = level;
      o2.connect(g2).connect(c.destination); o2.start(t + 0.6); o2.stop(t + 0.95);
      /* 3: a file, the media pipeline alone */
      let fileNote = "";
      try {
        const el = new Audio(beepWav(1320, 0.35, level));
        el.volume = 1;
        setTimeout(() => { el.play().catch((e) => { fileNote = ` (file refused: ${String(e).slice(0, 60)})`; }); }, 1200);
      } catch (e) {
        fileNote = ` (file failed: ${String(e).slice(0, 60)})`;
      }
      let peak = 0;
      const start = performance.now();
      const tick = () => {
        peak = Math.max(peak, outputLevel());
        if (performance.now() - start < 1800) requestAnimationFrame(tick);
        else resolve({
          state: c.state,
          volume,
          meterMoved: peak > 0.002,
          detail: `three beeps played: 1 LOW-MID via ${bridgeState()}, 2 LOW direct, 3 HIGH as a file. `
            + (peak > 0.002 ? `Bus meter moved (${peak.toFixed(3)}).` : "Bus meter did NOT move.")
            + fileNote + " Which did you hear?",
        });
      };
      requestAnimationFrame(tick);
    } catch (e) {
      resolve({ state: c.state, volume, meterMoved: false, detail: String(e) });
    }
  });
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
