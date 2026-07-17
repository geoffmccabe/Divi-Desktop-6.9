import { useEffect, useState } from "react";
import { nodeStatus, type NodeStatus } from "./bridge";
import { PHASE_COLOR, PHASE_LABEL } from "./status";

// The node status block for the Overview tab. No glass wrapper — it nests
// inside the wallet panel.
export function StatusPanel() {
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await nodeStatus();
        if (alive) {
          setStatus(s);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const phase = status?.phase ?? "unreachable";
  const color = PHASE_COLOR[phase] ?? "var(--muted-foreground)";
  const working = phase === "syncing" || phase === "no-peers" || phase === "starting" || phase === "unreachable";

  return (
    <div className="wl-status">
      <div className="wl-status-head">
        <span
          className="wl-dot"
          style={{
            backgroundColor: `hsl(${color})`,
            boxShadow: `0 0 12px hsl(${color} / 0.8)`,
            animation: working ? "status-dot-pulse 1.4s ease-in-out infinite" : "none",
          }}
        />
        <span className="wl-status-label" style={{ color: `hsl(${color})` }}>
          {PHASE_LABEL[phase] ?? "Unknown"}
        </span>
      </div>
      <p className="wl-status-line">
        {error ? "Can't reach the node service yet — retrying…" : status?.headline ?? "Checking the node…"}
      </p>
      <div className="wl-status-chips">
        <div className="glass-chip px-4 py-2">
          Block height<br />
          <span>{status?.blocks != null ? status.blocks.toLocaleString() : "—"}</span>
        </div>
        <div className="glass-chip px-4 py-2">
          Peers<br />
          <span>{status?.peers != null ? status.peers : "—"}</span>
        </div>
      </div>
    </div>
  );
}
