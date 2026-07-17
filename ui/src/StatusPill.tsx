import { useEffect, useState } from "react";
import { nodeStatus } from "./bridge";
import { PHASE_COLOR, PHASE_LABEL } from "./status";

// Slim always-visible status in the header.
export function StatusPill() {
  const [phase, setPhase] = useState("starting");

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await nodeStatus();
        if (alive) setPhase(s.phase);
      } catch {
        /* keep last */
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const color = PHASE_COLOR[phase] ?? "var(--muted-foreground)";
  return (
    <div className="status-pill glass-chip">
      <span
        className="wl-dot"
        style={{ backgroundColor: `hsl(${color})`, boxShadow: `0 0 8px hsl(${color} / 0.8)` }}
      />
      <span style={{ color: `hsl(${color})` }}>{PHASE_LABEL[phase] ?? "—"}</span>
    </div>
  );
}
