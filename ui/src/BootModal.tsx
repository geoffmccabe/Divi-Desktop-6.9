// A centered, dismissible overlay shown while the Divi node isn't ready yet, so
// the user always knows what's happening (or what's stuck). It reads the node's
// live phase + headline, shows an elapsed timer so you can see it's alive, warns
// on no-internet or slowness, and offers a "start the node" action when it's
// stopped/crashed. Clears itself once the node is synced/staking.

import { useEffect, useRef, useState } from "react";
import { nodeStatus, restartNode, type NodeStatus } from "./bridge";
import "./boot-modal.css";

// Phases where the node IS ready — the modal hides for these.
const READY = new Set(["synced", "staking"]);

const TITLES: Record<string, string> = {
  stopped: "Your node isn't running",
  crashed: "The node needs repair",
  starting: "Starting your Divi node…",
  "no-peers": "Connecting to the network…",
  syncing: "Syncing the blockchain…",
};

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function BootModal() {
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let alive = true;
    const poll = () => nodeStatus().then((s) => { if (alive) setStatus(s); }).catch(() => {});
    poll();
    const id = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - startedAt.current), 1000);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const phase = status?.phase ?? "starting";
  const ready = READY.has(phase);

  // When the node becomes ready, reset so the modal returns cleanly (with a fresh
  // timer) the next time the node isn't ready.
  useEffect(() => {
    if (ready) {
      setDismissed(false);
      startedAt.current = Date.now();
    }
  }, [ready]);

  if (!status || ready || dismissed) return null;

  const title = TITLES[phase] ?? "Starting…";
  const slow = elapsed > 30000;
  const canStart = phase === "stopped" || phase === "crashed";

  const start = async () => {
    setBusy(true);
    try {
      await restartNode();
    } catch {
      /* the outcome shows up in the live status */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="boot-scrim">
      <div className="boot-card glass-panel">
        <button type="button" className="boot-x" aria-label="Dismiss" onClick={() => setDismissed(true)}>✕</button>
        <div className="boot-spinner" />
        <h2 className="boot-title">{title}</h2>
        <p className="boot-headline">{status.headline}</p>

        <div className="boot-meta">
          <span className="boot-timer">{fmtElapsed(elapsed)}</span>
          {status.blocks != null && <span>block {status.blocks.toLocaleString()}</span>}
          {status.peers != null && <span>{status.peers} {status.peers === 1 ? "peer" : "peers"}</span>}
        </div>

        {!online && (
          <p className="boot-warn">No internet connection — the node can't reach the Divi network. Check your connection.</p>
        )}
        {online && slow && (
          <p className="boot-warn">This is taking longer than usual. It should still get there — a first sync can be slow.</p>
        )}

        {canStart && (
          <button type="button" className="wl-btn boot-start" disabled={busy} onClick={start}>
            {busy ? "Starting…" : "Try to start the node"}
          </button>
        )}
        <button type="button" className="wl-link boot-dismiss" onClick={() => setDismissed(true)}>
          Continue to the wallet
        </button>
      </div>
    </div>
  );
}
