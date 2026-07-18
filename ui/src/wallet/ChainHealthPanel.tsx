import { useEffect, useState } from "react";
import { chainOrphans } from "./api";
import { loadHealth, mergeHealth, healthStats, type ChainHealthStore } from "./chainHealth";

// Settings → CHAIN HEALTH. Reads the node's fork list, keeps our own running
// history of it, and says plainly how the chain is behaving.
//
// Styling leans on the existing settings classes plus inline rules: index.css
// is the file a second agent is most likely to be in at any moment.

const VERDICT_COLOR: Record<string, string> = {
  unknown: "hsl(var(--muted-foreground))",
  normal: "hsl(var(--success))",
  elevated: "hsl(var(--warning))",
  watch: "hsl(var(--warning))",
  serious: "rgb(255, 120, 105)",
};

const ago = (ms: number) => {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

function Stat({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <div style={{ flex: "1 1 90px", minWidth: 90 }}>
      <div style={{ fontSize: "1.15rem", fontWeight: 700, color: tint ?? "hsl(var(--foreground))" }}>{value}</div>
      <div style={{ fontSize: "0.62rem", letterSpacing: "0.08em", opacity: 0.65, textTransform: "uppercase" }}>
        {label}
      </div>
    </div>
  );
}

export function ChainHealthPanel() {
  const [store, setStore] = useState<ChainHealthStore>(() => loadHealth());
  const [reachable, setReachable] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await chainOrphans();
        if (!alive) return;
        if (!r) {
          setReachable(false);
          return;
        }
        setReachable(true);
        setStore(mergeHealth(r));
      } catch {
        if (alive) setReachable(false);
      }
    };
    load();
    const id = setInterval(load, 120000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const s = healthStats(store);
  const tint = VERDICT_COLOR[s.verdict];

  return (
    <section className="set-section">
      <h3 className="set-title">Chain Health</h3>

      {reachable === false ? (
        <p className="set-note">Can't reach the node right now, so this is the last picture we had.</p>
      ) : null}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "10px 0 4px" }}>
        <Stat label="Forks seen" value={s.forkCount.toLocaleString()} />
        <Stat label="Fork rate" value={s.observedBlocks > 0 ? `${s.ratePct.toFixed(2)}%` : "—"} />
        <Stat label="Deepest" value={s.deepest > 0 ? `${s.deepest} blk` : "—"} tint={s.deepest >= 3 ? tint : undefined} />
        <Stat label="Blocks watched" value={s.observedBlocks.toLocaleString()} />
      </div>

      <p className="set-note" style={{ color: tint, fontWeight: 600 }}>
        {s.verdictText}
      </p>

      {s.forkCount > 0 && (
        <>
          <div style={{ fontSize: "0.72rem", margin: "10px 0 4px" }}>
            <strong>{s.followed}</strong> made our node roll back and switch chains ·{" "}
            <strong>{s.witnessed}</strong> we only watched from the outside
          </div>
          <div style={{ fontSize: "0.72rem", opacity: 0.8 }}>
            Fork depth: {s.depths.map(([d, n]) => `${d} block${d === 1 ? "" : "s"} ×${n}`).join(" · ")}
          </div>

          <div style={{ marginTop: 10, maxHeight: 150, overflowY: "auto" }}>
            {store.forks.slice(0, 12).map((f) => {
              const followed = f.status.includes("fork");
              return (
                <div
                  key={f.height}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: "0.7rem",
                    padding: "3px 0",
                    borderBottom: "1px solid hsl(var(--border) / 0.35)",
                  }}
                >
                  <span style={{ fontFamily: "ui-monospace, monospace", opacity: 0.85 }}>
                    #{f.height.toLocaleString()}
                  </span>
                  <span style={{ color: followed ? "rgb(255, 140, 125)" : "hsl(var(--muted-foreground))" }}>
                    {followed ? "we rolled back" : "witnessed"}
                  </span>
                  <span style={{ marginLeft: "auto", opacity: 0.6 }}>{ago(f.firstSeen)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="set-note" style={{ marginTop: 10, fontSize: "0.68rem", opacity: 0.75 }}>
        Forks are normal: two stakers occasionally mint a block at the same height and one loses. Only deep or
        frequent forks suggest a problem. This counts what <em>your</em> node saw — a fork that never reached it is
        invisible here, so this is a view from one vantage point, not the whole network.
      </p>
    </section>
  );
}
