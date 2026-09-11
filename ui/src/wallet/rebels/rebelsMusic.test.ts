// The music: which theme should be playing, and what happens when the ship is
// lost.
//
// Run: sh scripts/run-rebels-music-tests.sh
//
// The interesting part of this is not the sound, it is the WAITING. Two things
// stop a theme starting and neither is under the caller's control: the track
// may still be downloading, and a webview will not make a noise until the
// player has clicked something. Both are true at the exact moment the panel
// opens, which is when the opening theme is supposed to begin.

/* A module, not a script. Without this the file's top-level names are globals
   and collide with the other test that also loads its subject dynamically. */
export {};

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}
process.on("uncaughtException", (e) => {
  console.log(out.join("\n"));
  console.log("FAIL threw: " + (e as Error).message);
  process.exit(1);
});

/* ---- a fake context, close enough to the real one to be worth testing ---- */
let ctxState: "suspended" | "running" | "closed" = "suspended";
let gestured = false;
let now = 0;
const started: Array<{ loop: boolean; stopAt: number | null }> = [];
const ramps: Array<{ to: number; at: number }> = [];

class FakeParam {
  value = 1;
  setValueAtTime(v: number) { this.value = v; return this; }
  linearRampToValueAtTime(v: number, at: number) { ramps.push({ to: v, at }); this.value = v; return this; }
  cancelScheduledValues() { return this; }
  exponentialRampToValueAtTime(v: number) { this.value = v; return this; }
}
class FakeSource {
  buffer: unknown = null;
  loop = false;
  rec: { loop: boolean; stopAt: number | null } = { loop: false, stopAt: null };
  connect() { return this; }
  start() { this.rec = { loop: this.loop, stopAt: null }; started.push(this.rec); }
  stop(at: number) { this.rec.stopAt = at; }
}
class FakeGain {
  gain = new FakeParam();
  connect() { return this; }
}
const fakeCtx = {
  get state() { return ctxState; },
  get currentTime() { return now; },
  destination: {},
  createBufferSource() { return new FakeSource(); },
  createGain() { return new FakeGain(); },
  decodeAudioData: (_b: ArrayBuffer) => Promise.resolve({ duration: 120 } as unknown as AudioBuffer),
  /* A webview only lets a context resume from a real user gesture. Resuming
     unconditionally is what a naive fake does, and it hides the exact bug this
     file exists to guard against. */
  /* What the sound bus asks a context for. */
  sampleRate: 48000,
  suspend() { return Promise.resolve(); },
  close() { return Promise.resolve(); },
  createAnalyser() {
    return { fftSize: 1024, connect() { return this; }, getFloatTimeDomainData(arr: Float32Array) { arr.fill(0.1); } };
  },
  resume() { if (gestured) ctxState = "running"; return Promise.resolve(); },
};

(globalThis as Record<string, unknown>).window = { AudioContext: function () { return fakeCtx; } };
(globalThis as Record<string, unknown>).document = { documentElement: {} };
(globalThis as Record<string, unknown>).getComputedStyle = () => ({
  getPropertyValue: (n: string) => (n === "--sound-volume" ? "0.15" : ""),
});
/* No IndexedDB in node: the cache quietly gives up and the fetch is used. */
const wanted: string[] = [];
(globalThis as Record<string, unknown>).fetch = (url: string) => {
  wanted.push(String(url));
  return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
};

const settle = () => new Promise((r) => setTimeout(r, 20));

