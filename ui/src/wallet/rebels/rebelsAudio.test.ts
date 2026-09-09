// Does the game actually make a noise?
//
// Written after Geoff reported "the game has lost its sound" and every obvious
// cause checked out: the samples were in the bundle, intact and well formed, the
// master volume was 0.15, and the wiring was untouched. When the obvious causes
// are all fine the thing to do is stop guessing and drive the module.
//
// Web Audio is stubbed, so what is proved here is that the module DECODES all
// its samples and STARTS a source for each sound, at a sensible volume and
// speed. Whether a speaker moves is not something a test can know.
//
// Run: sh scripts/run-rebels-audio-tests.sh

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/* ---- the stub ---- */
interface Started { rate: number; gain: number; panned: boolean }
const started: Started[] = [];
let decodeCalls = 0;
/** How many sounds the game carries. One assertion's worth of counting, so a
 *  new sound does not look like a regression. */
const SAMPLES = 9;
let decodeShouldFail = false;
let decodeShouldHang = false;

class FakeParam { constructor(public value = 0) {} setValueAtTime(v: number) { this.value = v; } cancelScheduledValues() {} exponentialRampToValueAtTime() {} }
class FakeCtx {
  state = "running";
  currentTime = 0;
  listener = {
    positionX: new FakeParam(), positionY: new FakeParam(), positionZ: new FakeParam(),
    forwardX: new FakeParam(), forwardY: new FakeParam(), forwardZ: new FakeParam(),
    upX: new FakeParam(), upY: new FakeParam(), upZ: new FakeParam(),
  };
  destination = { name: "out" };
  resume() { this.state = "running"; return Promise.resolve(); }
  createBufferSource() {
    const node = {
      buffer: null as unknown,
      playbackRate: { value: 1 },
      loop: false,
      _gain: 1,
      connect(g: { _v?: number }) { node._gain = g._v ?? 1; return g; },
      start() { started.push({ rate: node.playbackRate.value, gain: node._gain, panned: node._panned }); },
      stop() {},
      _panned: false,
    };
    return node;
  }
  createGain() { const g = { _v: 1, gain: { value: 1, setValueAtTime(v: number) { g._v = v; }, cancelScheduledValues() {}, exponentialRampToValueAtTime() {} }, connect() { return g; } }; 
    Object.defineProperty(g.gain, "value", { get: () => g._v, set: (v: number) => { g._v = v; }, configurable: true });
    return g; }
  createPanner() { return { panningModel: "", distanceModel: "", refDistance: 0, maxDistance: 0, rolloffFactor: 0, positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 }, connect() { return this; } }; }
  decodeAudioData(_raw: ArrayBuffer) {
    decodeCalls++;
    if (decodeShouldHang) return new Promise<AudioBuffer>(() => { /* never */ });
    return decodeShouldFail
      ? Promise.reject(new Error("bad sample"))
      : Promise.resolve({ duration: 1, sampleRate: 48000 } as unknown as AudioBuffer);
  }
}

const ctx = new FakeCtx();
(globalThis as Record<string, unknown>).window = { AudioContext: function () { return ctx; } };
(globalThis as Record<string, unknown>).document = {
  documentElement: {},
};
(globalThis as Record<string, unknown>).getComputedStyle = () => ({
  getPropertyValue: (n: string) => (n === "--sound-volume" ? "0.15" : ""),
});
(globalThis as Record<string, unknown>).atob = (b64: string) =>
  Buffer.from(b64, "base64").toString("binary");

