import { useCallback, useEffect, useState } from "react";
import {
  screening, saveScreening, replayScreening,
  type Screening, type ReplayResult,
} from "../../builder/api";

// Admin, Screening: tune what gets blocked before it reaches the AI, and see
// what people actually tried.
//
// The point of this panel is the log. Rules written from imagination catch
// imaginary attacks; the only honest way to tune them is against real attempts,
// which is why every message is kept word for word and why Test changes exists:
// it re-runs the whole history against your edits and tells you exactly what
// would have changed, before anything is saved.

export function ScreeningPanel() {
  const [data, setData] = useState<Screening | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [flag, setFlag] = useState(40);
  const [block, setBlock] = useState(70);
  const [replay, setReplay] = useState<ReplayResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    setError(null);
    screening()
      .then((d) => {
        setData(d);
        setFlag(d.thresholds.flag);
        setBlock(d.thresholds.block);
        setWeights(Object.fromEntries(d.rules.map((r) => [r.id, r.weight])));
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(load, [load]);

  const save = async () => {
    setBusy(true);
    try {
      await saveScreening({ thresholds: { flag, block }, weights });
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      // Saves first, so the replay reflects what is on screen rather than what
      // was last stored. Showing a result for settings the admin cannot see
      // would be worse than useless.
      await saveScreening({ thresholds: { flag, block }, weights });
      setReplay(await replayScreening());
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="admin-panel">
        <p className="wl-note">
          The app builder service is not running, so there is nothing to tune yet.
          Open App Builder in the menu and it will tell you what it needs.
        </p>
        <p className="wl-note ai-security">{error}</p>
        <button type="button" className="wl-btn" onClick={load}>Try again</button>
      </div>
    );
  }

  if (!data) return <div className="admin-panel"><p className="wl-note">Loading…</p></div>;

  const blocked = data.recent.filter((e) => e.verdict === "block").length;
  const flagged = data.recent.filter((e) => e.verdict === "flag").length;

  return (
    <div className="admin-panel">
      <p className="wl-note">
        Requests are scored against the list below. Anything at or above the block
        level is refused before it reaches the AI, so it costs nothing.
      </p>
      <p className="wl-note ai-security">
        This is not what keeps people safe on its own. The AI can only write files
        into one folder, with no shell and no internet, and that is what actually
        contains a bad request. Treat this as a filter that saves money and
        catches the obvious, not as a wall.
      </p>

      <h3 className="ai-section-head">Levels</h3>
      <label className="admin-field">
        <span>Warn at {flag}</span>
        <input type="range" min={0} max={200} step={5} value={flag}
          onChange={(e) => setFlag(Number(e.target.value))} />
      </label>
      <label className="admin-field">
        <span>Block at {block}</span>
        <input type="range" min={5} max={250} step={5} value={block}
          onChange={(e) => setBlock(Number(e.target.value))} />
      </label>
      {block <= flag && (
        <p className="wl-note" style={{ color: "hsl(var(--destructive))" }}>
          The block level has to be above the warn level.
        </p>
      )}

      <h3 className="ai-section-head">What it looks for</h3>
      {data.rules.map((r) => (
        <label className="admin-field" key={r.id}>
          <span>{r.why} <em className="ai-unset">({weights[r.id] ?? r.weight})</em></span>
          <input
            type="range" min={0} max={120} step={5}
            value={weights[r.id] ?? r.weight}
            onChange={(e) => setWeights((w) => ({ ...w, [r.id]: Number(e.target.value) }))}
          />
        </label>
      ))}

      <div className="ai-key-row" style={{ marginTop: 12 }}>
        <button type="button" className="wl-btn wl-btn-primary"
          disabled={busy || block <= flag} onClick={save}>
          {saved ? "Saved" : "Save"}
        </button>
        <button type="button" className="wl-btn" disabled={busy || block <= flag} onClick={test}>
          Test changes against history
        </button>
      </div>

      {replay && (
        <p className="wl-note" style={{ marginTop: 10 }}>
          {replay.changed === 0
            ? `Checked all ${replay.total} past requests. Nothing would have been decided differently.`
            : `${replay.changed} of ${replay.total} past requests would now be decided differently.`}
        </p>
      )}
      {replay?.changes.slice(0, 8).map((c, i) => (
        <p className="wl-note ai-security" key={i}>
          {c.was} → {c.now}: “{c.text.slice(0, 90)}”
        </p>
      ))}

      <h3 className="ai-section-head">
        What people tried ({data.recent.length} seen, {blocked} blocked, {flagged} warned)
      </h3>
      {data.recent.length === 0 && <p className="wl-note">Nothing yet.</p>}
      {data.recent.slice(0, 40).map((e, i) => (
        <div className="admin-field" key={i}>
          <span>
            <em className={e.verdict === "block" ? "ai-unset" : "ai-set"}>{e.verdict}</em>
            {" "}score {e.score}
            {e.hits.length > 0 && ` · ${e.hits.join(", ")}`}
          </span>
          <p className="wl-note ai-security" style={{ margin: 0 }}>{e.text.slice(0, 220)}</p>
        </div>
      ))}
    </div>
  );
}
