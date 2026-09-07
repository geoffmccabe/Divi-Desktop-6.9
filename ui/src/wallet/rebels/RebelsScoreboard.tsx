// The high score tables, as a modal over the launch screen.
//
// Two of them, and they answer different questions. BEST is "what is the
// greatest run anyone has had"; TOTAL is "who has scored the most, ever",
// which anyone can climb by playing a lot rather than by getting lucky once.

import { useEffect, useMemo, useState } from "react";
import { topByBest, topByTotal, playerName, fetchTop, type ScoreRow } from "./rebelsScores";

export function RebelsScoreboard({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"best" | "total">("best");
  const me = useMemo(() => playerName(), []);
  /* This wallet's own copy first, so the table is never blank while the
     network answers, then the real one when it arrives. */
  const local: ScoreRow[] = useMemo(
    () => (tab === "best" ? topByBest() : topByTotal()),
    [tab],
  );
  const [remote, setRemote] = useState<ScoreRow[] | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let live = true;
    setRemote(null);
    setOffline(false);
    fetchTop(tab).then((rows) => {
      if (!live) return;
      if (rows) setRemote(rows); else setOffline(true);
    });
    return () => { live = false; };
  }, [tab]);
  const rows = remote ?? local;

  return (
    <div className="orbit-card orbit-scores">
      <h2>HIGH SCORES</h2>
      <div className="rs-tabs" role="group">
        <button type="button" className={tab === "best" ? "on" : ""} onClick={() => setTab("best")}>
          BEST GAME
        </button>
        <button type="button" className={tab === "total" ? "on" : ""} onClick={() => setTab("total")}>
          ALL TIME
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="orbit-keys">Nothing yet. Fly a sortie and put a number up.</p>
      ) : (
        <ol className="rs-list">
          {rows.map((r, i) => (
            <li key={r.name} className={r.name === me ? "rs-me" : ""}>
              <span className="rs-rank">{i + 1}</span>
              <span className="rs-name" title={r.name}>{r.name}</span>
              <span className="rs-pts">
                {(tab === "best" ? r.best : r.total).toLocaleString()}
              </span>
              {tab === "total" && <span className="rs-games">{r.games} runs</span>}
            </li>
          ))}
        </ol>
      )}

      <p className="orbit-keys rs-note">
        {offline
          ? "Showing this wallet's own copy: the network could not be reached."
          : "One place per player on each table, so nobody can take more than one."}
      </p>
      <button type="button" onClick={onClose}>BACK</button>
    </div>
  );
}