async function main() {
  const M = await import("./rebelsMusic");

  // 1. WHEN EACH THEME IS FETCHED.
  //
  //    Geoff: "the opening music should load before the game button is clicked,
  //    so that it starts to play immediately. But then the second music
  //    'gameplay' could load at that point, while the user looks at the game
  //    welcome stream."
  {
    M.resetMusicForTests();
    wanted.length = 0;
    /* The wallet starting up. No audio context is needed and none is used: this
       only puts bytes on the disk. */
    M.prefetchMusic();
    await settle();
    ok("the wallet's startup fetches the opening theme",
       wanted.length === 1 && wanted[0].endsWith("opening.mp3"), wanted.join(", "));
    ok("and nothing else, so starting the wallet stays cheap",
       wanted.filter((u) => u.endsWith("gameplay1.mp3")).length === 0, wanted.join(", "));

    M.prefetchMusic();
    await settle();
    ok("and it only ever fetches it once", wanted.length === 1, `${wanted.length} requests`);

    /* Now the panel opens. The flying theme comes down while the welcome screen
       is being read. */
    wanted.length = 0;
    gestured = true; ctxState = "running";
    M.primeMusic();
    await settle();
    ok("opening the panel fetches the flying theme",
       wanted.some((u) => u.endsWith("gameplay1.mp3")), wanted.join(", "));
  }

  // 2. A SUSPENDED CONTEXT MUST NOT LOSE THE THEME.
  //
  //    The panel opens, the theme is asked for, and a webview refuses to make
  //    a sound because nothing has been clicked yet. Playing anyway would spend
  //    the first half of a two-minute loop inaudible. It has to wait and then
  //    start, not fail.
  {
    M.resetMusicForTests();
    started.length = 0;
    ctxState = "suspended";
    gestured = false;
    M.primeMusic();
    M.playOpening();
    await settle();
    ok("nothing plays into a sleeping context", started.length === 0, `${started.length} started`);

    /* The player clicks something. */
    gestured = true;
    M.pumpMusic();
    await settle();
    ok("and it starts the moment the sound is allowed", started.length === 1, `${started.length}`);
    ok("on repeat", started[0]?.loop === true);
  }

  // 3. A theme that arrives late still gets played.
  {
    M.resetMusicForTests();
    started.length = 0;
    gestured = true; ctxState = "running";
    M.playOpening();          /* asked for before anything is downloaded */
    ok("nothing plays before the track lands", started.length === 0);
    M.primeMusic();
    await settle();
    ok("and it plays when it does", started.length === 1, `${started.length}`);
  }

  // 4. Launching and dying.
  {
    M.resetMusicForTests();
    gestured = true; ctxState = "running";
    M.primeMusic();
    await settle();
    M.playOpening();
    await settle();
    M.playGameplay();
    await settle();
    ok("launching plays the flying theme", M.musicState().playing === "gameplay",
       JSON.stringify(M.musicState().playing));

    started.length = 0;
    ramps.length = 0;
    now = 100;
    M.musicOnDeath();
    await settle();

    /* Five seconds out, and Geoff's figure is the one in the code. */
    const out5 = ramps.find((r) => Math.abs(r.at - (100 + M.DEATH_FADE)) < 1e-6 && r.to <= 0.001);
    ok("the flying theme fades out over five seconds", !!out5 && M.DEATH_FADE === 5,
       `ramps to ${ramps.map((r) => `${r.to.toFixed(3)}@${r.at}`).join(", ")}`);

    /* And the menu theme comes back AFTER it, not across it. */
    ok("the menu theme does not start on top of it", started.length === 0,
       `${started.length} started immediately`);
    ok("but it is what should be playing", M.musicState().wanted === "opening",
       String(M.musicState().wanted));

    now = 100 + M.DEATH_FADE + 0.1;
    M.pumpMusic();
    await settle();
    ok("and it returns once the fade is done", started.length === 1, `${started.length}`);
    ok("also on repeat", started[0]?.loop === true);
  }

  // 5. Launching again during the fade cancels it rather than waiting it out.
  {
    M.resetMusicForTests();
    gestured = true; ctxState = "running";
    M.primeMusic();
    await settle();
    M.playGameplay();
    await settle();
    now = 200;
    M.musicOnDeath();
    started.length = 0;
    M.playGameplay();
    await settle();
    ok("relaunching during the fade starts flying again at once",
       started.length === 1 && M.musicState().playing === "gameplay", `${started.length}`);
  }

  // 6. A muted theme silences the music too, and never divides by it.
  {
    (globalThis as Record<string, unknown>).getComputedStyle = () => ({
      getPropertyValue: (n: string) => (n === "--sound-volume" ? "0" : ""),
    });
    ok("the volume slider at zero silences the music", M.musicState().level === 0,
       String(M.musicState().level));
    (globalThis as Record<string, unknown>).getComputedStyle = () => ({
      getPropertyValue: (n: string) => (n === "--sound-volume" ? "0.15" : ""),
    });
    ok("and music sits under the effects", M.MUSIC_LEVEL < 1 && M.MUSIC_LEVEL > 0.4,
       String(M.MUSIC_LEVEL));
  }

  // 7. Leaving the panel stops it.
  {
    M.resetMusicForTests();
    gestured = true; ctxState = "running";
    M.primeMusic();
    await settle();
    M.playOpening();
    await settle();
    M.stopMusic();
    ok("closing the panel stops the music", M.musicState().playing === null
       && M.musicState().wanted === null, JSON.stringify(M.musicState()));
  }

  console.log(out.join("\n"));
  console.log(`${out.filter((l) => l.startsWith("PASS")).length} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

void main();
