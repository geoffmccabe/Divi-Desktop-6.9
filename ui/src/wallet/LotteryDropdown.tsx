import { useEffect, useState } from "react";
import { walletAddresses, lotteryWins, lotteryLeaderboard, type LotteryEntry } from "./api";

// Opened from the Next Lottery header: the user's cumulative lottery wins (big /
// small / total) on top, then the live leaderboard — the current top candidates
// for the next draw (from getlotteryblockwinners).

export function LotteryDropdown({ open }: { open: boolean }) {
  const [render, setRender] = useState(open);
  const [wins, setWins] = useState<{ big: number; small: number } | null>(null);
  const [board, setBoard] = useState<LotteryEntry[] | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (open) setRender(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const lb = await lotteryLeaderboard();
        if (alive) setBoard(lb);
      } catch {
        if (alive) setBoard([]);
      }
      try {
        setScanning(true);
        const addrs = await walletAddresses();
        const won = await lotteryWins(addrs.map((a) => a.address));
        if (alive) setWins({ big: won.reduce((s, w) => s + w.big, 0), small: won.reduce((s, w) => s + w.small, 0) });
      } catch {
        /* leave as-is */
      } finally {
        if (alive) setScanning(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  if (!render) return null;
  const total = wins ? wins.big + wins.small : 0;

  return (
    <div
      className={"stake-dropdown glass-panel" + (open ? " stake-dropdown-open" : "")}
      onTransitionEnd={() => {
        if (!open) setRender(false);
      }}
    >
      <div className="stake-dropdown-inner">
        <div className="lot-mywins">
          <div className="lot-mywins-hdr">Your Lottery Wins</div>
          <div className="lot-mywins-row">
            <span className="lot-win-big">🏆 {wins?.big ?? 0} big</span>
            <span className="lot-win-small">🎟 {wins?.small ?? 0} small</span>
            <span className="lot-total">{total.toLocaleString()} total</span>
          </div>
          {scanning && <div className="stake-scan">Counting your wins from the chain…</div>}
        </div>
        <div className="lot-board-hdr">Current Lottery Leaderboard</div>
        {board === null ? (
          <p className="wl-empty">Loading leaderboard…</p>
        ) : board.length === 0 ? (
          <p className="wl-empty">No lottery candidates yet.</p>
        ) : (
          <ul className="lot-board">
            {board.map((e, i) => (
              <li key={i} className="lot-row">
                <span className="lot-rank">#{e.rank + 1}</span>
                <span className="lot-addr">{e.address}</span>
                <span className="lot-score">{e.score}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
