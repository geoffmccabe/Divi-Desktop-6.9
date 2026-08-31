// Settings → Logs. A single time-ordered stream merging the node's own log and
// the app's activity log, styled like an old-school CRT terminal: node lines in
// fluorescent green, app lines in amber, on near-black. Both streams are already
// collapsed on the backend (a repeated line shows once, then "[^^ xN]"). Merge +
// coloring happen here in the dashboard; reading the logs never disturbs the node.

import { useCallback, useEffect, useMemo, useState } from "react";
import { nodeLogs, type AppLogEntry } from "../bridge";
import "./logs.css";

type Line = { tsMs: number; source: "node" | "app"; msg: string; count: number };

function fmtTime(ms: number): string {
  if (!ms) return "--:--:--";
  try {
    return new Date(ms).toLocaleTimeString();
  } catch {
    return "";
  }
}

// Parse the backend's collapsed node-log text into structured lines. Node lines
// look like "2026-08-26 12:19:47 <message>", optionally followed by "[^^ xN]".
function parseNode(text: string): Line[] {
  const lines = text.split("\n");
  const out: Line[] = [];
  let lastTs = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("[^^ ")) continue;
    const m = line.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (.*)$/);
    let tsMs: number;
    let msg: string;
    if (m) {
      // The node writes its log in UTC; parse it as UTC so it lines up with the
      // app log's absolute timestamps (both then display in local time).
      tsMs = new Date(`${m[1]}T${m[2]}Z`).getTime();
      msg = m[3];
      lastTs = tsMs;
    } else {
      tsMs = lastTs; // continuation line — keep it next to its parent
      msg = line;
    }
    let count = 1;
    const next = lines[i + 1];
    if (next && next.startsWith("[^^ x")) {
      const c = next.match(/\[\^\^ x(\d+)\]/);
      if (c) count = parseInt(c[1], 10);
      i++; // consume the marker line
    }
    out.push({ tsMs, source: "node", msg, count });
  }
  return out;
}

export function LogsPanel() {
  const [nodeLog, setNodeLog] = useState("");
  const [appLog, setAppLog] = useState<AppLogEntry[]>([]);
  const [auto, setAuto] = useState(true);
  const [copied, setCopied] = useState("");
  const [filter, setFilter] = useState<"all" | "node" | "app">("all");

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

  const merged = useMemo<Line[]>(() => {
    const node = parseNode(nodeLog);
    const app: Line[] = appLog.map((e) => ({ tsMs: e.tsMs, source: "app", msg: e.msg, count: e.count }));
    return [...node, ...app].sort((a, b) => a.tsMs - b.tsMs);
  }, [nodeLog, appLog]);

  // What the terminal actually renders: the whole stream, or just one source.
  // The node is a firehose and the app a trickle, so "App" is how you read the
  // app's own events without hunting for them among the node's lines.
  const shown = useMemo<Line[]>(
    () => (filter === "all" ? merged : merged.filter((l) => l.source === filter)),
    [merged, filter],
  );

  const toText = (lines: Line[]) =>
    lines
      .map((l) => {
        const head = `${fmtTime(l.tsMs)} ${l.source === "node" ? "[node]" : "[app] "} ${l.msg}`;
        return l.count > 1 ? `${head}\n[^^ x${l.count}]` : head;
      })
      .join("\n");

  const copy = async (which: "all" | "node" | "app") => {
    const lines = which === "all" ? merged : merged.filter((l) => l.source === which);
    try {
      await navigator.clipboard.writeText(toText(lines));
      setCopied(which);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* clipboard blocked — the terminal is selectable as a fallback */
    }
  };

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
      <div className="logs-copybar">
        <div className="logs-filter">
          <button type="button" className={"wl-btn" + (filter === "all" ? " wl-btn-on" : "")} onClick={() => setFilter("all")}>All</button>
          <button type="button" className={"wl-btn logs-key-node" + (filter === "node" ? " wl-btn-on" : "")} onClick={() => setFilter("node")}>Node</button>
          <button type="button" className={"wl-btn logs-key-app" + (filter === "app" ? " wl-btn-on" : "")} onClick={() => setFilter("app")}>App</button>
        </div>
        <span className="logs-spacer" />
        <button type="button" className="wl-btn" onClick={() => copy("all")}>{copied === "all" ? "Copied!" : "Copy all"}</button>
        <button type="button" className="wl-btn" onClick={() => copy("node")}>{copied === "node" ? "Copied!" : "Copy node"}</button>
        <button type="button" className="wl-btn" onClick={() => copy("app")}>{copied === "app" ? "Copied!" : "Copy app"}</button>
      </div>

      <div className="logs-crt">
        {shown.length === 0 && <div className="logs-empty">{filter === "app" ? "(no app events logged yet)" : "(no activity logged yet)"}</div>}
        {shown.map((l, i) => (
          <div key={i} className={l.source === "node" ? "logs-line logs-node" : "logs-line logs-app"}>
            <span className="logs-ts">{fmtTime(l.tsMs)}</span>{" "}
            <span className="logs-tag">{l.source === "node" ? "[node]" : "[app] "}</span>{" "}
            <span className="logs-msg">{l.msg}</span>
            {l.count > 1 && <span className="logs-rep"> [^^ x{l.count}]</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
