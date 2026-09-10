// The music: one theme for the menu, one for flying, and the fade between them.
//
// STREAMED, NOT BUNDLED
// ---------------------
// Two minutes of stereo is a megabyte each, and the wallet is one inlined HTML
// file: bundling them would put two megabytes of music into every download of
// DD69 whether or not anybody ever opens the game. So they come from R2 on
// demand and are then kept for good on the machine that fetched them, which is
// how the ship models and the map tiles already work.
//
// The opening theme is asked for FIRST and on its own, before the gameplay
// track and before any model or map tile the game will want. Geoff: "it should
// be the first thing that the player hears because it's lazy-loaded from
// Cloudflare before anything else."
//
// WHY IT IS AN INTENT RATHER THAN A COMMAND
// -----------------------------------------
// Nothing here plays anything directly. Callers say which theme SHOULD be
// playing and this works out when that becomes possible, because two things
// stand in the way and neither is under the caller's control: the track may not
// have arrived yet, and a webview will not make a sound at all until the player
// has clicked something. A play() that simply failed when either was true would
// lose the opening theme almost every time, since the panel opens before the
// download finishes.

import { audioContext, masterVolume, output, onAudioRebuild } from "../../sound";

const BASE = "https://assets.dreadroot.com/rebels/music";
const DB = "dd69.music";
const STORE = "tracks";

export type Track = "opening" | "gameplay";

/** Where each theme lives. Gameplay is numbered because there will be more of
 *  them; the menu only ever needs the one. */
const FILES: Record<Track, string> = {
  opening: "opening.mp3",
  gameplay: "gameplay1.mp3",
};

/**
 * Music sits under the effects.
 *
 * A laser plays at the master volume, but it is a transient: continuous music
 * at the same figure sits on top of the game rather than under it. Three
 * quarters is quiet enough to fly to and loud enough to hear.
 */
export const MUSIC_LEVEL = 0.75;
/** Seconds the flying theme takes to go, when the ship does. Geoff's figure. */
export const DEATH_FADE = 5;
/** And how long the menu theme takes to come back up afterwards. */
export const RETURN_FADE = 2.5;
/** An ordinary change of theme, when nobody has died. */
export const SWAP_FADE = 1.2;

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  track: Track;
}

const buffers = new Map<Track, AudioBuffer>();
const fetching = new Set<Track>();
let failed = new Set<Track>();
let voice: Voice | null = null;
/** What SHOULD be playing, which is not always what can be. */
let wanted: Track | null = null;
/** Seconds the next start should fade in over. */
let fadeIn = SWAP_FADE;
/** Set while the flying theme is on its way out, so the menu theme does not
 *  start on top of it. */
let holdUntil = 0;

/* ---- the byte store ---- */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("no local store"));
  });
}

async function cached(key: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as ArrayBuffer) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function keep(key: string, bytes: ArrayBuffer): Promise<void> {
  try {
    const db = await openDb();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(bytes, key);
  } catch {
    /* A full store costs one more download next time, and nothing else. */
  }
}

/**
 * Get one theme's bytes onto this machine. No audio context, no decoding.
 *
 * Kept apart from decoding on purpose, because the two want to happen at very
 * different moments. Downloading wants to happen as early as possible and can
 * happen with no sound system at all; decoding needs an audio context and is
 * only worth doing when the theme is about to be heard.
 */
async function cacheTrack(track: Track): Promise<ArrayBuffer | null> {
  const key = FILES[track];
  const have = await cached(key);
  if (have) return have;
  try {
    const res = await fetch(`${BASE}/${key}`);
    if (!res.ok) throw new Error(`http ${res.status}`);
    const bytes = await res.arrayBuffer();
    void keep(key, bytes);
    return bytes;
  } catch {
    failed.add(track);
    return null;
  }
}

/**
 * Put a theme on the machine, long before anybody needs it.
 *
 * Called once when the WALLET starts, not when the game opens. Geoff: "it makes
 * more sense to have the music lazy-load once the DD69 app is loaded, so it
 * doesn't have to be streamed at once to 20+ people. Once it's on a user's hard
 * drive, it's there to be used when needed and only loaded once."
 *
 * That is the right call for two separate reasons. A room of twenty players all
 * opening the game at the same moment would otherwise all pull a megabyte at
 * that moment; and the opening theme is supposed to start the instant the panel
 * appears, which it cannot do if that is when the download begins.
 *
 * Only the opening theme. The flying one is fetched when the panel opens, while
 * the player is reading the welcome screen, so the wallet's own startup pulls
 * as little as it can.
 */
export function prefetchMusic(): void {
  if (prefetched) return;
  prefetched = true;
  void cacheTrack("opening");
}
let prefetched = false;

/** Fetch if needed, then decode. Safe to call repeatedly. */
function fetchTrack(track: Track): void {
  if (buffers.has(track) || fetching.has(track) || failed.has(track)) return;
  const ctx = audioContext();
  if (!ctx) return;
  fetching.add(track);
  void (async () => {
    try {
      const bytes = await cacheTrack(track);
      if (!bytes) throw new Error("no bytes");
      /* decodeAudioData takes ownership of the buffer it is given, so the copy
         that went into the store must not be the one handed over. */
      const buf = await ctx.decodeAudioData(bytes.slice(0));
      buffers.set(track, buf);
      pumpMusic();
    } catch {
      failed.add(track);
    } finally {
      fetching.delete(track);
    }
  })();
}

