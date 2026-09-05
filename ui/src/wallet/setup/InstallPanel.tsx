// The first-run install side-panel. It sits to the LEFT of the network map
// (the map shrinks to make room) so a new user feels like they're already
// inside the app, watching themselves join the network while it sets up.
//
// Three stacked sections; only the first is active:
//   1. DD69            - the wallet/node itself. Shows the right flow for the
//                        user's "track" (brand-new, Divi Desktop 2.0 found, or
//                        already set up).
//   2. DIVA CHAIN      - a second EVM-style chain (greyed, "coming soon").
//   3. DIVI STORAGE    - Arweave-style paid storage that earns DIVI (greyed).
//
// `simulate` (Cmd/Ctrl-N from the map) pretends this is a brand-new install and
// plays the whole sequence WITHOUT touching the real wallet/node or downloading
// anything - so nothing needs cleaning up afterwards.

import { useEffect, useRef, useState } from "react";
import { setupInfo, nodeStatus, type SetupInfo, type NodeStatus } from "../../bridge";
import "./install-panel.css";

export type SetupMethod = "snapshot" | "nodes" | "reuse" | null;
export type InstallState = { installing: boolean; method: SetupMethod };

// A synthetic "brand-new machine" reading for the Cmd-N simulator.
const SIM_INFO: SetupInfo = {
  track: "new", needsSetup: true, dd69HasChain: false,
  dd2HasChain: false, dd2HasWallet: false, dd2ChainGb: 0, sameVolume: false,
};

type Sim = { pct: number; blocks: number; peers: number; stage: string; done: boolean };
const SIM_TIP = 4_201_700; // a believable chain tip for the fake climb

function simStage(pct: number): string {
  if (pct >= 100) return "Synced — you're on the network!";
  if (pct >= 92) return "Catching up the latest blocks…";
  if (pct >= 80) return "Verifying the download…";
  if (pct >= 8) return `Downloading snapshot… ${Math.floor(((pct - 8) / 72) * 100)}%`;
  return "Contacting the Divi snapshot server…";
}

