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
import { snapshotInfo, snapshotFetch, type SnapshotInfo } from "../api";
import { copySetupLog } from "../SetupLogHotkey";
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
  const [copied, setCopied] = useState(false);
  /* The real download. `sim` above is the demo animation; these are the actual
     bytes. The GO button used to set `installing` and nothing else, so the
     panel advertised "fast · ~4.7 GB" and then let the node crawl the chain
     from peers for days. */
  const [snap, setSnap] = useState<SnapshotInfo | null>(null);
  const [dl, setDl] = useState<{ done: number; total: number | null; stage: string } | null>(null);
  const [dlErr, setDlErr] = useState<string | null>(null);
  useEffect(() => {
    snapshotInfo().then(setSnap).catch(() => setSnap(null));
    const ev = (window as unknown as {
      __TAURI__?: { event?: { listen: (n: string, cb: (e: { payload: unknown }) => void) => Promise<() => void> } };
    }).__TAURI__?.event;
    if (!ev) return;
    let un: (() => void) | null = null;
    let dead = false;
    ev.listen("dd69://snapshot-progress", (e) => {
      const p = e.payload as { done?: number; total?: number | null; stage?: string };
      setDl({ done: p.done ?? 0, total: p.total ?? null, stage: p.stage ?? "" });
    }).then((u) => { if (dead) u(); else un = u; }).catch(() => {});
    return () => { dead = true; try { un?.(); } catch { /* gone */ } };
  }, []);

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

  // Simulator progress climb — starts only once the user has picked a method
  // and pressed GO (installing becomes true). No auto-start: they choose first.
  useEffect(() => {
    if (!simulate || !installing) return;
    setSim({ pct: 0, blocks: 0, peers: 0, stage: simStage(0), done: false });
    const id = setInterval(() => {
      setSim((s) => {
        if (s.done) return s;
        const pct = Math.min(100, s.pct + 1.4);
        const blocks = Math.floor((pct / 100) * SIM_TIP);
        const peers = Math.min(8, Math.floor(pct / 12));
        const done = pct >= 100;
        if (done) onStateRef.current?.({ installing: false, method: null }); // stop the flow, node -> gold
        return { pct, blocks, peers, stage: simStage(pct), done };
      });
    }, 220);
    return () => clearInterval(id);
  }, [simulate, installing]);

  const start = (m: SetupMethod) => {
    setInstalling(true);
    setDlErr(null);
    onStateRef.current?.({ installing: true, method: m });
    // SNAPSHOT actually downloads the chain now. NODES is the honest slow path:
    // the node fetches blocks from peers, which needs nothing started here.
    if (m === "snapshot") {
      snapshotFetch()
        .then(() => setDl({ done: 1, total: 1, stage: "Snapshot ready — starting your node." }))
        .catch((e) => {
          setDlErr(String(e));
          setInstalling(false);
          onStateRef.current?.({ installing: false, method: null });
        });
    }
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
            {simulate ? (
              <div className="ip-bar"><div className="ip-bar-fill" style={{ width: `${sim.pct}%` }} /></div>
            ) : dl && dl.total ? (
              <>
                <div className="ip-bar">
                  <div className="ip-bar-fill" style={{ width: `${Math.min(100, (dl.done / dl.total) * 100)}%` }} />
                </div>
                <div className="ip-stat">
                  <span>Downloaded</span>
                  <b>{(dl.done / 1e9).toFixed(2)} of {(dl.total / 1e9).toFixed(2)} GB</b>
                </div>
              </>
            ) : null}
            {!simulate && dl?.stage && (
              <div className="ip-stat"><span>Step</span><b>{dl.stage}</b></div>
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
            {/* What it costs, BEFORE committing to it. This said nothing before, so
                people began a multi-day download with no idea of size or wait. */}
            {snap && (
              <p className="ip-note">
                {method === "snapshot" ? (
                  <>
                    About {snap.bytes ? (snap.bytes / 1e9).toFixed(1) : "4.7"} GB to download, and
                    roughly {snap.needGb} GB free needed while it unpacks. Usually under an hour.
                  </>
                ) : (
                  <>
                    Collects the chain block by block from other nodes. Needs about {snap.needGb} GB
                    free and typically takes <b>a day or more</b>. The snapshot is far faster.
                  </>
                )}{" "}You have {snap.freeGb} GB free.
              </p>
            )}
            {snap && !snap.enoughRoom && (
              <p className="ip-warn">
                Not enough free space on this disk yet ({snap.freeGb} GB free, about {snap.needGb} GB
                needed). Free some space first: a half-finished chain is worse than none.
              </p>
            )}
            {dlErr && <p className="ip-warn">{dlErr}</p>}
            <label className="ip-field-label">Download node data:</label>
            <div className="ip-split" role="group" aria-label="Download method">
              <button
                type="button"
                className={"ip-split-btn" + (method === "snapshot" ? " on" : "")}
                onClick={() => setMethod("snapshot")}
              >
                SNAPSHOT
                <small>
                  fast · {snap?.bytes ? `${(snap.bytes / 1e9).toFixed(1)} GB` : "~4.7 GB"}
                </small>
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
            <button
              type="button"
              className="ip-btn ip-btn-go"
              disabled={!!snap && !snap.enoughRoom}
              onClick={() => start(method)}
            >
              GO →
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

      {/* ============ Diagnostics footer ============ */}
      <footer className="ip-foot">
        <button
          type="button"
          className="ip-link"
          onClick={async () => {
            const ok = await copySetupLog();
            setCopied(ok);
            window.setTimeout(() => setCopied(false), 3000);
          }}
        >
          {copied ? "✓ Setup log copied" : "Copy setup log (⌘L)"}
        </button>
        <span className="ip-foot-hint">Having trouble? Copy this and send it over — it has no private keys.</span>
      </footer>
    </aside>
  );
}
