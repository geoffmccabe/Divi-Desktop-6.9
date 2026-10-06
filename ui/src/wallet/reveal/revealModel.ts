// PERC reveal — shared model: the tier-jump color ladder, the 20→100% intensity
// curve, and the roll math. Pure and framework-agnostic so the reveal can be
// reused in DD69, DiviGo, or anywhere. The on-chain reveal transaction (the real
// roll, seeded by a future Divi block) will feed a RevealResult into the stage;
// `simulate` here is only for previews until that backend lands.

export interface RevealResult {
  tier: number;   // the tier reached (1..40); 0 when unknown/preview-UR
  jump: number;   // tiers "up": result tier for an original pack, result-input for a forge
  ur: boolean;    // ultra rare
  floor: number;  // forged guaranteed minimum tier (0 = none)
}

export interface Level {
  name: string;
  c: string[];       // one or more colors driving the effect layers
  glitter: boolean;  // white glitter overlay (jumps >= 6)
  rainbow?: boolean;
  fire?: boolean;
  gold?: boolean;
}

// Color ladder keyed to how many tiers were jumped (1..10), per the set rules.
export const LEVELS: Record<number, Level> = {
  1:  { name: "grey-tan", c: ["#b9ad94"], glitter: false },
  2:  { name: "green",    c: ["#3fd17a"], glitter: false },
  3:  { name: "blue",     c: ["#3d9bff"], glitter: false },
  4:  { name: "purple",   c: ["#b06bff"], glitter: false },
  5:  { name: "red",      c: ["#ff4d5e"], glitter: false },
  6:  { name: "white",    c: ["#ffffff"], glitter: true },
  7:  { name: "pink",     c: ["#ff77c8"], glitter: true },
  8:  { name: "rainbow",  c: ["#ff5e5e", "#ffb23e", "#4ad991", "#3d9bff", "#b06bff"], rainbow: true, glitter: true },
  9:  { name: "fire",     c: ["#ff3b1f", "#ff8a1e", "#ffd23e"], fire: true, glitter: true },
  10: { name: "gold",     c: ["#ffd45e", "#ffb23e", "#fff2c2"], gold: true, glitter: true },
};

export function lvl(n: number): Level {
  return LEVELS[Math.max(1, Math.min(10, Math.round(n)))];
}

// Spectacle / sound scale: +1 tier = 20%, +2 = 30%, … capped at 100%.
export function intensity(magnitude: number): number {
  return Math.max(0.2, Math.min(1, 0.1 + magnitude * 0.1));
}

export function colorFor(res: RevealResult): string {
  return res.ur ? "#b76bff" : lvl(res.jump).c[0];
}

// Halving ladder: P(step = k) = 0.5^k, k >= 1.
function steps(): number {
  let k = 1;
  while (Math.random() < 0.5 && k < 40) k++;
  return k;
}

export interface RollInput {
  type: "original" | "forged";
  inputTier?: number;   // forged: the shared tier of the two inputs
  forceTier?: number;   // optional: force a specific result tier
  forceUR?: boolean;
}

// A local simulation of a reveal roll — PREVIEW ONLY. The real result comes from
// the on-chain reveal (reveal.rs + a future-block seed) once that is wired.
export function simulate(inp: RollInput): RevealResult {
  const ur = !!inp.forceUR || Math.random() < 0.01;
  let tier: number;
  let floor = 0;
  let base = 0;
  if (inp.type === "forged") {
    base = Math.max(1, Math.min(39, inp.inputTier ?? 1));
    floor = Math.min(40, base + 1);
    tier = Math.min(40, base + steps());
  } else {
    tier = Math.min(40, steps());
  }
  if (inp.forceTier != null) {
    tier = Math.max(1, Math.min(40, inp.forceTier));
    if (inp.type === "forged") tier = Math.max(tier, floor);
  }
  const jump = inp.type === "forged" ? tier - base : tier;
  return { tier, floor, ur, jump: Math.max(1, jump) };
}

// A fixed result for previewing one effect level (or UR) directly.
export function previewResult(level: number | "ur"): RevealResult {
  if (level === "ur") return { tier: 0, jump: 10, ur: true, floor: 0 };
  return { tier: level, jump: level, ur: false, floor: 0 };
}
