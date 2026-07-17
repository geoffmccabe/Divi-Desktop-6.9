import { useEffect, useState } from "react";
import { nodeStatus, type NodeStatus } from "./bridge";

// One color per phase — the always-visible signal. Greens = good, amber =
// working, red = attention.
const PHASE_COLOR: Record<string, string> = {
  staking: "var(--success)",
  synced: "var(--success)",
  syncing: "var(--warning)",
  "no-peers": "var(--warning)",
  starting: "var(--warning)",
  crashed: "var(--destructive)",
  stopped: "var(--muted-foreground)",
  unreachable: "var(--muted-foreground)",
};

const PHASE_LABEL: Record<string, string> = {
  staking: "Staking",
  synced: "Synced",
  syncing: "Syncing",
  "no-peers": "Connecting",
  starting: "Starting",
  crashed: "Needs repair",
  stopped: "Stopped",
  unreachable: "Starting",
};

export function StatusPanel() {
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await nodeStatus();
        if (alive) { setStatus(s); setError(null); }
      } catch (e) {
        if (alive) setError(String(e));
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const phase = status?.phase ?? "unreachable";
  const color = PHASE_COLOR[phase] ?? "var(--muted-foreground)";
  const working = phase === "syncing" || phase === "no-peers" || phase === "unreachable";

  return (
    <div className="glass-panel p-8 w-full max-w-xl">
      <div className="flex items-center gap-3 mb-1">
        <span
          style={{
            width: 12, height: 12, borderRadius: "50%",
            backgroundColor: `hsl(${color})`,
            boxShadow: `0 0 12px hsl(${color} / 0.8)`,
            animation: working ? "status-dot-pulse 1.4s ease-in-out infinite" : "none",
          }}
        />
        <span className="text-sm uppercase tracking-wider" style={{ color: `hsl(${color})` }}>
          {PHASE_LABEL[phase] ?? "Unknown"}
        </span>
      </div>

      <p className="text-lg leading-relaxed" style={{ color: "hsl(var(--foreground))" }}>
        {error ? "Can't reach the node service yet — retrying…" : status?.headline ?? "Checking the node…"}
      </p>

      <div className="flex gap-6 mt-6 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
        <div className="glass-chip px-4 py-2">
          Block height<br />
          <span className="text-base" style={{ color: "hsl(var(--foreground))" }}>
            {status?.blocks != null ? status.blocks.toLocaleString() : "—"}
          </span>
        </div>
        <div className="glass-chip px-4 py-2">
          Peers<br />
          <span className="text-base" style={{ color: "hsl(var(--foreground))" }}>
            {status?.peers != null ? status.peers : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