export function InstallPanel({
  simulate = false,
  onClose,
  onStateChange,
}: {
  simulate?: boolean;
  onClose: () => void;
  onStateChange?: (s: InstallState) => void;
}) {
  const [realInfo, setRealInfo] = useState<SetupInfo | null>(null);
  const [method, setMethod] = useState<Exclude<SetupMethod, "reuse" | null>>("snapshot"); // SNAPSHOT default
  const [goFresh, setGoFresh] = useState(false); // a DD2.0 user chose to download fresh instead
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [sim, setSim] = useState<Sim>({ pct: 0, blocks: 0, peers: 0, stage: simStage(0), done: false });
  const onStateRef = useRef(onStateChange);
  onStateRef.current = onStateChange;

  const info = simulate ? SIM_INFO : realInfo;

  useEffect(() => {
    if (!simulate) setupInfo().then(setRealInfo).catch(() => {});
  }, [simulate]);

  // Real installs (Phase 1: visual only) poll the node for honest progress text.
  useEffect(() => {
    if (!installing || simulate) return;
    let alive = true;
    const tick = () => nodeStatus().then((s) => { if (alive) setStatus(s); }).catch(() => {});
    tick();
    const id = setInterval(tick, 2500);
    return () => { alive = false; clearInterval(id); };
  }, [installing, simulate]);

  // Simulator: auto-start the sequence and drive a scripted progress climb.
  useEffect(() => {
    if (!simulate) return;
    setInstalling(true);
    onStateRef.current?.({ installing: true, method: "snapshot" });
    setSim({ pct: 0, blocks: 0, peers: 0, stage: simStage(0), done: false });
    const id = setInterval(() => {
      setSim((s) => {
        if (s.done) return s;
        const pct = Math.min(100, s.pct + 1.4);
        const blocks = Math.floor((pct / 100) * SIM_TIP);
        const peers = Math.min(8, Math.floor(pct / 12));
        const done = pct >= 100;
        if (done) onStateRef.current?.({ installing: false, method: "snapshot" }); // node -> gold
        return { pct, blocks, peers, stage: simStage(pct), done };
      });
    }, 220);
    return () => {
      clearInterval(id);
      setInstalling(false);
      onStateRef.current?.({ installing: false, method: null });
    };
  }, [simulate]);

  // Start a real setup (download/import lands in the next slice). For now this
  // flips into the "installing" look so the red node + progress area come alive.
  const start = (m: SetupMethod) => {
    setInstalling(true);
    onStateRef.current?.({ installing: true, method: m });
  };

  if (!info) {
    return (
      <aside className="ip-panel glass-panel">
        <div className="ip-loading">Checking your system…</div>
      </aside>
    );
  }

  const track = goFresh ? "new" : info.track;
  const simDone = simulate && sim.done;

  return (
    <aside className="ip-panel glass-panel">
      <header className="ip-head">
        <h2 className="ip-title">Set up your Divi wallet</h2>
        <button type="button" className="ip-close" title="Close" onClick={onClose}>×</button>
      </header>
      {simulate && <div className="ip-sim-badge">SIMULATION · ⌘N to exit</div>}

      {/* ============ 1. DD69 (active) ============ */}
      <section className="ip-sec ip-sec-active">
        <div className="ip-sec-head">
          <span className={"ip-sec-dot " + (simDone || (!installing && track === "ready") ? "ip-dot-on" : installing ? "ip-dot-busy" : "ip-dot-on")} />
          <h3 className="ip-sec-name">DD69 · Wallet &amp; Node</h3>
        </div>

        {installing || simDone ? (
          <div className="ip-progress">
            <p className="ip-lead">
              {simDone
                ? "You're all set up!"
                : method === "snapshot" || info.track === "dd2"
                ? "Bringing in the blockchain…"
                : "Reaching out to the network…"}
            </p>
            {simulate && (
              <div className="ip-bar"><div className="ip-bar-fill" style={{ width: `${sim.pct}%` }} /></div>
            )}
            <div className="ip-stat">
              <span>Status</span>
              <b>{simulate ? sim.stage : status?.headline ?? "Starting…"}</b>
            </div>
            <div className="ip-stat">
              <span>Block height</span>
              <b>{simulate ? sim.blocks.toLocaleString() : status?.blocks?.toLocaleString() ?? "—"}</b>
            </div>
            <div className="ip-stat">
              <span>Peers</span>
              <b>{simulate ? sim.peers : status?.peers ?? "—"}</b>
            </div>
            <p className="ip-note">
              {simDone ? "That's you, live on the Divi network." : "Watch the map — that's you joining the Divi network."}
            </p>
          </div>
        ) : track === "ready" ? (
          <div className="ip-flow">
            <p className="ip-lead">✓ Your node is set up and synced.</p>
            <p className="ip-note">Everything's running. Press ⌘N to preview what a brand-new user sees.</p>
            <button type="button" className="ip-btn" onClick={onClose}>Close</button>
          </div>
        ) : track === "dd2" ? (
          <div className="ip-flow">
            <p className="ip-lead">We found <b>Divi Desktop 2.0</b> on this computer.</p>
            <p className="ip-note">
              We can reuse its blockchain{info.dd2ChainGb > 0 ? ` (${info.dd2ChainGb.toFixed(1)} GB)` : ""}
              {info.dd2HasWallet ? " and your existing wallet" : ""}, so you skip the long download and
              see your DIVI right away. Your old app is left untouched.
            </p>
            <button type="button" className="ip-btn ip-btn-primary" onClick={() => start("reuse")}>
              Use my existing Divi data{info.sameVolume ? " (instant)" : ""} →
            </button>
            <button type="button" className="ip-link" onClick={() => setGoFresh(true)}>
              Download a fresh copy instead
            </button>
          </div>
        ) : (
          <div className="ip-flow">
            <p className="ip-lead">Let's get your node running.</p>
            <label className="ip-field-label">Download node data:</label>
            <div className="ip-split" role="group" aria-label="Download method">
              <button
                type="button"
                className={"ip-split-btn" + (method === "snapshot" ? " on" : "")}
                onClick={() => setMethod("snapshot")}
              >
                SNAPSHOT
                <small>fast · ~4.7 GB</small>
              </button>
              <button
                type="button"
                className={"ip-split-btn" + (method === "nodes" ? " on" : "")}
                onClick={() => setMethod("nodes")}
              >
                NODES
                <small>slower · trustless</small>
              </button>
            </div>
            <p className="ip-note">
              {method === "snapshot"
                ? "Grabs a daily snapshot of the chain from the Divi server, then catches up the last few blocks. Much faster."
                : "Builds the chain block-by-block directly from other nodes. Slower, but trusts no single source."}
            </p>
            <button type="button" className="ip-btn ip-btn-primary" onClick={() => start(method)}>
              Start setup →
            </button>
            {(goFresh && (info.track === "dd2")) && (
              <button type="button" className="ip-link" onClick={() => setGoFresh(false)}>
                ← Back to reusing my Divi Desktop 2.0 data
              </button>
            )}
          </div>
        )}
      </section>

      {/* ============ 2. DIVA CHAIN (greyed) ============ */}
      <section className="ip-sec ip-sec-soon">
        <div className="ip-sec-head">
          <span className="ip-sec-dot" />
          <h3 className="ip-sec-name">DIVA Chain · EVM node</h3>
          <span className="ip-soon">Coming soon</span>
        </div>
        <p className="ip-note">
          Run a second, EVM-style chain from your computer — the same smart-contract world as Ethereum,
          powered by Divi. Helps secure the network and can earn you rewards.
        </p>
      </section>

      {/* ============ 3. DIVI STORAGE (greyed) ============ */}
      <section className="ip-sec ip-sec-soon">
        <div className="ip-sec-head">
          <span className="ip-sec-dot" />
          <h3 className="ip-sec-name">DIVI Storage · earn fees</h3>
          <span className="ip-soon">Coming soon</span>
        </div>
        <p className="ip-note">
          Rent out spare disk space for permanent, Arweave-style paid storage and earn DIVI in fees
          whenever others store data through you.
        </p>
      </section>
    </aside>
  );
}
