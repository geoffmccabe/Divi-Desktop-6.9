// Admin → Logs. Surfaces the node's connecting/staking logs (the tail of the
// node's own debug.log plus DD69's spawn log) so they can be read and copied when
// something's wrong — exactly what's needed to diagnose "node isn't running" or
// staking issues. Auto-refreshes; a Copy-all button grabs everything at once.

import { useCallback, useEffect, useState } from "react";
import { nodeLogs, type NodeLogs } from "../../bridge";
import "./logs.css";

export function LogsPanel() {
  const [logs, setLogs] = useState<NodeLogs | null>(null);
  const [copied, setCopied] = useState(false);
  const [auto, setAuto] = useState(true);

  const load = useCallback(() => {
    nodeLogs().then(setLogs).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    if (!auto) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load, auto]);

  const copyAll = async () => {
    const text = `=== node debug.log ===\n${logs?.debugTail ?? ""}\n\n=== DD69 spawn.log ===\n${logs?.spawnTail ?? ""}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the boxes below are selectable as a fallback */
    }
  };

  return (
    <div className="value-panel">
      <section className="style-group">
        <h3>Node logs</h3>
        <p className="set-note">
          Detailed connecting &amp; staking logs. When something isn't working, copy these and send
          them over. The boxes are also selectable if the Copy button is blocked.
        </p>
        <div className="logs-actions">
          <button type="button" className="wl-btn" onClick={copyAll}>{copied ? "Copied!" : "Copy all"}</button>
          <button type="button" className="wl-link" onClick={load}>Refresh</button>
          <label className="logs-auto">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            <span>Live</span>
          </label>
        </div>

        <h4 className="logs-h">Node debug log</h4>
        <pre className="logs-box">{logs?.debugTail || "Loading…"}</pre>

        <h4 className="logs-h">Startup log</h4>
        <pre className="logs-box">{logs?.spawnTail || "(empty)"}</pre>
      </section>
    </div>
  );
}
