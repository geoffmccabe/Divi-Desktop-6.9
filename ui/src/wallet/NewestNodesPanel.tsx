import { useEffect, useRef, useState } from "react";
import { newNodes, ageLabel, type NewNode } from "./newNodes";
import { loadKnown } from "./knownPeers";

// Bottom-right "Newest Nodes" panel: nodes still within their 10-day spiral
// window, newest on top. Hovering/clicking a row highlights its map spiral
// (2x size, 3x spin) via onHighlight. Styled inline to stay out of the shared
// index.css. Reads the same source (newNodes) the map draws from, so they agree.

const shortIp = (ip: string) => {
  const p = ip.split(".");
  return p.length === 4 ? `${p[0]}.${p[1]}…${p[3]}` : ip;
};
const place = (n: NewNode) => {
  const city = n.city?.trim();
  const cc = n.cc?.trim();
  if (city && cc) return `${city}, ${cc}`;
  if (city) return city;
  return n.country?.trim() || "Unknown";
};

// The aqua the spiral uses, as a static swatch colour.
const AQUA = "hsl(177 80% 55%)";

export function NewestNodesPanel({
  onHighlight,
  onClose,
}: {
  onHighlight: (ip: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<NewNode[]>(() => newNodes(loadKnown()));

  // Refresh the list periodically so a node aging out (or a new arrival) shows.
  useEffect(() => {
    const id = setInterval(() => setRows(newNodes(loadKnown())), 15000);
    return () => clearInterval(id);
  }, []);

  // Don't let scroll/click inside the panel zoom or pan the map beneath.
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

  return (
    <div
      ref={ref}
      className="glass-panel"
      onMouseLeave={() => onHighlight(null)}
      style={{
        position: "absolute",
        right: 10,
        top: 10,
        width: 210,
        maxHeight: 260,
        padding: "8px 10px",
        borderRadius: 10,
        fontSize: "0.72rem",
        zIndex: 6,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 700, color: AQUA, letterSpacing: "0.04em" }}>NEWEST NODES</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", opacity: 0.7, fontSize: "0.85rem" }}
        >
          ✕
        </button>
      </div>

      {rows.length === 0 ? (
        <div style={{ opacity: 0.65, padding: "6px 0" }}>No new nodes in the last 10 days.</div>
      ) : (
        <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          {rows.map((n) => (
            <div
              key={n.ip}
              onMouseEnter={() => onHighlight(n.ip)}
              onClick={() => onHighlight(n.ip)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "3px 4px",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              {/* size-scaled swatch: bigger = newer */}
              <span
                style={{
                  flexShrink: 0,
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  border: `1.5px solid ${AQUA}`,
                  boxShadow: `0 0 6px ${AQUA}`,
                  opacity: 0.5 + 0.5 * ((10 - n.ageDays) / 10),
                }}
              />
              <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <div style={{ fontWeight: 600 }}>{place(n)}</div>
                <div style={{ opacity: 0.6, fontFamily: "ui-monospace, monospace", fontSize: "0.66rem" }}>
                  {shortIp(n.ip)}
                </div>
              </span>
              <span style={{ opacity: 0.7, fontSize: "0.66rem", whiteSpace: "nowrap" }}>{ageLabel(n.ageDays)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ opacity: 0.5, fontSize: "0.62rem", marginTop: 2 }}>First seen by your node — not "joined".</div>
    </div>
  );
}
