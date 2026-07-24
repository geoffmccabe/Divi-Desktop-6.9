import { useCallback, useEffect, useRef, useState } from "react";
import { nodeStatus, type NodeStatus } from "./bridge";
import { PHASE_COLOR, PHASE_LABEL } from "./status";
import { playSound } from "./sound";
import { Icon } from "./Icon";
import { loadKnown } from "./wallet/knownPeers";
import { onPeerCount } from "./wallet/peerEvents";

// The node status block for the Overview tab. No glass wrapper — it nests
// inside the wallet panel.
export function StatusPanel({ onOpenNetwork }: { onOpenNetwork?: () => void }) {
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [error, setError] = useState(false);
  // Last block height we ever saw, so we can keep showing it (greyed) while the
  // node is behind instead of dropping to a dash.
  const [lastBlocks, setLastBlocks] = useState<number | null>(null);
  // Last peer count we actually read, so a slow RPC spell keeps showing it.
  const [lastPeers, setLastPeers] = useState<number | null>(null);
  // Total nodes discovered across the network (peers + the 30-day known set).
  const [nodeCount, setNodeCount] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);

  // The Peers/Nodes numbers you SEE climb one-by-one toward their real totals, so
  // discovery reads as a live tally instead of snapping (0→79). Each step bumps a
  // token used as a React key to restart a 3-second gold pulse; rapid steps keep
  // it lit and it fades 3s after the last one.
  const [dispPeers, setDispPeers] = useState(0);
  const [dispNodes, setDispNodes] = useState(0);
  const [peerTok, setPeerTok] = useState(0);
  const [nodeTok, setNodeTok] = useState(0);

  // The last status where the node actually answered, so a brief connection miss
  // keeps showing the true state instead of flapping to a scary message.
  const lastGood = useRef<NodeStatus | null>(null);
  const misses = useRef(0);

  // Record a peer reading, whichever source saw it first (status poll or map).
  const notePeers = useCallback((p: number) => setLastPeers(p), []);
  // The map polls peers on its own clock; when it sees one connect, the target
  // here moves at that instant instead of waiting for the next status poll.
  useEffect(() => onPeerCount(notePeers), [notePeers]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await nodeStatus();
        if (!alive) return;
        setError(false);
        setNodeCount(Object.keys(loadKnown()).length); // grows as the map discovers nodes
        const answered = s.peers != null; // got real data back from the node
        const definitive = answered || s.phase === "stopped" || s.phase === "crashed";
        if (answered) lastGood.current = s;

        if (definitive) {
          misses.current = 0;
          setReconnecting(false);
          setStatus(s);
        } else {
          // No answer this cycle. Keep the last real status through short blips;
          // only surface the trouble if it persists (~20s).
          misses.current += 1;
          if (lastGood.current && misses.current < 4) {
            setReconnecting(true);
            setStatus(lastGood.current);
          } else {
            setReconnecting(false);
            setStatus(s);
          }
        }

        if (s.blocks != null) setLastBlocks(s.blocks);
        if (s.peers != null) notePeers(s.peers);
      } catch {
        if (alive) setError(true);
      }
    };
    poll();
    // Poll a bit faster so a new peer shows up close to when it connects.
    const id = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [notePeers]);

  const phase = status?.phase ?? "unreachable";
  const color = PHASE_COLOR[phase] ?? "var(--muted-foreground)";
  const working = phase === "syncing" || phase === "no-peers" || phase === "starting" || phase === "unreachable";
  const caughtUp = phase === "synced" || phase === "staking";

  // Targets the displayed counts climb toward (freshest reading, kept last-good).
  const peersTarget = lastPeers ?? status?.peers ?? 0;
  const nodesTarget = nodeCount;

  // Climb peers by one at a time; gold pulse on every step. The low click only on
  // a genuine single addition, not the startup rush.
  useEffect(() => {
    if (dispPeers === peersTarget) return;
    if (dispPeers > peersTarget) return setDispPeers(peersTarget); // a drop: snap, no pulse
    const gap = peersTarget - dispPeers;
    const t = setTimeout(() => {
      setDispPeers((n) => n + 1);
      setPeerTok((k) => k + 1);
      if (gap === 1) playSound("peer");
    }, 220);
    return () => clearTimeout(t);
  }, [dispPeers, peersTarget]);

  // Climb nodes by one at a time; gold pulse on every step.
  useEffect(() => {
    if (dispNodes === nodesTarget) return;
    if (dispNodes > nodesTarget) return setDispNodes(nodesTarget);
    const t = setTimeout(() => {
      setDispNodes((n) => n + 1);
      setNodeTok((k) => k + 1);
    }, 160);
    return () => clearTimeout(t);
  }, [dispNodes, nodesTarget]);

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
        {reconnecting && <span className="wl-refreshing"> · refreshing…</span>}
      </p>
      <div className="wl-status-chips">
        <div className="wl-chip-row">
          <div className="glass-chip px-4 py-2 blk-chip">
            <span className="chip-label">Block height</span>
            {showBlocks != null ? (
              liveBlocks != null ? (
                <span className="chip-num">{showBlocks.toLocaleString()}</span>
              ) : (
                <span className="chip-num blk-stale">
                  {showBlocks.toLocaleString()}
                  <span className="blk-more">+?</span>
                </span>
              )
            ) : (
              <span className="chip-num">—</span>
            )}
          </div>
        </div>
        <div className="wl-chip-row">
          <button
            type="button"
            className="glass-chip px-4 py-2 peers-chip"
            title="Peers you're connected to"
            onClick={onOpenNetwork}
          >
            <span key={`pl${peerTok}`} className={"chip-label chip-label-peers" + (peerTok ? " gold-flash" : "")}>Peers</span>
            <span key={`pn${peerTok}`} className={"chip-num" + (peerTok ? " gold-flash" : "")}>{dispPeers}</span>
          </button>
          <button
            type="button"
            className="glass-chip px-4 py-2 peers-chip"
            title="All nodes discovered on the network (peers + 30-day known)"
            onClick={onOpenNetwork}
          >
            <span key={`nl${nodeTok}`} className={"chip-label chip-label-nodes" + (nodeTok ? " gold-flash" : "")}>Nodes</span>
            <span key={`nn${nodeTok}`} className={"chip-num" + (nodeTok ? " gold-flash" : "")}>{dispNodes.toLocaleString()}</span>
          </button>
          <button
            type="button"
            className="glass-chip px-4 py-2 peers-chip"
            title="Open the network map"
            onClick={onOpenNetwork}
          >
            <span className="chip-label chip-label-map">Map</span>
            <span className="chip-num chip-map-icon"><Icon name="globe" size={18} /></span>
          </button>
        </div>
      </div>
    </div>
  );
}
