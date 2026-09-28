import { useEffect, useMemo, useRef, useState } from "react";
import {
  waveDefence, validateGame, gameSeconds, gameMaxAward,
  PLACES, PLACES_LIVE, ARRIVALS, MAX_REWARD_DIVI, MAX_ROUNDS,
  ROUND_MIN_SECONDS, ROUND_MAX_SECONDS, ROUND_MAX_ENEMIES, BIAS_MIN, BIAS_MAX,
  type GameType, type Round, type Spawn, type PlaceId, type Arrival,
} from "../../wallet/rebels/gameTypes";
import { fetchGameTypes, saveGameType, deleteGameType } from "../../wallet/rebels/gameTypesRemote";
import { fetchEnemyTypes } from "../../wallet/rebels/enemyTypesRemote";
import { cardFromFile } from "../../wallet/rebels/gameImage";
import type { EnemyType } from "../../wallet/rebels/enemyTypes";
import "./rebels-games.css";

// Admin: Rebels Games. Where Geoff builds a game.
//
// Geoff: "define game types with a name, and image (3:2 aspect ratio)
// uploaded, a sequence of rounds that have a time for each of them, and a
// sequence of enemy types I can add there."
//
// A game is a PLACE plus a SEQUENCE OF ROUNDS. The built-in Wave Defence is
// shown and locked, like the built-in enemies, and copying it is how you start
// - it is thirty rounds of a working game, which is a better starting point
// than an empty list.
//
// The enemy dropdown is filled from the enemies panel, so anything Geoff makes
// there is choosable here without this file knowing about it.

const SECRET_KEY = "dd69.admin.rebelsDropsSecret";

