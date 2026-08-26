// Settings → Logs. Two side-by-side streams: the node's own log (left) and the
// app's activity log (right), each with a Copy button. Both are already collapsed
// on the backend (a repeated line shows once, then "[^^ xN]"), so copies stay
// small. Read-only — reading the logs never disturbs the node.

import { useCallback, useEffect, useState } from "react";
import { nodeLogs, type AppLogEntry } from "../bridge";
import "./logs.css";

function fmtTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}

// The app log rendered as text (with the same "[^^ xN]" collapse markers), used
// both for display and for the Copy button.
function appLogText(entries: AppLogEntry[]): string {
  let out = "";
  for (const e of entries) {
    out += `${fmtTime(e.tsMs)} ${e.msg}\n`;
    if (e.count > 1) out += `[^^ x${e.count}]\n`;
  }
  return out;
}

export function LogsPanel() {
  const [nodeLog, setNodeLog] = useState("");
  const [appLog, setAppLog] = useState<AppLogEntry[]>([]);
  const [auto, setAuto] = useState(true);
  const [copied, setCopied] = useState<"" | "node" | "app">("");

  const load = useCallback(() => {
    nodeLogs()
      .then((l) => {
        setNodeLog(l.nodeLog);
        setAppLog(l.appLog);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    if (!auto) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load, auto]);

  const copy = async (which: "node" | "app") => {
    const text = which === "node" ? nodeLog : appLogText(appLog);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* clipboard blocked — the boxes are selectable as a fallback */
    }
  };

  const appText = appLog.length ? appLogText(appLog) : "(no app activity logged yet)";

  return (
    <div className="logs-view">
      <div className="logs-view-head">
        <h3 className="set-title">Logs</h3>
        <label className="logs-auto">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span>Live</span>
        </label>
        <button type="button" className="wl-link" onClick={load}>Refresh</button>
      </div>
      <p className="set-note">
        The node's own log and the app's activity, for troubleshooting. Repeated lines are collapsed
        to a count. Copy either side and send it over.
      </p>

      <div className="logs-cols">
        <div className="logs-col">
          <div className="logs-col-head">
            <span className="logs-col-label">Node Logs</span>
            <button type="button" className="wl-btn logs-copy" onClick={() => copy("node")}>
              {copied === "node" ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre className="logs-box">{nodeLog || "(empty)"}</pre>
        </div>

        <div className="logs-col">
          <div className="logs-col-head">
            <span className="logs-col-label">App Logs</span>
            <button type="button" className="wl-btn logs-copy" onClick={() => copy("app")}>
              {copied === "app" ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre className="logs-box">{appText}</pre>
        </div>
      </div>
    </div>
  );
}
