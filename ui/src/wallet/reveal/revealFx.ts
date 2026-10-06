// PERC reveal — layered canvas FX + synthesized sound. Rebuilt from the four
// reference effects (spinning starburst, warp starfield, glitter, fireworks);
// CodePen cannot load inside the app, so these are native reimplementations.
// Two canvases sandwich the PERC card: BASE behind it, OVER in front.
// Everything scales with `intensity` (0.2..1) and recolors per the level.
import type { Level } from "./revealModel";

const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Layer {
  over: boolean;
  ttl: number;
  age: number;
  update: (dt: number, age: number) => void;
  draw: (g: CanvasRenderingContext2D) => void;
}

export interface PlayOpts {
  level: Level;
  intensity: number;
  ur: boolean;
  durationMs?: number;
}

export interface RevealFx {
  play: (opts: PlayOpts) => void;
  stop: () => void;
}

export function createRevealFx(baseCanvas: HTMLCanvasElement, overCanvas: HTMLCanvasElement): RevealFx {
  const bctx = baseCanvas.getContext("2d")!;
  const octx = overCanvas.getContext("2d")!;
  const DPR = Math.min(2, (typeof devicePixelRatio !== "undefined" && devicePixelRatio) || 1);
  let W = 0, H = 0, CX = 0, CY = 0;
  let layers: Layer[] = [];
  let running = false;
  let last = 0;
  let raf = 0;

  function size() {
    const r = baseCanvas.getBoundingClientRect();
    W = baseCanvas.width = overCanvas.width = Math.max(1, Math.round(r.width * DPR));
    H = baseCanvas.height = overCanvas.height = Math.max(1, Math.round(r.height * DPR));
    CX = W / 2;
    CY = H * 0.47;
  }

  function fade(age: number, ttl: number, inMs: number, outMs: number): number {
    if (age < inMs) return age / inMs;
    if (age > ttl - outMs) return Math.max(0, (ttl - age) / outMs);
    return 1;
  }
  const pick = (arr: string[], i: number) => arr[((i % arr.length) + arr.length) % arr.length];

  function loop(t: number) {
    const dt = Math.min(50, t - last);
    last = t;
    bctx.clearRect(0, 0, W, H);
    octx.clearRect(0, 0, W, H);
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i];
      L.age += dt;
      const g = L.over ? octx : bctx;
      L.update(dt, L.age);
      g.save();
      L.draw(g);
      g.restore();
      if (L.age >= L.ttl) layers.splice(i, 1);
    }
    if (layers.length) {
      raf = requestAnimationFrame(loop);
    } else {
      running = false;
      bctx.clearRect(0, 0, W, H);
      octx.clearRect(0, 0, W, H);
    }
  }
  function startLoop() {
    if (!running) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }
  }

  // ---- Layer 1: spinning starburst wheel (base) ----
  function spinBurst(level: Level, inten: number, ttl: number): Layer {
    const rays = 26;
    const maxR = Math.max(W, H) * 0.62 * (0.45 + inten * 0.55);
    const spin = 0.00018 + inten * 0.0005;
    let ang = 0, hue = 0;
    return {
      over: false, ttl, age: 0,
      update(dt) { ang += spin * dt; hue = (hue + dt * 0.03) % 360; },
      draw(g) {
        const a = fade(this.age, ttl, 350, 700);
        g.globalAlpha = a * (0.1 + inten * 0.14);
        g.translate(CX, CY); g.rotate(ang);
        for (let i = 0; i < rays; i++) {
          if (i % 2) continue;
          const a0 = (i / rays) * Math.PI * 2, a1 = ((i + 1) / rays) * Math.PI * 2;
          if (level.rainbow) g.fillStyle = `hsl(${(hue + (i / rays) * 360) % 360},85%,60%)`;
          else g.fillStyle = level.fire ? pick(level.c, i) : pick(level.c, 0);
          g.beginPath(); g.moveTo(0, 0);
          g.lineTo(Math.cos(a0) * maxR, Math.sin(a0) * maxR);
          g.lineTo(Math.cos(a1) * maxR, Math.sin(a1) * maxR);
          g.closePath(); g.fill();
        }
      },
    };
  }

  // ---- Layer 2: warp starfield + burst flash (base, above spin) ----
  function starfield(level: Level, inten: number, ttl: number): Layer {
    const n = Math.round((reduce ? 30 : 120) * inten);
    const stars = Array.from({ length: n }, () => {
      const a = Math.random() * Math.PI * 2;
      return { a, r: Math.random() * 30 * DPR, v: (2 + Math.random() * 7) * DPR * (0.5 + inten), pr: 0 };
    });
    let flash = 1;
    return {
      over: false, ttl, age: 0,
      update(dt) {
        flash = Math.max(0, flash - dt / 420);
        for (const s of stars) {
          s.pr = s.r; s.v *= 1.02; s.r += (s.v * dt) / 16;
          if (s.r > Math.max(W, H)) { s.r = Math.random() * 20 * DPR; s.v = (2 + Math.random() * 7) * DPR * (0.5 + inten); }
        }
      },
      draw(g) {
        const a = fade(this.age, ttl, 120, 650);
        if (flash > 0) {
          g.globalAlpha = a * flash * 0.6;
          g.strokeStyle = level.rainbow ? "#fff" : pick(level.c, 0);
          g.lineWidth = 6 * DPR * flash;
          g.beginPath(); g.arc(CX, CY, (1 - flash) * Math.max(W, H) * 0.5, 0, Math.PI * 2); g.stroke();
        }
        g.globalAlpha = a; g.lineCap = "round";
        for (let i = 0; i < stars.length; i++) {
          const s = stars[i];
          const x0 = CX + Math.cos(s.a) * s.pr, y0 = CY + Math.sin(s.a) * s.pr;
          const x1 = CX + Math.cos(s.a) * s.r, y1 = CY + Math.sin(s.a) * s.r;
          g.strokeStyle = level.rainbow ? `hsl(${(s.a * 57) % 360},90%,70%)` : (level.c.length > 1 ? pick(level.c, i) : (level.gold ? "#fff2c2" : "#ffffff"));
          g.lineWidth = (0.6 + inten * 1.6) * DPR;
          g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        }
      },
    };
  }

  // ---- Layer 3: white glitter (over, jumps >= 6) ----
  function glitter(inten: number, ttl: number): Layer {
    const n = Math.round((reduce ? 26 : 90) * inten);
    const gs = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H, ph: Math.random() * 6.28,
      sp: 0.004 + Math.random() * 0.006, sz: (0.8 + Math.random() * 2.2) * DPR, dy: (0.2 + Math.random() * 0.5) * DPR,
    }));
    return {
      over: true, ttl, age: 0,
      update(dt) { for (const s of gs) { s.ph += s.sp * dt; s.y += (s.dy * dt) / 16; if (s.y > H) s.y = 0; } },
      draw(g) {
        const a = fade(this.age, ttl, 200, 700); g.fillStyle = "#ffffff";
        for (const s of gs) {
          const tw = (Math.sin(s.ph) + 1) / 2; g.globalAlpha = a * tw * 0.95; const r = s.sz * (0.5 + tw);
          g.beginPath(); g.moveTo(s.x, s.y - r * 2); g.lineTo(s.x + r * 0.5, s.y); g.lineTo(s.x, s.y + r * 2); g.lineTo(s.x - r * 0.5, s.y); g.closePath(); g.fill();
          g.beginPath(); g.moveTo(s.x - r * 2, s.y); g.lineTo(s.x, s.y + r * 0.5); g.lineTo(s.x + r * 2, s.y); g.lineTo(s.x, s.y - r * 0.5); g.closePath(); g.fill();
        }
      },
    };
  }

  // ---- Layer 4: fireworks (over, Ultra Rare) ----
  function fireworks(ttl: number): Layer {
    const cols = ["#ff6ec7", "#ffd36e", "#6effc1", "#6db6ff", "#b76bff", "#ff5e5e"];
    const rockets: { x: number; y: number; ty: number; vy: number; col: string }[] = [];
    const parts: { x: number; y: number; vx: number; vy: number; life: number; col: string; sz: number }[] = [];
    let acc = 0;
    const launch = () => {
      rockets.push({ x: W * (0.25 + Math.random() * 0.5), y: H, ty: H * (0.2 + Math.random() * 0.35), vy: -(8 + Math.random() * 4) * DPR, col: cols[(Math.random() * cols.length) | 0] });
    };
    return {
      over: true, ttl, age: 0,
      update(dt) {
        acc += dt;
        if (acc > 280 && this.age < ttl - 900) { acc = 0; launch(); if (Math.random() < 0.5) launch(); }
        for (let i = rockets.length - 1; i >= 0; i--) {
          const r = rockets[i]; r.y += (r.vy * dt) / 16;
          if (r.y <= r.ty) {
            for (let p = 0; p < (reduce ? 24 : 70); p++) {
              const a = Math.random() * 6.28, sp = (1 + Math.random() * 6) * DPR;
              parts.push({ x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, col: r.col, sz: (1 + Math.random() * 1.5) * DPR });
            }
            rockets.splice(i, 1);
          }
        }
        for (let i = parts.length - 1; i >= 0; i--) {
          const q = parts[i]; q.vy += 0.12 * DPR; q.x += (q.vx * dt) / 16; q.y += (q.vy * dt) / 16; q.vx *= 0.99; q.vy *= 0.99; q.life -= dt / 1100;
          if (q.life <= 0) parts.splice(i, 1);
        }
      },
      draw(g) {
        const a = fade(this.age, ttl, 80, 800);
        for (const r of rockets) { g.globalAlpha = a; g.fillStyle = r.col; g.beginPath(); g.arc(r.x, r.y, 2 * DPR, 0, 6.28); g.fill(); }
        for (const q of parts) { g.globalAlpha = a * Math.max(0, q.life); g.fillStyle = q.col; g.beginPath(); g.arc(q.x, q.y, q.sz * q.life, 0, 6.28); g.fill(); }
        g.globalAlpha = 1;
      },
    };
  }

  return {
    play(opts: PlayOpts) {
      size();
      layers = [];
      const ttl = opts.durationMs ?? (opts.ur ? 5200 : 3600);
      const L = opts.level;
      const inten = opts.ur ? 1 : opts.intensity;
      layers.push(spinBurst(L, inten, ttl));
      layers.push(starfield(L, inten, ttl));
      if (opts.ur) { layers.push(fireworks(ttl)); layers.push(glitter(1, ttl)); }
      else if (L.glitter) { layers.push(glitter(inten, ttl)); }
      layers.forEach((l) => (l.age = 0));
      startLoop();
    },
    stop() {
      layers = [];
      if (raf) cancelAnimationFrame(raf);
      running = false;
      try { bctx.clearRect(0, 0, W, H); octx.clearRect(0, 0, W, H); } catch { /* detached */ }
    },
  };
}

