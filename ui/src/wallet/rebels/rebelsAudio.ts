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
import { audioContext, masterVolume } from "../../sound";

/** How far speed, pitch and volume may wander, either way. */
const WOBBLE = 0.1;
/** The gap between the two barrels. */
const SECOND_BARREL = 0.05;

let buffer: AudioBuffer | null = null;
let loading: Promise<void> | null = null;
let failed = false;

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

/** Decode once, on the first shot, and hold it. */
export function primeGunSound(): void {
  if (buffer || loading || failed) return;
  const ctx = audioContext();
  if (!ctx) { failed = true; return; }
  loading = toArrayBuffer(laserUrl)
    .then((raw) => ctx.decodeAudioData(raw))
    .then((decoded) => { buffer = decoded; })
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
