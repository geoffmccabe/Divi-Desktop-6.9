// The leaderboards.
//
// Two tables, both a hundred entries deep. BEST is the highest single run
// anyone has managed; TOTAL is everything they have ever scored added up, so
// somebody who plays a lot gets on that one by playing a lot rather than by
// having one lucky sortie.
//
// They live in Supabase, in the project the wallet already uses, so the tables
// are the network's and not this machine's. localStorage is kept as well, but
// only as a cache: it is what the modal shows in the instant before the network
// answers, and what it falls back to offline.
//
// A run is filed through a database function rather than by writing the row,
// because merging is the whole point: `best` may only climb and `total` may only
// add. A client that could write the row directly could set its own best to
// anything, and two runs finishing at once would lose one of them. Direct writes
// are refused by policy; the function is the only way in.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../exchanges";

const KEY = "dd69.rebels.scores";
const KEEP = 100;

const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

export interface ScoreRow {
  /** Node name if its owner set one, otherwise the address and country. */
  name: string;
  best: number;
  total: number;
  games: number;
  /** Seven counts, one per ship tier, from tier one upward. */
  tierKills: number[];
  at: number;
}

export const TIER_COUNT = 7;
const noKills = () => new Array(TIER_COUNT).fill(0) as number[];

interface Table { rows: ScoreRow[] }

function read(): Table {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { rows: [] };
    const v = JSON.parse(raw) as Table;
    return Array.isArray(v?.rows) ? v : { rows: [] };
  } catch {
    return { rows: [] };
  }
}

function write(t: Table): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* Out of storage or blocked. A leaderboard is not worth an error. */
  }
}

/**
 * Who the player is.
 *
 * The node's own name when its owner has set one, because that is the name
 * they chose to be known by on the map. Otherwise the node's address and
 * country, which is what the map itself falls back to.
 */
export function playerName(): string {
  try {
    const id = localStorage.getItem("dd69.nodeIdentity");
    if (id) {
      const parsed = JSON.parse(id) as { name?: string };
      const name = (parsed.name ?? "").trim();
      if (name) return name.slice(0, 32);
    }
  } catch {
    /* fall through to the address */
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("dd69.selfGeo.")) continue;
      const g = JSON.parse(localStorage.getItem(k) || "{}") as
        { ip?: string; country?: string };
      if (g.ip) return [g.ip, g.country].filter(Boolean).join(" · ").slice(0, 40);
    }
  } catch {
    /* nothing known */
  }
  return "this node";
}

/**
 * File a finished run, locally and to the network.
 *
 * The local write happens first and always, so the tables are right even with
 * no connection. The network call is fire and forget: a leaderboard is not
 * worth interrupting a game over.
 */
export function recordScore(
  points: number,
  tierKills: number[] = noKills(),
  name = playerName(),
): ScoreRow {
  const kills = tierKills.reduce((a, b) => a + b, 0);
  if (points > 0 || kills > 0) {
    fetch(`${SUPABASE_URL}/rest/v1/rpc/rebels_submit`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_name: name,
        p_points: Math.round(points),
        p_tier_kills: tierKills.slice(0, TIER_COUNT).map((n) => Math.max(0, Math.round(n))),
      }),
    }).catch(() => { /* offline; the local copy still has it */ });
  }
  return recordLocal(points, tierKills, name);
}

function recordLocal(points: number, tierKills: number[], name: string): ScoreRow {
  const t = read();
  let row = t.rows.find((r) => r.name === name);
  if (!row) {
    row = { name, best: 0, total: 0, games: 0, tierKills: noKills(), at: Date.now() };
    t.rows.push(row);
  }
  if (!Array.isArray(row.tierKills) || row.tierKills.length !== TIER_COUNT) {
    row.tierKills = noKills();
  }
  row.best = Math.max(row.best, points);
  row.total += points;
  row.games += 1;
  for (let i = 0; i < TIER_COUNT; i++) row.tierKills[i] += tierKills[i] ?? 0;
  row.at = Date.now();

  /* Trimmed against BOTH tables, so a row that is top-hundred on either one
     survives. Keeping only the top hundred by total would quietly delete the
     holder of the best single run. */
  const keep = new Set<ScoreRow>();
  for (const r of [...t.rows].sort((a, b) => b.best - a.best).slice(0, KEEP)) keep.add(r);
  for (const r of [...t.rows].sort((a, b) => b.total - a.total).slice(0, KEEP)) keep.add(r);
  t.rows = t.rows.filter((r) => keep.has(r));
  write(t);
  return row;
}

export function topByBest(limit = KEEP): ScoreRow[] {
  return [...read().rows].sort((a, b) => b.best - a.best || a.name.localeCompare(b.name)).slice(0, limit);
}

export function topByTotal(limit = KEEP): ScoreRow[] {
  return [...read().rows].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, limit);
}

/**
 * The tables as the network has them.
 *
 * One row per player on both, so a good player takes the top place and not the
 * top twenty however many runs they file.
 */
export async function fetchTop(by: "best" | "total", limit = KEEP): Promise<ScoreRow[] | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rebels_scores` +
      `?select=name,best,total,games,tier_kills,updated_at&order=${by}.desc&limit=${limit}`,
      { headers },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{
      name: string; best: number; total: number; games: number;
      tier_kills: number[] | null; updated_at: string;
    }>;
    return rows.map((r) => ({
      name: r.name,
      best: r.best,
      total: r.total,
      games: r.games,
      tierKills: Array.isArray(r.tier_kills) && r.tier_kills.length === TIER_COUNT
        ? r.tier_kills : noKills(),
      at: Date.parse(r.updated_at) || 0,
    }));
  } catch {
    return null;
  }
}

/**
 * This player's own lifetime row, so the tier tallies can start from what they
 * have already done rather than from zero every time the game opens.
 *
 * Falls back to the local copy, which is what an offline session sees.
 */
export async function myTotals(name = playerName()): Promise<ScoreRow> {
  const local = topByTotal(1000).find((r) => r.name === name)
    ?? { name, best: 0, total: 0, games: 0, tierKills: noKills(), at: 0 };
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rebels_scores` +
      `?name_key=eq.${encodeURIComponent(name.toLowerCase())}` +
      `&select=name,best,total,games,tier_kills,updated_at&limit=1`,
      { headers },
    );
    if (!res.ok) return local;
    const rows = (await res.json()) as Array<{
      name: string; best: number; total: number; games: number;
      tier_kills: number[] | null; updated_at: string;
    }>;
    const r = rows[0];
    if (!r) return local;
    return {
      name: r.name, best: r.best, total: r.total, games: r.games,
      tierKills: Array.isArray(r.tier_kills) && r.tier_kills.length === TIER_COUNT
        ? r.tier_kills : noKills(),
      at: Date.parse(r.updated_at) || 0,
    };
  } catch {
    return local;
  }
}