export function RebelsGamesPanel() {
  const builtIn = useMemo(() => waveDefence(), []);
  const [saved, setSaved] = useState<GameType[]>([]);
  const [enemies, setEnemies] = useState<EnemyType[]>([]);
  const [source, setSource] = useState("loading");
  const [pick, setPick] = useState(builtIn.id);
  const [secret, setSecret] = useState(() => { try { return localStorage.getItem(SECRET_KEY) ?? ""; } catch { return ""; } });
  const [status, setStatus] = useState("");
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetchEnemyTypes().then((r) => {
      setEnemies(r.enemies);
      return fetchGameTypes(r.enemies.map((e) => e.id));
    }).then((r) => {
      setSaved(r.games.filter((g) => g.id !== builtIn.id));
      setSource(r.live ? "live games" : `built-in only (${r.error ?? "no live row yet"})`);
    });
  }, [builtIn.id]);

  const all = useMemo(() => [builtIn, ...saved], [builtIn, saved]);
  const chosen = all.find((g) => g.id === pick) ?? builtIn;
  const locked = chosen.id === builtIn.id;
  const known = useMemo(() => ["fighters", ...enemies.map((e) => e.id)], [enemies]);
  const check = validateGame(chosen, known);
  const errors = "errors" in check ? check.errors : [];
  const canSave = !locked && !("errors" in check) && secret.trim().length > 0;

  const edit = (f: (g: GameType) => GameType) =>
    setSaved((l) => l.map((g) => (g.id === pick ? f(g) : g)));
  const editRound = (i: number, f: (r: Round) => Round) =>
    edit((g) => ({ ...g, rounds: g.rounds.map((r, j) => (j === i ? f(r) : r)) }));

  const freeId = (stem: string) => {
    let id = stem, n = 2;
    while (all.some((g) => g.id === id)) id = `${stem}-${n++}`;
    return id;
  };
  const copy = () => {
    const g: GameType = {
      ...JSON.parse(JSON.stringify(chosen)) as GameType,
      id: freeId(`${chosen.id}-copy`), name: `${chosen.name} copy`, published: false,
    };
    setSaved((l) => [...l, g]);
    setPick(g.id);
  };
  /* Deleted in the database too, not only here: a single-row design got that
     for free and a row per game does not. Removed from the list either way, so
     a delete that fails to reach the server still leaves the panel honest
     about having tried, and says so. */
  const remove = async () => {
    const id = pick;
    const name = chosen.name;
    setSaved((l) => l.filter((g) => g.id !== id));
    setPick(builtIn.id);
    if (!secret.trim()) { setStatus(`removed "${name}" here; type the admin secret to remove it live`); return; }
    const r = await deleteGameType(secret.trim(), id);
    setStatus("ok" in r ? `deleted "${name}"` : `removed here, but the server refused: ${r.error}`);
  };

  const pickCard = async (f: File | undefined) => {
    if (!f) return;
    setStatus("shrinking the picture");
    try {
      const image = await cardFromFile(f);
      edit((g) => ({ ...g, image }));
      setStatus(`card ready, ${Math.round(image.length / 1024)}KB`);
    } catch (e) {
      setStatus(`that picture will not do: ${(e as Error).message}`);
    }
  };

  /* ---- SAVING IS PER GAME, not the whole list ----
     One row per game, so editing one writes one row. That matters when two
     people are editing: rewriting the whole list would quietly undo whatever
     the other had just saved. */
  const save = async () => {
    if (locked) return;
    if ("errors" in check) { setStatus(`refused: ${check.errors[0]}`); return; }
    setStatus("saving");
    try { localStorage.setItem(SECRET_KEY, secret); } catch { /* fine */ }
    const r = await saveGameType(secret.trim(), chosen, known);
    setStatus("ok" in r
      ? `saved "${chosen.name}": rooms pick it up within ten minutes, cockpits on their next flight`
      : `refused: ${r.error}`);
    if ("ok" in r) setSource("live games");
  };

  const spawnRow = (ri: number, si: number, s: Spawn) => (
    <div className="rg-spawn" key={si}>
      <select className="wl-input" value={s.enemy} disabled={locked}
        onChange={(e) => editRound(ri, (r) => ({
          ...r,
          spawns: r.spawns.map((x, j) => {
            if (j !== si) return x;
            const next: Spawn = { ...x, enemy: e.target.value };
            /* A bias means nothing on one named kind of ship, and the
               validator refuses it there, so it goes when you switch away. */
            if (next.enemy !== "fighters") delete next.bias;
            return next;
          }),
        }))}>
        <option value="fighters">Fighters (a mix)</option>
        {enemies.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
      </select>
      <input className="wl-input" type="number" min={1} max={ROUND_MAX_ENEMIES} step={1}
        value={s.count} disabled={locked}
        onChange={(e) => editRound(ri, (r) => ({
          ...r, spawns: r.spawns.map((x, j) => (j === si ? { ...x, count: Number(e.target.value) || 0 } : x)),
        }))} />
      <select className="wl-input" value={s.arrive} disabled={locked}
        onChange={(e) => editRound(ri, (r) => ({
          ...r, spawns: r.spawns.map((x, j) => (j === si ? { ...x, arrive: e.target.value as Arrival } : x)),
        }))}>
        {ARRIVALS.map((a) => (
          <option key={a} value={a}>
            {a === "once" ? "all at once" : a === "spread" ? "spread out" : "in clumps"}
          </option>
        ))}
      </select>
      {s.enemy === "fighters" ? (
        <span className="rg-bias">
          <input className="wl-input" type="number" min={BIAS_MIN} max={BIAS_MAX} step={0.1}
            value={s.bias?.[0] ?? BIAS_MIN} disabled={locked} title="easiest"
            onChange={(e) => editRound(ri, (r) => ({
              ...r, spawns: r.spawns.map((x, j) => (j === si
                ? { ...x, bias: [Number(e.target.value) || 0, x.bias?.[1] ?? BIAS_MAX] as [number, number] } : x)),
            }))} />
          <span className="rg-hint">to</span>
          <input className="wl-input" type="number" min={BIAS_MIN} max={BIAS_MAX} step={0.1}
            value={s.bias?.[1] ?? BIAS_MAX} disabled={locked} title="hardest"
            onChange={(e) => editRound(ri, (r) => ({
              ...r, spawns: r.spawns.map((x, j) => (j === si
                ? { ...x, bias: [x.bias?.[0] ?? BIAS_MIN, Number(e.target.value) || 0] as [number, number] } : x)),
            }))} />
        </span>
      ) : <span className="rg-hint">one kind</span>}
      <button type="button" className="rg-btn rg-danger" disabled={locked || chosen.rounds[ri].spawns.length <= 1}
        onClick={() => editRound(ri, (r) => ({ ...r, spawns: r.spawns.filter((_, j) => j !== si) }))}>x</button>
    </div>
  );

  return (
    <div className="admin-panel rg-panel">
      <p className="wl-note">
        A game is a place and a sequence of rounds. Rounds end on the clock, always. &ldquo;Fighters
        (a mix)&rdquo; is what the game has always sent &mdash; the seven tiers weighted by a
        difficulty that is rolled per round, and the two numbers are how easy and how hard that can
        be. Showing: {source}.
      </p>

      <div className="rg-split">
        <div className="rg-list">
          {all.map((g) => (
            <button type="button" key={g.id} className={`rg-item${g.id === pick ? " on" : ""}`}
              onClick={() => setPick(g.id)}>
              <span className="rg-item-name">{g.name}</span>
              <span className="rg-tag">{g.place}</span>
              {g.id === builtIn.id
                ? <span className="rg-tag">locked</span>
                : <span className={`rg-tag${g.published ? "" : " rg-off"}`}>{g.published ? "live" : "draft"}</span>}
            </button>
          ))}
        </div>

        <section className="rg-edit">
          <div className="rg-edit-head">
            <input className="wl-input rg-name" value={chosen.name} disabled={locked}
              onChange={(e) => edit((g) => ({ ...g, name: e.target.value }))} />
            <span className="rg-id">{chosen.id}</span>
            <button type="button" className="rg-btn" onClick={copy}>copy this one</button>
            <button type="button" className="rg-btn rg-danger" disabled={locked} onClick={() => void remove()}>delete</button>
          </div>

          {locked ? (
            <p className="rg-hint">
              This is the game the server plays today. Copy it to make one you can change.
            </p>
          ) : null}

          <div className="rg-top">
            <div>
              <div className="rg-card" style={chosen.image ? { backgroundImage: `url(${chosen.image})` } : undefined}>
                {chosen.image ? null : <span>No card picture. 3:2; anything you upload is cropped to fit.</span>}
              </div>
              <div className="rg-card-btns">
                <input ref={file} type="file" accept="image/*" hidden
                  onChange={(e) => { void pickCard(e.target.files?.[0]); e.target.value = ""; }} />
                <button type="button" className="rg-btn" disabled={locked} onClick={() => file.current?.click()}>
                  upload card
                </button>
                <button type="button" className="rg-btn rg-danger" disabled={locked || !chosen.image}
                  onClick={() => edit((g) => { const c = { ...g }; delete c.image; return c; })}>
                  remove
                </button>
              </div>
            </div>

            <div className="rg-fields">
              <label className="rg-field">
                <span>Where</span>
                <select className="wl-input" value={chosen.place} disabled={locked}
                  onChange={(e) => edit((g) => ({ ...g, place: e.target.value as PlaceId }))}>
                  {PLACES.map((p) => (
                    <option key={p} value={p}>{p}{PLACES_LIVE.includes(p) ? "" : " (not reachable yet)"}</option>
                  ))}
                </select>
              </label>
              <label className="rg-field">
                <span>Who with</span>
                <select className="wl-input" value={chosen.crew} disabled={locked}
                  onChange={(e) => edit((g) => ({ ...g, crew: e.target.value as GameType["crew"] }))}>
                  <option value="multiplayer">everyone together</option>
                  <option value="solo">on your own</option>
                </select>
              </label>
              <label className="rg-field">
                <span>Award for finishing</span>
                <input className="wl-input" type="number" min={0} max={MAX_REWARD_DIVI} step={1}
                  value={chosen.award?.divi ?? 0} disabled={locked}
                  onChange={(e) => edit((g) => ({ ...g, award: { ...g.award, divi: Number(e.target.value) || 0 } }))} />
                <span className="rg-hint">DIVI, up to {MAX_REWARD_DIVI}</span>
              </label>
              <label className="rg-field">
                <span>Players can see it</span>
                <select className="wl-input" value={chosen.published ? "yes" : "no"} disabled={locked}
                  onChange={(e) => edit((g) => ({ ...g, published: e.target.value === "yes" }))}>
                  <option value="no">no, still a draft</option>
                  <option value="yes">yes, live</option>
                </select>
              </label>
            </div>
          </div>

          <span className="rg-sum">
            {chosen.rounds.length} rounds &middot; {Math.round(gameSeconds(chosen) / 60)} minutes &middot;{" "}
            {chosen.rounds.reduce((n, r) => n + r.spawns.reduce((m, s) => m + s.count, 0), 0)} enemies &middot;{" "}
            up to {gameMaxAward(chosen)} DIVI in awards
          </span>

          <div className="rg-rounds">
            {chosen.rounds.map((r, ri) => (
              <div className="rg-round" key={ri}>
                <div className="rg-round-head">
                  <span className="rg-round-no">Round {ri + 1}</span>
                  <input className="wl-input" type="number" min={ROUND_MIN_SECONDS} max={ROUND_MAX_SECONDS}
                    step={5} style={{ width: 80 }} value={r.seconds} disabled={locked}
                    onChange={(e) => editRound(ri, (x) => ({ ...x, seconds: Number(e.target.value) || 0 }))} />
                  <span className="rg-hint">seconds</span>
                  <input className="wl-input" type="number" min={0} max={MAX_REWARD_DIVI} step={1}
                    style={{ width: 80 }} value={r.award?.divi ?? 0} disabled={locked}
                    onChange={(e) => editRound(ri, (x) => ({ ...x, award: { ...x.award, divi: Number(e.target.value) || 0 } }))} />
                  <span className="rg-hint">DIVI for surviving</span>
                  <button type="button" className="rg-btn rg-danger" disabled={locked || chosen.rounds.length <= 1}
                    onClick={() => edit((g) => ({ ...g, rounds: g.rounds.filter((_, j) => j !== ri) }))}>
                    remove round
                  </button>
                </div>
                {r.spawns.map((s, si) => spawnRow(ri, si, s))}
                <button type="button" className="rg-btn" disabled={locked}
                  onClick={() => editRound(ri, (x) => ({
                    ...x, spawns: [...x.spawns, { enemy: "fighters", count: 5, arrive: "spread" }],
                  }))}>
                  add something to this round
                </button>
              </div>
            ))}
          </div>

          <button type="button" className="rg-btn" disabled={locked || chosen.rounds.length >= MAX_ROUNDS}
            onClick={() => edit((g) => ({
              ...g,
              rounds: [...g.rounds, {
                seconds: 120,
                spawns: [{ enemy: "fighters", count: 10 + g.rounds.length * 2, arrive: "spread" }],
              }],
            }))}>
            add a round
          </button>

          {errors.length ? (
            <div className="rg-errors">{errors.map((e) => <span key={e}>{e}</span>)}</div>
          ) : null}
        </section>
      </div>

      <div className="rg-foot">
        <span className="wl-note">{status}</span>
        <input className="wl-input" type="password" placeholder="admin secret"
          value={secret} onChange={(e) => setSecret(e.target.value)} />
        <button type="button" className="rg-btn rg-primary" disabled={!canSave} onClick={() => void save()}>
          SAVE THIS GAME
        </button>
      </div>
    </div>
  );
}
