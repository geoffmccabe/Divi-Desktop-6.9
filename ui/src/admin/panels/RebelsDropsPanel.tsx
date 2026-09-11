import { useEffect, useMemo, useState } from "react";
import {
  chartOdds, chartTotal, droppableKeys, rollDrop, validateDropConfig, DEFAULT_DROP_CONFIG,
  type DropChart, type DropConfig, type DropRule,
} from "../../wallet/rebels/dropCharts";
import { fetchDropConfig, saveDropConfig } from "../../wallet/rebels/dropConfigRemote";
import { itemByKey } from "../../wallet/rebels/itemCatalog";
import "./rebels-drops.css";

// Admin: Rebels Drops. What wrecks leave behind: the charts (item, weight)
// and the rules (which enemies use which chart, chance per tier). Read from
// the live row, edited here, saved with the admin secret, which is typed once
// and kept on this machine. The "test" button rolls ten thousand kills with
// the exact function the game uses, so a change can be seen before it is
// saved. See docs/DIVI-REBELS-ITEMS-PLAN.md.

const SECRET_KEY = "dd69.admin.rebelsDropsSecret";
const ENEMIES: DropRule["enemy"][] = ["any", "fighter", "flock"];

export function RebelsDropsPanel() {
  const [cfg, setCfg] = useState<DropConfig>(DEFAULT_DROP_CONFIG);
  const [source, setSource] = useState("loading");
  const [secret, setSecret] = useState(() => { try { return localStorage.getItem(SECRET_KEY) ?? ""; } catch { return ""; } });
  const [status, setStatus] = useState("");
  const [trial, setTrial] = useState<{ tier: number; enemy: "fighter" | "flock"; rolls: Record<string, number>; nothing: number } | null>(null);
  const [trialTier, setTrialTier] = useState(1);
  const keys = useMemo(() => droppableKeys(), []);

  useEffect(() => {
    void fetchDropConfig().then((r) => {
      setCfg(r.config);
      setSource(r.live ? "live charts" : `default charts (${r.error ?? "no live row"})`);
    });
  }, []);

  const check = validateDropConfig(cfg);
  const errors = "errors" in check ? check.errors : [];

  const setChart = (i: number, c: DropChart) => setCfg({ ...cfg, charts: cfg.charts.map((x, j) => (j === i ? c : x)) });
  const setRule = (i: number, r: DropRule) => setCfg({ ...cfg, rules: cfg.rules.map((x, j) => (j === i ? r : x)) });

  const runTrial = (enemy: "fighter" | "flock") => {
    const rolls: Record<string, number> = {};
    let nothing = 0;
    if ("errors" in check) return;
    for (let i = 0; i < 10_000; i++) {
      const k = rollDrop(check.ok, enemy, trialTier, Math.random(), Math.random());
      if (k) rolls[k] = (rolls[k] ?? 0) + 1; else nothing++;
    }
    setTrial({ tier: trialTier, enemy, rolls, nothing });
  };

  const save = async () => {
    if ("errors" in check) { setStatus(check.errors[0]); return; }
    setStatus("saving");
    try { localStorage.setItem(SECRET_KEY, secret); } catch { /* fine */ }
    const r = await saveDropConfig(secret.trim(), check.ok);
    setStatus("ok" in r ? "saved: rooms pick it up within ten minutes, cockpits on their next flight" : `refused: ${r.error}`);
    if ("ok" in r) setSource("live charts");
  };

  return (
    <div className="admin-panel rd-panel">
      <p className="wl-note">
        What a wreck leaves behind. A chart is items with weights; an item's chance is its weight over
        the chart's total. A rule gives enemies a chart and a chance per tier (10% means a tier-one
        wreck drops one time in ten, a tier-seven seven in ten). Showing: {source}.
      </p>

      {cfg.charts.map((chart, ci) => {
        const total = chartTotal(chart);
        const odds = new Map(chartOdds(chart).map((o) => [o.key, o.share]));
        return (
          <section key={chart.id} className="rd-chart">
            <div className="rd-chart-head">
              <input className="wl-input rd-name" value={chart.name} onChange={(e) => setChart(ci, { ...chart, name: e.target.value })} />
              <span className="rd-id">{chart.id}</span>
              <button type="button" className="rd-btn rd-danger" disabled={cfg.charts.length <= 1}
                onClick={() => setCfg({ ...cfg, charts: cfg.charts.filter((_, j) => j !== ci), rules: cfg.rules.filter((r) => r.chart !== chart.id) })}>
                remove chart
              </button>
            </div>
            <div className="rd-rows">
              <div className="rd-row rd-head"><span>item</span><span>weight</span><span>share</span><span /></div>
              {chart.entries.map((e, ei) => (
                <div key={ei} className="rd-row">
                  <select className="wl-input" value={e.key}
                    onChange={(ev) => setChart(ci, { ...chart, entries: chart.entries.map((x, j) => (j === ei ? { ...x, key: ev.target.value } : x)) })}>
                    {keys.map((k) => <option key={k} value={k}>{itemByKey(k)?.name ?? k}</option>)}
                  </select>
                  <input className="wl-input" type="number" min="0" step="1" value={e.weight}
                    onChange={(ev) => setChart(ci, { ...chart, entries: chart.entries.map((x, j) => (j === ei ? { ...x, weight: ev.target.value === "" ? 0 : Number(ev.target.value) } : x)) })} />
                  <span className="rd-share">{pct(odds.get(e.key) ?? 0)}</span>
                  <button type="button" className="rd-btn rd-danger" onClick={() => setChart(ci, { ...chart, entries: chart.entries.filter((_, j) => j !== ei) })}>x</button>
                </div>
              ))}
            </div>
            <div className="rd-chart-foot">
              <span className="rd-total">total weight {total.toLocaleString()}</span>
              <button type="button" className="rd-btn"
                onClick={() => setChart(ci, { ...chart, entries: [...chart.entries, { key: keys.find((k) => !chart.entries.some((x) => x.key === k)) ?? keys[0], weight: 1000 }] })}>
                add item
              </button>
            </div>
          </section>
        );
      })}
      <button type="button" className="rd-btn"
        onClick={() => setCfg({ ...cfg, charts: [...cfg.charts, { id: `chart${cfg.charts.length + 1}${Date.now().toString(36).slice(-3)}`, name: `Drop chart ${cfg.charts.length + 1}`, entries: [{ key: keys[0], weight: 1000 }] }] })}>
        add chart
      </button>

      <section className="rd-chart">
        <div className="rd-chart-head"><span className="rd-name rd-title">Rules</span></div>
        <div className="rd-rows">
          <div className="rd-row rd-rule rd-head"><span>enemies</span><span>tiers</span><span>chart</span><span>chance per tier</span><span /></div>
          {cfg.rules.map((r, ri) => (
            <div key={ri} className="rd-row rd-rule">
              <select className="wl-input" value={r.enemy} onChange={(e) => setRule(ri, { ...r, enemy: e.target.value as DropRule["enemy"] })}>
                {ENEMIES.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <span className="rd-tiers">
                <input className="wl-input" type="number" min="1" max="7" value={r.tierMin} onChange={(e) => setRule(ri, { ...r, tierMin: Number(e.target.value) || 1 })} />
                <input className="wl-input" type="number" min="1" max="7" value={r.tierMax} onChange={(e) => setRule(ri, { ...r, tierMax: Number(e.target.value) || 7 })} />
              </span>
              <select className="wl-input" value={r.chart} onChange={(e) => setRule(ri, { ...r, chart: e.target.value })}>
                {cfg.charts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input className="wl-input" type="number" min="0" max="1" step="0.01" value={r.chancePerTier}
                onChange={(e) => setRule(ri, { ...r, chancePerTier: e.target.value === "" ? 0 : Number(e.target.value) })} />
              <button type="button" className="rd-btn rd-danger" onClick={() => setCfg({ ...cfg, rules: cfg.rules.filter((_, j) => j !== ri) })}>x</button>
            </div>
          ))}
        </div>
        <div className="rd-chart-foot">
          <span className="rd-total">first matching rule wins; an enemy no rule covers drops nothing</span>
          <button type="button" className="rd-btn"
            onClick={() => setCfg({ ...cfg, rules: [...cfg.rules, { enemy: "any", tierMin: 1, tierMax: 7, chart: cfg.charts[0]?.id ?? "", chancePerTier: 0.1 }] })}>
            add rule
          </button>
        </div>
      </section>

      <section className="rd-chart">
        <div className="rd-chart-head">
          <span className="rd-name rd-title">Test ten thousand kills</span>
          <label className="rd-inline">tier
            <input className="wl-input" type="number" min="1" max="7" value={trialTier} onChange={(e) => setTrialTier(Math.min(7, Math.max(1, Number(e.target.value) || 1)))} />
          </label>
          <button type="button" className="rd-btn" disabled={errors.length > 0} onClick={() => runTrial("fighter")}>fighters</button>
          <button type="button" className="rd-btn" disabled={errors.length > 0} onClick={() => runTrial("flock")}>flock members</button>
        </div>
        {trial && (
          <div className="rd-rows">
            <div className="rd-row rd-trial"><span>nothing</span><span>{trial.nothing.toLocaleString()}</span><span>{pct(trial.nothing / 10_000)}</span></div>
            {Object.entries(trial.rolls).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <div key={k} className="rd-row rd-trial"><span>{itemByKey(k)?.name ?? k}</span><span>{n.toLocaleString()}</span><span>{pct(n / 10_000)}</span></div>
            ))}
          </div>
        )}
      </section>

      {errors.length > 0 && <p className="wl-err">{errors.join(". ")}</p>}

      <label className="admin-field">
        <span>Admin secret (kept on this machine)</span>
        <input className="wl-input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} spellCheck={false} autoComplete="off" />
      </label>
      <div className="rd-chart-foot">
        <span className="wl-note">{status}</span>
        <button type="button" className="rd-btn rd-primary" disabled={errors.length > 0 || !secret.trim()} onClick={() => void save()}>SAVE LIVE</button>
      </div>
    </div>
  );
}

function pct(x: number): string {
  if (x <= 0) return "0%";
  if (x < 0.0001) return "<0.01%";
  return `${(x * 100).toFixed(x < 0.01 ? 3 : 2)}%`;
}
