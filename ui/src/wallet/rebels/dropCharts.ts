// Drop charts: what a wreck leaves behind, and how often.
//
// Pure data and arithmetic, no three.js and no network, because the same roll
// runs in three places: the room (its word, for room play), the cockpit (its
// word, flying solo: Geoff, "always drops whether you are flying solo or
// not"), and the admin panel's "test ten thousand rolls" button. One function,
// so those three can never disagree about the odds.
//
// A CHART is a list of item keys with weights; the chance of a given item is
// its weight over the chart's total. A RULE says which chart an enemy uses
// and how likely a drop is at all: the chance is per tier, so a rule at 10%
// gives a tier-one wreck one drop in ten and a tier-seven wreck seven in ten.
// Geoff: "10% x tier of the enemy."
//
// The live config lives in the DD69 Supabase project (rebels_drops, one row)
// and is edited from the wallet's admin overlay. What is here is the default
// it starts from and the fallback when the table cannot be reached.

import { ALL_ITEMS, itemByKey } from "./itemCatalog";

export interface DropEntry { key: string; weight: number }
export interface DropChart { id: string; name: string; entries: DropEntry[] }

/** Which enemies a rule covers. "any" is both. */
export type DropEnemy = "fighter" | "flock" | "any";
export interface DropRule {
  enemy: DropEnemy;
  /** Inclusive enemy tiers, one to seven. */
  tierMin: number;
  tierMax: number;
  chart: string;
  /** Chance of a drop at all, multiplied by the enemy's tier. */
  chancePerTier: number;
}
export interface DropConfig { charts: DropChart[]; rules: DropRule[] }

/** A drop is the killer's alone for this long, then anyone's. */
export const DROP_PRIVATE_SECONDS = 60;
export const DROP_CHANCE_PER_TIER = 0.1;

/** Geoff's Drop chart 1, 2026-Sep-11. */
export const DEFAULT_DROP_CONFIG: DropConfig = {
  charts: [{
    id: "chart1",
    name: "Drop chart 1",
    entries: [
      { key: "recharge", weight: 100_000 },
      { key: "supercharge", weight: 40_000 },
      { key: "reargun", weight: 1_000 },
      { key: "vstrafe1", weight: 40_000 }, { key: "vstrafe2", weight: 10_000 },
      { key: "vstrafe3", weight: 2_500 }, { key: "vstrafe4", weight: 625 },
      { key: "strafe1", weight: 40_000 }, { key: "strafe2", weight: 10_000 },
      { key: "strafe3", weight: 2_500 }, { key: "strafe4", weight: 625 },
      { key: "hull1", weight: 40_000 }, { key: "hull2", weight: 10_000 },
      { key: "hull3", weight: 2_500 }, { key: "hull4", weight: 625 }, { key: "hull5", weight: 156 },
      { key: "portal", weight: 100 },
      { key: "drone1", weight: 10_000 }, { key: "drone2", weight: 2_500 },
      { key: "drone3", weight: 625 }, { key: "drone4", weight: 156 }, { key: "drone5", weight: 39 },
    ],
  }],
  rules: [{ enemy: "any", tierMin: 1, tierMax: 7, chart: "chart1", chancePerTier: DROP_CHANCE_PER_TIER }],
};

export function chartTotal(chart: DropChart): number {
  let t = 0;
  for (const e of chart.entries) t += Math.max(0, e.weight);
  return t;
}

/** Pick by weight. `r` is in [0, 1). Null on an empty chart. */
export function weightedPick(chart: DropChart, r: number): string | null {
  const total = chartTotal(chart);
  if (total <= 0) return null;
  let at = Math.min(Math.max(r, 0), 0.999_999_999) * total;
  for (const e of chart.entries) {
    const w = Math.max(0, e.weight);
    if (w === 0) continue;
    if (at < w) return e.key;
    at -= w;
  }
  return chart.entries[chart.entries.length - 1]?.key ?? null;
}

/** The first rule that covers this enemy, or null: no rule, no drop. */
export function ruleFor(cfg: DropConfig, enemy: "fighter" | "flock", tier: number): DropRule | null {
  for (const r of cfg.rules) {
    if (r.enemy !== "any" && r.enemy !== enemy) continue;
    if (tier < r.tierMin || tier > r.tierMax) continue;
    return r;
  }
  return null;
}

