// The guns.
//
// A recorded sample rather than a generated tone, and never the same twice: the
// speed, pitch and volume are all nudged by up to a tenth on every shot. A
// laser that plays back byte-identical fifty times in a row stops sounding like
// a weapon and starts sounding like a UI beep, and that sameness is the single
// most fatiguing thing about arcade audio.
//
// Two barrels fire together, so the sample plays twice a twentieth of a second
// apart, each with its OWN random figures, which is what makes it read as a
// double shot rather than as one louder shot.

import laserUrl from "../../assets/laser_shot_v1.mp3";
import rechargeUrl from "../../assets/recharge_station_v1.mp3";
import torpedoUrl from "../../assets/torpedo_v1.mp3";
import torpedoBlastUrl from "../../assets/torpedo_explosion_v1.mp3";
import shipBlastUrl from "../../assets/spaceship_explosion_v1.mp3";
import warnUrl from "../../assets/warning_bullet_approach.mp3";
import bounceUrl from "../../assets/bullet_bounce.mp3";
import { audioContext, masterVolume } from "../../sound";

/** How far speed, pitch and volume may wander, either way. */
const WOBBLE = 0.1;
/** The gap between the two barrels. A twentieth of a second was too tight to
 *  hear as two reports: it read as one thicker one. */
const SECOND_BARREL = 0.2;

let buffer: AudioBuffer | null = null;
let rechargeBuffer: AudioBuffer | null = null;
let torpedoBuffer: AudioBuffer | null = null;
let torpedoBlastBuffer: AudioBuffer | null = null;
let shipBlastBuffer: AudioBuffer | null = null;
let warnBuffer: AudioBuffer | null = null;
let bounceBuffer: AudioBuffer | null = null;
let loading: Promise<void> | null = null;
let failed = false;

/** The recharging loop, while it is running. */
let rechargeNode: AudioBufferSourceNode | null = null;
let rechargeGain: GainNode | null = null;

/**
 * Turn the bundled sample into something Web Audio can play.
 *
 * The build inlines it as a data URI, and fetching one of those would need
 * `connect-src data:` in the wallet's content policy. Decoding the base64 by
 * hand keeps the policy exactly as tight as it is.
 */
