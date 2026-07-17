import { useEffect, useRef, useState } from "react";
import { nodeStatus, type NodeStatus } from "./bridge";
import { PHASE_COLOR, PHASE_LABEL } from "./status";
import { playSound } from "./sound";

// The node status block for the Overview tab. No glass wrapper — it nests
// inside the wallet panel.
export function StatusPanel() {
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [error, setError] = useState(false);
  // Last block height we ever saw, so we can keep showing it (greyed) while the
  // node is behind instead of dropping to a dash.
  const [lastBlocks, setLastBlocks] = useState<number | null>(null);
  const [peerFlash, setPeerFlash] = useState(false);
  const prevPeers = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await nodeStatus();
        if (!alive) return;
        setStatus(s);
        setError(false);
        if (s.blocks != null) setLastBlocks(s.blocks);
        // A newly-added peer: brief yellow flash + low click.
        const p = s.peers ?? 0;
        if (prevPeers.current != null && p > prevPeers.current) {
          setPeerFlash(true);
          playSound("peer");
          setTimeout(() => setPeerFlash(false), 1000);
        }
        prevPeers.current = p;
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
  const caughtUp = phase === "synced" || phase === "staking";

  // Peers: 0 rather than a dash when we simply have none yet.
  const peers = status?.peers ?? 0;

  // Block height: live value when caught up; otherwise the last-known value in
  // grey with a "+?" to show it's behind and still climbing.
  const liveBlocks = caughtUp && status?.blocks != null ? status.blocks : null;
  const showBlocks = liveBlocks ?? lastBlocks;

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
          {showBlocks != null ? (
            liveBlocks != null ? (
              <span>{showBlocks.toLocaleString()}</span>
            ) : (
              <span className="blk-stale">
                {showBlocks.toLocaleString()}
                <span className="blk-more">+?</span>
              </span>
            )
          ) : (
            <span>—</span>
          )}
        </div>
        <div className={"glass-chip px-4 py-2" + (peerFlash ? " peer-flash" : "")}>
          Peers<br />
          <span>{peers}</span>
        </div>
      </div>
    </div>
  );
}