// ---- synthesized reveal sound (scales 0.2..1 with intensity) ----
let AC: AudioContext | null = null;
function ac(): AudioContext | null {
  try {
    if (!AC) AC = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (AC.state === "suspended") AC.resume();
  } catch { AC = null; }
  return AC;
}
function noiseBuf(a: AudioContext): AudioBuffer {
  const n = a.sampleRate * 0.6, b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function tone(a: AudioContext, dst: AudioNode, freq: number, t0: number, dur: number, type: OscillatorType, peak: number) {
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(dst); o.start(t0); o.stop(t0 + dur + 0.05);
}
export function primeAudio() { ac(); }
export function playRevealSound(inten: number, ur: boolean, muted: boolean) {
  if (muted) return;
  const a = ac(); if (!a) return;
  const t = a.currentTime;
  const master = a.createGain(); master.gain.value = inten; master.connect(a.destination);
  const src = a.createBufferSource(); src.buffer = noiseBuf(a);
  const bp = a.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(3500, t + 0.5); bp.Q.value = 0.8;
  const wg = a.createGain(); wg.gain.setValueAtTime(0.0001, t); wg.gain.linearRampToValueAtTime(0.5, t + 0.25); wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  src.connect(bp); bp.connect(wg); wg.connect(master); src.start(t); src.stop(t + 0.65);
  tone(a, master, 70, t + 0.5, 0.5, "sine", 0.9);
  const scale = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
  const notes = ur ? 6 : Math.min(6, 2 + Math.round(inten * 5));
  for (let i = 0; i < notes; i++) tone(a, master, scale[i % scale.length], t + 0.52 + i * 0.075, 0.5, "triangle", 0.28);
  if (ur) {
    [392, 493.88, 587.33, 783.99].forEach((f) => tone(a, master, f, t + 0.55, 1.6, "sawtooth", 0.12));
    for (let i = 0; i < 10; i++) tone(a, master, 1800 + Math.random() * 1600, t + 0.7 + i * 0.09, 0.4, "sine", 0.08);
  }
}
