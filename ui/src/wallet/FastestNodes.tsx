import { useCallback, useEffect, useRef, useState } from "react";
import { pingNodes } from "./api";

export interface FastCandidate {
  ip: string;
  country?: string;
}
interface Ranked extends FastCandidate {
  ms: number;
}

// Show an IP compactly as first.second…last, e.g. 198.46.232.135 -> 198.46…135
function shortIp(ip: string): string {
  const p = ip.split(".");
  return p.length === 4 ? `${p[0]}.${p[1]}…${p[3]}` : ip;
}

// Node speed ranking: time-pings EVERY node the map knows about (a TCP
// round-trip to its P2P port) and orders the reachable ones fastest-first.
// Times are relative to this machine, not an absolute measure of the node.
// Runs only when the user opens the panel or hits rescan — never on a timer.
// Styled like the bottom-left Nodes-by-Country panel.
export function FastestNodes({
  getNodes,
  onClose,
}: {
  getNodes: () => FastCandidate[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<Ranked[] | null>(null); // null = still pinging
  const [total, setTotal] = useState(0);
  const runIdRef = useRef(0);
  // Kept in a ref so a re-render of the map never re-triggers a scan.
  const getNodesRef = useRef(getNodes);
  getNodesRef.current = getNodes;

  // Don't let scroll/click inside the panel zoom or pan the map.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener("wheel", stop, { passive: false });
    el.addEventListener("mousedown", stop);
    return () => {
      el.removeEventListener("wheel", stop);
      el.removeEventListener("mousedown", stop);
    };
  }, []);

  const scan = useCallback(() => {
    const run = ++runIdRef.current;
    const byIp = new Map(getNodesRef.current().map((n) => [n.ip, n]));
    setRows(null);
    setTotal(byIp.size);
    pingNodes([...byIp.keys()])
      .then((res) => {
        if (runIdRef.current !== run) return;
        setRows(
          res
            .filter((r) => r.online && r.ms > 0)
            .sort((a, b) => a.ms - b.ms)
            .map((r) => ({ ip: r.ip, country: byIp.get(r.ip)?.country, ms: r.ms }))
        );
      })
      .catch(() => {
        if (runIdRef.current === run) setRows([]);
      });
  }, []);

  // One scan when the panel opens (the user's click), then only on rescan.
  useEffect(() => {
    scan();
    return () => {
      runIdRef.current++; // drop a scan still in flight when the panel closes
    };
  }, [scan]);

  return (
    <div className="fastnodes" ref={ref}>
      <div className="fn-head">
        <span className="fn-title">Node Speed</span>
        <button
          type="button"
          className="fn-rescan"
          onClick={scan}
          disabled={rows === null}
          title="Ping every known node again"
        >
          ↻
        </button>
        <button type="button" className="fn-close" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      <div className="fn-cols">
        <span>Country</span>
        <span>Node</span>
        <span className="fn-ms-h">ms</span>
      </div>
      <div className="fn-list">
        {rows === null ? (
          <div className="fn-empty">Pinging {total} nodes…</div>
        ) : rows.length === 0 ? (
          <div className="fn-empty">No nodes answered.</div>
        ) : (
          rows.map((r, i) => (
            <div key={r.ip} className="fn-row">
              <span className="fn-country">
                <span className="fn-rank">{i + 1}</span>
                {r.country || "Unknown"}
              </span>
              <span className="fn-ip" title={r.ip}>
                {shortIp(r.ip)}
              </span>
              <span className="fn-ms">{r.ms}</span>
            </div>
          ))
        )}
      </div>
      {rows !== null && (
        <div className="fn-foot">
          {rows.length} of {total} answered
        </div>
      )}
    </div>
  );
}