function toArrayBuffer(url: string): Promise<ArrayBuffer> {
  if (!url.startsWith("data:")) {
    return fetch(url).then((r) => r.arrayBuffer());
  }
  const b64 = url.slice(url.indexOf(",") + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return Promise.resolve(bytes.buffer);
}

/**
 * Wake the audio up. MUST be called from a real click.
 *
 * A webview creates an audio context suspended and only lets it be resumed from
 * a user gesture. Decoding is started as soon as the panel opens, which is not a
 * gesture, so without this the context would sit suspended and every sound would
 * queue up silently behind it.
 */
export function resumeAudio(): void {
  const ctx = audioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume();
  /* AND GIVE A PREVIOUS FAILURE ANOTHER GO.
     `failed` used to be a one-way latch: anything that went wrong once, at any
     point, silenced the game for the rest of the session with no way back. The
     window for that is wider than it looks, because decoding starts at attach,
     which is not a user gesture and is the moment the webview is least ready.
     One unlucky start and the whole game is mute until it is restarted, which
     matches "the game has lost its sound" exactly.
     This runs from a real click, so it is the right place to try again. */
  if (failed && ctx) {
    failed = false;
    primeGunSound();
  }
}

/** Decode every sample once and hold them. */
export function primeGunSound(): void {
  if (loading || failed || (buffer && rechargeBuffer && torpedoBuffer
      && torpedoBlastBuffer && shipBlastBuffer && warnBuffer && bounceBuffer)) return;
  const ctx = audioContext();
  if (!ctx) { failed = true; return; }
  const load = (url: string) => toArrayBuffer(url).then((raw) => ctx.decodeAudioData(raw));
  loading = Promise.all([
    load(laserUrl), load(rechargeUrl), load(torpedoUrl),
    load(torpedoBlastUrl), load(shipBlastUrl), load(warnUrl), load(bounceUrl),
  ])
    .then(([gun, recharge, torpedo, torpedoBlast, shipBlast, warn, bounce]) => {
      buffer = gun;
      rechargeBuffer = recharge;
      torpedoBuffer = torpedo;
      torpedoBlastBuffer = torpedoBlast;
      shipBlastBuffer = shipBlast;
      warnBuffer = warn;
      bounceBuffer = bounce;
    })
    .catch(() => {
      /* Silence is not worth breaking a game over, but it is not permanent
         either: resumeAudio clears this on the next launch and tries again. */
      failed = true;
    })
    .finally(() => { loading = null; });
}

/** A number within WOBBLE either side of one. */
function wobble(): number {
  return 1 + (Math.random() * 2 - 1) * WOBBLE;
}

function shot(ctx: AudioContext, at: number, volume: number): void {
  if (!buffer) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  /* playbackRate moves speed and pitch together, the way a real recording
     played faster does. Shifting one without the other would need a pitch
     shifter and would sound processed rather than organic. */
  src.playbackRate.value = wobble();
  const gain = ctx.createGain();
  gain.gain.value = volume * wobble();
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start(at);
}

/** Fire: two barrels, a twentieth of a second apart, neither one the same. */
export function playGunSound(): void {
  const ctx = audioContext();
  if (!ctx || failed) return;
  if (!buffer) { primeGunSound(); return; }
  const volume = masterVolume();
  if (!(volume > 0)) return;
  const now = ctx.currentTime;
  shot(ctx, now, volume);
  shot(ctx, now + SECOND_BARREL, volume);
}

/**
 * The recharging station, while you sit on the pad.
 *
 * Looped rather than fired once: a resupply at your own tower takes about a
 * second and at anyone else's about two, and sitting there holds it longer
 * still, so a one-shot would either stop early or trail off after you left.
 * Calling this twice is harmless; the second call is ignored.
 */
export function startRechargeSound(): void {
  const ctx = audioContext();
  if (!ctx || failed || rechargeNode || !rechargeBuffer) return;
  const volume = masterVolume();
  if (!(volume > 0)) return;
  const src = ctx.createBufferSource();
  src.buffer = rechargeBuffer;
  src.loop = true;
  const gain = ctx.createGain();
  /* Eased in, because a looping sample snapped on at full level clicks. */
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + 0.08);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start();
  rechargeNode = src;
  rechargeGain = gain;
}

/** Undocked, finished, destroyed, or the panel closed. Fades rather than cuts. */
export function stopRechargeSound(): void {
  const ctx = audioContext();
  const node = rechargeNode;
  const gain = rechargeGain;
  rechargeNode = null;
  rechargeGain = null;
  if (!node) return;
  if (!ctx || !gain) { try { node.stop(); } catch { /* already stopped */ } return; }
  const end = ctx.currentTime + 0.12;
  try {
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    node.stop(end + 0.02);
  } catch {
    try { node.stop(); } catch { /* already stopped */ }
  }
}

/**
 * Play a decoded sample once, lightly varied so repeats never sound identical.
 *
 * `vary` turns that variation off. Wobble suits things that are meant to sound
 * like a physical event happening twice — a gun, an explosion — where two
 * identical copies read as a loop. It does NOT suit a signal. The cockpit
 * warning is an instrument tone, and playing it at a random speed each time
 * made it sound slowed down and out of tune rather than urgent, which is
 * exactly the complaint. Signals play at their own pitch.
 */
function once(buf: AudioBuffer | null, loudness = 1, vary = true): void {
  const ctx = audioContext();
  if (!ctx || failed || !buf) return;
  const volume = masterVolume();
  if (!(volume > 0)) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = vary ? wobble() : 1;
  const gain = ctx.createGain();
  gain.gain.value = volume * loudness * (vary ? wobble() : 1);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start();
}

/**
 * The mini gun. The same sample as the main guns, half again in pitch, and a
 * single round rather than a double, so it is the same weapon family and
 * plainly not the same weapon.
 */
export function playMiniSound(): void {
  const ctx = audioContext();
  if (!ctx || failed || !buffer) return;
  const volume = masterVolume();
  if (!(volume > 0)) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = 1.5 * wobble();
  const gain = ctx.createGain();
  gain.gain.value = volume * 0.85 * wobble();
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start();
}

