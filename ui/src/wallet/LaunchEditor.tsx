import { useEffect, useMemo, useState } from "react";
import type { LaunchPlan, LaunchEdits } from "./api";
import { InfoDot } from "../InfoDot";

// The editable review screen for a v6 (owner-only, multi-Ultra-Rare-set) launch
// bundle. It shows the set the user built in Kinet.ink and lets them edit the
// TEXT specs before launching on Divi — names, supply, prices, rarity weights,
// Ultra Rare set names, and the per-set forging dials. Art is NOT edited here
// (it stays in Kinet.ink); the card grid is label-only because v6 masters are
// encrypted. Chances read almost like a percentage: a set's chance is its weight
// over (100 + the sum of every Ultra Rare weight). See docs/NFD-PERCS-LAUNCH-PLAN.md.

const DUFFS_PER_DIVI = 100_000_000;

interface UrEdit {
  name: string;
  rarityWeight: string; // kept as text so the field can be empty while typing
  tierCount: number; // structural (from the art), shown read-only
  factorPpm: number;
  forgeEnabled: boolean;
  forgeMode: "plus1" | "variable";
  continuePct: string; // continue-chance as a percent string
}

interface State {
  name: string;
  symbol: string;
  website: string;
  description: string;
  maxSupply: string;
  priceDivi: string;
  payoutAddress: string;
  forgeFeeDivi: string; // "" = no forge cost
  mainSetWeight: number;
  baseTierCount: number;
  baseFactorPpm: number;
  urSets: UrEdit[];
}

