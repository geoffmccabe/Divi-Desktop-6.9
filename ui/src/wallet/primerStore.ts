import { useSyncExternalStore } from "react";

// PrimerLove state — the fast blockchain loader. Fed by the backend once it lands;
// for now a preview simulator (Cmd+Shift+P) drives it so the screen can be seen.
export interface PrimerState {
  active: boolean;
  chunkDate: string; // e.g. "May 2023" — the month being loaded
  chunkIndex: number; // 1-based
  chunkTotal: number;
  overallPct: number; // 0..100 across all chunks
  chunkPct: number; // 0..100 for the current chunk
  phase: string; // downloading | verifying | applying
  preview: boolean; // true while the demo simulator is driving it
}

let state: PrimerState = {
  active: false, chunkDate: "", chunkIndex: 0, chunkTotal: 0,
  overallPct: 0, chunkPct: 0, phase: "", preview: false,
};
const listeners = new Set<() => void>();
export function setPrimer(s: Partial<PrimerState>) {
  state = { ...state, ...s };
  for (const l of listeners) l();
}
export function usePrimer(): PrimerState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

// ---- Preview simulator (until the real download/apply backend exists) ----
let sim: number | null = null;
export function togglePrimerPreview() {
  if (state.active) {
    if (sim) window.clearInterval(sim);
    sim = null;
    setPrimer({ active: false, preview: false });
    return;
  }
  // ~monthly chunks from Divi's launch to now.
  const months: string[] = [];
  const d = new Date(2018, 4, 1);
  const end = new Date(2026, 6, 1);
  while (d <= end) {
    months.push(d.toLocaleString(undefined, { month: "long", year: "numeric" }));
    d.setMonth(d.getMonth() + 1);
  }
  let ci = 0;
  let cp = 0;
  const phases = ["downloading", "verifying", "applying"];
  setPrimer({ active: true, preview: true, chunkTotal: months.length, chunkIndex: 1, chunkDate: months[0], chunkPct: 0, overallPct: 0, phase: "downloading" });
  sim = window.setInterval(() => {
    cp += 4 + Math.random() * 9;
    if (cp >= 100) {
      cp = 0;
      ci++;
      if (ci >= months.length) {
        if (sim) window.clearInterval(sim);
        sim = null;
        setPrimer({ active: false, preview: false });
        return;
      }
    }
    setPrimer({
      chunkIndex: ci + 1,
      chunkDate: months[ci],
      chunkPct: Math.min(100, cp),
      overallPct: Math.round(((ci + Math.min(100, cp) / 100) / months.length) * 100),
      phase: phases[Math.floor(cp / 40) % phases.length],
    });
  }, 180);
}