/* ------------------------------------------------------------ 3D audio ----
   The same approach DreadRoot uses (src/lib/spatialAudio.ts): a PannerNode with
   HRTF and an inverse distance model, and a listener that is told where the
   cockpit is AND which way it is facing. The orientation is the part that is
   easy to leave out and the part that makes a shot from behind sound like it
   came from behind rather than merely quiet. */

/** Where the cockpit is and which way it looks. Set once a frame. */
export function setListener(
  px: number, py: number, pz: number,
  fx: number, fy: number, fz: number,
  ux: number, uy: number, uz: number,
): void {
  const ctx = audioContext();
  if (!ctx) return;
  const l = ctx.listener;
  const t = ctx.currentTime;
  if (l.positionX) {
    l.positionX.setValueAtTime(px, t);
    l.positionY.setValueAtTime(py, t);
    l.positionZ.setValueAtTime(pz, t);
    l.forwardX.setValueAtTime(fx, t);
    l.forwardY.setValueAtTime(fy, t);
    l.forwardZ.setValueAtTime(fz, t);
    l.upX.setValueAtTime(ux, t);
    l.upY.setValueAtTime(uy, t);
    l.upZ.setValueAtTime(uz, t);
  } else {
    /* Older WebKit. Deprecated, and the only thing that works there. */
    (l as unknown as { setPosition(x: number, y: number, z: number): void })
      .setPosition(px, py, pz);
    (l as unknown as { setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void })
      .setOrientation(fx, fy, fz, ux, uy, uz);
  }
}

/** Distances are in globe units, where the whole planet is 628 around. */
const SHOT_REF = 6;
const SHOT_MAX = 260;

/**
 * A shot fired somewhere out in the world.
 *
 * Panned and attenuated by where it happened, so fire from behind is heard
 * behind you. That is the point of it: it is the only warning the player gets
 * that something is on their tail.
 */
export function playShotAt(x: number, y: number, z: number, pitch = 0.7): void {
  const ctx = audioContext();
  if (!ctx || failed || !buffer) return;
  const volume = masterVolume();
  if (!(volume > 0)) return;

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = pitch * wobble();

  const gain = ctx.createGain();
  gain.gain.value = volume * wobble();

  const panner = ctx.createPanner();
  panner.panningModel = "HRTF";
  panner.distanceModel = "inverse";
  panner.refDistance = SHOT_REF;
  panner.maxDistance = SHOT_MAX;
  panner.rolloffFactor = 1.3;
  if (panner.positionX) {
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
  } else {
    (panner as unknown as { setPosition(a: number, b: number, c: number): void }).setPosition(x, y, z);
  }

  src.connect(gain);
  gain.connect(panner);
  panner.connect(ctx.destination);
  src.start();
}

/** A torpedo leaving the tube. */
export function playTorpedoSound(): void {
  once(torpedoBuffer);
}

/** A fighter coming apart, or something smaller if the level is turned down. */
export function playShipExplosion(loudness = 1.1): void {
  once(shipBlastBuffer, loudness);
}

/** A torpedo going off. The big one, so it is given a little more level. */
export function playTorpedoBlast(): void {
  once(torpedoBlastBuffer, 1.25);
}

/**
 * A round on course for the ship.
 *
 * Half the natural level, as asked: it is a cue to reach for the right button,
 * not an air-raid siren, and in a busy fight several are in the air at once.
 */
export function playIncomingWarning(): void {
  /* One at a time. Four fighters firing at once raise four warnings inside a
     few frames, and four copies of the same tone laid over each other with
     random offsets is the smeared, detuned noise that got reported. A quarter
     second between them keeps it a series of pips. */
  const ctx = audioContext();
  const now = ctx ? ctx.currentTime : 0;
  if (now - lastWarnAt < 0.25) return;
  lastWarnAt = now;
  once(warnBuffer, 0.5, false);
}
let lastWarnAt = -1;

/** A round turned away by the guard. The reward for having reacted. */
export function playBounce(): void {
  once(bounceBuffer, 1, false);
}