/**
 * The panel has opened.
 *
 * The opening theme should already be on disk from the wallet's startup, so
 * this is a decode rather than a download and it can start almost at once. The
 * flying theme is pulled now, in the background, while the welcome screen is
 * being read: by the time anybody presses launch it is there.
 */
export function primeMusic(): void {
  fetchTrack("opening");
  void cacheTrack("gameplay");
}

function level(): number {
  const v = masterVolume();
  return Number.isFinite(v) && v > 0 ? v * MUSIC_LEVEL : 0;
}

function stopVoice(v: Voice, over: number, ctx: AudioContext): void {
  const now = ctx.currentTime;
  try {
    v.gain.gain.cancelScheduledValues(now);
    /* From wherever it actually is rather than from the top, or a theme cut
       short half way through a fade jumps back to full and then falls. */
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.linearRampToValueAtTime(0.0001, now + over);
    v.src.stop(now + over + 0.05);
  } catch {
    /* Already stopped. */
  }
}

/**
 * Start whatever should be playing, if it can be.
 *
 * Called whenever something changes that might make it possible: a track
 * arriving, the audio waking up, or a caller changing its mind.
 */
export function pumpMusic(): void {
  const ctx = audioContext();
  if (!ctx) return;
  /* A webview will not make a sound before the player has clicked something,
     and starting a two-minute loop into a suspended context would spend the
     first half of the theme inaudible. */
  if (ctx.state !== "running") return;
  if (wanted === null) return;
  if (voice && voice.track === wanted) return;
  if (holdUntil > ctx.currentTime) return;

  const buf = buffers.get(wanted);
  if (!buf) { fetchTrack(wanted); return; }

  if (voice) { stopVoice(voice, SWAP_FADE, ctx); voice = null; }

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  const top = level();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, top), now + Math.max(0.01, fadeIn));
  src.connect(gain);
  gain.connect(output() ?? ctx.destination);
  src.start();
  voice = { src, gain, track: wanted };
  fadeIn = SWAP_FADE;

}

/** Play the menu theme. What is heard whenever nobody is flying. */
export function playOpening(fade = SWAP_FADE): void {
  wanted = "opening";
  fadeIn = fade;
  pumpMusic();
}

/** Play the flying theme, on repeat. */
export function playGameplay(fade = SWAP_FADE): void {
  wanted = "gameplay";
  fadeIn = fade;
  /* A launch cancels a death fade: the player is flying again. */
  holdUntil = 0;
  pumpMusic();
}

/**
 * The ship is gone.
 *
 * The flying theme goes over five seconds and the menu theme comes back after
 * it rather than across it, which is what was asked for and is also the right
 * shape: a crossfade would have the two playing together at the one moment the
 * game has nothing to say.
 */
export function musicOnDeath(): void {
  const ctx = audioContext();
  if (!ctx) { wanted = "opening"; return; }
  if (voice) {
    stopVoice(voice, DEATH_FADE, ctx);
    voice = null;
    holdUntil = ctx.currentTime + DEATH_FADE;
  }
  wanted = "opening";
  fadeIn = RETURN_FADE;
  pumpMusic();
}

/** Everything off, for leaving the panel. */
export function stopMusic(over = 0.6): void {
  const ctx = audioContext();
  wanted = null;
  holdUntil = 0;
  if (voice && ctx) stopVoice(voice, over, ctx);
  voice = null;
}

/** Keep the level in step with the theme's volume slider while playing. */
export function tickMusic(): void {
  const ctx = audioContext();
  if (!ctx || !voice) return;
  const top = level();
  /* Only when it has actually moved, and never during a fade, which would
     fight the ramp that is already scheduled. */
  const g = voice.gain.gain;
  if (Math.abs(g.value - top) > 0.005 && ctx.currentTime > 0) {
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(Math.max(0.0001, top), ctx.currentTime + 0.4);
  }
}

/** For the black box. */
export function musicState(): Record<string, unknown> {
  let state = "none";
  try {
    const ctx = audioContext();
    state = ctx ? ctx.state : "null";
  } catch { state = "threw"; }
  return {
    ctx: state,
    wanted,
    playing: voice ? voice.track : null,
    have: [...buffers.keys()],
    fetching: [...fetching],
    failed: [...failed],
    level: level(),
  };
}

/** Test hook. */
/* The bus was rebuilt. The decoded tracks belonged to the old context, the
   voice died with it; the intent (what is wanted) survives, so decoding the
   wanted track again is enough for pumpMusic to start it over. */
onAudioRebuild(() => {
  buffers.clear();
  fetching.clear();
  failed = new Set();
  voice = null;
  holdUntil = 0;
  if (wanted) fetchTrack(wanted);
});

export function resetMusicForTests(): void {
  prefetched = false;
  buffers.clear();
  fetching.clear();
  failed = new Set();
  voice = null;
  wanted = null;
  holdUntil = 0;
  fadeIn = SWAP_FADE;
}