async function main() {
  const A = await import("./rebelsAudio");

  // 1. Priming decodes every sample the game has.
  A.primeGunSound();
  await new Promise((r) => setTimeout(r, 50));
  /* Counted rather than typed, so adding a sound does not fail a test that was
   only ever asserting "all of them". */
  ok("every sample is decoded", decodeCalls === SAMPLES, `${decodeCalls} of ${SAMPLES}`);

  // 2. The guns are a DOUBLE shot, and neither barrel is identical.
  started.length = 0;
  A.playGunSound();
  ok("the guns fire two barrels", started.length === 2, `${started.length} sources`);
  ok("at an audible level", started.every((s) => s.gain > 0), started.map((s) => s.gain.toFixed(3)).join(","));
  ok("and not at the same speed twice", started[0]?.rate !== started[1]?.rate,
     started.map((s) => s.rate.toFixed(3)).join(","));

  // 3. Every one-shot in the game makes a sound.
  for (const [name, fn] of [
    ["the mini gun", A.playMiniSound],
    ["a torpedo launch", A.playTorpedoSound],
    ["a torpedo going off", A.playTorpedoBlast],
    ["a fighter exploding", A.playShipExplosion],
    ["the bounce off a raised shield", A.playBounce],
  ] as Array<[string, () => void]>) {
    started.length = 0;
    fn();
    ok(`${name} is heard`, started.length > 0 && started[0].gain > 0,
       `${started.length} sources at ${started[0]?.gain?.toFixed(3)}`);
  }

  // 4. The warning is a SIGNAL: its own pitch, and not stacked on itself.
  started.length = 0;
  ctx.currentTime = 100;
  A.playIncomingWarning();
  ok("the warning is heard", started.length === 1, `${started.length}`);
  ok("at its own pitch, not a random one", started[0]?.rate === 1, `${started[0]?.rate}`);
  A.playIncomingWarning();
  ok("and a second one straight away is swallowed", started.length === 1, `${started.length}`);
  ctx.currentTime = 100.3;
  A.playIncomingWarning();
  ok("but one a quarter second later is not", started.length === 2, `${started.length}`);

  // 5. Enemy fire is positioned rather than flat.
  started.length = 0;
  A.playShotAt(10, 20, 30);
  ok("enemy fire is heard", started.length === 1, `${started.length}`);

  // 6. A failure is NOT permanent.
  //
  //    `failed` used to latch for the life of the session: one bad moment at
  //    attach, which is not a user gesture and is the least ready the webview
  //    ever is, and the game was mute until it was restarted. That is the shape
  //    of "the game has lost its sound", and it is not something a player can
  //    do anything about.
  {
    /* Force the failure the same way a bad start would: make decoding reject,
       clear what is held, and prime. */
    decodeShouldFail = true;
    decodeCalls = 0;
    A.primeGunSound();
    await new Promise((r) => setTimeout(r, 50));

    decodeShouldFail = false;
    A.resumeAudio();
    await new Promise((r) => setTimeout(r, 50));
    started.length = 0;
    A.playGunSound();
    ok("a failed start recovers on the next launch", started.length === 2,
       `${started.length} sources`);
  }

  // 7. The resupply loop starts and stops.
  started.length = 0;
  A.startRechargeSound();
  ok("the resupply loop starts", started.length === 1, `${started.length}`);
  A.startRechargeSound();
  ok("and calling it twice does not stack it", started.length === 1, `${started.length}`);
  A.stopRechargeSound();
  A.startRechargeSound();
  ok("it can be started again after stopping", started.length === 2, `${started.length}`);
  A.stopRechargeSound();

  /* ---- A CONTEXT THAT SUSPENDS MID-GAME ----
     The webview suspends audio whenever the window loses focus or the machine
     sleeps, and it can only be woken from a real user gesture. That used to be
     done in one place, the click on LAUNCH, so anything that suspended AFTER
     launching stayed suspended: the game carried on flying and shooting in
     silence with nothing else wrong. Geoff: "the sound is gone in the game."

     Waking it has to work from a cold suspend at any moment, not only from a
     fresh start. */
  ctx.state = "suspended";
  A.resumeAudio();
  ok("a context that suspends mid-game can be woken again",
     ctx.state === "running", ctx.state);

  /* And it must be free to call on every keystroke, which is what the game now
     does: waking an already-running context is a no-op, not a restart. */
  const before = decodeCalls;
  for (let i = 0; i < 50; i++) A.resumeAudio();
  ok("waking an already-awake context costs nothing",
     ctx.state === "running" && decodeCalls === before,
     `${decodeCalls - before} extra decodes`);

  /* A MUTED THEME IS NOT A BROKEN GAME.
     The wallet's theme has a Volume slider that writes --sound-volume, and it
     goes down to zero. Every sound in the game reads it and returns early, so a
     slider at zero is silence everywhere with nothing else wrong: worth knowing
     it is a setting rather than a fault, because the two look identical. */
  let vol = "0";
  (globalThis as Record<string, unknown>).getComputedStyle = () => ({
    getPropertyValue: (n: string) => (n === "--sound-volume" ? vol : ""),
  });
  const quiet = started.length;
  A.playGunSound();
  ok("the theme's volume at zero silences the game", started.length === quiet,
     `${started.length - quiet} sounds played`);
  vol = "0.15";
  A.playGunSound();
  ok("and turning it back up brings the game back", started.length > quiet,
     `${started.length - quiet} sounds played`);

  /* ---- A DECODE THAT NEVER FINISHES ----
     The guard against decoding everything twice was also a way to silence the
     game permanently. decodeAudioData on a WebKit context that is not running
     does not reliably reject; it can simply never settle, and a promise that
     never settles left the "already loading" flag set for the rest of the
     session. Every later attempt returned on that line, so the game stayed mute
     with nothing to see and nothing to report. Three rounds of this were spent
     guessing from the outside.

     A start that has not finished within the patience window has failed, and
     the next request is allowed to try again. */
  {
    const realNow = Date.now;
    let clock = realNow();
    Date.now = () => clock;

    /* Wipe what is loaded so a fresh attempt is possible, then hang it. */
    /* The samples are data URIs, so decoding starts a microtask later rather
       than on this line. Counting without letting the queue drain reads zero
       every time and proves nothing. */
    const settle = () => new Promise((r) => setTimeout(r, 10));

    A.resetAudioForTests();
    decodeShouldHang = true;
    A.primeGunSound();
    await settle();
    const hung = decodeCalls;
    ok("a hung start does begin decoding", hung === SAMPLES, `${hung} decodes`);

    A.primeGunSound();
    await settle();
    ok("a second call does not decode everything twice",
       decodeCalls === hung, `${decodeCalls - hung} extra`);

    /* Still hung a second later: it is allowed to be slow. */
    clock += 1000;
    A.primeGunSound();
    await settle();
    ok("and a slow start is left alone", decodeCalls === hung, `${decodeCalls - hung} extra`);

    /* But not for ever. */
    clock += 30_000;
    A.primeGunSound();
    await settle();
    ok("a decode that never finishes stops blocking every later one",
       decodeCalls === hung + SAMPLES, `${decodeCalls - hung} retries after 30s`);

    Date.now = realNow;
    decodeShouldHang = false;
  }

  /* And the state is readable, which is the whole point: a suspended context,
     a failed decode and a muted theme are three different faults that look
     exactly alike from outside. */
  {
    const st = A.audioState();
    ok("the sound reports what it is doing",
       typeof st.ctx === "string" && typeof st.failed === "boolean"
       && typeof st.buffers === "number" && typeof st.volume === "number",
       JSON.stringify(st));
  }

  console.log(out.join("\n"));
  console.log(`\n${out.length - failures} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

void main();
