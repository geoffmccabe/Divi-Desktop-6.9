import { useEffect, useRef, useState } from "react";
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

// Top-10 fastest nodes: time-pings every node the map knows about (a TCP
// round-trip to its P2P port) and ranks the reachable ones. Styled like the
// bottom-left Nodes-by-Country panel. Opened by the lightning icon in the topbar.
export function FastestNodes({ nodes, onClose }: { nodes: FastCandidate[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<Ranked[] | null>(null); // null = still pinging

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

  useEffect(() => {
    let alive = true;
    const byIp = new Map(nodes.map((n) => [n.ip, n]));
    pingNodes([...byIp.keys()])
      .then((res) => {
        if (!alive) return;
        const ranked = res
          .filter((r) => r.online && r.ms > 0)
          .sort((a, b) => a.ms - b.ms)
          .slice(0, 10)
          .map((r) => ({ ip: r.ip, country: byIp.get(r.ip)?.country, ms: r.ms }));
        setRows(ranked);
      })
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [nodes]);

  return (
    <div className="fastnodes" ref={ref}>
      <div className="fn-head">
        <span className="fn-title">Fastest Nodes</span>
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
          <div className="fn-empty">Pinging the network…</div>
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
    </div>
  );
}
