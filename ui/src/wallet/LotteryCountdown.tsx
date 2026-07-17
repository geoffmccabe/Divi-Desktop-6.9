import { useEffect, useState } from "react";
import { type LotteryInfo } from "./api";

// The next weekly lottery draw: local date/time plus a live countdown that
// ticks every second. The ETA is a block-count estimate (~60s/block), so it's
// labelled approximate and re-syncs whenever the header refetches lottery info.

function fmtCountdown(secs: number): string {
  if (secs <= 0) return "drawing…";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (d > 0 ? `${d}d ` : "") + `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function LotteryCountdown({ info }: { info: LotteryInfo | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!info) {
    return (
      <div className="hdr-lottery">
        <span className="bl-label">Next Lottery</span>
        <span className="lot-when">—</span>
      </div>
    );
  }

  const etaMs = info.nextEta * 1000;
  const remaining = Math.max(0, (etaMs - now) / 1000);
  const when = new Date(etaMs).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="hdr-lottery">
      <span className="bl-label">Next Lottery</span>
      <span className="lot-count">{fmtCountdown(remaining)}</span>
      <span className="lot-when">≈ {when}</span>
    </div>
  );
}
