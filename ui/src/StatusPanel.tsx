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
  // Last peer count we actually read, so a slow RPC spell keeps showing it
  // instead of dropping to 0.
  const [lastPeers, setLastPeers] = useState<number | null>(null);
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
        if (s.peers != null) setLastPeers(s.peers);
        // A newly-added peer: brief yellow flash + low click. Only compare when
        // we actually got a fresh reading, so a missed poll doesn't false-flash.
        if (s.peers != null) {
          const p = s.peers;
          if (prevPeers.current != null && p > prevPeers.current) {
            setPeerFlash(true);
            playSound("peer");
            setTimeout(() => setPeerFlash(false), 1000);
          }
          prevPeers.current = p;
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
  const caughtUp = phase === "synced" || phase === "staking";

  // Peers: the fresh reading, else the last one we saw, else 0 (never a dash).
  const peers = status?.peers ?? lastPeers ?? 0;

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
