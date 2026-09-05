// The first-run install side-panel. It sits to the LEFT of the network map
// (the map shrinks to make room) so a new user feels like they're already
// inside the app, watching themselves join the network while it sets up.
//
// Three stacked sections; only the first is active:
//   1. DD69            - the wallet/node itself. Shows the right flow for the
//                        user's "track" (brand-new, or Divi Desktop 2.0 found).
//   2. DIVA CHAIN      - a second EVM-style chain (greyed, "coming soon").
//   3. DIVI STORAGE    - Arweave-style paid storage that earns DIVI (greyed).
//
// Phase 1: the panel, the sections, track detection, and the SNAPSHOT/NODES
// choice are live; the flashing-red node is driven from here. The actual
// download/import and the flowing-hex animations land in the next slices.

import { useEffect, useState } from "react";
import { setupInfo, nodeStatus, type SetupInfo, type NodeStatus } from "../../bridge";
import "./install-panel.css";

export type SetupMethod = "snapshot" | "nodes" | "reuse" | null;
export type InstallState = { installing: boolean; method: SetupMethod };

export function InstallPanel({
  onClose,
  onStateChange,
}: {
  onClose: () => void;
  onStateChange?: (s: InstallState) => void;
}) {
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [method, setMethod] = useState<Exclude<SetupMethod, "reuse" | null>>("snapshot"); // SNAPSHOT default
  const [goFresh, setGoFresh] = useState(false); // a DD2.0 user chose to download fresh instead
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState<NodeStatus | null>(null);

  useEffect(() => {
    setupInfo().then(setInfo).catch(() => {});
  }, []);

  // While installing, poll the node so we can show honest progress text.
  useEffect(() => {
    if (!installing) return;
    let alive = true;
    const tick = () => nodeStatus().then((s) => { if (alive) setStatus(s); }).catch(() => {});
    tick();
    const id = setInterval(tick, 2500);
    return () => { alive = false; clearInterval(id); };
  }, [installing]);

  const emit = (s: InstallState) => onStateChange?.(s);

  // Start (real download/import lands next slice). For now this flips into the
  // "installing" look so the red node + progress area come alive.
  const start = (m: SetupMethod) => {
    setInstalling(true);
    emit({ installing: true, method: m });
  };

  if (!info) {
    return (
      <aside className="ip-panel glass-panel">
        <div className="ip-loading">Checking your system…</div>
      </aside>
    );
  }

  const track = goFresh ? "new" : info.track;

  return (
    <aside className="ip-panel glass-panel">
      <header className="ip-head">
        <h2 className="ip-title">Set up your Divi wallet</h2>
        <button type="button" className="ip-close" title="Close" onClick={onClose}>×</button>
      </header>

      {/* ============ 1. DD69 (active) ============ */}
      <section className="ip-sec ip-sec-active">
        <div className="ip-sec-head">
          <span className="ip-sec-dot ip-dot-on" />
          <h3 className="ip-sec-name">DD69 · Wallet &amp; Node</h3>
        </div>

        {installing ? (
          <div className="ip-progress">
            <p className="ip-lead">
              {method === "snapshot" || info.track === "dd2"
                ? "Bringing in the blockchain…"
                : "Reaching out to the network…"}
            </p>
            <div className="ip-stat">
              <span>Status</span><b>{status?.headline ?? "Starting…"}</b>
            </div>
            <div className="ip-stat">
              <span>Block height</span><b>{status?.blocks?.toLocaleString() ?? "—"}</b>
            </div>
            <div className="ip-stat">
              <span>Peers</span><b>{status?.peers ?? "—"}</b>
            </div>
            <p className="ip-note">Watch the map — that's you joining the Divi network.</p>
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
            {goFresh && (
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
