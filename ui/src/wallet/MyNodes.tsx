import { useEffect, useState } from "react";
import { listNodes, setActiveNode, type NodeInfo } from "./api";

// "My Nodes" settings tab: pick which node the wallet reads. Desktop (this
// computer's Divi node) is always shown; personal nodes such as DIVI LOVE SCAN
// appear only if this machine's nodes.json defines them — so other people who
// install the app never see them.
export function MyNodes() {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [active, setActive] = useState("desktop");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const refresh = () =>
    listNodes()
      .then((r) => {
        setNodes(r.nodes);
        setActive(r.active);
      })
      .catch(() => {});
  useEffect(() => {
    refresh();
  }, []);

  const choose = async (id: string) => {
    if (id === active || busy) return;
    setBusy(id);
    setNote("");
    try {
      await setActiveNode(id);
      setActive(id);
      // Tell the network map to repoint to the newly-active node immediately.
      window.dispatchEvent(new CustomEvent("dd69:nodeswitch"));
      setNote("Switched. The balance and network view update within a few seconds.");
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="set-section">
      <h3 className="set-title">My Nodes</h3>
      <p className="set-note">
        Choose which node this wallet reads. Your balance, transactions, and network map all come from the node you select here.
      </p>
      <div className="mynodes">
        {nodes.map((n) => {
          const isActive = n.id === active;
          return (
            <div key={n.id} className={"mynode" + (isActive ? " mynode-active" : "")}>
              <div className="mynode-head">
                <span className="mynode-dot" />
                <span className="mynode-label">{n.label}</span>
                <span className="mynode-mode">{n.mode === "remote" ? "Remote" : "Local"}</span>
                {isActive && <span className="mynode-badge">Active</span>}
              </div>
              <div className="mynode-meta">
                {n.mode === "remote" ? (
                  <>
                    <div>
                      <span>Host</span>
                      <b>
                        {(n.host || "127.0.0.1")}:{n.port ?? 51473}
                      </b>
                    </div>
                    <div>
                      <span>RPC user</span>
                      <b>{n.user || "—"}</b>
                    </div>
                    <div>
                      <span>Password</span>
                      <b>{n.has_pass ? "•••••• saved" : "not set"}</b>
                    </div>
                  </>
                ) : (
                  <div>
                    <span>Data folder</span>
                    <b>{n.datadir || "This computer's Divi folder"}</b>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="mynode-btn"
                disabled={isActive || busy === n.id}
                onClick={() => choose(n.id)}
              >
                {isActive ? "In use" : busy === n.id ? "Switching…" : "Use this node"}
              </button>
            </div>
          );
        })}
      </div>
      {note && <p className="set-note mynode-note">{note}</p>}
    </section>
  );
}
