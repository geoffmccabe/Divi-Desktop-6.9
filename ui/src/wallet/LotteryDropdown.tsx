import { useEffect, useState } from "react";
import { walletAddresses, lotteryBoard, type LotteryBoard } from "./api";

// Opened from the Next Lottery header: your cumulative lottery block wins on top
// (Big×10 + Small = points), then the leaderboard — top 10 addresses by points.

const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

// Cache the computed leaderboard so it shows instantly and never blanks to
// "no wins" while the (expensive) recompute runs or the node is busy.
const CACHE = "dd69.lotteryBoard";
function loadCache(): LotteryBoard | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE) || "null");
  } catch {
    return null;
  }
}

export function LotteryDropdown({ open }: { open: boolean }) {
  const [render, setRender] = useState(open);
  const [board, setBoard] = useState<LotteryBoard | null>(() => loadCache());
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (open) setRender(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      setScanning(true);
      try {
        const addrs = await walletAddresses();
        const b = await lotteryBoard(addrs.map((a) => a.address));
        // Only replace what we show if the recompute actually returned data —
        // otherwise keep the last-known board rather than blanking it.
        if (alive && b.leaders.length > 0) {
          setBoard(b);
          try {
            localStorage.setItem(CACHE, JSON.stringify(b));
          } catch {
            /* storage full */
          }
        }
      } catch {
        /* keep the cached board */
      } finally {
        if (alive) setScanning(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  if (!render) return null;

  return (
    <div
      className={"stake-dropdown glass-panel" + (open ? " stake-dropdown-open" : "")}
      onTransitionEnd={() => {
        if (!open) setRender(false);
      }}
    >
      <div className="stake-dropdown-inner">
        <div className="lot-mywins">
          <div className="lot-mywins-hdr">Your Lottery Block Wins</div>
          <div className="lot-mywins-row">
            <span className="lot-win-big"><span className="lot-trophy-gold">🏆</span> {board?.yourBig ?? 0} Big (x10)</span>
            <span className="lot-win-small"><span className="lot-trophy-silver">🏆</span> {board?.yourSmall ?? 0} Small</span>
            <span className="lot-total">{(board?.yourPoints ?? 0).toLocaleString()}</span>
          </div>
          {scanning && <div className="stake-scan">Counting lottery wins from the chain…</div>}
        </div>
        <div className="lot-board-hdr">Lottery Leaderboards</div>
        {board === null ? (
          <p className="wl-empty">Loading leaderboard…</p>
        ) : board.leaders.length === 0 ? (
          <p className="wl-empty">No lottery wins found yet.</p>
        ) : (
          <ul className="lot-board">
            {board.leaders.map((e, i) => (
              <li key={i} className="lot-row">
                <div className="lot-row-top">
                  <span className="lot-rank">#{i + 1}</span>
                  <span className="lot-addr">{short(e.address)}</span>
                  <span className="lot-score">{e.points.toLocaleString()}</span>
                </div>
                <div className="lot-row-sub">
                  <span className="lot-trophy-gold">🏆</span> {e.big} Big (10x) · <span className="lot-trophy-silver">🏆</span> {e.small} Small
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
