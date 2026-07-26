// Short notification tones, synthesised with the Web Audio API so there is no
// sound file to bundle (zero download weight). One bright chime for an incoming
// Fast Send, one lower two-tone alert for a detected conflict.

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null; // audio unavailable — the UI still works, just silently
  }
}

function beep(freq: number, start: number, dur: number, gain = 0.14) {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const t0 = ac.currentTime + start;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Bright rising three-note chime — "money just arrived".
export function playArrival() {
  beep(660, 0, 0.18);
  beep(880, 0.12, 0.18);
  beep(1320, 0.24, 0.28);
}

// Lower, dissonant two-tone — "something is wrong with this payment".
export function playConflict() {
  beep(330, 0, 0.3, 0.16);
  beep(247, 0.18, 0.4, 0.16);
}