function toDivi(duffs: number): string {
  return (duffs / DUFFS_PER_DIVI).toString();
}
function parseDivi(s: string): number {
  const n = Number(s.trim());
  return Number.isFinite(n) && n >= 0 ? Math.round(n * DUFFS_PER_DIVI) : 0;
}
function intOf(s: string, fallback = 0): number {
  const n = Math.floor(Number(s.trim()));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Build the editable state from a freshly-parsed plan.
function initState(plan: LaunchPlan): State {
  const shape = plan.setShape;
  return {
    name: plan.name ?? "",
    symbol: plan.symbol ?? "",
    website: plan.website ?? "",
    description: plan.description ?? "",
    maxSupply: String(plan.maxSupply ?? 0),
    priceDivi: toDivi(plan.priceDuffs ?? 0),
    payoutAddress: plan.payoutAddress ?? "",
    forgeFeeDivi: plan.forgeFeeDuffs != null ? toDivi(plan.forgeFeeDuffs) : "",
    mainSetWeight: shape?.mainSetWeight ?? 100,
    baseTierCount: shape?.baseTierCount ?? 0,
    baseFactorPpm: shape?.baseFactorPpm ?? 0,
    urSets: (shape?.ultraRareSets ?? []).map((u) => ({
      name: u.name,
      rarityWeight: String(u.rarityWeight),
      tierCount: u.tierCount,
      factorPpm: u.factorPpm,
      forgeEnabled: u.forge.enabled,
      forgeMode: u.forge.mode,
      continuePct: (u.forge.continueChancePpm / 10_000).toString(),
    })),
  };
}

export function LaunchEditor({
  plan,
  onChange,
}: {
  plan: LaunchPlan;
  onChange: (edits: LaunchEdits, maxSupply: number) => void;
}) {
  const [st, setSt] = useState<State>(() => initState(plan));

  // Re-seed when a different bundle is loaded.
  useEffect(() => {
    setSt(initState(plan));
  }, [plan]);

  // Live chance maths: a set's chance = its weight / (100 + sum of UR weights).
  const weights = st.urSets.map((u) => intOf(u.rarityWeight));
  const denom = st.mainSetWeight + weights.reduce((a, b) => a + b, 0);
  const pct = (w: number) => (denom > 0 ? (w / denom) * 100 : 0);
  const ppm = (w: number) => (denom > 0 ? Math.round((w / denom) * 1_000_000) : 0);
  const mainPct = pct(st.mainSetWeight);

  // Report the edits upward whenever the form changes.
  const edits = useMemo<LaunchEdits>(
    () => ({
      name: st.name,
      description: st.description,
      symbol: st.symbol,
      website: st.website,
      maxSupply: intOf(st.maxSupply),
      priceDuffs: parseDivi(st.priceDivi),
      payoutAddress: st.payoutAddress,
      forgeFeeDuffs: st.forgeFeeDivi.trim() === "" ? null : parseDivi(st.forgeFeeDivi),
      setShape: {
        baseFactorPpm: st.baseFactorPpm,
        mainSetWeight: st.mainSetWeight,
        ultraRareSets: st.urSets.map((u) => ({
          name: u.name,
          rarityWeight: intOf(u.rarityWeight),
          chancePpm: ppm(intOf(u.rarityWeight)),
          factorPpm: u.factorPpm,
          forge: {
            enabled: u.forgeEnabled,
            mode: u.forgeMode,
            continueChancePpm: u.forgeMode === "plus1" ? 0 : Math.round(Number(u.continuePct || "0") * 10_000),
          },
        })),
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [st, denom],
  );
  useEffect(() => {
    onChange(edits, intOf(st.maxSupply));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits]);

  const set = <K extends keyof State>(k: K, v: State[K]) => setSt((s) => ({ ...s, [k]: v }));
  const setUr = (i: number, patch: Partial<UrEdit>) =>
    setSt((s) => ({ ...s, urSets: s.urSets.map((u, j) => (j === i ? { ...u, ...patch } : u)) }));

  const items = plan.items ?? [];
  // Group the card grid by set, base first, then each UR set in order.
  const setOrder = ["base", ...st.urSets.map((u) => u.name)];
  const groups = setOrder
    .map((name) => ({ name, items: items.filter((it) => it.set === name) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="launch-editor">
      <p className="wl-note">
        Review and edit your collection before it goes live on Divi. You can change the text and numbers here; to
        change artwork, edit it in Kinet.ink and upload again.
      </p>

      <h4 className="le-head">Collection</h4>
      <div className="le-grid2">
        <label className="le-field">
          <span>Name</span>
          <input className="wl-input" value={st.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className="le-field">
          <span>Symbol</span>
          <input className="wl-input" value={st.symbol} onChange={(e) => set("symbol", e.target.value)} />
        </label>
        <label className="le-field le-span2">
          <span>Website</span>
          <input className="wl-input" value={st.website} onChange={(e) => set("website", e.target.value)} />
        </label>
        <label className="le-field le-span2">
          <span>Description</span>
          <textarea
            className="wl-input"
            rows={2}
            value={st.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </label>
        <label className="le-field">
          <span>
            Max packs <InfoDot glyph="i" text="The most packs that can ever be minted. 0 means unlimited." />
          </span>
          <input
            className="wl-input"
            inputMode="numeric"
            value={st.maxSupply}
            onChange={(e) => set("maxSupply", e.target.value)}
          />
        </label>
        <label className="le-field">
          <span>Mint price (DIVI)</span>
          <input
            className="wl-input"
            inputMode="decimal"
            value={st.priceDivi}
            onChange={(e) => set("priceDivi", e.target.value)}
          />
        </label>
        <label className="le-field le-span2">
          <span>
            Payout address <InfoDot glyph="i" text="Where mint and forge payments go. Leave blank to use your own wallet address." />
          </span>
          <input
            className="wl-input"
            value={st.payoutAddress}
            placeholder="Your wallet (default)"
            onChange={(e) => set("payoutAddress", e.target.value)}
          />
        </label>
        <label className="le-field">
          <span>
            Forge cost (DIVI) <InfoDot glyph="i" text="What a player pays to forge two cards into an upgrade. Leave blank for no forge cost." />
          </span>
          <input
            className="wl-input"
            inputMode="decimal"
            value={st.forgeFeeDivi}
            placeholder="none"
            onChange={(e) => set("forgeFeeDivi", e.target.value)}
          />
        </label>
      </div>

      <h4 className="le-head">Rarity</h4>
      <div className="le-rarity">
        <div className="le-set le-set-main">
          <div className="le-set-top">
            <strong>Main Set</strong>
            <span className="le-tiers">{st.baseTierCount} tiers</span>
          </div>
          {st.urSets.length > 0 && <div className="le-chance">Main Set appears {mainPct.toFixed(2)}% of the time</div>}
        </div>

        {st.urSets.map((u, i) => {
          const w = intOf(u.rarityWeight);
          const dim = !u.forgeEnabled;
          return (
            <div className="le-set" key={i}>
              <div className="le-set-top">
                <input
                  className="wl-input le-setname"
                  value={u.name}
                  onChange={(e) => setUr(i, { name: e.target.value })}
                  aria-label={`Ultra Rare set ${i + 1} name`}
                />
                <span className="le-tiers">{u.tierCount} tiers</span>
              </div>
              <div className="le-set-row">
                <label className="le-field le-narrow">
                  <span>Rarity Weight</span>
                  <input
                    className="wl-input"
                    inputMode="numeric"
                    value={u.rarityWeight}
                    onChange={(e) => setUr(i, { rarityWeight: e.target.value })}
                  />
                </label>
                <div className="le-chance">UR Set #{i + 1} appears {pct(w).toFixed(2)}% of the time</div>
              </div>
              <div className="le-forge">
                <label className="le-inline">
                  <span>Forging</span>
                  <select
                    className="wl-input le-select"
                    value={u.forgeEnabled ? "yes" : "no"}
                    onChange={(e) => setUr(i, { forgeEnabled: e.target.value === "yes" })}
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </label>
                <label className={"le-inline" + (dim ? " le-dim" : "")}>
                  <span>Mode</span>
                  <select
                    className="wl-input le-select"
                    disabled={dim}
                    value={u.forgeMode}
                    onChange={(e) => setUr(i, { forgeMode: e.target.value === "plus1" ? "plus1" : "variable" })}
                  >
                    <option value="plus1">+1 Only</option>
                    <option value="variable">Variable</option>
                  </select>
                </label>
                <label className={"le-inline" + (dim || u.forgeMode === "plus1" ? " le-dim" : "")}>
                  <span>Climb chance %</span>
                  <input
                    className="wl-input le-narrow"
                    inputMode="decimal"
                    disabled={dim || u.forgeMode === "plus1"}
                    value={u.continuePct}
                    onChange={(e) => setUr(i, { continuePct: e.target.value })}
                  />
                  <InfoDot
                    glyph="i"
                    text="For a Variable forge, the chance of climbing one more tier at each step. 50% means +1 half the time, +2 a quarter, and so on. It stops at this set's top card."
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {groups.length > 0 && (
        <>
          <h4 className="le-head">Cards ({items.length})</h4>
          {groups.map((g) => (
            <div className="le-cardgroup" key={g.name}>
              <div className="le-cardgroup-name">{g.name === "base" ? "Main Set" : g.name}</div>
              <div className="le-cards">
                {g.items.map((it, j) => (
                  <div className={"le-card" + (it.isUltraRare ? " le-card-ur" : "")} key={j} title={it.name}>
                    <div className="le-card-tier">T{it.tier}</div>
                    <div className="le-card-name">{it.name}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
