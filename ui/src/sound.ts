// Instant UI sounds via Web Audio — oscillator tones, so there's no file to
// load and playback is immediate. Each event's waveform + pitch come from the
// theme's --sound-* CSS variables, so a skin defines its own sounds.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
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

  osc.connect(gain).connect(c.destination);
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
