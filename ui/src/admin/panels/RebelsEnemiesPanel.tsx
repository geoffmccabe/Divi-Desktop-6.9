import { useEffect, useMemo, useState } from "react";
import {
  builtInEnemies, validateEnemy, validateEnemies, blankEnemy, duplicateEnemy,
  BEHAVIOURS, HEALTH_MIN, HEALTH_MAX, SPEED_MIN, SPEED_MAX,
  FIRE_EVERY_MIN, FIRE_EVERY_MAX, FIRE_RANGE_MIN, FIRE_RANGE_MAX,
  SHOT_SPEED_MIN, SHOT_SPEED_MAX, DAMAGE_MIN, DAMAGE_MAX, RESISTANCE_MAX, WORTH_MAX,
  type EnemyType, type Behaviour,
} from "../../wallet/rebels/enemyTypes";
import { fetchEnemyTypes, saveEnemyTypes } from "../../wallet/rebels/enemyTypesRemote";
import { ROUND_MAX_ENEMIES } from "../../wallet/rebels/gameTypes";
import "./rebels-enemies.css";

// Admin: Rebels Enemies. The screen Geoff makes enemies on.
//
// Geoff: "a panel for that tab for me to create enemy types with names,
// health, damage, fire rate, colors of firing, velocity of ship, velocity of
// firing, shields, damage resistance, flocking, etc."
//
// Built-ins are listed and cannot be edited, only COPIED - which is the whole
// workflow: start from a Red Fighter, change three numbers, name it. Nobody
// builds an enemy from nothing, and a blank form is a worse starting point
// than a working ship.
//
// It saves with the admin secret, typed once and kept on this machine, exactly
// as the Drops panel does. See saveEnemyTypes for why that is a secret and not
// a role: a role cannot authorise anything until there is real authentication,
// and one today would gate this tab and nothing else.

const SECRET_KEY = "dd69.admin.rebelsDropsSecret";   /* the same secret, one place to type it */

const hex = (n: number) => `#${Math.max(0, Math.min(0xffffff, n | 0)).toString(16).padStart(6, "0")}`;
const unhex = (s: string) => parseInt(s.replace("#", ""), 16) || 0;