/** The chance a wreck of this tier drops anything at all. */
export function dropChance(cfg: DropConfig, enemy: "fighter" | "flock", tier: number): number {
  const rule = ruleFor(cfg, enemy, tier);
  return rule ? Math.min(1, Math.max(0, rule.chancePerTier * tier)) : 0;
}

/**
 * Roll a kill. Two random numbers, both in [0, 1): whether, then what.
 * Returns the item key, or null for nothing. Deterministic given the numbers,
 * which is what the tests and the admin panel's tally lean on.
 */
export function rollDrop(
  cfg: DropConfig, enemy: "fighter" | "flock", tier: number, rWhether: number, rWhat: number,
): string | null {
  const rule = ruleFor(cfg, enemy, tier);
  if (!rule) return null;
  if (rWhether >= Math.min(1, rule.chancePerTier * tier)) return null;
  const chart = cfg.charts.find((c) => c.id === rule.chart);
  return chart ? weightedPick(chart, rWhat) : null;
}

/** Each item's share of a chart, for reading. Sums to one. */
export function chartOdds(chart: DropChart): Array<{ key: string; share: number }> {
  const total = chartTotal(chart);
  return chart.entries.map((e) => ({ key: e.key, share: total > 0 ? Math.max(0, e.weight) / total : 0 }));
}

/**
 * Check a config from anywhere (the table, the admin panel) and return a
 * clean copy, or the reasons it cannot be used. Unknown item keys are the
 * common mistake and are named.
 */
export function validateDropConfig(raw: unknown): { ok: DropConfig } | { errors: string[] } {
  const errors: string[] = [];
  const o = (raw ?? {}) as Partial<DropConfig>;
  const charts: DropChart[] = [];
  const ids = new Set<string>();
  for (const c of Array.isArray(o.charts) ? o.charts : []) {
    const id = String(c?.id ?? "").trim();
    if (!id) { errors.push("a chart has no id"); continue; }
    if (ids.has(id)) { errors.push(`chart "${id}" appears twice`); continue; }
    ids.add(id);
    const entries: DropEntry[] = [];
    for (const e of Array.isArray(c.entries) ? c.entries : []) {
      const key = String(e?.key ?? "").trim();
      const weight = Number(e?.weight);
      if (!itemByKey(key)) { errors.push(`chart "${id}": "${key}" is not an item`); continue; }
      if (!Number.isFinite(weight) || weight < 0) { errors.push(`chart "${id}": "${key}" has a bad weight`); continue; }
      entries.push({ key, weight });
    }
    if (!entries.length) errors.push(`chart "${id}" is empty`);
    charts.push({ id, name: String(c.name ?? id).slice(0, 60), entries });
  }
  if (!charts.length) errors.push("no charts");
  const rules: DropRule[] = [];
  for (const r of Array.isArray(o.rules) ? o.rules : []) {
    const enemy = r?.enemy === "fighter" || r?.enemy === "flock" ? r.enemy : "any";
    const tierMin = Math.round(Number(r?.tierMin ?? 1)), tierMax = Math.round(Number(r?.tierMax ?? 7));
    const chance = Number(r?.chancePerTier);
    const chart = String(r?.chart ?? "");
    if (!ids.has(chart)) { errors.push(`a rule points at chart "${chart}", which does not exist`); continue; }
    if (!(tierMin >= 1 && tierMax <= 7 && tierMin <= tierMax)) { errors.push(`a rule has tiers ${tierMin}..${tierMax}`); continue; }
    if (!Number.isFinite(chance) || chance < 0 || chance > 1) { errors.push("a rule's chance must be 0 to 1"); continue; }
    rules.push({ enemy, tierMin, tierMax, chart, chancePerTier: chance });
  }
  if (errors.length) return { errors };
  return { ok: { charts, rules } };
}

/** Every key a chart may use, for the admin panel's pickers. */
export function droppableKeys(): string[] {
  return ALL_ITEMS.filter((i) => i.drop && !i.byName).map((i) => i.key);
}
