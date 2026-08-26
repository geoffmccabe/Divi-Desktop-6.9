// A centered, dismissible overlay shown while the Divi node isn't ready, so the
// user always knows what's happening (or what's stuck). It reads the node's live
// phase, shows an elapsed timer, warns on no-internet or slowness, and offers a
// "start the node" action when it's stopped/crashed. Clears once synced/staking.
//
// Crucially it DEBOUNCES: the node has brief RPC misses every ~20s that flip the
// phase to "starting" for a single cycle. We only show after the node has been
// not-ready for several consecutive polls, so those blips don't flash the modal.

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

const SUBTITLES: Record<string, string> = {
  stopped: "The node has stopped. You can start it again below.",
  crashed: "The node hit a problem — starting it again will try to repair it.",
  starting: "Getting the node up and connecting to the network…",
  "no-peers": "Looking for peers on the Divi network…",
  syncing: "Catching up on the latest blocks…",
};

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function BootModal() {
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [visible, setVisible] = useState(false);
  const [shownSince, setShownSince] = useState(0);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  const streak = useRef(0);       // consecutive not-ready polls
  const everReady = useRef(false); // has the node been ready at least once this session
  const dismissed = useRef(false); // user chose "continue" for the current not-ready episode
  const wasVisible = useRef(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let s: NodeStatus | null = null;
      try {
        s = await nodeStatus();
      } catch {
        streak.current += 1; // a failed poll counts as not-ready, but softly
      }
      if (!alive) return;
      if (s) {
        setStatus(s);
        if (READY.has(s.phase)) {
          streak.current = 0;
          everReady.current = true;
          dismissed.current = false; // fresh episode may show later
        } else {
          streak.current += 1;
        }
      }
      const ready = s ? READY.has(s.phase) : false;
      const show = !ready && !dismissed.current && streak.current >= 2;
      if (show && !wasVisible.current) setShownSince(Date.now());
      wasVisible.current = show;
      setVisible(show);
    };
    // Poll quickly during the initial boot for responsiveness, then back right
    // off once the node has been healthy — frequent polling piles up RPC
    // connections and can wedge the node. Recursive timeout, not setInterval.
    const loop = async () => {
      await poll();
      if (!alive) return;
      timer = setTimeout(loop, everReady.current ? 15000 : 3000);
    };
    loop();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
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

  if (!visible || !status) return null;

  const phase = status.phase;
  const title = TITLES[phase] ?? "Starting…";
  const subtitle = SUBTITLES[phase] ?? "Getting things ready…";
  const elapsed = now - shownSince;
  const slow = elapsed > 30000;
  const canStart = phase === "stopped" || phase === "crashed";

  const dismiss = () => {
    dismissed.current = true;
    wasVisible.current = false;
    setVisible(false);
  };

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
        <button type="button" className="boot-x" aria-label="Dismiss" onClick={dismiss}>✕</button>
        <div className="boot-spinner" />
        <h2 className="boot-title">{title}</h2>
        <p className="boot-headline">{subtitle}</p>

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
        <button type="button" className="wl-link boot-dismiss" onClick={dismiss}>
          Continue to the wallet
        </button>
      </div>
    </div>
  );
}