export function RebelsEnemiesPanel() {
  const builtIn = useMemo(() => builtInEnemies(), []);
  const [custom, setCustom] = useState<EnemyType[]>([]);
  const [source, setSource] = useState("loading");
  const [pick, setPick] = useState<string>(builtIn[0].id);
  const [secret, setSecret] = useState(() => { try { return localStorage.getItem(SECRET_KEY) ?? ""; } catch { return ""; } });
  const [status, setStatus] = useState("");

  useEffect(() => {
    void fetchEnemyTypes().then((r) => {
      setCustom(r.custom);
      setSource(r.live ? "live definitions" : `built-ins only (${r.error ?? "no live row yet"})`);
    });
  }, []);

  const all = useMemo(() => [...builtIn, ...custom], [builtIn, custom]);
  const chosen = all.find((e) => e.id === pick) ?? builtIn[0];
  const editable = !chosen.builtIn;
  const check = validateEnemy(chosen);
  const errors = "errors" in check ? check.errors : [];
  const setErrors = "errors" in validateEnemies(custom) ? validateEnemies(custom) : null;
  const allErrors = setErrors && "errors" in setErrors ? setErrors.errors : [];

  const edit = (f: (e: EnemyType) => EnemyType) =>
    setCustom((list) => list.map((e) => (e.id === pick ? f(e) : e)));
  const num = (key: keyof EnemyType, v: string) =>
    edit((e) => ({ ...e, [key]: v === "" ? 0 : Number(v) }));

  /** A fresh id that nothing is using. */
  const freeId = (stem: string) => {
    let id = stem, n = 2;
    while (all.some((e) => e.id === id)) id = `${stem}-${n++}`;
    return id;
  };

  const add = () => {
    const e = blankEnemy(freeId("new-enemy"));
    setCustom((l) => [...l, e]);
    setPick(e.id);
  };
  const copy = () => {
    const e = duplicateEnemy(chosen, freeId(`${chosen.id}-copy`));
    setCustom((l) => [...l, e]);
    setPick(e.id);
  };
  const remove = () => {
    setCustom((l) => l.filter((e) => e.id !== pick));
    setPick(builtIn[0].id);
  };

  const save = async () => {
    const v = validateEnemies(custom);
    if ("errors" in v) { setStatus(`refused: ${v.errors[0]}`); return; }
    setStatus("saving");
    try { localStorage.setItem(SECRET_KEY, secret); } catch { /* fine */ }
    const r = await saveEnemyTypes(secret.trim(), custom);
    setStatus("ok" in r
      ? "saved: rooms pick it up within ten minutes, cockpits on their next flight"
      : `refused: ${r.error}`);
    if ("ok" in r) setSource("live definitions");
  };

  /** A number box, bounded the way the validator bounds it, so the panel and
   *  the saver cannot disagree about what is allowed. */
  const field = (
    label: string, key: keyof EnemyType, lo: number, hi: number, step: number, hint?: string,
  ) => (
    <label className="re-field" key={key as string}>
      <span>{label}</span>
      <input
        className="wl-input" type="number" min={lo} max={hi} step={step}
        disabled={!editable}
        value={String(chosen[key] ?? "")}
        onChange={(ev) => num(key, ev.target.value)}
      />
      {hint ? <span className="re-hint">{hint}</span> : null}
    </label>
  );

  return (
    <div className="admin-panel re-panel">
      <p className="wl-note">
        Enemies the game can send. The fifteen built-ins are what it sends today and cannot be
        edited &mdash; copy one and change it. An enemy is one of our hulls, painted, plus numbers;
        nothing here models a new spaceship. Showing: {source}.
      </p>

      <div className="re-split">
        <div className="re-list">
          <div className="re-group">Built in</div>
          {builtIn.map((e) => (
            <button type="button" key={e.id} className={`re-item${e.id === pick ? " on" : ""}`}
              onClick={() => setPick(e.id)}>
              <span className="re-swatch" style={{ background: hex(e.colour) }} />
              <span className="re-item-name">{e.name}</span>
              <span className="re-locked">locked</span>
            </button>
          ))}
          <div className="re-group">Yours</div>
          {custom.length === 0
            ? <span className="re-hint">None yet. Copy a built-in to start.</span>
            : custom.map((e) => (
              <button type="button" key={e.id} className={`re-item${e.id === pick ? " on" : ""}`}
                onClick={() => setPick(e.id)}>
                <span className="re-swatch" style={{ background: hex(e.colour) }} />
                <span className="re-item-name">{e.name}</span>
              </button>
            ))}
        </div>

        <section className="re-edit">
          <div className="re-edit-head">
            <input className="wl-input re-name" value={chosen.name} disabled={!editable}
              onChange={(ev) => edit((e) => ({ ...e, name: ev.target.value }))} />
            <span className="re-id">{chosen.id}</span>
            <button type="button" className="re-btn" onClick={copy}>copy this one</button>
            <button type="button" className="re-btn re-danger" disabled={!editable} onClick={remove}>delete</button>
          </div>

          {chosen.builtIn ? (
            <p className="re-hint">
              This is one of the game&rsquo;s own. Copy it to make a version you can change.
            </p>
          ) : null}

          <div className="re-fields">
            <label className="re-field">
              <span>How it flies</span>
              <select className="wl-input" value={chosen.behaviour} disabled={!editable}
                onChange={(ev) => edit((e) => ({ ...e, behaviour: ev.target.value as Behaviour }))}>
                {BEHAVIOURS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <span className="re-hint">
                {chosen.behaviour === "fighter" ? "Comes at you, shoots, commits to a pass."
                  : chosen.behaviour === "drone" ? "Flocks and swarms. Individually weak."
                  : "The big one, with its own behaviour."}
              </span>
            </label>

            <label className="re-field">
              <span>Its colour</span>
              <span className="re-colour">
                <input type="color" value={hex(chosen.colour)} disabled={!editable}
                  onChange={(ev) => edit((e) => ({ ...e, colour: unhex(ev.target.value) }))} />
                <span className="re-hint">hull and shield</span>
              </span>
            </label>

            <label className="re-field">
              <span>Colour of its fire</span>
              <span className="re-colour">
                <input type="color" value={hex(chosen.fireColour ?? chosen.colour)} disabled={!editable}
                  onChange={(ev) => edit((e) => ({ ...e, fireColour: unhex(ev.target.value) }))} />
                <button type="button" className="re-btn" disabled={!editable || chosen.fireColour === undefined}
                  onClick={() => edit((e) => { const c = { ...e }; delete c.fireColour; return c; })}>
                  match hull
                </button>
              </span>
            </label>

            {field("Health", "shieldMax", HEALTH_MIN, HEALTH_MAX, 10)}
            {field("Damage resistance", "resistance", 0, RESISTANCE_MAX, 0.05,
                   `0 to ${RESISTANCE_MAX}. At 1 nothing could kill it.`)}
            {field("Speed", "speed", SPEED_MIN, SPEED_MAX, 0.1, "multiple of normal")}
            {field("Seconds between shots", "fireEvery", FIRE_EVERY_MIN, FIRE_EVERY_MAX, 0.1)}
            {field("Firing range", "fireRange", FIRE_RANGE_MIN, FIRE_RANGE_MAX, 5, "world units")}
            {field("Shot speed", "shotSpeed", SHOT_SPEED_MIN, SHOT_SPEED_MAX, 0.1, "multiple of normal")}
            {field("Damage", "damage", DAMAGE_MIN, DAMAGE_MAX, 0.1, "multiple of a normal round")}
            {field("DIVI a kill drops", "worth", 0, WORTH_MAX, 0.1,
                   `up to ${WORTH_MAX}. A round can hold ${ROUND_MAX_ENEMIES}, so ${WORTH_MAX} is ${WORTH_MAX * ROUND_MAX_ENEMIES} DIVI a round.`)}

            <label className="re-field">
              <span>Hull</span>
              <input className="wl-input" placeholder="space_SM_Ship_Fighter_04" disabled={!editable}
                value={chosen.hull ?? ""}
                onChange={(ev) => edit((e) => {
                  const c = { ...e };
                  if (ev.target.value.trim()) c.hull = ev.target.value.trim(); else delete c.hull;
                  return c;
                })} />
              <span className="re-hint">blank means the usual model for how it flies</span>
            </label>
          </div>

          {errors.length ? (
            <div className="re-errors">{errors.map((e) => <span key={e}>{e}</span>)}</div>
          ) : null}
        </section>
      </div>

      <div className="re-foot">
        <span className="wl-note">{status}</span>
        <input className="wl-input" type="password" placeholder="admin secret"
          value={secret} onChange={(ev) => setSecret(ev.target.value)} />
        <button type="button" className="re-btn" onClick={add}>new enemy</button>
        <button type="button" className="re-btn re-primary"
          disabled={allErrors.length > 0 || !secret.trim()} onClick={() => void save()}>
          SAVE LIVE
        </button>
      </div>
    </div>
  );
}
