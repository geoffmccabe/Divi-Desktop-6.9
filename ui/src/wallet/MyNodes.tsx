import { useEffect, useState } from "react";
import { listNodes, setActiveNode, nodeIdentity, setNodeName, setNodeLabel, restartNode, type NodeInfo } from "./api";
import { setActiveNodeId } from "./activeNode";

// "My Nodes" settings tab: pick which node the wallet reads. Desktop (this
// computer's Divi node) is always shown; personal nodes such as DIVI LOVE SCAN
// appear only if this machine's nodes.json defines them — so other people who
// install the app never see them.
export function MyNodes() {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [active, setActive] = useState("desktop");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // This computer's node identity: a stable id + a fun, user-chosen name.
  const [nodeId, setNodeId] = useState("");
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameNote, setNameNote] = useState("");

  const refresh = () =>
    listNodes()
      .then((r) => {
        setNodes(r.nodes);
        setActive(r.active);
        setActiveNodeId(r.active);
      })
      .catch(() => {});
  /* The name box belongs to whichever node is ACTIVE. The desktop node's
     name is this install's identity (and is announced by the local node);
     a remote node's name is its label. It used to show the desktop node's
     name whatever was selected. */
  const loadNameFor = (activeId: string, list: NodeInfo[]) => {
    if (activeId === "desktop") {
      nodeIdentity()
        .then((i) => { setNodeId(i.id); setName(i.name); setSavedName(i.name); })
        .catch(() => {});
    } else {
      const n = list.find((x) => x.id === activeId);
      setNodeId("");
      setName(n?.label ?? "");
      setSavedName(n?.label ?? "");
    }
  };
  useEffect(() => {
    listNodes()
      .then((r) => {
        setNodes(r.nodes);
        setActive(r.active);
        setActiveNodeId(r.active);
        loadNameFor(r.active, r.nodes);
      })
      .catch(() => {});
  }, []);

  const saveName = async () => {
    if (nameBusy) return;
    setNameBusy(true);
    setNameNote("");
    try {
      if (active === "desktop") {
        const i = await setNodeName(name.trim(), "custom");
        setName(i.name);
        setSavedName(i.name);
        // Let the map pick up the new name immediately.
        window.dispatchEvent(new CustomEvent("dd69:nodename", { detail: i }));
        setNameNote(i.name ? "Saved. Announced to the network at the node's next restart." : "Name cleared.");
      } else {
        await setNodeLabel(active, name.trim());
        setSavedName(name.trim());
        await refresh();
        setNameNote("Saved.");
      }
    } catch (e) {
      setNameNote(String(e));
    } finally {
      setNameBusy(false);
    }
  };

  useEffect(() => {
    if (active) loadNameFor(active, nodes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const choose = async (id: string) => {
    if (id === active || busy) return;
    setBusy(id);
    setNote("");
    try {
      await setActiveNode(id);
      /* Bring the chosen node up NOW. Switching used to only record the
         choice; the local node then sat stopped until the watchdog noticed
         a minute later, and in the meantime the map called it "gone quiet".
         Geoff, 2026-Sep-22: switched back to Desktop, copied a warning
         thirteen seconds into a start that takes two minutes. */
      void restartNode().catch(() => {});
      setActive(id);
      setActiveNodeId(id);
      /* Everyone: the map repoints, and the shell remounts every panel so
         nothing from the old node stays on screen (see Shell). */
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

      {/* This computer's node name — a fun label that rides with a stable id, so
          your node stays "one node" even when your IP changes as you travel. */}
      <div className="nodename-box">
        <label className="nodename-label" htmlFor="nodename-input">
          Node name{active && active !== "desktop" ? ` for ${nodes.find((n) => n.id === active)?.label ?? active}` : " for this computer's node"}
        </label>
        <div className="nodename-row">
          <input
            id="nodename-input"
            className="nodename-input"
            type="text"
            maxLength={40}
            placeholder="Name your node (optional, just for fun)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveName(); }}
          />
          <button
            type="button"
            className="nodename-save"
            disabled={nameBusy || name.trim() === savedName.trim()}
            onClick={saveName}
          >
            {nameBusy ? "Saving…" : "Save"}
          </button>
        </div>
        <p className="set-note nodename-hint">
          This shows on the network map for your node. It's a nickname, not proof of identity — later you'll be
          able to use your node's registered Agent name instead.{nodeId ? ` Node id: ${nodeId}` : ""}
        </p>
        {nameNote && <p className="set-note mynode-note">{nameNote}</p>}
      </div>

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
