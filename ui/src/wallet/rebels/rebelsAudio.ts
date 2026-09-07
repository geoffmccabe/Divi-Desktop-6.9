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
import { audioContext, masterVolume } from "../../sound";

/** How far speed, pitch and volume may wander, either way. */
const WOBBLE = 0.1;
/** The gap between the two barrels. */
const SECOND_BARREL = 0.05;

let buffer: AudioBuffer | null = null;
let rechargeBuffer: AudioBuffer | null = null;
let torpedoBuffer: AudioBuffer | null = null;
let torpedoBlastBuffer: AudioBuffer | null = null;
let shipBlastBuffer: AudioBuffer | null = null;
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
}

/** Decode every sample once and hold them. */
export function primeGunSound(): void {
  if (loading || failed || (buffer && rechargeBuffer && torpedoBuffer
      && torpedoBlastBuffer && shipBlastBuffer)) return;
  const ctx = audioContext();
  if (!ctx) { failed = true; return; }
  const load = (url: string) => toArrayBuffer(url).then((raw) => ctx.decodeAudioData(raw));
  loading = Promise.all([
    load(laserUrl), load(rechargeUrl), load(torpedoUrl),
    load(torpedoBlastUrl), load(shipBlastUrl),
  ])
    .then(([gun, recharge, torpedo, torpedoBlast, shipBlast]) => {
      buffer = gun;
      rechargeBuffer = recharge;
      torpedoBuffer = torpedo;
      torpedoBlastBuffer = torpedoBlast;
      shipBlastBuffer = shipBlast;
    })
    .catch(() => {
      /* Silence is not worth breaking a game over. */
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

/** Play a decoded sample once, lightly varied so repeats never sound identical. */
function once(buf: AudioBuffer | null, loudness = 1): void {
  const ctx = audioContext();
  if (!ctx || failed || !buf) return;
  const volume = masterVolume();
  if (!(volume > 0)) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = wobble();
  const gain = ctx.createGain();
  gain.gain.value = volume * loudness * wobble();
  src.connect(gain);
  gain.connect(ctx.destination);
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
